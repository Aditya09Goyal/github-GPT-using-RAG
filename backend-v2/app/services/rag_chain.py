from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document

from app.core.config import settings
from app.core.logging import get_logger
from app.services.retriever import retrieve_relevant_chunks

logger = get_logger(__name__)

# Cached at module level — same reasoning as the embedding model:
# don't recreate the LLM client on every single request.
_llm: ChatGroq | None = None

PROMPT_TEMPLATE = """You are a helpful assistant answering questions about a GitHub repository.
Use ONLY the context below to answer the question. If the answer isn't in the context, say you don't know — do not make things up.

Context:
{context}

Question: {question}

Answer:"""


def get_llm() -> ChatGroq:
    global _llm
    if _llm is None:
        logger.info("Initializing Groq LLM client")
        _llm = ChatGroq(
            model="openai/gpt-oss-120b",
            groq_api_key=settings.groq_api_key,
            temperature=0.2,
        )
    return _llm


def format_context(docs: list[Document]) -> str:
    """
    Turns retrieved Documents into a single text block for the prompt,
    labeling each chunk with its source file so the LLM can reference it.
    """
    return "\n\n".join(
        f"[Source: {doc.metadata.get('source', 'unknown')}]\n{doc.page_content}"
        for doc in docs
    )


def answer_question(question: str, collection_name: str) -> dict:
    """
    Full RAG flow: retrieve relevant chunks, build a prompt, call the LLM,
    return the answer along with which sources were used.
    """
    docs = retrieve_relevant_chunks(question, collection_name)

    if not docs:
        logger.warning("No relevant chunks found — answering without context.")
        return {
            "answer": "I couldn't find anything relevant in this repository to answer that.",
            "sources": [],
        }

    context = format_context(docs)

    prompt = ChatPromptTemplate.from_template(PROMPT_TEMPLATE)
    chain = prompt | get_llm() | StrOutputParser()

    logger.info(f"Calling LLM for question: '{question}'")
    answer = chain.invoke({"context": context, "question": question})

    sources = sorted({doc.metadata.get("source", "unknown") for doc in docs})

    return {
        "answer": answer,
        "sources": sources,
    }