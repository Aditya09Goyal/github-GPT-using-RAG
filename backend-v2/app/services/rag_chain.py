from collections.abc import Iterator

from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.documents import Document
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

from app.core.config import settings
from app.core.logging import get_logger
from app.schemas.chat import ChatTurn
from app.services.overview import OVERVIEW_SOURCE
from app.services.retriever import get_overview, retrieve_relevant_chunks

logger = get_logger(__name__)

# Cached at module level — same reasoning as the embedding model:
# don't recreate the LLM client on every single request.
_llm: ChatGroq | None = None

NO_CONTEXT_ANSWER = "Ummn, Will improve myself for such bad results😓."

SYSTEM_PROMPT = """You are a helpful assistant answering questions about a GitHub repository.
Use ONLY the context below to answer. The first block is a REPOSITORY OVERVIEW (GitHub description, contributors, languages, file list, README start); the rest are relevant pieces of the code.
The earlier conversation is only there to help you understand what the user is referring to — facts must come from the context.
You may explain what the code does based on what you can see in it. If the question has several parts, answer every part you can and say briefly which part isn't in the context. Never make things up.
Context:
{context}"""

# Used to turn a follow-up like "where is it called?" into "Where is load_config called?"
# so the vector search looks for the right thing.
CONDENSE_PROMPT = """Given the conversation below and a follow-up question, rewrite the follow-up as a standalone question that can be understood without the conversation. Keep code identifiers and file names exactly as written. If the follow-up is already standalone, return it unchanged. Reply with the question only.

Conversation:
{history}

Follow-up question: {question}

Standalone question:"""


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


def _trim_history(history: list[ChatTurn] | None) -> list[ChatTurn]:
    """
    Keeps only the most recent messages and shortens long ones,
    so a long chat doesn't blow up the prompt size.
    """
    if not history:
        return []
    recent = (
        history[-settings.history_max_messages :]
        if settings.history_max_messages > 0
        else []
    )
    limit = settings.history_max_chars
    return [
        ChatTurn(
            role=t.role,
            content=t.content if len(t.content) <= limit else t.content[:limit] + " …",
        )
        for t in recent
        if t.content.strip()
    ]


def _to_messages(history: list[ChatTurn]) -> list[BaseMessage]:
    return [
        HumanMessage(t.content) if t.role == "user" else AIMessage(t.content)
        for t in history
    ]


def condense_question(question: str, history: list[ChatTurn]) -> str:
    """
    Rewrites a follow-up question into a standalone one using the conversation.
    Falls back to the original question if the LLM call fails or returns nothing.
    """
    transcript = "\n".join(f"{t.role.capitalize()}: {t.content}" for t in history)
    chain = (
        ChatPromptTemplate.from_template(CONDENSE_PROMPT)
        | get_llm()
        | StrOutputParser()
    )
    try:
        standalone = chain.invoke({"history": transcript, "question": question}).strip()
    except Exception:
        logger.exception("Condensing the follow-up question failed — using it as-is.")
        return question
    if standalone:
        logger.info(f"Condensed follow-up '{question}' -> '{standalone}'")
    return standalone or question


def _prepare(question: str, collection_name: str, history: list[ChatTurn] | None):
    """
    Shared first half of the RAG flow: trim the history, work out what to search for,
    and retrieve the relevant chunks.
    """
    history = _trim_history(history)
    search_query = condense_question(question, history) if history else question
    docs = [
        d
        for d in retrieve_relevant_chunks(search_query, collection_name)
        if d.metadata.get("source") != OVERVIEW_SOURCE
    ]
    overview = get_overview(collection_name)
    if overview:
        docs = [
            overview
        ] + docs  # always in context, so broad questions ("what is this?", "who made it?") work
    return history, docs


def _answer_chain():
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", SYSTEM_PROMPT),
            MessagesPlaceholder("history"),
            ("human", "{question}"),
        ]
    )
    return prompt | get_llm() | StrOutputParser()


def _sources(docs: list[Document]) -> list[str]:
    return sorted({doc.metadata.get("source", "unknown") for doc in docs} - {OVERVIEW_SOURCE})


def answer_question(
    question: str, collection_name: str, history: list[ChatTurn] | None = None
) -> dict:
    """
    Full RAG flow: retrieve relevant chunks, build a prompt, call the LLM,
    return the answer along with which sources were used.
    """
    history, docs = _prepare(question, collection_name, history)

    if not docs:
        logger.warning("No relevant chunks found — answering without context.")
        return {"answer": NO_CONTEXT_ANSWER, "sources": []}

    logger.info(
        f"Calling LLM for question: '{question}' ({len(history)} history messages)"
    )
    answer = _answer_chain().invoke(
        {
            "context": format_context(docs),
            "history": _to_messages(history),
            "question": question,
        }
    )

    return {"answer": answer, "sources": _sources(docs)}


def stream_answer(
    question: str, collection_name: str, history: list[ChatTurn] | None = None
) -> Iterator[dict]:
    """
    Same flow as answer_question, but yields events as they become available:
      {"type": "sources", "sources": [...]}  — once, before any text
      {"type": "token", "content": "..."}    — many times, pieces of the answer
    The caller is responsible for sending a final "done" event.
    """
    history, docs = _prepare(question, collection_name, history)

    if not docs:
        logger.warning("No relevant chunks found — answering without context.")
        yield {"type": "sources", "sources": []}
        yield {"type": "token", "content": NO_CONTEXT_ANSWER}
        return

    yield {"type": "sources", "sources": _sources(docs)}

    logger.info(
        f"Streaming LLM answer for question: '{question}' ({len(history)} history messages)"
    )
    for piece in _answer_chain().stream(
        {
            "context": format_context(docs),
            "history": _to_messages(history),
            "question": question,
        }
    ):
        if piece:
            yield {"type": "token", "content": piece}
