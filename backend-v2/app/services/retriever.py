from langchain_core.vectorstores import VectorStoreRetriever
from langchain_core.documents import Document

from app.core.config import settings
from app.core.logging import get_logger
from app.services.vectorstore import get_vectorstore

logger = get_logger(__name__)


def get_retriever(collection_name: str, top_k: int | None = None) -> VectorStoreRetriever:
    """
    Returns a retriever for a given repo's collection.
    A retriever wraps a vectorstore and exposes a simple interface:
    give it a query string, get back the most relevant Documents.
    """
    store = get_vectorstore(collection_name)

    return store.as_retriever(
        search_type="similarity",
        search_kwargs={"k": top_k or settings.retriever_top_k},
    )


def retrieve_relevant_chunks(query: str, collection_name: str, top_k: int | None = None) -> list[Document]:
    """
    Runs a similarity search for the given query against a repo's collection.
    Returns the raw Documents (text + metadata) — formatting them into a
    prompt is the next file's (rag_chain.py) job, not this one.
    """
    retriever = get_retriever(collection_name, top_k)
    results = retriever.invoke(query)

    logger.info(f"Retrieved {len(results)} chunks for query: '{query}' (collection: {collection_name})")
    for doc in results:
        logger.debug(f"  - {doc.metadata.get('source')} (chunk {doc.metadata.get('chunk_index')})")

    return results