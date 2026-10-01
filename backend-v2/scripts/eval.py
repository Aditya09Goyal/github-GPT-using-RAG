"""
Retrieval + answer evaluation for the RAG pipeline.

Runs every question in eval/questions.json through the REAL pipeline (rag_chain.prepare_context →
generate_answer — the same code the /chat endpoints use) and measures:
  - Hit@k            a chunk from an expected file is in the top k            (retrieval)
  - MRR              1 / rank of the first chunk from an expected file         (retrieval)
  - File recall@k    share of the expected files found in the top k           (retrieval)
  - Judge score      1-5 from an LLM judge comparing the answer with the reference answer
                     (correct = score >= 4)                                    (generation)

Results go to CSV for before/after tracking:
  eval/results/<run_id>_<collection>_<mode>.csv   one row per question
  eval/results/summary.csv                        one row per (run, repo, mode) — appended, never overwritten

Run from backend-v2 (venv active, .env filled in, repos already indexed in the app):
  python scripts/eval.py                                   # hybrid search, answers + judge
  python scripts/eval.py --mode both --retrieval-only      # fast & free: vector vs hybrid retrieval
  python scripts/eval.py --mode vector --label before      # baseline
  python scripts/eval.py --mode hybrid --label after
  python scripts/eval.py --repo aditya09goyal-github-gpt-using-rag --limit 5 --sleep 2
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TypeVar

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

DEFAULT_QUESTIONS = ROOT / "eval" / "questions.json"
DEFAULT_RESULTS = ROOT / "eval" / "results"
CORRECT_THRESHOLD = 4  # judge score (1-5) that counts as a correct answer

T = TypeVar("T")


# ---------------------------------------------------------------- metrics (pure, unit-tested)


def first_hit_rank(retrieved: Sequence[str], expected: Sequence[str], k: int) -> int | None:
    """1-based rank of the first retrieved chunk whose file is expected, within the top k."""
    wanted = set(expected)
    for rank, path in enumerate(retrieved[:k], start=1):
        if path in wanted:
            return rank
    return None


def hit_at_k(retrieved: Sequence[str], expected: Sequence[str], k: int) -> float:
    return 1.0 if first_hit_rank(retrieved, expected, k) else 0.0


def reciprocal_rank(retrieved: Sequence[str], expected: Sequence[str], k: int) -> float:
    rank = first_hit_rank(retrieved, expected, k)
    return 1.0 / rank if rank else 0.0


def file_recall(retrieved: Sequence[str], expected: Sequence[str], k: int) -> float:
    if not expected:
        return 0.0
    return len(set(retrieved[:k]) & set(expected)) / len(set(expected))


def parse_judge_reply(text: str) -> tuple[int | None, str]:
    """
    Pulls {"score": 1-5, "reason": "..."} out of the judge's reply, tolerating code fences
    or extra prose around the JSON. Returns (None, raw text) if no usable score is found.
    """
    for candidate in re.findall(r"\{.*?\}", text, flags=re.DOTALL)[::-1] or [text]:
        try:
            data = json.loads(candidate)
        except (json.JSONDecodeError, TypeError):
            continue
        score = data.get("score") if isinstance(data, dict) else None
        if isinstance(score, (int, float)) and 1 <= score <= 5:
            return int(round(score)), str(data.get("reason", "")).strip()
    m = re.search(r"score\W{0,5}([1-5])\b", text, flags=re.IGNORECASE)
    if m:
        return int(m.group(1)), text.strip()[:500]
    return None, text.strip()[:500]


def mean(values: Sequence[float]) -> float | None:
    return round(statistics.fmean(values), 4) if values else None


# ---------------------------------------------------------------- questions file


@dataclass
class Question:
    id: str
    question: str
    expected_files: list[str]
    reference_answer: str = ""
    tags: list[str] = field(default_factory=list)


@dataclass
class RepoSet:
    repo_url: str
    collection_name: str
    questions: list[Question]


def load_questions(path: Path) -> list[RepoSet]:
    data = json.loads(path.read_text(encoding="utf-8"))
    sets: list[RepoSet] = []
    seen_ids: set[str] = set()
    for repo in data["repos"]:
        questions = []
        for q in repo["questions"]:
            if q["id"] in seen_ids:
                raise ValueError(f"Duplicate question id: {q['id']}")
            if not q.get("expected_files"):
                raise ValueError(f"Question {q['id']} has no expected_files")
            seen_ids.add(q["id"])
            questions.append(
                Question(
                    id=q["id"],
                    question=q["question"],
                    expected_files=list(q["expected_files"]),
                    reference_answer=q.get("reference_answer", ""),
                    tags=list(q.get("tags", [])),
                )
            )
        sets.append(RepoSet(repo["repo_url"], repo["collection_name"], questions))
    return sets


# ---------------------------------------------------------------- LLM judge

JUDGE_PROMPT = """You are grading an AI assistant's answer to a question about a code repository.

