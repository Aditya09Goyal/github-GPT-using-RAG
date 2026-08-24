from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.schemas.repo import IndexRepoRequest, IndexRepoResponse
from app.services.github_loader import clone_repo, collect_files
from app.services.chunker import chunk_files
from app.services.vectorstore import add_chunks_to_store, collection_exists

logger = get_logger(__name__)
router = APIRouter(prefix="/repos", tags=["repos"])


@router.post("", response_model=IndexRepoResponse)
def index_repo(request: IndexRepoRequest):
    """
    Clones a GitHub repo, chunks it, embeds it, and stores it in a new collection.
    Rejects the request if this collection_name was already indexed —
    caller should pick a new name or explicitly re-index (not supported yet).
    """
    if collection_exists(request.collection_name):
        raise HTTPException(
            status_code=409,
            detail=f"Collection '{request.collection_name}' already exists. "
                   f"Choose a different name, or delete it first before re-indexing.",
        )

    try:
        repo_path = clone_repo(request.repo_url, request.collection_name)
        files = collect_files(repo_path)

        if not files:
            raise HTTPException(status_code=422, detail="No indexable files found in this repository.")

        chunks = chunk_files(files, repo_path)
        add_chunks_to_store(chunks, collection_name=request.collection_name)

        return IndexRepoResponse(
            collection_name=request.collection_name,
            files_indexed=len(files),
            chunks_created=len(chunks),
            message="Repository indexed successfully.",
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to index repo {request.repo_url}")
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")