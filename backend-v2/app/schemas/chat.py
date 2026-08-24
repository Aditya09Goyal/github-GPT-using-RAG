from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """
    What the client sends to ask a question about an already-indexed repo.
    """
    question: str = Field(..., min_length=1, description="The user's question about the repo")
    collection_name: str = Field(..., description="Which indexed repo to query")


class ChatResponse(BaseModel):
    """
    What we send back: the answer plus which files it was grounded in.
    """
    answer: str
    sources: list[str]
