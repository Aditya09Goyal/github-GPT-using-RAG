import os
import shutil
import stat
import subprocess
from pathlib import Path

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)

# File extensions we actually care about indexing.
# Skip binaries, images, lockfiles, etc — they're not useful for a chat context
# and would just waste embedding time/space.
ALLOWED_EXTENSIONS = {
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".jsx",
    ".java",
    ".go",
    ".rs",
    ".md",
    ".txt",
    ".json",
    ".yaml",
    ".yml",
    ".toml",
    ".html",
    ".css",
    ".c",
    ".h",
    ".cpp",
    ".hpp",
    ".cs",
    ".kt",
    ".php",
    ".rb",
    ".swift",
    ".sql",
    ".sh",
    ".vue",
    ".svelte",
}

ALLOWED_NO_EXTENSION_NAMES = {"README", "LICENSE", "Dockerfile", "Makefile"}

# Folders to skip entirely while walking the repo
IGNORED_DIRS = {
    ".git",
    "node_modules",
    "venv",
    "__pycache__",
    "dist",
    "build",
    ".next",
    ".venv",
    ".cache",
    ".vite",
    "vendor",
    "target",
    "coverage",
    ".idea",
    ".vscode",
    "site-packages",
}

# Huge auto-generated files: thousands of useless chunks, slow to embed on a free CPU
IGNORED_FILES = {
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "poetry.lock",
    "uv.lock",
    "Pipfile.lock",
    "Cargo.lock",
    "composer.lock",
}

MAX_FILE_BYTES = (
    200_000  # skip anything bigger than ~200 KB (minified bundles, data dumps)
)


def _force_remove(func, path, exc):
    """
    Windows marks git's pack files as read-only, so rmtree fails with
    'Access is denied'. Clear the read-only flag and retry the delete.
    """
    os.chmod(path, stat.S_IWRITE)
    func(path)


CLONE_TIMEOUT_SECONDS = 120  # a clone that takes longer than this is killed


def clone_repo(repo_url: str, repo_name: str) -> Path:
    """
    Shallow-clones a GitHub repo into settings.repo_clone_dir.
    Runs git with a hard timeout, so a slow or stuck download can never block
    the indexing worker forever. Any half-downloaded folder is deleted on failure.
    """
    dest = Path(settings.repo_clone_dir) / repo_name

    if dest.exists():
        logger.info(f"Removing existing local copy at {dest}")
        shutil.rmtree(dest, onexc=_force_remove)

    dest.parent.mkdir(parents=True, exist_ok=True)

    logger.info(f"Cloning {repo_url} into {dest}")
    try:
        subprocess.run(
            [
                "git",
                "clone",
                "--depth",
                "1",
                "--single-branch",
                "--no-tags",
                "--",
                repo_url,
                str(dest),
            ],
            check=True,  # raise if git fails (e.g. repo not found)
            timeout=CLONE_TIMEOUT_SECONDS,  # kill git if it takes too long
            capture_output=True,
            text=True,
            # never stop and wait for a username/password (private or missing repo) — fail at once instead
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except subprocess.TimeoutExpired:
        if dest.exists():
            shutil.rmtree(dest, onexc=_force_remove)
        raise RuntimeError(
            f"Downloading the repo took longer than {CLONE_TIMEOUT_SECONDS} seconds — it is too big or GitHub is slow. Try again later."
        )
    except subprocess.CalledProcessError as e:
        if dest.exists():
            shutil.rmtree(dest, onexc=_force_remove)
        logger.warning(f"git clone failed: {e.stderr.strip()}")
        raise RuntimeError(
            "Could not download the repo. Check that it exists and is public."
        )

    return dest


def get_commit_sha(repo_path: Path) -> str:
    """The exact commit that was cloned (e.g. 'a1b2c3d…'), so citation links can point to that version."""
    result = subprocess.run(
        ["git", "-C", str(repo_path), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    return result.stdout.strip()


def collect_files(repo_path: Path) -> list[Path]:
    """
    Walks the cloned repo and returns a list of file paths worth indexing,
    filtered by extension and skipping irrelevant folders.
    """
    collected = []

    repo_root = repo_path.resolve()

    for path in repo_path.rglob("*"):
        # 1) skip symlinks — a repo could link to server files like /proc/self/environ
        if path.is_symlink():
            continue

        if not path.is_file():
            continue

        # 2) extra safety: the real file must be inside the cloned repo folder
        if not path.resolve().is_relative_to(repo_root):
            continue

        if any(ignored in path.parts for ignored in IGNORED_DIRS):
            continue

        if (
            path.suffix not in ALLOWED_EXTENSIONS
            and path.name not in ALLOWED_NO_EXTENSION_NAMES
        ):
            continue

        if path.name in IGNORED_FILES or path.stat().st_size > MAX_FILE_BYTES:
            continue

        # minified bundles are one giant line of noise
        if path.name.endswith((".min.js", ".min.css", ".map")):
            continue

        collected.append(path)

    logger.info(f"Collected {len(collected)} files from {repo_path}")
    return collected


def remove_clone(repo_path: Path) -> None:
    """
    Deletes the local clone once it's embedded — the frontend reads files straight
    from GitHub, so keeping clones only fills up the server's small disk.
    """
    if repo_path.exists():
        shutil.rmtree(repo_path, onexc=_force_remove)
