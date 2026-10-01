import csv
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("eval_script", ROOT / "scripts" / "eval.py")
ev = importlib.util.module_from_spec(_spec)
sys.modules["eval_script"] = ev  # dataclasses look their module up in sys.modules
_spec.loader.exec_module(ev)


def test_rank_metrics():
    retrieved = ["a.py", "b.py", "c.py", "b.py"]
    assert ev.first_hit_rank(retrieved, ["c.py", "z.py"], k=8) == 3
    assert ev.hit_at_k(retrieved, ["c.py"], k=8) == 1.0
    assert ev.hit_at_k(retrieved, ["c.py"], k=2) == 0.0  # outside top-k
    assert ev.reciprocal_rank(retrieved, ["b.py", "c.py"], k=8) == pytest.approx(0.5)
    assert ev.reciprocal_rank(retrieved, ["z.py"], k=8) == 0.0
    assert ev.file_recall(retrieved, ["a.py", "c.py", "z.py", "z.py"], k=8) == pytest.approx(2 / 3)
    assert ev.file_recall(retrieved, [], k=8) == 0.0
    assert ev.mean([]) is None and ev.mean([1, 0, 0.5]) == 0.5


@pytest.mark.parametrize(
    "reply, score",
    [
        ('{"score": 4, "reason": "minor omission"}', 4),
        ('```json\n{"score": 5, "reason": "ok"}\n```', 5),
        ('Thinking... {"note": 1} final: {"score": 2, "reason": "wrong"}', 2),
        ("Score: 3 — partially right", 3),
        ('{"score": 9}', None),
        ("no idea", None),
    ],
)
def test_parse_judge_reply(reply, score):
    assert ev.parse_judge_reply(reply)[0] == score


def test_bundled_questions_file_is_valid():
    sets = ev.load_questions(ev.DEFAULT_QUESTIONS)
    assert sets
    for s in sets:
        assert 20 <= len(s.questions) <= 30
        for q in s.questions:
            assert q.question.strip() and q.reference_answer.strip()
            assert all(not f.startswith("/") for f in q.expected_files)


def test_bundled_ground_truth_files_exist_in_this_repo():
    # the bundled set is about this repository, so every expected file must exist here
    repo_root = ROOT.parent
    for s in ev.load_questions(ev.DEFAULT_QUESTIONS):
        if "github-GPT-using-RAG" in s.repo_url:
            for q in s.questions:
                for f in q.expected_files:
                    assert (repo_root / f).is_file(), f"{q.id}: {f}"


def test_load_questions_rejects_bad_files(tmp_path):
    bad = {"repos": [{"repo_url": "u", "collection_name": "c", "questions": [
        {"id": "x", "question": "q", "expected_files": ["a"]},
        {"id": "x", "question": "q2", "expected_files": ["b"]},
    ]}]}  # fmt: skip
    p = tmp_path / "q.json"
    p.write_text(json.dumps(bad))
    with pytest.raises(ValueError, match="Duplicate"):
        ev.load_questions(p)


@pytest.mark.skipif(not os.environ.get("TEST_DATABASE_URL"), reason="TEST_DATABASE_URL not set")
def test_end_to_end_run_writes_csvs(tmp_path, monkeypatch):
    # real retrieval (fake embedder) + stubbed answer / judge LLMs
    from tests.test_hybrid_search_db import NOISE, TARGETS, FakeEmbeddings
    from app.services import rag_chain, vectorstore
    from sqlalchemy import text

    fake = FakeEmbeddings()
    monkeypatch.setattr(vectorstore, "get_embedding_model", lambda: fake)
    with vectorstore._engine.begin() as conn:
        conn.execute(text("DROP TABLE IF EXISTS langchain_pg_embedding, langchain_pg_collection CASCADE"))
    vectorstore._stores.clear()
    vectorstore._hybrid_ready = False
    vectorstore._hybrid_failed_at = 0.0
    vectorstore.add_chunks_to_store(NOISE + TARGETS, "evalrepo")

    monkeypatch.setattr(rag_chain, "get_overview", lambda name: None)
    monkeypatch.setattr(rag_chain, "generate_answer", lambda q, docs, h: f"answer from {docs[0].metadata['source']}")
    monkeypatch.setattr(ev, "make_judge", lambda model, effort: (lambda q, a: (5 if "useAuth" in a else 2, "stub")))

    questions = {"repos": [{"repo_url": "https://github.com/x/y", "collection_name": "evalrepo", "questions": [
        {"id": "q1", "question": "Where is useAuth defined?", "expected_files": ["src/hooks/useAuth.ts"], "reference_answer": "r"},
        {"id": "q2", "question": "what is MAX_FILE_BYTES", "expected_files": ["server/config.py"], "reference_answer": "r"},
    ]}]}  # fmt: skip
    qfile = tmp_path / "questions.json"
    qfile.write_text(json.dumps(questions))
    out = tmp_path / "results"

    assert ev.main(["--questions", str(qfile), "--out-dir", str(out), "--mode", "both", "--label", "test"]) == 0
    assert ev.main(["--questions", str(qfile), "--out-dir", str(out), "--mode", "hybrid", "--retrieval-only"]) == 0

    with (out / "summary.csv").open() as f:
        summary = list(csv.DictReader(f))
    assert [r["mode"] for r in summary] == ["vector", "hybrid", "hybrid"]
    hybrid = summary[1]
    assert float(hybrid["hit_at_k"]) == 1.0 and float(hybrid["mrr"]) == 1.0
    assert hybrid["judged"] == "2" and float(hybrid["judge_mean"]) == pytest.approx(3.5)
    assert summary[2]["judged"] == "0" and summary[2]["judge_mean"] == ""

    per_q = sorted(out.glob("*_evalrepo_hybrid.csv"))[0]
    with per_q.open() as f:
        rows = list(csv.DictReader(f))
    assert rows[0]["first_hit_rank"] == "1"
    assert rows[0]["retrieved"].startswith("src/hooks/useAuth.ts#L3-L6")
