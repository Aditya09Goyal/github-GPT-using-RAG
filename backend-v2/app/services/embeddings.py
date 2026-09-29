from fastembed import TextEmbedding
from langchain_core.embeddings import Embeddings

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


class FastEmbedEmbeddings(Embeddings):
    """
    LangChain-compatible wrapper around fastembed.
    fastembed runs the same all-MiniLM-L6-v2 model on ONNX Runtime instead of
    PyTorch, so it needs a fraction of the RAM (fits Render's 512 MB free tier).
    Vectors come out already normalized (unit length), same as before.
    """

    def __init__(self, model_name: str, cache_dir: str | None = None):
        # threads=1 keeps ONNX Runtime's memory use low (~420 MB peak instead of ~800 MB)
        self.model = TextEmbedding(model_name=model_name, cache_dir=cache_dir, threads=1)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        # small batches = lower peak RAM while indexing big repos
        return [v.tolist() for v in self.model.embed(texts, batch_size=8)]

    def embed_query(self, text: str) -> list[float]:
        return next(iter(self.model.query_embed(text))).tolist()


# Cached at module level — loading the model is slow, so do it once per app run.
_embedding_model: FastEmbedEmbeddings | None = None


def get_embedding_model() -> FastEmbedEmbeddings:
    """
    Returns a singleton embedding model.
    First call loads (and, the very first time, downloads) the model; later calls reuse it.
    """
    global _embedding_model

    if _embedding_model is None:
        logger.info(f"Loading embedding model: {settings.embedding_model_name}")
        _embedding_model = FastEmbedEmbeddings(
            model_name=settings.embedding_model_name,
            cache_dir=settings.embedding_cache_dir,
        )
        logger.info("Embedding model loaded.")

    return _embedding_model