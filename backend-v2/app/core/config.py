from pydantic_settings import BaseSettings, SettingsConfigDict
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

    # --- Sign in with GitHub (OAuth App: github.com/settings/developers) ---
    github_client_id: str
    github_client_secret: str
    jwt_secret: str  # long random string used to sign login tokens, e.g. `openssl rand -hex 32`
    jwt_expire_days: int = 30
    # GitHub login of the owner; on their sign-in, repos indexed before login existed are assigned to them
    admin_github_login: str | None = None

    # --- Embedding model ---
    embedding_model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_cache_dir: str = str(Path(__file__).resolve().parent.parent.parent / ".cache" / "fastembed")

    # --- Vector store ---
    database_url: str  # Neon connection string (postgresql://...), set in .env

    # --- Repo storage ---
    repo_clone_dir: str = str(Path(__file__).resolve().parent.parent.parent / "data" / "repos")

    # --- Chunking ---
    chunk_size: int = 1000
    chunk_overlap: int = 200

    # --- Retrieval ---
    retriever_top_k: int = 5

    # --- Conversation memory ---
    history_max_messages: int = 6  # how many earlier messages (user + assistant) the LLM sees
    history_max_chars: int = 1500  # long earlier answers are cut to this length to save tokens

    # --- CORS ---
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


# Singleton instance — import this everywhere else instead of re-instantiating Settings()
settings = Settings()