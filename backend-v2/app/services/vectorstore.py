from langchain_postgres import PGVector
from langchain_core.documents import Document
from sqlalchemy import create_engine, text

from app.core.config import settings
from app.core.logging import get_logger
from app.services.embeddings import get_embedding_model
from app.services.chunker import Chunk

logger = get_logger(__name__)

EMBEDDING_DIM = 384  # all-MiniLM-L6-v2 output size


def _sqlalchemy_url(url: str) -> str:
    """
    Neon gives a URL starting with postgresql:// (or postgres://).
    SQLAlchemy needs to be told to use the psycopg (v3) driver.
    """
    for prefix in ("postgresql+psycopg://", "postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix) :]
    return url


# One shared connection pool for the whole app.
# pool_pre_ping: Neon suspends idle databases, so check a connection is alive before using it.
_engine = create_engine(
    _sqlalchemy_url(settings.database_url),
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
)


def get_vectorstore(collection_name: str) -> PGVector:
    """
    Returns a pgvector-backed store for one repo.
    All repos live in the same two tables (langchain_pg_collection, langchain_pg_embedding);
    collection_name keeps each repo's chunks separate, just like Chroma collections did.
    """
    return PGVector(
        embeddings=get_embedding_model(),
        collection_name=collection_name,
        connection=_engine,
        embedding_length=EMBEDDING_DIM,
        use_jsonb=True,
    )


def add_chunks_to_store(
    chunks: list[Chunk], collection_name: str, on_progress=None
) -> None:
    """
    Embeds and stores chunks in small batches.
    Small batches keep peak RAM low on the free tier, and on_progress(done_count)
    lets the indexing job report live progress to the frontend.
    """
    if not chunks:
        logger.warning("No chunks to add — skipping.")
        return

    store = get_vectorstore(collection_name)
    batch = settings.embed_batch_size

    logger.info(f"Adding {len(chunks)} chunks to collection '{collection_name}'")
    for i in range(0, len(chunks), batch):
        part = chunks[i : i + batch]
        store.add_documents(
            [
                Document(
                    page_content=c.text,
                    metadata={"source": c.source_path, "chunk_index": c.chunk_index},
                )
                for c in part
            ]
        )
        if on_progress:
            on_progress(i + len(part))
    logger.info("Done adding documents.")


def delete_collection(collection_name: str) -> None:
    """
    Removes a collection and all its vectors (embeddings are deleted by ON DELETE CASCADE).
    """
    try:
        with _engine.begin() as conn:
            conn.execute(
                text("DELETE FROM langchain_pg_collection WHERE name = :name"),
                {"name": collection_name},
            )
    except Exception:
        logger.debug(f"Nothing to delete for '{collection_name}'")


def rename_collection(old: str, new: str) -> None:
    """
    Atomically swaps a finished temp collection into its real name
    (and replaces an older copy if one exists — used for re-indexing).
    """
    with _engine.begin() as conn:
        conn.execute(
            text("DELETE FROM langchain_pg_collection WHERE name = :new"), {"new": new}
        )
        conn.execute(
            text("UPDATE langchain_pg_collection SET name = :new WHERE name = :old"),
            {"new": new, "old": old},
        )


def collection_exists(collection_name: str) -> bool:
    """
    Checks whether a collection already has data in it.
    Uses a plain SQL query so that checking never creates an empty collection
    as a side effect (constructing PGVector would).
    """
    query = text("""
        SELECT EXISTS (
            SELECT 1
            FROM langchain_pg_embedding e
            JOIN langchain_pg_collection c ON c.uuid = e.collection_id
            WHERE c.name = :name
        )
        """)
    try:
        with _engine.connect() as conn:
            return bool(conn.execute(query, {"name": collection_name}).scalar())
    except Exception:
        # Tables don't exist yet (fresh database) → nothing has been indexed.
        return False
