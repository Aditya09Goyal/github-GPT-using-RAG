import threading

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


# Building a PGVector runs CREATE EXTENSION + create tables + create collection against the DB,
# so it is built once per collection and reused (was 2-3 times per question before).
_stores: dict[str, PGVector] = {}
_overviews: dict[str, Document | None] = {}
_cache_lock = threading.Lock()

OVERVIEW_SOURCE = "__overview__"


def _forget(*names: str) -> None:
    """Drop cached store/overview after a collection is deleted, renamed or re-indexed."""
    with _cache_lock:
        for n in names:
            _stores.pop(n, None)
            _overviews.pop(n, None)


def get_vectorstore(collection_name: str) -> PGVector:
    """
    Returns a pgvector-backed store for one repo (cached per collection).
    All repos live in the same two tables (langchain_pg_collection, langchain_pg_embedding);
    collection_name keeps each repo's chunks separate.
    """
    store = _stores.get(collection_name)
    if store is None:
        with _cache_lock:
            store = _stores.get(collection_name)
            if store is None:
                store = PGVector(
                    embeddings=get_embedding_model(),
                    collection_name=collection_name,
                    connection=_engine,
                    embedding_length=EMBEDDING_DIM,
                    use_jsonb=True,
                )
                _stores[collection_name] = store
    return store


def get_overview_doc(collection_name: str) -> Document | None:
    """
    The repo overview chunk, fetched with one plain SQL query (no embedding, no vector search)
    and cached in memory. Repos indexed before the overview existed return None.
    """
    if collection_name in _overviews:
        return _overviews[collection_name]
    query = text(
        """
        SELECT e.document, e.cmetadata
        FROM langchain_pg_embedding e
        JOIN langchain_pg_collection c ON c.uuid = e.collection_id
        WHERE c.name = :name AND e.cmetadata->>'source' = :source
        LIMIT 1
        """
    )
    with _engine.connect() as conn:
        row = conn.execute(query, {"name": collection_name, "source": OVERVIEW_SOURCE}).first()
    doc = Document(page_content=row[0], metadata=dict(row[1] or {})) if row else None
    with _cache_lock:
        _overviews[collection_name] = doc
    return doc


def similarity_search(collection_name: str, query: str, k: int) -> list[Document]:
    """
    Top-k cosine search in ONE SQL round trip (same ordering as PGVector's default cosine search).
    Going through PGVector here cost extra round trips per question (collection lookup, and on the
    first question for a repo also CREATE EXTENSION / tables / collection) — slow against a remote DB.
    """
    vec = "[" + ",".join(f"{x:.7f}" for x in get_embedding_model().embed_query(query)) + "]"
    sql = text(
        """
        SELECT e.document, e.cmetadata
        FROM langchain_pg_embedding e
        JOIN langchain_pg_collection c ON c.uuid = e.collection_id
        WHERE c.name = :name
        ORDER BY e.embedding <=> CAST(:vec AS vector)
        LIMIT :k
        """
    )
    with _engine.connect() as conn:
        rows = conn.execute(sql, {"name": collection_name, "vec": vec, "k": k}).all()
    return [Document(page_content=r[0], metadata=dict(r[1] or {})) for r in rows]


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
    _forget(collection_name)
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
    _forget(old, new)


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
