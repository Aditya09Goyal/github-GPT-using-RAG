import os
import re
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_postgres import PGEngine, PGVectorStore
from config import configs

VECTOR_SIZE = 384  # all-MiniLM-L6-v2 output size

_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        _engine = PGEngine.from_connection_string(url=os.getenv("DATABASE_URL"))
    return _engine


def _table_name_for(repo_name: str) -> str:
    """Postgres table names must be lowercase, alphanumeric/underscore only."""
    safe = re.sub(r"[^a-zA-Z0-9_]", "_", repo_name).lower()
    return f"repo_{safe}"


def table_exists(table_name: str) -> bool:
    import psycopg2

    raw_url = os.getenv("DATABASE_URL").replace(
        "postgresql+psycopg://", "postgresql://"
    )
    conn = psycopg2.connect(raw_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = %s)",
                (table_name,),
            )
            return cur.fetchone()[0]
    finally:
        conn.close()


def get_vector_store(repo_name: str) -> PGVectorStore:
    engine = _get_engine()
    table_name = _table_name_for(repo_name)
    embeddings = HuggingFaceEmbeddings(model_name=configs["embedding_model"])

    if not table_exists(table_name):
        engine.init_vectorstore_table(table_name=table_name, vector_size=VECTOR_SIZE)

    return PGVectorStore.create_sync(
        engine=engine,
        table_name=table_name,
        embedding_service=embeddings,
    )


def get_all_documents(repo_name: str):
    from langchain_core.documents import Document
    import psycopg2

    table_name = _table_name_for(repo_name)
    raw_url = os.getenv("DATABASE_URL").replace(
        "postgresql+psycopg://", "postgresql://"
    )
    conn = psycopg2.connect(raw_url)
    try:
        with conn.cursor() as cur:
            cur.execute(f'SELECT content, langchain_metadata FROM "{table_name}"')
            rows = cur.fetchall()
        return [Document(page_content=r[0], metadata=r[1] or {}) for r in rows]
    finally:
        conn.close()
