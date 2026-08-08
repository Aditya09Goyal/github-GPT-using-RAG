from pathlib import Path
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger(__name__)


@dataclass
class Chunk:
    """
    A single chunk of text, plus metadata about where it came from.
    Metadata matters a lot later — it's how we tell the user *which file*
    an answer was pulled from.
    """
    text: str
    source_path: str
    chunk_index: int


def read_file_safely(path: Path) -> str | None:
    """
    Reads a file as text. Returns None (instead of crashing) if the file
    can't be decoded as text — some repo files are secretly binary despite
    having an allowed extension, or use unusual encodings.
    """
    try:
        return path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as e:
        logger.warning(f"Skipping unreadable file {path}: {e}")
        return None


def chunk_files(file_paths: list[Path], repo_root: Path) -> list[Chunk]:
    """
    Reads each file and splits it into overlapping chunks.
    repo_root is used to store a clean relative path in metadata
    (e.g. 'src/app.py' instead of a long absolute Windows path).
    """
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )

    all_chunks: list[Chunk] = []

    for path in file_paths:
        content = read_file_safely(path)
        if content is None or not content.strip():
            continue

        relative_path = str(path.relative_to(repo_root))
        pieces = splitter.split_text(content)

        for i, piece in enumerate(pieces):
            all_chunks.append(
                Chunk(text=piece, source_path=relative_path, chunk_index=i)
            )

    logger.info(f"Created {len(all_chunks)} chunks from {len(file_paths)} files")
    return all_chunks