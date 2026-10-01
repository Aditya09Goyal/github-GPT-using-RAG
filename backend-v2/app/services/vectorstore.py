import threading
import time

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

# ---------- Full-text (keyword) search column ----------
#
# Postgres' default text parser keeps "auth.py", "settings.database" and whole paths as single tokens
# and never splits camelCase, so plain to_tsvector(document) misses most code identifiers.
# The chunk text is normalised first (the query side, retriever.keyword_query, follows the same rules):
#   1) every run of non-alphanumeric characters becomes a space → snake_case, dotted names and paths
#      split into words ("MAX_FILE_BYTES" → max file bytes, "auth.py" → auth py)
#   2) the same text again with camelCase / PascalCase split, appended → "useAuth" is indexed both as
#      useauth (exact identifier) and as use + auth (its parts)
# 'simple' = lowercase only: no stemming and no stop words, which would mangle identifiers.
# It is a STORED GENERATED column, so Postgres fills it for existing rows when the column is added
# (no re-index needed) and keeps it up to date on every insert (no change to how PGVector writes rows).
TSV_COLUMN = "document_tsv"
_WORDS = r"regexp_replace(coalesce(document, ''), '[^A-Za-z0-9]+', ' ', 'g')"
_CAMEL_SPLIT = (
    rf"regexp_replace(regexp_replace({_WORDS}, '([a-z0-9])([A-Z])', '\1 \2', 'g'), "
    r"'([A-Z])([A-Z][a-z])', '\1 \2', 'g')"
)
TSV_EXPRESSION = f"to_tsvector('simple', {_WORDS}) || to_tsvector('simple', {_CAMEL_SPLIT})"

_schema_lock = threading.Lock()
_hybrid_ready = False
_hybrid_failed_at = 0.0  # after a failed setup, try again at most every few minutes
_HYBRID_RETRY_SECONDS = 300


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


def ensure_hybrid_search_schema() -> bool:
    """
    Idempotent migration for hybrid search, run at startup (and after the first index on a fresh DB):
      - adds the generated tsvector column (Postgres backfills existing rows itself — no re-index)
      - adds a GIN index on it
    Returns True when keyword search is usable. Never raises: on failure search stays vector-only.
    """
    global _hybrid_ready, _hybrid_failed_at
    if _hybrid_ready:
        return True
    if _hybrid_failed_at and time.monotonic() - _hybrid_failed_at < _HYBRID_RETRY_SECONDS:
        return False

    with _schema_lock:
        if _hybrid_ready:
            return True
        try:
            with _engine.begin() as conn:
                if conn.execute(text("SELECT to_regclass('langchain_pg_embedding')")).scalar() is None:
                    # fresh database: PGVector creates the table when the first repo is indexed,
                    # and add_chunks_to_store runs this again then
                    logger.info("Hybrid search: embeddings table doesn't exist yet — will set up after the first index.")
                    return False

                has_column = conn.execute(
                    text(
                        """
                        SELECT EXISTS (
                            SELECT 1 FROM pg_attribute
                            WHERE attrelid = 'langchain_pg_embedding'::regclass
                              AND attname = :col AND NOT attisdropped
                        )
                        """
                    ),
                    {"col": TSV_COLUMN},
                ).scalar()

                if not has_column:
                    t0 = time.perf_counter()
                    logger.info("Hybrid search: adding the full-text column and backfilling existing chunks…")
                    conn.execute(
                        text(
                            f"ALTER TABLE langchain_pg_embedding ADD COLUMN IF NOT EXISTS {TSV_COLUMN} "
                            f"tsvector GENERATED ALWAYS AS ({TSV_EXPRESSION}) STORED"
                        )
                    )
                    logger.info(f"Hybrid search: column added in {time.perf_counter() - t0:.1f} s")

                conn.execute(
                    text(
                        f"CREATE INDEX IF NOT EXISTS ix_langchain_pg_embedding_{TSV_COLUMN} "
                        f"ON langchain_pg_embedding USING gin ({TSV_COLUMN})"
                    )
                )
            _hybrid_ready = True
            _hybrid_failed_at = 0.0
            logger.info("Hybrid search ready (full-text + vector, RRF).")
            return True
        except Exception:
            _hybrid_failed_at = time.monotonic()
            logger.exception("Could not set up hybrid search — falling back to vector-only search.")
            return False


def _query_vector(query: str) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in get_embedding_model().embed_query(query)) + "]"


def _to_documents(rows) -> list[Document]:
    return [Document(page_content=r[0], metadata=dict(r[1] or {})) for r in rows]


