"""
Integration tests against a real Postgres + pgvector (skipped unless TEST_DATABASE_URL is set).
Uses a tiny deterministic fake embedder, so no model download is needed.
WARNING: drops and recreates the langchain_pg_* tables in that database — use a throwaway DB.
"""
import hashlib
import math
import os

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")

from sqlalchemy import text  # noqa: E402

from app.services import retriever, vectorstore  # noqa: E402
from app.services.chunker import Chunk  # noqa: E402


class FakeEmbeddings:
    """Bag-of-words hashed into 384 dims, L2-normalised — similar texts get similar vectors."""

    def _vec(self, s: str) -> list[float]:
        v = [0.0] * vectorstore.EMBEDDING_DIM
        for w in s.lower().split():
            v[int(hashlib.md5(w.encode()).hexdigest(), 16) % len(v)] += 1.0
        n = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / n for x in v]

    def embed_documents(self, texts):
        return [self._vec(t) for t in texts]

    def embed_query(self, t):
        return self._vec(t)


@pytest.fixture()
def db(monkeypatch):
    fake = FakeEmbeddings()
    monkeypatch.setattr(vectorstore, "get_embedding_model", lambda: fake)
    with vectorstore._engine.begin() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.execute(text("DROP TABLE IF EXISTS langchain_pg_embedding, langchain_pg_collection CASCADE"))
    vectorstore._stores.clear()
    vectorstore._overviews.clear()
    vectorstore._hybrid_ready = False
    vectorstore._hybrid_failed_at = 0.0
    yield
    vectorstore._stores.clear()
    vectorstore._hybrid_ready = False


NOISE = [
    Chunk(f"File: docs/notes{i}.md\nGeneral notes about how authentication and login work in apps.", f"docs/notes{i}.md", 0, 1, 2)
    for i in range(30)
]
TARGETS = [
    Chunk("File: src/hooks/useAuth.ts\nexport function useAuth() {\n  return useContext(AuthCtx);\n}", "src/hooks/useAuth.ts", 0, 3, 6),
    Chunk("File: server/config.py\nPORT = int(os.getenv('PORT', 8000))\nMAX_FILE_BYTES = 200_000", "server/config.py", 0, 10, 11),
    Chunk("File: lib/route_optimizer.py\nclass RouteOptimizer:\n    def pick(self): ...", "lib/route_optimizer.py", 0, 1, 2),
]


def _insert_old_style(collection: str, chunks: list[Chunk]):
    """Writes chunks exactly like the pre-hybrid code did (no tsvector column involved)."""
    store = vectorstore.get_vectorstore(collection)
    from langchain_core.documents import Document

    store.add_documents([Document(page_content=c.text, metadata=vectorstore.chunk_metadata(c)) for c in chunks])


def _has_column() -> bool:
    with vectorstore._engine.connect() as conn:
        return conn.execute(
            text("SELECT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'langchain_pg_embedding'::regclass AND attname = 'document_tsv')")
        ).scalar()


def test_migration_on_fresh_db_is_a_noop_until_tables_exist(db):
    assert vectorstore.ensure_hybrid_search_schema() is False
    vectorstore._hybrid_failed_at = 0.0
    vectorstore.add_chunks_to_store(TARGETS, "fresh")  # creates tables, then the migration runs
    assert _has_column()
    assert retriever.retrieve_relevant_chunks("useAuth", "fresh", top_k=1)[0].metadata["source"] == "src/hooks/useAuth.ts"


def test_backfills_existing_rows_without_reindex_and_finds_identifiers(db):
    _insert_old_style("repo", NOISE + TARGETS)  # an "old" index: no full-text column yet
    assert not _has_column()

    assert vectorstore.ensure_hybrid_search_schema() is True
    assert _has_column()
    assert vectorstore.ensure_hybrid_search_schema() is True  # idempotent

    with vectorstore._engine.connect() as conn:
        missing = conn.execute(text("SELECT count(*) FROM langchain_pg_embedding WHERE document_tsv IS NULL")).scalar()
        idx = conn.execute(text("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_langchain_pg_embedding_document_tsv'")).scalar()
    assert missing == 0
    assert "gin" in idx.lower()

    for question, expected in [
        ("Where is useAuth defined?", "src/hooks/useAuth.ts"),
        ("which PORT does the server use", "server/config.py"),
        ("what is MAX_FILE_BYTES", "server/config.py"),
        ("What does RouteOptimizer do?", "lib/route_optimizer.py"),
        ("route optimizer", "lib/route_optimizer.py"),  # camelCase parts
    ]:
        docs = retriever.retrieve_relevant_chunks(question, "repo", top_k=3, mode="hybrid")
        assert docs[0].metadata["source"] == expected, question
        assert docs[0].metadata["retrieval"]["keyword_rank"] == 1
        assert docs[0].metadata["start_line"] is not None


def test_rrf_scores_and_overview_excluded(db):
    overview = Chunk("REPOSITORY OVERVIEW useAuth PORT RouteOptimizer", vectorstore.OVERVIEW_SOURCE, 0)
    _insert_old_style("repo", [overview] + NOISE + TARGETS)
    vectorstore.ensure_hybrid_search_schema()

    docs = retriever.retrieve_relevant_chunks("useAuth hook", "repo", top_k=8, mode="hybrid")
    assert all(d.metadata["source"] != vectorstore.OVERVIEW_SOURCE for d in docs)
    scores = [d.metadata["retrieval"]["score"] for d in docs]
    assert scores == sorted(scores, reverse=True)
    top = docs[0].metadata["retrieval"]
    expected = sum(1 / (60 + r) for r in (top["vector_rank"], top["keyword_rank"]) if r)
    assert top["score"] == pytest.approx(expected)

    vec_docs = retriever.retrieve_relevant_chunks("useAuth hook", "repo", top_k=8, mode="vector")
    assert len(vec_docs) == 8 and all(d.metadata["source"] != vectorstore.OVERVIEW_SOURCE for d in vec_docs)


def test_collections_are_isolated_and_new_rows_get_indexed(db):
    _insert_old_style("a", NOISE)
    vectorstore.ensure_hybrid_search_schema()
    vectorstore.add_chunks_to_store(TARGETS, "b")  # inserted after the migration → generated column fills itself
    assert all(d.metadata["source"].startswith("docs/") for d in retriever.retrieve_relevant_chunks("useAuth", "a", top_k=5))
    assert retriever.retrieve_relevant_chunks("useAuth", "b", top_k=1)[0].metadata["source"] == "src/hooks/useAuth.ts"


def test_falls_back_to_vector_search_when_hybrid_query_fails(db, monkeypatch):
    _insert_old_style("repo", NOISE + TARGETS)
    vectorstore.ensure_hybrid_search_schema()
    monkeypatch.setattr(vectorstore, "_HYBRID_SQL", text("SELECT broken FROM nowhere"))
    docs = retriever.retrieve_relevant_chunks("useAuth", "repo", top_k=4, mode="hybrid")
    assert len(docs) == 4 and "retrieval" not in docs[0].metadata
