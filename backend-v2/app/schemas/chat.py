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


class Citation(BaseModel):
    """
    One file region an answer was grounded in, e.g. app/auth.py lines 12-40 (1-based, inclusive).
    Lines are None for repos indexed before line numbers were recorded (re-index to get them).
    """
    path: str
    start_line: int | None = None
    end_line: int | None = None


class ChatResponse(BaseModel):
    """
    What we send back: the answer plus which files (sources) and exact
    line ranges (citations) it was grounded in.
    """
    answer: str
    sources: list[str]
    citations: list[Citation] = Field(default_factory=list)