def similarity_search(collection_name: str, query: str, k: int) -> list[Document]:
    """
    Top-k cosine search in ONE SQL round trip (same ordering as PGVector's default cosine search).
    Going through PGVector here cost extra round trips per question (collection lookup, and on the
    first question for a repo also CREATE EXTENSION / tables / collection) — slow against a remote DB.
    The overview chunk is skipped: it is always added to the context separately.
    """
    sql = text(
        """
        SELECT e.document, e.cmetadata
        FROM langchain_pg_embedding e
        JOIN langchain_pg_collection c ON c.uuid = e.collection_id
        WHERE c.name = :name AND e.cmetadata->>'source' IS DISTINCT FROM :overview
        ORDER BY e.embedding <=> CAST(:vec AS vector)
        LIMIT :k
        """
    )
    params = {"name": collection_name, "vec": _query_vector(query), "k": k, "overview": OVERVIEW_SOURCE}
    with _engine.connect() as conn:
        rows = conn.execute(sql, params).all()
    return _to_documents(rows)


# Both ranked lists are built and fused with Reciprocal Rank Fusion inside one statement:
#   score(chunk) = 1 / (rrf_k + rank in vector list) + 1 / (rrf_k + rank in keyword list)
# A chunk missing from one list just gets nothing from it. RRF only looks at ranks, so the very
# different scales of cosine distance and ts_rank never have to be compared.
_HYBRID_SQL = text(
    f"""
    WITH coll AS (
        SELECT uuid FROM langchain_pg_collection WHERE name = :name
    ),
    vec AS (
        SELECT e.id, ROW_NUMBER() OVER (ORDER BY e.embedding <=> CAST(:vec AS vector)) AS rnk
        FROM langchain_pg_embedding e
        WHERE e.collection_id = (SELECT uuid FROM coll)
          AND e.cmetadata->>'source' IS DISTINCT FROM :overview
        ORDER BY e.embedding <=> CAST(:vec AS vector)
        LIMIT :pool
    ),
    kw AS (
        SELECT e.id, ROW_NUMBER() OVER (ORDER BY ts_rank(e.{TSV_COLUMN}, q.tsq) DESC, e.id) AS rnk
        FROM langchain_pg_embedding e, to_tsquery('simple', :tsq) AS q(tsq)
        WHERE e.collection_id = (SELECT uuid FROM coll)
          AND e.cmetadata->>'source' IS DISTINCT FROM :overview
          AND e.{TSV_COLUMN} @@ q.tsq
        ORDER BY rnk
        LIMIT :pool
    ),
    fused AS (
        SELECT id, SUM(1.0 / (:rrf_k + rnk)) AS score
        FROM (SELECT id, rnk FROM vec UNION ALL SELECT id, rnk FROM kw) ranked
        GROUP BY id
    )
    SELECT e.document, e.cmetadata, f.score, v.rnk AS vector_rank, k.rnk AS keyword_rank
    FROM fused f
    JOIN langchain_pg_embedding e ON e.id = f.id
    LEFT JOIN vec v ON v.id = f.id
    LEFT JOIN kw k ON k.id = f.id
    ORDER BY f.score DESC, v.rnk NULLS LAST, k.rnk NULLS LAST
    LIMIT :k
    """
)


def hybrid_search(collection_name: str, query: str, ts_query: str | None, k: int) -> list[Document]:
    """
    Keyword (full-text, ts_rank) + vector (cosine) search fused with RRF — one SQL round trip.
    ts_query is a to_tsquery() expression built by retriever.keyword_query.
    Falls back to plain vector search when there are no keywords, the full-text column isn't
    set up yet, or the hybrid query fails for any reason — a question is never lost to this.
    Each Document gets metadata["retrieval"] = {score, vector_rank, keyword_rank} for debugging/eval.
    """
    if not ts_query or not ensure_hybrid_search_schema():
        return similarity_search(collection_name, query, k)

    params = {
        "name": collection_name,
        "vec": _query_vector(query),
        "tsq": ts_query,
        "k": k,
        "pool": max(settings.hybrid_candidates, k),
        "rrf_k": settings.rrf_k,
        "overview": OVERVIEW_SOURCE,
    }
    try:
        with _engine.connect() as conn:
            rows = conn.execute(_HYBRID_SQL, params).all()
    except Exception:
        logger.exception("Hybrid search failed — falling back to vector search for this question.")
        return similarity_search(collection_name, query, k)

    docs = _to_documents(rows)
    for doc, r in zip(docs, rows):
        doc.metadata["retrieval"] = {"score": float(r[2]), "vector_rank": r[3], "keyword_rank": r[4]}
    return docs


def chunk_metadata(chunk: Chunk) -> dict:
    """JSONB metadata saved with each chunk. Line numbers only exist for real file chunks."""
    meta = {"source": chunk.source_path, "chunk_index": chunk.chunk_index}
    if chunk.start_line is not None and chunk.end_line is not None:
        meta["start_line"] = chunk.start_line
        meta["end_line"] = chunk.end_line
    return meta


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
    # On a brand-new database the embeddings table was only just created by get_vectorstore,
    # so the startup migration couldn't add the full-text column yet.
    ensure_hybrid_search_schema()

    logger.info(f"Adding {len(chunks)} chunks to collection '{collection_name}'")
    for i in range(0, len(chunks), batch):
        part = chunks[i : i + batch]
        store.add_documents([Document(page_content=c.text, metadata=chunk_metadata(c)) for c in part])
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
