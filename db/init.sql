CREATE EXTENSION IF NOT EXISTS vector;

-- Feature 1: query logs
CREATE TABLE IF NOT EXISTS query_logs (
    id SERIAL PRIMARY KEY,
    repo_name TEXT NOT NULL,
    query TEXT NOT NULL,
    answer TEXT,
    latency_ms INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Feature 1: conversation sessions
CREATE TABLE IF NOT EXISTS conversations (
    id SERIAL PRIMARY KEY,
    session_id TEXT NOT NULL,
    repo_name TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_session ON conversations (session_id);