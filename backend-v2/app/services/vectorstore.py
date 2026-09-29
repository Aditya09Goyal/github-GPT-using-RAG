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
            return "postgresql+psycopg://" + url[len(prefix):]
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


def add_chunks_to_store(chunks: list[Chunk], collection_name: str) -> None:
    """
    Embeds and stores a list of chunks into the given collection.
    Each chunk becomes a Document with metadata (source file + chunk index)
    so we can trace answers back to their origin later.
    """
    if not chunks:
        logger.warning("No chunks to add — skipping.")
        return

    store = get_vectorstore(collection_name)

    documents = [
        Document(
            page_content=chunk.text,
            metadata={
                "source": chunk.source_path,
                "chunk_index": chunk.chunk_index,
            },
        )
        for chunk in chunks
    ]

    logger.info(f"Adding {len(documents)} documents to collection '{collection_name}'")
    batch = 200
    for i in range(0, len(documents), batch):
        store.add_documents(documents[i:i + batch])
    logger.info("Done adding documents.")


def collection_exists(collection_name: str) -> bool:
    """
    Checks whether a collection already has data in it.
    Uses a plain SQL query so that checking never creates an empty collection
    as a side effect (constructing PGVector would).
    """
    query = text(
        """
        SELECT EXISTS (
            SELECT 1
            FROM langchain_pg_embedding e
            JOIN langchain_pg_collection c ON c.uuid = e.collection_id
            WHERE c.name = :name
        )
        """
    )
    try:
        with _engine.connect() as conn:
            return bool(conn.execute(query, {"name": collection_name}).scalar())
    except Exception:
        # Tables don't exist yet (fresh database) → nothing has been indexed.
        return False