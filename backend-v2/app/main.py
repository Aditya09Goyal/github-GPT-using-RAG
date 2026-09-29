from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.api import routes_repo, routes_chat
from fastapi.middleware.cors import CORSMiddleware

# Set up logging before anything else happens
setup_logging()
logger = get_logger(__name__)

app = FastAPI(
    title="GitHub Chat API",
    description="RAG pipeline to chat with any GitHub repository",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],  # common Vite / CRA dev ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_repo.router)
app.include_router(routes_chat.router)

@app.on_event("startup")
async def on_startup():
    logger.info("Starting GitHub Chat API...")
    logger.info("Vector store: Postgres + pgvector")
    logger.info(f"Repo clone dir: {settings.repo_clone_dir}")


@app.get("/health")
def health_check():
    return {"status": "ok"}