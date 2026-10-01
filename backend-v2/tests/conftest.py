"""
Settings are read from the environment when app.core.config is first imported, so dummy values
are set here before any app module loads. Unit tests never touch the network or the database.
The integration tests in test_hybrid_search_db.py run only when TEST_DATABASE_URL points at a
throwaway Postgres with pgvector, e.g.
    TEST_DATABASE_URL=postgresql://user:pass@localhost:5432/ghgpt_test pytest
"""
import os

os.environ.setdefault("GROQ_API_KEY", "test-key")
os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL") or "postgresql://test:test@localhost:1/test"
