from typing import Literal

from pydantic import BaseModel, Field


class ChatTurn(BaseModel):
    """
    One earlier message in the conversation, sent back by the client
    so follow-up questions ("and where is that called?") can be understood.
    """
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    """
    What the client sends to ask a question about an already-indexed repo.
    """
    question: str = Field(..., min_length=1, description="The user's question about the repo")
    collection_name: str = Field(..., description="Which indexed repo to query")
    history: list[ChatTurn] = Field(
        default_factory=list,
        description="Earlier messages in this chat, oldest first. Only the most recent few are used.",
    )


class ChatResponse(BaseModel):
    """
    What we send back: the answer plus which files it was grounded in.
    """
    answer: str
    sources: list[str]