Question:
{question}

Reference answer (written by a developer who knows the code — treat it as ground truth):
{reference}

Files that contain the answer: {expected_files}

Assistant's answer:
{answer}

Grade how correct and complete the assistant's answer is compared with the reference:
5 = fully correct and complete (extra correct detail is fine)
4 = correct, with minor omissions
3 = partially correct: some key facts right, some missing or vague
2 = mostly wrong or missing the point, with little correct content
1 = wrong, made up, or says it doesn't know
Penalise statements that contradict the reference. Do not reward length or style.

Reply with JSON only: {{"score": <1-5>, "reason": "<one sentence>"}}"""


def make_judge(model: str, effort: str | None):
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate
    from langchain_groq import ChatGroq

    from app.core.config import settings

    extra = {"reasoning_effort": effort} if effort and "gpt-oss" in model else {}
    llm = ChatGroq(model=model, groq_api_key=settings.groq_api_key, temperature=0, **extra)
    chain = ChatPromptTemplate.from_template(JUDGE_PROMPT) | llm | StrOutputParser()

    def judge(q: Question, answer: str) -> tuple[int | None, str]:
        reply = chain.invoke(
            {
                "question": q.question,
                "reference": q.reference_answer or "(none given — judge against the expected files' purpose)",
                "expected_files": ", ".join(q.expected_files),
                "answer": answer,
            }
        )
        return parse_judge_reply(reply)

    return judge


def with_retries(fn: Callable[[], T], what: str, attempts: int = 4) -> T:
    """Groq's free tier rate-limits quickly; back off 2s, 4s, 8s before giving up."""
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 — any provider error is retried the same way
            if i == attempts - 1:
                raise
            wait = 2 ** (i + 1)
            print(f"    ! {what} failed ({str(e)[:120]}) — retrying in {wait}s", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


# ---------------------------------------------------------------- run


CSV_FIELDS = [
    "run_id", "timestamp", "label", "mode", "k", "collection", "question_id", "tags", "question",
    "expected_files", "retrieved", "first_hit_rank", "hit_at_k", "reciprocal_rank", "file_recall",
    "chunks_with_lines", "answer", "judge_score", "judge_correct", "judge_reason",
    "retrieve_ms", "answer_ms", "error",
]  # fmt: skip

SUMMARY_FIELDS = [
    "run_id", "timestamp", "label", "mode", "k", "collection", "questions", "hit_at_k", "mrr",
    "file_recall", "judge_mean", "judge_correct_rate", "judged", "errors", "avg_retrieve_ms",
    "avg_answer_ms", "judge_model", "answer_model",
]  # fmt: skip


def _fmt_chunk(meta: dict) -> str:
    path = meta.get("source", "?")
    if meta.get("start_line") is not None:
        return f"{path}#L{meta['start_line']}-L{meta['end_line']}"
    return path


def evaluate_repo(repo: RepoSet, mode: str, args, judge, run_id: str, timestamp: str) -> list[dict]:
    from app.services.rag_chain import generate_answer, prepare_context
    from app.services.overview import OVERVIEW_SOURCE

    rows = []
    questions = repo.questions[: args.limit] if args.limit else repo.questions
    for n, q in enumerate(questions, start=1):
        row = {
            "run_id": run_id, "timestamp": timestamp, "label": args.label, "mode": mode, "k": args.k,
            "collection": repo.collection_name, "question_id": q.id, "tags": ";".join(q.tags),
            "question": q.question, "expected_files": ";".join(q.expected_files), "error": "",
        }  # fmt: skip
        try:
            t0 = time.perf_counter()
            history, docs = prepare_context(q.question, repo.collection_name, None, mode=mode)
            row["retrieve_ms"] = round(1000 * (time.perf_counter() - t0))

            chunks = [d for d in docs if d.metadata.get("source") != OVERVIEW_SOURCE][: args.k]
            retrieved = [d.metadata.get("source", "") for d in chunks]
            rank = first_hit_rank(retrieved, q.expected_files, args.k)
            row.update(
                retrieved=";".join(_fmt_chunk(d.metadata) for d in chunks),
                first_hit_rank=rank or "",
                hit_at_k=hit_at_k(retrieved, q.expected_files, args.k),
                reciprocal_rank=round(reciprocal_rank(retrieved, q.expected_files, args.k), 4),
                file_recall=round(file_recall(retrieved, q.expected_files, args.k), 4),
                chunks_with_lines=sum(1 for d in chunks if d.metadata.get("start_line") is not None),
            )

            if not args.retrieval_only:
                t1 = time.perf_counter()
                answer = with_retries(lambda: generate_answer(q.question, docs, history), "answer")
                row["answer_ms"] = round(1000 * (time.perf_counter() - t1))
                row["answer"] = answer
                if judge:
                    score, reason = with_retries(lambda: judge(q, answer), "judge")
                    row["judge_score"] = score if score is not None else ""
                    row["judge_correct"] = "" if score is None else int(score >= CORRECT_THRESHOLD)
                    row["judge_reason"] = reason
        except Exception as e:  # noqa: BLE001 — record and keep going, one bad question shouldn't kill the run
            row["error"] = f"{type(e).__name__}: {e}"[:500]

        status = "ERR" if row["error"] else ("hit " if row.get("hit_at_k") else "MISS")
        extra = f" judge={row['judge_score']}" if row.get("judge_score") not in (None, "") else ""
        rank_txt = f"rank={row.get('first_hit_rank') or '-'}"
        print(f"  [{mode:6}] {n:>2}/{len(questions)} {q.id:<10} {status} {rank_txt:<8}{extra}  {q.question[:60]}")
        rows.append(row)
        if args.sleep:
            time.sleep(args.sleep)
    return rows


def summarize(rows: list[dict], base: dict) -> dict:
    ok = [r for r in rows if not r["error"]]
    judged = [r for r in ok if r.get("judge_score") not in (None, "")]
    return {
        **base,
        "questions": len(rows),
        "hit_at_k": mean([r["hit_at_k"] for r in ok]),
        "mrr": mean([r["reciprocal_rank"] for r in ok]),
        "file_recall": mean([r["file_recall"] for r in ok]),
        "judge_mean": mean([r["judge_score"] for r in judged]),
        "judge_correct_rate": mean([r["judge_correct"] for r in judged]),
        "judged": len(judged),
        "errors": len(rows) - len(ok),
        "avg_retrieve_ms": mean([r["retrieve_ms"] for r in ok if r.get("retrieve_ms") is not None]),
        "avg_answer_ms": mean([r["answer_ms"] for r in ok if r.get("answer_ms") is not None]),
    }


def write_csv(path: Path, fields: list[str], rows: list[dict], append: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists() or not append
    with path.open("a" if append else "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        if new:
            w.writeheader()
        w.writerows(rows)


def previous_summary(path: Path, collection: str, mode: str, run_id: str) -> dict | None:
    """Latest earlier summary row for the same repo + mode, to print a before/after delta."""
    if not path.exists():
        return None
    with path.open(encoding="utf-8") as f:
        rows = [r for r in csv.DictReader(f) if r["collection"] == collection and r["mode"] == mode and r["run_id"] != run_id]
    return rows[-1] if rows else None


def print_summary(s: dict, prev: dict | None) -> None:
    def cell(key: str, pct: bool = True) -> str:
        v = s.get(key)
        if v is None:
            return "—"
        txt = f"{100 * v:5.1f}%" if pct else f"{v:4.2f}"
        if prev and prev.get(key) not in (None, ""):
            d = v - float(prev[key])
            txt += f" ({'+' if d >= 0 else ''}{100 * d:.1f})" if pct else f" ({'+' if d >= 0 else ''}{d:.2f})"
        return txt

    print(
        f"\n  {s['collection']} · {s['mode']} · {s['questions']} questions"
        + (f" · {s['errors']} errors" if s["errors"] else "")
        + (f"   (Δ vs run {prev['run_id']} '{prev['label']}')" if prev else "")
    )
    print(f"    Hit@{s['k']:<3}       {cell('hit_at_k')}")
    print(f"    MRR@{s['k']:<3}       {cell('mrr', pct=False)}")
    print(f"    File recall  {cell('file_recall')}")
    if s["judged"]:
        print(f"    Judge mean   {cell('judge_mean', pct=False)} / 5   correct (≥{CORRECT_THRESHOLD}): {cell('judge_correct_rate')}")


def main(argv: list[str] | None = None) -> int:
    from app.core.config import settings

    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--questions", type=Path, default=DEFAULT_QUESTIONS)
    p.add_argument("--out-dir", type=Path, default=DEFAULT_RESULTS)
    p.add_argument("--mode", choices=["hybrid", "vector", "both"], default=settings.search_mode)
    p.add_argument("--k", type=int, default=settings.retriever_top_k, help="top-k chunks retrieved and scored (default: RETRIEVER_TOP_K)")
    p.add_argument("--repo", action="append", help="only this collection_name (repeatable)")
    p.add_argument("--limit", type=int, default=0, help="only the first N questions per repo")
    p.add_argument("--label", default="", help="free text saved with the run, e.g. 'before hybrid'")
    p.add_argument("--retrieval-only", action="store_true", help="skip answer generation and judging (fast, no LLM calls)")
    p.add_argument("--no-judge", action="store_true", help="generate answers but don't judge them")
    p.add_argument("--judge-model", default=settings.llm_model)
    p.add_argument("--judge-effort", default="medium", help="reasoning_effort for gpt-oss judges (low|medium|high)")
    p.add_argument("--sleep", type=float, default=0.0, help="seconds to wait between questions (Groq rate limits)")
    args = p.parse_args(argv)

    # retrieval uses settings.retriever_top_k internally; keep it in step with --k
    settings.retriever_top_k = args.k

    from app.services.vectorstore import collection_exists

    repo_sets = load_questions(args.questions)
    if args.repo:
        repo_sets = [r for r in repo_sets if r.collection_name in set(args.repo)]
    if not repo_sets:
        print("No matching repos in the questions file.", file=sys.stderr)
        return 2

    modes = ["vector", "hybrid"] if args.mode == "both" else [args.mode]
    judge = None if args.retrieval_only or args.no_judge else make_judge(args.judge_model, args.judge_effort)

    now = datetime.now(timezone.utc)
    run_id = now.strftime("%Y%m%d-%H%M%S")
    timestamp = now.isoformat(timespec="seconds")
    summary_path = args.out_dir / "summary.csv"
    print(f"Eval run {run_id}  modes={','.join(modes)}  k={args.k}  judge={'off' if not judge else args.judge_model}")

    any_ran = False
    for repo in repo_sets:
        if not collection_exists(repo.collection_name):
            print(f"\n! '{repo.collection_name}' isn't indexed — add {repo.repo_url} in the app first. Skipping.", file=sys.stderr)
            continue
        print(f"\n{repo.repo_url}  ({repo.collection_name})")
        for mode in modes:
            rows = evaluate_repo(repo, mode, args, judge, run_id, timestamp)
            any_ran = True
            write_csv(args.out_dir / f"{run_id}_{repo.collection_name}_{mode}.csv", CSV_FIELDS, rows)

            base = {
                "run_id": run_id, "timestamp": timestamp, "label": args.label, "mode": mode, "k": args.k,
                "collection": repo.collection_name, "judge_model": args.judge_model if judge else "",
                "answer_model": "" if args.retrieval_only else settings.llm_model,
            }  # fmt: skip
            summary = summarize(rows, base)
            prev = previous_summary(summary_path, repo.collection_name, mode, run_id)
            write_csv(summary_path, SUMMARY_FIELDS, [summary], append=True)
            print_summary(summary, prev)

            missing_lines = sum(1 for r in rows if not r["error"] and r.get("chunks_with_lines") == 0)
            if missing_lines:
                print(f"    note: {missing_lines} questions retrieved chunks without line numbers — re-index the repo to get them.")

    if any_ran:
        print(f"\nPer-question results: {args.out_dir}/{run_id}_*.csv\nRun summaries:        {summary_path}")
    return 0 if any_ran else 1


if __name__ == "__main__":
    sys.exit(main())
