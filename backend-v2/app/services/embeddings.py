from langchain_huggingface import HuggingFaceEmbeddings

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# Cached at module level — loading the model from disk/downloading it is slow
# (a few seconds to a minute the first time). We only want this to happen once
# per app run, not once per request.
_embedding_model: HuggingFaceEmbeddings | None = None


def get_embedding_model() -> HuggingFaceEmbeddings:
    """
    Returns a singleton HuggingFaceEmbeddings instance.
    First call loads the model (slow); every call after that reuses it (instant).
    """
    global _embedding_model

    if _embedding_model is None:
        logger.info(f"Loading embedding model: {settings.embedding_model_name}")
        _embedding_model = HuggingFaceEmbeddings(
            model_name=settings.embedding_model_name,
            model_kwargs={"device": "cpu"},       # switch to "cuda" if you have a GPU set up
            encode_kwargs={"normalize_embeddings": True},  # cosine similarity works better on normalized vectors
        )
        logger.info("Embedding model loaded.")

    return _embedding_model