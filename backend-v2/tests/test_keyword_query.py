import pytest

from app.services.retriever import keyword_query


@pytest.mark.parametrize(
    "question, expected",
    [
        ("Where is useAuth defined?", "(useauth | use <-> auth)"),
        ("what is MAX_FILE_BYTES", "max <-> file <-> bytes"),
        ("which PORT does it run on", "port | run"),
        ("explain app/core/auth.py", "app <-> core <-> auth <-> py"),
        ("How does RouteOptimizer pick a warehouse?", "(routeoptimizer | route <-> optimizer) | pick | warehouse"),
        ("HTTPServer setup", "(httpserver | http <-> server) | setup"),
        ("what does settings.database_url hold", "settings <-> database <-> url | hold"),
    ],
)
def test_keyword_query_examples(question, expected):
    assert keyword_query(question) == expected


def test_only_stop_words_gives_none():
    assert keyword_query("What does this project do?") is None
    assert keyword_query("") is None
    assert keyword_query("?? !!") is None


def test_dedupes_and_caps_terms():
    q = keyword_query(" ".join(f"word{i}" for i in range(40)) + " word1 word1")
    assert q.count("|") == 15  # 16 terms max
    assert q.split(" | ").count("word1") == 1


def test_output_is_always_safe_tsquery_syntax():
    nasty = "it's a 'quoted' & !bang | pipe <-> (paren) :* e.g. a/b \\x00 ; DROP TABLE x; --"
    q = keyword_query(nasty)
    assert q is not None
    allowed = set("abcdefghijklmnopqrstuvwxyz0123456789 ()|<->")
    assert set(q) <= allowed
