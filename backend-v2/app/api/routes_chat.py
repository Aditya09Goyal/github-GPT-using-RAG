from fastapi import APIRouter, HTTPException

from app.core.logging import get_logger
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.rag_chain import answer_question
from app.services.vectorstore import collection_exists

logger = get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(request: ChatRequest):
    """
    Answers a question about an already-indexed repo.
    """
    if not collection_exists(request.collection_name):
        raise HTTPException(
            status_code=404,
            detail=f"Collection '{request.collection_name}' not found. Index it first via POST /repos.",
        )

    try:
        result = answer_question(request.question, request.collection_name)
        return ChatResponse(answer=result["answer"], sources=result["sources"])

    except Exception as e:
        logger.exception(f"Failed to answer question for collection {request.collection_name}")
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")