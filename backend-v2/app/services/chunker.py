import re
from bisect import bisect_right
from pathlib import Path
from dataclasses import dataclass

from langchain_text_splitters import Language, RecursiveCharacterTextSplitter

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
    # 1-based, inclusive line range of the chunk in the original file (None for synthetic chunks
    # like the repo overview, or if the piece couldn't be located in the file).
    start_line: int | None = None
    end_line: int | None = None


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


# Code-aware splitting: cut at class / function boundaries instead of in the middle of them.
LANGUAGE_BY_EXT = {
    ".py": Language.PYTHON,
    ".js": Language.JS,
    ".jsx": Language.JS,
    ".ts": Language.TS,
    ".tsx": Language.TS,
    ".java": Language.JAVA,
    ".go": Language.GO,
    ".rs": Language.RUST,
    ".c": Language.C,
    ".h": Language.C,
    ".cpp": Language.CPP,
    ".hpp": Language.CPP,
    ".cs": Language.CSHARP,
    ".kt": Language.KOTLIN,
    ".php": Language.PHP,
    ".rb": Language.RUBY,
    ".swift": Language.SWIFT,
    ".md": Language.MARKDOWN,
    ".html": Language.HTML,
}

_splitters: dict = {}


def _splitter_for(path: Path) -> RecursiveCharacterTextSplitter:
    lang = LANGUAGE_BY_EXT.get(path.suffix.lower())
    if lang not in _splitters:
        if lang is None:
            _splitters[lang] = RecursiveCharacterTextSplitter(
                chunk_size=settings.chunk_size, chunk_overlap=settings.chunk_overlap
            )
        else:
            _splitters[lang] = RecursiveCharacterTextSplitter.from_language(
                lang,
                chunk_size=settings.chunk_size,
                chunk_overlap=settings.chunk_overlap,
            )
    return _splitters[lang]


def locate_pieces(content: str, pieces: list[str], overlap: int) -> list[tuple[int, int] | None]:
    """
    Finds the (start_line, end_line) of each split piece in the original file, 1-based and inclusive.
    The splitter only strips whitespace from its pieces, so each one is an exact substring of the file,
    and pieces come out in file order. Searching forward from (previous end - overlap) keeps repeated
    code (e.g. identical boilerplate blocks) mapped to the right occurrence.
    """
    line_starts = [0] + [m.end() for m in re.finditer("\n", content)]

    def line_of(offset: int) -> int:
        return bisect_right(line_starts, offset)  # offset 0 → line 1

    ranges: list[tuple[int, int] | None] = []
    prev_start, prev_end = -1, 0
    for piece in pieces:
        if not piece:
            ranges.append(None)
            continue
        pos = -1
        # 1) where the next piece should start, 2) anywhere after the previous piece, 3) anywhere
        for start in (max(prev_start + 1, prev_end - overlap), prev_start + 1, 0):
            pos = content.find(piece, max(start, 0))
            if pos != -1:
                break
        if pos == -1:
            ranges.append(None)
            continue
        end = pos + len(piece)
        ranges.append((line_of(pos), line_of(end - 1)))
        prev_start, prev_end = pos, end
    return ranges


def chunk_files(file_paths: list[Path], repo_root: Path) -> list[Chunk]:
    """
    Reads each file and splits it into overlapping, code-aware chunks.
    Each chunk starts with a "File: path" line so questions that name a file
    match its chunks in the vector search, and records the line range it covers
    so answers can cite e.g. auth.py · L12–40.
    Stops early once max_chunks is passed — the caller rejects such repos.
    """
    all_chunks: list[Chunk] = []

    for path in file_paths:
        content = read_file_safely(path)
        if content is None or not content.strip():
            continue

        relative_path = path.relative_to(repo_root).as_posix()
        pieces = _splitter_for(path).split_text(content)
        ranges = locate_pieces(content, pieces, settings.chunk_overlap)

        for i, (piece, lines) in enumerate(zip(pieces, ranges)):
            all_chunks.append(
                Chunk(
                    text=f"File: {relative_path}\n{piece}",
                    source_path=relative_path,
                    chunk_index=i,
                    start_line=lines[0] if lines else None,
                    end_line=lines[1] if lines else None,
                )
            )

        if len(all_chunks) > settings.max_chunks:
            break

    logger.info(f"Created {len(all_chunks)} chunks from {len(file_paths)} files")
    return all_chunks
