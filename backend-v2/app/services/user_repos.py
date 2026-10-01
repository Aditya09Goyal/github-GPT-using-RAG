from sqlalchemy import text

from app.core.logging import get_logger
from app.services.vectorstore import _engine

logger = get_logger(__name__)

# Which user has which repo in their sidebar.
# The vectors themselves are shared (same public code = index once), but every user
# only ever sees and chats with the repos they added.
CREATE_SQL = """
CREATE TABLE IF NOT EXISTS user_repos (
    login           TEXT NOT NULL,
    collection_name TEXT NOT NULL,
    repo_url        TEXT NOT NULL,
    files           INTEGER NOT NULL DEFAULT 0,
    chunks          INTEGER NOT NULL DEFAULT 0,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (login, collection_name)
)
"""


def ensure_table() -> None:
    with _engine.begin() as conn:
        conn.execute(text(CREATE_SQL))


def list_repos(login: str) -> list[dict]:
    with _engine.connect() as conn:
        rows = conn.execute(
            text(
                "SELECT collection_name, repo_url, files, chunks, indexed_at FROM user_repos "
                "WHERE login = :login ORDER BY indexed_at DESC"
            ),
            {"login": login},
        ).mappings()
        return [dict(r) for r in rows]


def has_repo(login: str, collection_name: str) -> bool:
    with _engine.connect() as conn:
        return bool(
            conn.execute(
                text("SELECT 1 FROM user_repos WHERE login = :login AND collection_name = :name"),
                {"login": login, "name": collection_name},
            ).first()
        )


def access(login: str, collection_name: str) -> tuple[bool, bool]:
    """
    (repo is in this user's list, repo has vectors) — both answered in ONE round trip,
    because every chat request checks them.
    """
    sql = text(
        """
        SELECT
          EXISTS (SELECT 1 FROM user_repos WHERE login = :login AND collection_name = :name),
          EXISTS (
            SELECT 1 FROM langchain_pg_embedding e
            JOIN langchain_pg_collection c ON c.uuid = e.collection_id
            WHERE c.name = :name
          )
        """
    )
    with _engine.connect() as conn:
        row = conn.execute(sql, {"login": login, "name": collection_name}).first()
    return bool(row[0]), bool(row[1])


def add_repo(login: str, collection_name: str, repo_url: str, files: int, chunks: int) -> None:
    with _engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO user_repos (login, collection_name, repo_url, files, chunks)
                VALUES (:login, :name, :url, :files, :chunks)
                ON CONFLICT (login, collection_name)
                DO UPDATE SET repo_url = :url, files = :files, chunks = :chunks, indexed_at = now()
                """
            ),
            {"login": login, "name": collection_name, "url": repo_url, "files": files, "chunks": chunks},
        )


def remove_repo(login: str, collection_name: str) -> int:
    """
    Removes the repo from this user's list. Returns how many users still have it.
    """
    with _engine.begin() as conn:
        conn.execute(
            text("DELETE FROM user_repos WHERE login = :login AND collection_name = :name"),
            {"login": login, "name": collection_name},
        )
        return conn.execute(
            text("SELECT count(*) FROM user_repos WHERE collection_name = :name"), {"name": collection_name}
        ).scalar() or 0


def known_stats(collection_name: str) -> tuple[int, int]:
    """
    files / chunks of an already-indexed repo (from whoever indexed it first).
    """
    with _engine.connect() as conn:
        row = conn.execute(
            text("SELECT files, chunks FROM user_repos WHERE collection_name = :name ORDER BY indexed_at LIMIT 1"),
            {"name": collection_name},
        ).first()
        return (row[0], row[1]) if row else (0, 0)