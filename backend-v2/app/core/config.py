from pydantic_settings import BaseSettings, SettingsConfigDict
from pathlib import Path


class Settings(BaseSettings):
    """
    Central app configuration.
    Values are loaded from environment variables / .env file automatically.
    Field names map to env var names (case-insensitive).
    """

    # --- LLM (Gemini) ---
    google_api_key: str

    # --- GitHub access ---
    github_token: str | None = None  # optional: only needed for private repos / higher rate limits

    # --- Embedding model ---
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"

    # --- Vector store ---
    chroma_persist_dir: str = str(Path(__file__).resolve().parent.parent / "db" / "chroma")

    # --- Repo storage ---
    repo_clone_dir: str = str(Path(__file__).resolve().parent.parent.parent / "data" / "repos")

    # --- Chunking ---
    chunk_size: int = 1000
    chunk_overlap: int = 200

    # --- Retrieval ---
    retriever_top_k: int = 5

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


# Singleton instance — import this everywhere else instead of re-instantiating Settings()
settings = Settings()