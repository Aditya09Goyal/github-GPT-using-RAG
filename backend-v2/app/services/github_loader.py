import shutil
from pathlib import Path

import git

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# File extensions we actually care about indexing.
# Skip binaries, images, lockfiles, etc — they're not useful for a chat context
# and would just waste embedding time/space.
ALLOWED_EXTENSIONS = {
    ".py", ".js", ".ts", ".tsx", ".jsx", ".java", ".go", ".rs",
    ".md", ".txt", ".json", ".yaml", ".yml", ".toml",
    ".html", ".css",
}

# Folders to skip entirely while walking the repo
IGNORED_DIRS = {
    ".git", "node_modules", "venv", "__pycache__",
    "dist", "build", ".next", ".venv",
}


def clone_repo(repo_url: str, repo_name: str) -> Path:
    """
    Clones a GitHub repo to a local folder under settings.repo_clone_dir.
    If it already exists locally, deletes and re-clones (keeps it simple for now —
    no incremental pull logic yet).
    """
    dest = Path(settings.repo_clone_dir) / repo_name

    if dest.exists():
        logger.info(f"Removing existing local copy at {dest}")
        shutil.rmtree(dest)

    dest.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Cloning {repo_url} into {dest}")
    git.Repo.clone_from(repo_url, dest, depth=1)  # depth=1 = shallow clone, don't need full history

    return dest


def collect_files(repo_path: Path) -> list[Path]:
    """
    Walks the cloned repo and returns a list of file paths worth indexing,
    filtered by extension and skipping irrelevant folders.
    """
    collected = []

    for path in repo_path.rglob("*"):
        if not path.is_file():
            continue

        if any(ignored in path.parts for ignored in IGNORED_DIRS):
            continue

        if path.suffix not in ALLOWED_EXTENSIONS:
            continue

        collected.append(path)

    logger.info(f"Collected {len(collected)} files from {repo_path}")
    return collected