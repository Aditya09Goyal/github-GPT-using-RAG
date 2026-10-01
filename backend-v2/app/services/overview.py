import json
import re
import urllib.request
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

# Special "file" name for the repo overview chunk (defined in vectorstore, re-exported here).
# It is always added to the LLM context, but never shown as a source chip.
from app.services.vectorstore import OVERVIEW_SOURCE

logger = get_logger(__name__)

README_NAMES = ("README.md", "readme.md", "Readme.md", "README", "README.txt")


def _github_api(path: str):
    """
    Small GitHub REST call. Uses GITHUB_TOKEN when set (5000 req/h instead of 60).
    Returns None on any error — the overview just skips that part.
    """
    req = urllib.request.Request(f"https://api.github.com{path}", headers={"Accept": "application/vnd.github+json"})
    if settings.github_token:
        req.add_header("Authorization", f"Bearer {settings.github_token}")
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return json.loads(res.read().decode())
    except Exception as e:
        logger.warning(f"GitHub API {path} failed: {e}")
        return None


def _owner_repo(repo_url: str) -> tuple[str, str]:
    m = re.match(r"^https://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?/?$", repo_url)
    return (m.group(1), m.group(2)) if m else ("", "")


def build_overview(repo_url: str, repo_path: Path, files: list[Path]) -> str:
    """
    One text block describing the whole repo: GitHub description, contributors,
    languages, the file list and the start of the README.
    Answers "who made this?", "what is this project?", "what's the folder structure?"
    — questions that no single code chunk can answer.
    """
    owner, name = _owner_repo(repo_url)
    lines = [f"REPOSITORY OVERVIEW: {owner}/{name}", f"URL: {repo_url}"]

    meta = _github_api(f"/repos/{owner}/{name}") or {}
    if meta.get("description"):
        lines.append(f"Description: {meta['description']}")
    if meta.get("topics"):
        lines.append(f"Topics: {', '.join(meta['topics'])}")
    if meta:
        lines.append(f"Stars: {meta.get('stargazers_count', 0)} · Forks: {meta.get('forks_count', 0)} · Default branch: {meta.get('default_branch', '')}")
    lines.append(f"Owner: {owner}")

    contributors = _github_api(f"/repos/{owner}/{name}/contributors?per_page=20") or []
    if isinstance(contributors, list) and contributors:
        lines.append(
            "Contributors (by number of commits): "
            + ", ".join(f"{c.get('login')} ({c.get('contributions')} commits)" for c in contributors)
        )

    languages = _github_api(f"/repos/{owner}/{name}/languages") or {}
    if isinstance(languages, dict) and languages:
        lines.append(f"Languages: {', '.join(languages.keys())}")

    paths = sorted(p.relative_to(repo_path).as_posix() for p in files)
    lines.append(f"Files ({len(paths)}):")
    lines.extend(f"- {p}" for p in paths[:200])
    if len(paths) > 200:
        lines.append(f"- … and {len(paths) - 200} more")

    for rn in README_NAMES:
        readme = repo_path / rn
        if readme.exists():
            try:
                text = readme.read_text(encoding="utf-8", errors="ignore").strip()
                lines.append(f"README (start):\n{text[:1500]}")
            except OSError:
                pass
            break

    return "\n".join(lines)