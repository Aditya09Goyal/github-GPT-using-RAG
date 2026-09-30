from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import IntegrityError

from app.core.logging import get_logger
from app.schemas.repo import IndexRepoRequest, IndexRepoResponse
from app.services.github_loader import clone_repo, collect_files
from app.services.chunker import chunk_files
from app.services.auth import CurrentUser, get_current_user
from app.services.repo_registry import find_repo, internal_collection_name, register_repo
from app.services.vectorstore import add_chunks_to_store, delete_collection

logger = get_logger(__name__)
router = APIRouter(prefix="/repos", tags=["repos"])


@router.post("", response_model=IndexRepoResponse)
def index_repo(request: IndexRepoRequest, user: CurrentUser = Depends(get_current_user)):
    """
    Clones a GitHub repo, chunks it, embeds it, and stores it in a new collection
    owned by the signed-in user.
    Rejects the request if this user already has a repo with this collection_name —
    caller should pick a new name or explicitly re-index (not supported yet).
    """
    if find_repo(user.id, request.collection_name):
        raise HTTPException(
            status_code=409,
            detail=f"Collection '{request.collection_name}' already exists. "
                   f"Choose a different name, or delete it first before re-indexing.",
        )

    collection = internal_collection_name(user.id, request.collection_name)
    # Leftovers from an earlier attempt that crashed half-way would otherwise be mixed in.
    delete_collection(collection)

    try:
        repo_path = clone_repo(request.repo_url, collection)
        files = collect_files(repo_path)

        if not files:
            raise HTTPException(status_code=422, detail="No indexable files found in this repository.")

        chunks = chunk_files(files, repo_path)
        add_chunks_to_store(chunks, collection_name=collection)

        try:
            register_repo(user.id, request.collection_name, collection, request.repo_url, len(files), len(chunks))
        except IntegrityError:
            # Same user indexed the same name twice at the same time; the other request won.
            raise HTTPException(status_code=409, detail=f"Collection '{request.collection_name}' already exists.")

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