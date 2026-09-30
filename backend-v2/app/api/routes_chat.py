import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.logging import get_logger
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.rag_chain import answer_question, stream_answer
from app.services.auth import CurrentUser, get_current_user
from app.services.repo_registry import find_repo

logger = get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


def _owned_collection(user: CurrentUser, name: str) -> str:
    """
    Returns the pgvector collection behind the user's repo `name`.
    Someone else's repo gets the same 404 as a missing one, so names can't be probed.
    """
    repo = find_repo(user.id, name)
    if repo is None:
        raise HTTPException(
            status_code=404,
            detail=f"Collection '{name}' not found. Index it first via POST /repos.",
        )
    return repo.collection_name


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    """
    Answers a question about an already-indexed repo.
    """
    collection = _owned_collection(user, request.collection_name)

    try:
        result = answer_question(request.question, collection, request.history)
        return ChatResponse(answer=result["answer"], sources=result["sources"])

    except Exception as e:
        logger.exception(f"Failed to answer question for collection {request.collection_name}")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/stream")
def chat_stream(request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    """
    Same as POST /chat, but streams the answer as Server-Sent Events:
      event: sources  data: {"sources": [...]}
      event: token    data: {"content": "..."}   (repeated)
      event: done     data: {}
      event: error    data: {"detail": "..."}    (instead of done, if something fails mid-way)
    """
    collection = _owned_collection(user, request.collection_name)

    def events():
        try:
            for item in stream_answer(request.question, collection, request.history):
                kind = item.pop("type")
                yield _sse(kind, item)
            yield _sse("done", {})
        except Exception as e:
            logger.exception(f"Streaming failed for collection {request.collection_name}")
            yield _sse("error", {"detail": f"Chat failed: {str(e)}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # no-transform / X-Accel-Buffering stop proxies from buffering the stream into one chunk
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
