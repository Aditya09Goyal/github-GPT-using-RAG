from fastapi import FastAPI

from app.core.config import settings
from app.core.logging import setup_logging, get_logger
from app.api import routes_auth, routes_repo, routes_chat
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
    allow_origins=[
        o.strip() for o in settings.cors_origins.split(",") if o.strip()
    ],  # common Vite / CRA dev ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_auth.router)
app.include_router(routes_repo.router)
app.include_router(routes_chat.router)


@app.on_event("startup")
async def on_startup():
    logger.info("Starting GitHub Chat API...")
    logger.info("Vector store: Postgres + pgvector")
    logger.info(f"Repo clone dir: {settings.repo_clone_dir}")
    from app.services.user_repos import ensure_table

    ensure_table()  # per-user repo lists

    # Hybrid search migration: full-text column (backfilled by Postgres, no re-index) + GIN index.
    # Idempotent and never raises — if it can't run, search stays vector-only.
    from app.services.vectorstore import ensure_hybrid_search_schema

    ensure_hybrid_search_schema()

    # load the ONNX embedding model now, not on the first question after a (cold) start
    from app.services.embeddings import get_embedding_model

    get_embedding_model()


@app.get("/health")
def health_check():
    return {"status": "ok"}
