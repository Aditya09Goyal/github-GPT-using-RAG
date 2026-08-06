from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import setup_logging, get_logger

# Set up logging before anything else happens
setup_logging()
logger = get_logger(__name__)

app = FastAPI(
    title="GitHub Chat API",
    description="RAG pipeline to chat with any GitHub repository",
    version="1.0.0",
)


@app.on_event("startup")
async def on_startup():
    logger.info("Starting GitHub Chat API...")
    logger.info(f"Chroma persist dir: {settings.chroma_persist_dir}")
    logger.info(f"Repo clone dir: {settings.repo_clone_dir}")


@app.get("/health")
def health_check():
    return {"status": "ok"}