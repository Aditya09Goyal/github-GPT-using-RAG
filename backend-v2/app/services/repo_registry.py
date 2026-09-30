from dataclasses import dataclass

from sqlalchemy import select, text

from app.core.db import engine, repos
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class RepoRecord:
    name: str
    collection_name: str
    repo_url: str | None


def internal_collection_name(user_id: int, name: str) -> str:
    """The pgvector collection a user's repo is stored in — prefixed so names never clash between users."""
    return f"u{user_id}__{name}"


def find_repo(user_id: int, name: str) -> RepoRecord | None:
    """Returns the user's repo with this name, or None if they don't own one."""
    stmt = select(repos.c.name, repos.c.collection_name, repos.c.repo_url).where(
        repos.c.owner_id == user_id, repos.c.name == name
    )
    with engine.connect() as conn:
        row = conn.execute(stmt).first()
    return RepoRecord(*row) if row else None


def register_repo(user_id: int, name: str, collection_name: str, repo_url: str, files: int, chunks: int) -> None:
    """Records that the user owns this collection. Raises IntegrityError if the name is already taken."""
    stmt = repos.insert().values(
        owner_id=user_id,
        name=name,
        collection_name=collection_name,
        repo_url=repo_url,
        files_indexed=files,
        chunks_created=chunks,
    )
    with engine.begin() as conn:
        conn.execute(stmt)


def claim_legacy_collections(user_id: int) -> int:
    """
    Collections indexed before sign-in existed have no owner, so nobody could chat with them.
    Assigns all of them to this user (the admin). Returns how many were claimed.
    """
    stmt = text(
        r"""
        INSERT INTO repos (owner_id, name, collection_name)
        SELECT :uid, c.name, c.name
        FROM langchain_pg_collection c
        WHERE c.name NOT IN (SELECT collection_name FROM repos)
          AND c.name !~ '^u[0-9]+__'
        ON CONFLICT DO NOTHING
        """
    )
    try:
        with engine.begin() as conn:
            claimed = conn.execute(stmt, {"uid": user_id}).rowcount
    except Exception as e:
        # Fresh database: the langchain tables don't exist until the first repo is indexed.
        logger.info(f"No legacy collections to claim ({e.__class__.__name__})")
        return 0
    if claimed:
        logger.info(f"Assigned {claimed} pre-login collection(s) to user {user_id}")
    return claimed
