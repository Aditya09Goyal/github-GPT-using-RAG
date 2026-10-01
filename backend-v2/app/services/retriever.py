import re
from typing import Literal

from langchain_core.vectorstores import VectorStoreRetriever
from langchain_core.documents import Document

from app.core.config import settings
from app.core.logging import get_logger
from app.services.vectorstore import get_overview_doc, get_vectorstore, hybrid_search, similarity_search

logger = get_logger(__name__)

SearchMode = Literal["hybrid", "vector"]

# Question words and generic "talking about code" words. They'd match nearly every chunk
# (every chunk starts with "File: ..."), so they only add noise to the keyword ranking.
# Only applied to single words — parts of an identifier (get_user → get, user) are always kept.
STOP_WORDS = frozenset(
    """
    a about above after all also am an and any are as at be been being but by can could did do does doing
    done for from had has have having he her here him his how i if in into is it its just me more most my
    no not of on or our out over please same she should so some such than that the their them then there
    these they this those through to too under up us very was we were what when where which while who whom
    why will with would you your yours
    explain explains describe show shows tell give list find get gets work works working happen happens
    happening use used uses using defined define defines definition implement implemented implementation
    code file files function functions method methods class classes repo repository project codebase app
    application thing things part parts way does mean means purpose
    """.split()
)

MAX_TERMS = 16
_TERM = re.compile(r"[A-Za-z0-9_]+(?:[./\\:-]+[A-Za-z0-9_]+)*")
_NON_ALNUM = re.compile(r"[^A-Za-z0-9]+")
# same two rules as the tsvector column in vectorstore.py
_CAMEL_1 = re.compile(r"([a-z0-9])([A-Z])")
_CAMEL_2 = re.compile(r"([A-Z])([A-Z][a-z])")


def _camel_split(word: str) -> list[str]:
    return _CAMEL_2.sub(r"\1 \2", _CAMEL_1.sub(r"\1 \2", word)).split()


def keyword_query(question: str) -> str | None:
    """
    Turns a question into a to_tsquery() expression, mirroring how the full-text column is built:
      "Where is useAuth defined?"   → (useauth | use <-> auth)
      "what is MAX_FILE_BYTES"      → max <-> file <-> bytes
      "explain app/core/auth.py"    → app <-> core <-> auth <-> py
      "which PORT does it run on"   → port | run
    Terms are OR-ed: ts_rank then favours chunks that contain more (and rarer-in-chunk) terms.
    Output only ever contains [a-z0-9], spaces, parentheses, "|" and "<->", so it is always valid
    tsquery syntax. Returns None when nothing useful is left (→ vector search only).
    """
    terms: list[str] = []
    seen: set[str] = set()

    for raw in _TERM.findall(question):
        pieces = [p for p in _NON_ALNUM.split(raw) if p]  # snake_case, dotted, paths → pieces
        words = [w.lower() for p in pieces for w in _camel_split(p)]
        pieces = [p.lower() for p in pieces]

        if len(words) == 1:
            w = words[0]
            if len(w) < 2 or w in STOP_WORDS:
                continue
            term = w
        else:
            if all(len(w) == 1 for w in words):  # "e.g", "a/b"
                continue
            # the identifier as written (useAuth → useauth) OR as a phrase of its parts
            # (use <-> auth, which also matches use_auth / UseAuth / "use auth")
            options = list(dict.fromkeys([" <-> ".join(pieces), " <-> ".join(words)]))
            term = options[0] if len(options) == 1 else "(" + " | ".join(options) + ")"

        if term not in seen:
            seen.add(term)
            terms.append(term)
        if len(terms) >= MAX_TERMS:
            break

    return " | ".join(terms) or None


def get_retriever(
    collection_name: str, top_k: int | None = None
) -> VectorStoreRetriever:
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


def retrieve_relevant_chunks(
    query: str,
    collection_name: str,
    top_k: int | None = None,
    mode: SearchMode | None = None,
) -> list[Document]:
    """
    Finds the chunks most relevant to the query in a repo's collection.
      mode="hybrid" (default): keyword + vector search merged with Reciprocal Rank Fusion
      mode="vector": cosine similarity only
    Returns the raw Documents (text + metadata) — formatting them into a
    prompt is the next file's (rag_chain.py) job, not this one.
    """
    k = top_k or settings.retriever_top_k
    mode = mode or settings.search_mode

    if mode == "hybrid":
        ts_query = keyword_query(query)
        results = hybrid_search(collection_name, query, ts_query, k)
    else:
        ts_query = None
        results = similarity_search(collection_name, query, k)

    logger.info(
        f"Retrieved {len(results)} chunks ({mode}) for query: '{query}' (collection: {collection_name})"
        + (f" · keywords: {ts_query}" if ts_query else "")
    )
    for doc in results:
        m = doc.metadata
        logger.debug(
            f"  - {m.get('source')} L{m.get('start_line')}-{m.get('end_line')} "
            f"(chunk {m.get('chunk_index')}) {m.get('retrieval', '')}"
        )

    return results


def get_overview(collection_name: str) -> Document | None:
    """
    Fetches the repo overview chunk (description, contributors, file list, README start).
    Plain SQL + in-memory cache. Repos indexed before the overview existed return None.
    """
    try:
        return get_overview_doc(collection_name)
    except Exception:
        logger.exception("Could not load the repo overview")
        return None
