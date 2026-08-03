from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from src.rag import RAG
from typing import List
import os
from dotenv import load_dotenv
from datetime import datetime, timezone

load_dotenv()

app = FastAPI(title="GithubChat API", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

rag = RAG()


class QueryRequest(BaseModel):
    repo_url: str
    query: str


class Document(BaseModel):
    text: str
    file_path: str


class QueryResponse(BaseModel):
    answer: str
    contexts: List[Document]


def _repo_name_from_url(repo_url: str) -> str:
    return repo_url.split("/")[-1].replace(".git", "")


@app.post("/query", response_model=QueryResponse)
async def query_repository(request: QueryRequest):
    try:
        rag.prepare_retriever(request.repo_url)
        answer, docs = rag.call(request.query)
        return QueryResponse(
            answer=answer,
            contexts=[
                Document(text=d.page_content, file_path=d.metadata.get("file_path", ""))
                for d in docs
            ],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    return {"status": "healthy", "timestamp": datetime.now(timezone.utc).isoformat()}
