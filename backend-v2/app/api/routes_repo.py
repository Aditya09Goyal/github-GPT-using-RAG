from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.core.auth import current_user
from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.repo import IndexRepoRequest, IndexJobStatus
from app.services import jobs, user_repos
from app.services.github_loader import clone_repo, collect_files, remove_clone
from app.services.chunker import Chunk, chunk_files
from app.services.overview import (
    OVERVIEW_SOURCE,
    _github_api,
    _owner_repo,
    build_overview,
)
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
            jobs.update_job(name, status="running", stage="Checking repository size…")
            owner, repo = _owner_repo(repo_url)
            meta = _github_api(f"/repos/{owner}/{repo}") or {}
            size_mb = (meta.get("size") or 0) / 1024  # GitHub reports KB
            if size_mb > settings.max_repo_mb:
                raise RepoTooLarge(
                    f"This repo is about {size_mb:.0f} MB — too big for the free server (limit {settings.max_repo_mb} MB). "
                    "Try a smaller repo."
                )

            jobs.update_job(name, stage="Downloading repository…")
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
            chunks.insert(
                0,
                Chunk(
                    text=build_overview(repo_url, repo_path, files),
                    source_path=OVERVIEW_SOURCE,
                    chunk_index=0,
                ),
            )

            jobs.update_job(name, stage="Embedding chunks…", chunks=len(chunks))
            add_chunks_to_store(
                chunks, tmp, on_progress=lambda n: jobs.update_job(name, embedded=n)
            )

            rename_collection(tmp, name)
            for login in jobs.get_job(name).requested_by:
                user_repos.add_repo(login, name, repo_url, len(files), len(chunks))
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


@router.get("")
def my_repos(user: dict = Depends(current_user)):
    """
    The signed-in user's own repo list (what their sidebar shows).
    """
    return [
        {
            "name": r["collection_name"],
            "url": r["repo_url"],
            "files": r["files"],
            "chunks": r["chunks"],
            "indexed_at": r["indexed_at"].isoformat() if r["indexed_at"] else None,
        }
        for r in user_repos.list_repos(user["sub"])
    ]


@router.post("", response_model=IndexJobStatus, status_code=202)
def index_repo(
    request: IndexRepoRequest,
    background: BackgroundTasks,
    user: dict = Depends(current_user),
):
    """
    Adds a repo to the signed-in user's list, indexing it in the background if needed (202).
    Poll GET /repos/{collection_name}/status until status is "done" or "failed".
    If someone already indexed this repo, it's linked instantly (the vectors are shared).
    """
    name = request.collection_name
    login = user["sub"]

    job = jobs.get_job(name)
    if job and job.status in ("queued", "running"):
        if login not in job.requested_by:
            job.requested_by.append(
                login
            )  # someone else is indexing it → you get it too when it finishes
        return job.to_dict()

    if collection_exists(name) and not request.force:
        files, chunks = user_repos.known_stats(name)
        user_repos.add_repo(login, name, request.repo_url, files, chunks)
        return IndexJobStatus(
            collection_name=name,
            repo_url=request.repo_url,
            status="done",
            stage="Done",
            files=files,
            chunks=chunks,
            embedded=chunks,
            started_at=0,
        )

    job = jobs.create_job(name, request.repo_url, login)
    background.add_task(_run_index, request.repo_url, name)
    return job.to_dict()


@router.get("/{collection_name}/status", response_model=IndexJobStatus)
def index_status(collection_name: str):
    job = jobs.get_job(collection_name)
    if job:
        return job.to_dict()
    if collection_exists(collection_name):
        # indexed before the last server restart
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
def remove_repo(collection_name: str, user: dict = Depends(current_user)):
    """
    Removes the repo from YOUR list. The vectors are deleted only when no user has it anymore.
    """
    if jobs.is_active(collection_name):
        raise HTTPException(status_code=409, detail="This repo is still being indexed.")
    if user_repos.remove_repo(user["sub"], collection_name) == 0:
        delete_collection(collection_name)
