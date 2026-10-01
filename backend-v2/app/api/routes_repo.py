from fastapi import APIRouter, BackgroundTasks, HTTPException

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.repo import IndexRepoRequest, IndexJobStatus
from app.services import jobs
from app.services.github_loader import clone_repo, collect_files, remove_clone
from app.services.chunker import Chunk, chunk_files
from app.services.overview import OVERVIEW_SOURCE, build_overview
from app.services.vectorstore import (
    add_chunks_to_store,
    collection_exists,
    delete_collection,
    rename_collection,
)

logger = get_logger(__name__)
router = APIRouter(prefix="/repos", tags=["repos"])


class RepoTooLarge(Exception):
    pass


def _run_index(repo_url: str, name: str) -> None:
    """
    Runs in the background after POST /repos has already answered.
    Vectors go into a temporary "<name>__tmp" collection and are only renamed to <name>
    once everything succeeded — so a crash never leaves a half-indexed repo behind.
    """
    tmp = f"{name}__tmp"
    repo_path = None

    with jobs.index_lock:  # one repo at a time on the free tier
        try:
            jobs.update_job(name, status="running", stage="Downloading repository…")
            delete_collection(tmp)  # leftovers from a crashed earlier run
            repo_path = clone_repo(repo_url, name)

            jobs.update_job(name, stage="Scanning files…")
            files = collect_files(repo_path)
            if not files:
                raise RepoTooLarge("No indexable files found in this repository.")
            if len(files) > settings.max_files:
                raise RepoTooLarge(
                    f"This repo has {len(files)} code files — the free server can index up to {settings.max_files}. "
                    "Try a smaller repo."
                )

            jobs.update_job(name, stage="Splitting code into chunks…", files=len(files))
            chunks = chunk_files(files, repo_path)
            if len(chunks) > settings.max_chunks:
                raise RepoTooLarge(
                    f"This repo is too big to index on the free server (more than {settings.max_chunks} chunks). "
                    "Try a smaller repo."
                )

            jobs.update_job(name, stage="Reading repo info from GitHub…")
            chunks.insert(0, Chunk(text=build_overview(repo_url, repo_path, files), source_path=OVERVIEW_SOURCE, chunk_index=0))

            jobs.update_job(name, stage="Embedding chunks…", chunks=len(chunks))
            add_chunks_to_store(
                chunks, tmp, on_progress=lambda n: jobs.update_job(name, embedded=n)
            )

            rename_collection(tmp, name)
            jobs.update_job(name, status="done", stage="Done")
            logger.info(
                f"Indexed {repo_url} → '{name}' ({len(files)} files, {len(chunks)} chunks)"
            )

        except RepoTooLarge as e:
            delete_collection(tmp)
            jobs.update_job(name, status="failed", stage="Failed", error=str(e))
        except Exception as e:
            logger.exception(f"Failed to index repo {repo_url}")
            delete_collection(tmp)
            jobs.update_job(
                name, status="failed", stage="Failed", error=f"Indexing failed: {e}"
            )
        finally:
            if repo_path is not None:
                try:
                    remove_clone(repo_path)
                except Exception:
                    logger.warning(f"Could not delete clone at {repo_path}")


@router.post("", response_model=IndexJobStatus, status_code=202)
def index_repo(request: IndexRepoRequest, background: BackgroundTasks):
    """
    Starts indexing in the background and returns immediately (202).
    Poll GET /repos/{collection_name}/status until status is "done" or "failed".
    """
    name = request.collection_name

    if jobs.is_active(name):
        return jobs.get_job(name).to_dict()

    if collection_exists(name) and not request.force:
        raise HTTPException(
            status_code=409,
            detail=f"Collection '{name}' already exists. Send force=true to re-index it.",
        )

    job = jobs.create_job(name, request.repo_url)
    background.add_task(_run_index, request.repo_url, name)
    return job.to_dict()


@router.get("/{collection_name}/status", response_model=IndexJobStatus)
def index_status(collection_name: str):
    job = jobs.get_job(collection_name)
    if job:
        return job.to_dict()
    if collection_exists(collection_name):
        return IndexJobStatus(
            collection_name=collection_name,
            repo_url="",
            status="done",
            stage="Done",
            files=0,
            chunks=0,
            embedded=0,
            started_at=0,
        )
    raise HTTPException(
        status_code=404,
        detail="No indexing job found. The server may have restarted (often: ran out of memory on a big repo) — try again.",
    )


@router.delete("/{collection_name}", status_code=204)
def delete_repo(collection_name: str):
    """
    Deletes an indexed repo's vectors from the database.
    """
    if jobs.is_active(collection_name):
        raise HTTPException(status_code=409, detail="This repo is still being indexed.")
    delete_collection(collection_name)
