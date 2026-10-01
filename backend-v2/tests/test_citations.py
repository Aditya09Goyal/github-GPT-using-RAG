from langchain_core.documents import Document

from app.services.overview import OVERVIEW_SOURCE
from app.services.rag_chain import build_citations, format_context, source_label


def doc(path, start=None, end=None):
    meta = {"source": path}
    if start is not None:
        meta.update(start_line=start, end_line=end)
    return Document(page_content=f"File: {path}\n...", metadata=meta)


def test_merges_overlapping_and_adjacent_ranges_per_file():
    docs = [
        doc("b.py", 30, 50),
        doc("a.py", 1, 20),
        doc("b.py", 10, 32),  # overlaps 30-50
        doc("b.py", 51, 60),  # touches 30-50
        doc("b.py", 80, 90),
    ]
    assert build_citations(docs) == [
        {"path": "b.py", "start_line": 10, "end_line": 60},
        {"path": "b.py", "start_line": 80, "end_line": 90},
        {"path": "a.py", "start_line": 1, "end_line": 20},
    ]


def test_skips_overview_and_handles_old_chunks_without_lines():
    docs = [
        Document(page_content="overview", metadata={"source": OVERVIEW_SOURCE}),
        doc("old.py"),
        doc("mixed.py"),
        doc("mixed.py", 5, 9),
    ]
    assert build_citations(docs) == [
        {"path": "old.py", "start_line": None, "end_line": None},
        {"path": "mixed.py", "start_line": 5, "end_line": 9},
    ]


def test_ignores_invalid_line_metadata():
    bad = Document(page_content="x", metadata={"source": "x.py", "start_line": 9, "end_line": 3})
    assert build_citations([bad]) == [{"path": "x.py", "start_line": None, "end_line": None}]


def test_context_labels_include_line_ranges():
    assert source_label({"source": "app/auth.py", "start_line": 12, "end_line": 40}) == "app/auth.py · L12-40"
    assert source_label({"source": "README.md"}) == "README.md"
    ctx = format_context([doc("app/auth.py", 12, 40), doc("README.md")])
    assert "[Source: app/auth.py · L12-40]" in ctx
    assert "[Source: README.md]" in ctx
