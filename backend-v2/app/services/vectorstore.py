from langchain_chroma import Chroma
from langchain_core.documents import Document

from app.core.config import settings
from app.core.logging import get_logger
from app.services.embeddings import get_embedding_model
from app.services.chunker import Chunk

logger = get_logger(__name__)


def get_vectorstore(collection_name: str) -> Chroma:
    """
    Returns a Chroma vectorstore instance for a given collection.
    One collection = one indexed repo, so different repos don't mix results together.
    """
    return Chroma(
        collection_name=collection_name,
        embedding_function=get_embedding_model(),
        persist_directory=settings.chroma_persist_dir,
        # host=..., port=...
        # For using Chroma in server mode
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
    store.add_documents(documents)
    logger.info("Done adding documents.")