
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS document_chunks (
    id SERIAL PRIMARY KEY,
    repo_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    chunk_text TEXT NOT NULL,
    is_code BOOLEAN DEFAULT FALSE,
    embedding VECTOR(256),  -- matches your embedder's dimensions=256
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repo_name ON document_chunks (repo_name);
CREATE INDEX IF NOT EXISTS idx_embedding ON document_chunks
    USING hnsw (embedding vector_cosine_ops);