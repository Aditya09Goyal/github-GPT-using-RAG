from langchain_core.documents import Document

from app.services.rag_chain import (
    cited_docs,
    cited_numbers,
    format_context,
    _trim_history,
)
from app.schemas.chat import ChatTurn


def doc(path, start=None, end=None):
    meta = {"source": path}
    if start is not None:
        meta.update(start_line=start, end_line=end)
    return Document(page_content=f"code of {path}", metadata=meta)


OVERVIEW = Document(page_content="overview", metadata={"source": "__overview__"})
DOCS = [OVERVIEW, doc("app/auth.py", 12, 40), doc("app/db.py", 1, 20), doc("README.md")]


def test_code_chunks_are_numbered_and_overview_is_not():
    ctx = format_context(DOCS)
    assert "[1] [Source: app/auth.py · L12-40]" in ctx
    assert "[3] [Source: README.md]" in ctx
    assert "[Repository overview]" in ctx


def test_reads_all_marker_styles():
    assert cited_numbers("auth [1]. db [2][3].") == {1, 2, 3}
    assert cited_numbers("both [1, 3]") == {1, 3}


def test_ignores_brackets_inside_code():
    assert cited_numbers("use `items[2]` here\n```py\nx = arr[3]\n```") == set()


def test_keeps_only_cited_chunks():
    used = cited_docs("Tokens are checked in current_user [1].", DOCS)
    assert [d.metadata["source"] for d in used] == ["app/auth.py"]


def test_falls_back_to_all_when_nothing_valid_is_cited():
    for answer in ["no markers at all", "made-up number [9]"]:
        assert len(cited_docs(answer, DOCS)) == 3


def test_old_markers_are_removed_from_history():
    turns = _trim_history(
        [ChatTurn(role="assistant", content="It is in auth.py [1][2].")]
    )
    assert "[1]" not in turns[0].content
