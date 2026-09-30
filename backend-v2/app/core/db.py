from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    UniqueConstraint,
    create_engine,
    func,
)

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


def _sqlalchemy_url(url: str) -> str:
    """
    Neon gives a URL starting with postgresql:// (or postgres://).
    SQLAlchemy needs to be told to use the psycopg (v3) driver.
    """
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


# One shared connection pool for the whole app.
# pool_pre_ping: Neon suspends idle databases, so check a connection is alive before using it.
engine = create_engine(
    _sqlalchemy_url(settings.database_url),
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
)

metadata = MetaData()

# People who signed in with GitHub.
users = Table(
    "users",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("github_id", BigInteger, nullable=False, unique=True),
    Column("login", String, nullable=False),
    Column("name", String),
    Column("avatar_url", String),
    Column("created_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
)

# Which user owns which indexed repo.
# `name` is what the user sees and sends (e.g. "octocat-hello-world");
# `collection_name` is the pgvector collection it lives in (e.g. "u3__octocat-hello-world"),
# so two users can index a repo under the same name without clashing.
repos = Table(
    "repos",
    metadata,
    Column("id", Integer, primary_key=True),
    Column("owner_id", Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
    Column("name", String, nullable=False),
    Column("collection_name", String, nullable=False, unique=True),
    Column("repo_url", String),
    Column("files_indexed", Integer),
    Column("chunks_created", Integer),
    Column("indexed_at", DateTime(timezone=True), server_default=func.now(), nullable=False),
    UniqueConstraint("owner_id", "name", name="uq_repos_owner_name"),
)


def init_db() -> None:
    """Creates the app's own tables if they don't exist yet (safe to run on every startup)."""
    metadata.create_all(engine)
    logger.info("Database tables ready (users, repos).")
