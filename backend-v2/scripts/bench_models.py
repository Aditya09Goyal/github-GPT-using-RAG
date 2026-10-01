"""
Times the Groq models available to your key on the follow-up rewrite task.
Run from backend-v2 (venv active):   python scripts/bench_models.py
Then put the fastest model whose rewrites look correct into .env:  CONDENSE_MODEL=<model>
"""
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.output_parsers import StrOutputParser  # noqa: E402
from langchain_core.prompts import ChatPromptTemplate  # noqa: E402
from langchain_groq import ChatGroq  # noqa: E402

from app.core.config import settings  # noqa: E402
from app.services.rag_chain import CONDENSE_PROMPT  # noqa: E402

CANDIDATES = [
    ("openai/gpt-oss-20b", "low"),
    ("qwen/qwen3.8-27b", "none"),
    ("allam-2-7b", None),
    ("openai/gpt-oss-120b", "low"),
]

CASES = [
    ("User: What does the RouteOptimizer class do?\nAssistant: It picks the cheapest warehouse for an order.", "where is it called?"),
    ("User: Explain the auth flow.\nAssistant: Login uses JWT in core/auth.py.", "what formulas are used in this?"),
]

RUNS = 3


def main() -> None:
    prompt = ChatPromptTemplate.from_template(CONDENSE_PROMPT)
    for model, effort in CANDIDATES:
        extra = {"reasoning_effort": effort} if effort else {}
        llm = ChatGroq(model=model, groq_api_key=settings.groq_api_key, temperature=0, **extra)
        chain = prompt | llm | StrOutputParser()
        times, outputs = [], []
        try:
            for history, q in CASES:
                for i in range(RUNS):
                    t = time.perf_counter()
                    out = chain.invoke({"history": history, "question": q}).strip()
                    times.append((time.perf_counter() - t) * 1000)
                    if i == 0:
                        outputs.append(out)
            print(f"\n{model}  (reasoning_effort={effort})  median {statistics.median(times):.0f} ms")
            for (_, q), out in zip(CASES, outputs):
                print(f"   '{q}'  ->  {out!r}")
        except Exception as e:
            print(f"\n{model}  FAILED: {str(e)[:160]}")


if __name__ == "__main__":
    main()
