from pydantic_settings import BaseSettings, SettingsConfigDict
import tempfile
from pathlib import Path


class Settings(BaseSettings):
    """
    Central app configuration.
    Values are loaded from environment variables / .env file automatically.
    Field names map to env var names (case-insensitive).
    """

    # --- LLM (Groq) ---
    groq_api_key: str
    google_api_key: str | None = None

    # --- GitHub access ---
    github_token: str | None = None  # optional: only needed for private repos / higher rate limits

    # --- Embedding model ---
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_cache_dir: str = str(Path(__file__).resolve().parent.parent.parent / ".cache" / "fastembed")

    # --- Vector store ---
    database_url: str  # Neon connection string (postgresql://...), set in .env

    # --- Repo storage ---
    # outside the project folder: cloning into backend-v2/ made `uvicorn --reload` restart mid-indexing
    repo_clone_dir: str = str(Path(tempfile.gettempdir()) / "ghgpt-repos")

    # --- Chunking ---
    chunk_size: int = 1000
    chunk_overlap: int = 200

    # --- Limits for big repos (free tier = 512 MB RAM, slow CPU) ---
    max_repo_mb: int = 150  # checked on GitHub BEFORE cloning, so huge repos fail in 1 second, not after a long download
    max_files: int = 1500  # repos with more indexable files than this are rejected with a clear message
    max_chunks: int = 8000  # same idea for total chunks — keeps embedding time and DB size sane
    embed_batch_size: int = 64  # chunks embedded + saved per step (smaller = less RAM, more progress updates)

    # --- Retrieval ---
    retriever_top_k: int = 8

    # --- Conversation memory ---
    history_max_messages: int = 6  # how many earlier messages (user + assistant) the LLM sees
    history_max_chars: int = 1500  # long earlier answers are cut to this length to save tokens

    # --- Login with GitHub (OAuth App: github.com/settings/developers) ---
    github_client_id: str | None = None
    github_client_secret: str | None = None
    jwt_secret: str = "change-me-in-production"  # signs our own login tokens — set a long random value on Render
    jwt_expire_days: int = 7
    backend_url: str = "http://localhost:8000"  # where GitHub sends users back (…/auth/github/callback)
    frontend_url: str = "http://localhost:3000"  # where we send users after login

    # --- CORS ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


# Singleton instance — import this everywhere else instead of re-instantiating Settings()
settings = Settings()