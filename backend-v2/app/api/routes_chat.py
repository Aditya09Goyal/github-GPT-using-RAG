import json

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse

from app.core.auth import current_user
from app.core.logging import get_logger
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.rag_chain import answer_question, stream_answer
from app.services import user_repos
from app.services.vectorstore import collection_exists

logger = get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


def _ensure_collection(collection_name: str, login: str) -> None:
    if not user_repos.has_repo(login, collection_name):
        raise HTTPException(
            status_code=403, detail="This repo isn't in your list — add it first."
        )
    if not collection_exists(collection_name):
        raise HTTPException(
            status_code=404,
            detail=f"Collection '{collection_name}' not found. Index it first via POST /repos.",
        )


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest, user: dict = Depends(current_user)):
    """
    Answers a question about an already-indexed repo.
    """
    _ensure_collection(request.collection_name, user["sub"])

    try:
        result = answer_question(
            request.question, request.collection_name, request.history
        )
        return ChatResponse(answer=result["answer"], sources=result["sources"])

    except Exception as e:
        logger.exception(
            f"Failed to answer question for collection {request.collection_name}"
        )
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@router.post("/stream")
def chat_stream(request: ChatRequest, user: dict = Depends(current_user)):
    """
    Same as POST /chat, but streams the answer as Server-Sent Events:
      event: sources  data: {"sources": [...]}
      event: token    data: {"content": "..."}   (repeated)
      event: done     data: {}
      event: error    data: {"detail": "..."}    (instead of done, if something fails mid-way)
    """
    _ensure_collection(request.collection_name, user["sub"])

    def events():
        try:
            for item in stream_answer(
                request.question, request.collection_name, request.history
            ):
                kind = item.pop("type")
                yield _sse(kind, item)
            yield _sse("done", {})
        except Exception as e:
            logger.exception(
                f"Streaming failed for collection {request.collection_name}"
            )
            yield _sse("error", {"detail": f"Chat failed: {str(e)}"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        # no-transform / X-Accel-Buffering stop proxies from buffering the stream into one chunk
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
