import re
import time
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
from app.services.retriever import SearchMode, get_overview, retrieve_relevant_chunks

logger = get_logger(__name__)

# Cached at module level — same reasoning as the embedding model:
# don't recreate the LLM client on every single request.
_llm: ChatGroq | None = None
_condense_llm: ChatGroq | None = None
_condense_broken = False  # set after the small model fails once, so we don't pay for the failure every time

NO_CONTEXT_ANSWER = "Ummn, Will improve myself for such bad results😓."

SYSTEM_PROMPT = """You are a helpful assistant answering questions about a GitHub repository.
Use ONLY the context below to answer. The first block is a REPOSITORY OVERVIEW (GitHub description, contributors, languages, file list, README start); the rest are relevant pieces of the code.
The earlier conversation is only there to help you understand what the user is referring to — facts must come from the context.
You may explain what the code does based on what you can see in it. If the question has several parts, answer every part you can and say briefly which part isn't in the context. Never make things up.
Each code block is labelled with its file and line range, e.g. [Source: app/auth.py · L12-40]. When you point to specific code, name the file and, where it helps, the lines (e.g. app/auth.py L12-40).
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
        logger.info(f"Initializing Groq LLM client ({settings.llm_model})")
        extra = {}
        # reasoning_effort only exists for reasoning models (gpt-oss, qwen3) on Groq
        if settings.llm_reasoning_effort and "gpt-oss" in settings.llm_model:
            extra["reasoning_effort"] = settings.llm_reasoning_effort
        _llm = ChatGroq(
            model=settings.llm_model,
            groq_api_key=settings.groq_api_key,
            temperature=0.2,
            **extra,
        )
    return _llm


def get_condense_llm() -> ChatGroq:
    """Small, fast model used only to rewrite follow-up questions."""
    global _condense_llm
    if _condense_llm is None:
        effort = settings.condense_reasoning_effort
        if effort is None:  # auto
            effort = "low" if "gpt-oss" in settings.condense_model else "none" if "qwen" in settings.condense_model else None
        extra = {"reasoning_effort": effort} if effort else {}
        _condense_llm = ChatGroq(
            model=settings.condense_model,
            groq_api_key=settings.groq_api_key,
            temperature=0,
            **extra,
        )
    return _condense_llm


def _line_range(meta: dict) -> tuple[int, int] | None:
    """(start_line, end_line) from chunk metadata, or None (overview / repos indexed before line numbers)."""
    start, end = meta.get("start_line"), meta.get("end_line")
    if isinstance(start, int) and isinstance(end, int) and 1 <= start <= end:
        return start, end
    return None


def source_label(meta: dict) -> str:
    """'app/auth.py · L12-40', or just the path when the chunk has no line numbers."""
    path = meta.get("source", "unknown")
    lines = _line_range(meta)
    return f"{path} · L{lines[0]}-{lines[1]}" if lines else path


def format_context(docs: list[Document]) -> str:
    """
    Turns retrieved Documents into a single text block for the prompt,
    labeling each chunk with its source file (and line range) so the LLM can reference it.
    """
    return "\n\n".join(f"[Source: {source_label(doc.metadata)}]\n{doc.page_content}" for doc in docs)


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


# Words that point back at the conversation ("where is IT called?", "explain THIS more").
_REFERS_BACK = re.compile(
    r"\b(it|its|it's|this|that|these|those|they|them|their|there|he|she|him|her|above|previous|"
    r"same|also|again|more|else|other|another|former|latter|ones?)\b",
    re.IGNORECASE,
)


_THIS_REPO = re.compile(r"\b(this|that|the)\s+(project|repo|repository|codebase|code\s?base|app|application)\b", re.IGNORECASE)


def needs_rewrite(question: str) -> bool:
    """
    Only follow-ups need the LLM rewrite. A self-contained question
    ("Where is the main entry point?") is searched as-is, which saves one LLM call (~0.5-2 s).
    Very short messages ("and f4?", "why?") are treated as follow-ups.
    """
    # "this project / this repo" just means the indexed repo — not a reference to earlier messages
    q = _THIS_REPO.sub(" ", question)
    return len(question.split()) <= 3 or bool(_REFERS_BACK.search(q))


def condense_question(question: str, history: list[ChatTurn]) -> str:
    """
    Rewrites a follow-up question into a standalone one using the conversation.
    Falls back to the original question if the LLM call fails or returns nothing.
    """
    transcript = "\n".join(f"{t.role.capitalize()}: {t.content}" for t in history)
    prompt = ChatPromptTemplate.from_template(CONDENSE_PROMPT)
    inputs = {"history": transcript, "question": question}
    global _condense_broken
    try:
        if _condense_broken:
            raise RuntimeError("small model disabled after an earlier failure")
        standalone = (prompt | get_condense_llm() | StrOutputParser()).invoke(inputs).strip()
    except Exception as e:
        # e.g. the small model was retired on Groq — fall back to the main model (and stop trying the small one)
        if not _condense_broken:
            logger.warning(f"Condense model '{settings.condense_model}' failed ({e}) — using the main model from now on.")
            _condense_broken = True
        try:
            standalone = (prompt | get_llm() | StrOutputParser()).invoke(inputs).strip()
        except Exception:
            logger.exception("Condensing the follow-up question failed — using it as-is.")
            return question
    if standalone:
        logger.info(f"Condensed follow-up '{question}' -> '{standalone}'")
    return standalone or question


def prepare_context(
    question: str,
    collection_name: str,
    history: list[ChatTurn] | None,
    mode: SearchMode | None = None,
) -> tuple[list[ChatTurn], list[Document]]:
    """
    Shared first half of the RAG flow: trim the history, work out what to search for,
    and retrieve the relevant chunks. Returns (trimmed history, docs) — docs[0] is the
    repo overview when the repo has one, the rest are retrieved chunks in rank order.
    (Also used by scripts/eval.py, so the evaluation measures exactly what users get.)
    """
    history = _trim_history(history)
    t0 = time.perf_counter()
    search_query = condense_question(question, history) if history and needs_rewrite(question) else question
    t1 = time.perf_counter()
    docs = [
        d
        for d in retrieve_relevant_chunks(search_query, collection_name, mode=mode)
        if d.metadata.get("source") != OVERVIEW_SOURCE
    ]
    t2 = time.perf_counter()
    overview = get_overview(collection_name)
    t3 = time.perf_counter()
    logger.info(
        f"[timing] condense {1000 * (t1 - t0):.0f} ms · retrieve {1000 * (t2 - t1):.0f} ms · overview {1000 * (t3 - t2):.0f} ms"
    )
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


def build_citations(docs: list[Document]) -> list[dict]:
    """
    One citation per file region the answer was grounded in:
      {"path": "app/auth.py", "start_line": 12, "end_line": 40}
    Overlapping or touching chunks of the same file (chunks overlap by design) are merged into one range.
    Files are listed in retrieval order (most relevant first), ranges within a file top to bottom.
    Chunks without line numbers (repos indexed before they existed) give one path-only citation
    with start_line/end_line = None — unless the same file also has a real range.
    """
    by_path: dict[str, list[tuple[int, int]]] = {}
    for doc in docs:
        path = doc.metadata.get("source", "unknown")
        if path == OVERVIEW_SOURCE:
            continue
        ranges = by_path.setdefault(path, [])
        lines = _line_range(doc.metadata)
        if lines:
            ranges.append(lines)

    citations: list[dict] = []
    for path, ranges in by_path.items():
        if not ranges:
            citations.append({"path": path, "start_line": None, "end_line": None})
            continue
        merged: list[list[int]] = []
        for start, end in sorted(ranges):
            if merged and start <= merged[-1][1] + 1:
                merged[-1][1] = max(merged[-1][1], end)
            else:
                merged.append([start, end])
        citations.extend({"path": path, "start_line": a, "end_line": b} for a, b in merged)
    return citations


def generate_answer(question: str, docs: list[Document], history: list[ChatTurn]) -> str:
    """Second half of the RAG flow: one LLM call over the prepared context."""
    return _answer_chain().invoke(
        {
            "context": format_context(docs),
            "history": _to_messages(history),
            "question": question,
        }
    )


def answer_question(
    question: str, collection_name: str, history: list[ChatTurn] | None = None
) -> dict:
    """
    Full RAG flow: retrieve relevant chunks, build a prompt, call the LLM,
    return the answer along with which sources were used.
    """
    history, docs = prepare_context(question, collection_name, history)

    if not docs:
        logger.warning("No relevant chunks found — answering without context.")
        return {"answer": NO_CONTEXT_ANSWER, "sources": [], "citations": []}

    logger.info(
        f"Calling LLM for question: '{question}' ({len(history)} history messages)"
    )
    answer = generate_answer(question, docs, history)

    return {"answer": answer, "sources": _sources(docs), "citations": build_citations(docs)}


def stream_answer(
    question: str, collection_name: str, history: list[ChatTurn] | None = None
) -> Iterator[dict]:
    """
    Same flow as answer_question, but yields events as they become available:
      {"type": "sources", "sources": [...], "citations": [...]}  — once, before any text
      {"type": "token", "content": "..."}    — many times, pieces of the answer
    The caller is responsible for sending a final "done" event.
    """
    start = time.perf_counter()
    history, docs = prepare_context(question, collection_name, history)

    if not docs:
        logger.warning("No relevant chunks found — answering without context.")
        yield {"type": "sources", "sources": [], "citations": []}
        yield {"type": "token", "content": NO_CONTEXT_ANSWER}
        return

    yield {"type": "sources", "sources": _sources(docs), "citations": build_citations(docs)}

    logger.info(
        f"Streaming LLM answer for question: '{question}' ({len(history)} history messages)"
    )
    first = None
    for piece in _answer_chain().stream(
        {
            "context": format_context(docs),
            "history": _to_messages(history),
            "question": question,
        }
    ):
        if piece:
            if first is None:
                first = time.perf_counter()
            yield {"type": "token", "content": piece}
    end = time.perf_counter()
    logger.info(
        f"[timing] first token {1000 * ((first or end) - start):.0f} ms · total {1000 * (end - start):.0f} ms"
    )
