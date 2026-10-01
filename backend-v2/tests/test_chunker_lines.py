from pathlib import Path

from app.services.chunker import chunk_files, locate_pieces


def _lines(content: str, start: int, end: int) -> str:
    return "\n".join(content.split("\n")[start - 1 : end])


def test_locate_pieces_simple():
    content = "a = 1\nb = 2\n\ndef f():\n    return 3\n"
    pieces = ["a = 1\nb = 2", "def f():\n    return 3"]
    assert locate_pieces(content, pieces, overlap=0) == [(1, 2), (4, 5)]


def test_locate_pieces_overlapping_chunks():
    content = "\n".join(f"line {i}" for i in range(1, 11))
    pieces = [_lines(content, 1, 6), _lines(content, 5, 10)]  # 2 lines of overlap
    assert locate_pieces(content, pieces, overlap=20) == [(1, 6), (5, 10)]


def test_locate_pieces_repeated_text_maps_to_the_right_occurrence():
    block = "if x:\n    pass"
    content = f"{block}\n# middle\n{block}\n"
    assert locate_pieces(content, [block, "# middle", block], overlap=0) == [(1, 2), (3, 3), (4, 5)]


def test_locate_pieces_missing_and_empty_piece():
    assert locate_pieces("abc\ndef", ["zzz", "", "def"], overlap=0) == [None, None, (2, 2)]


def test_locate_pieces_piece_ending_with_newline_stays_on_its_line():
    content = "one\ntwo\nthree\n"
    assert locate_pieces(content, ["one\n"], overlap=0) == [(1, 1)]


def test_chunk_files_records_correct_line_ranges(tmp_path: Path):
    src = tmp_path / "pkg" / "mod.py"
    src.parent.mkdir()
    funcs = [f"def func_{i}(x):\n" + "".join(f"    y{j} = x + {j}\n" for j in range(12)) + "    return x\n" for i in range(12)]
    content = "\n\n".join(funcs)
    src.write_text(content, encoding="utf-8")

    chunks = chunk_files([src], tmp_path)
    assert len(chunks) >= 3  # actually split
    for c in chunks:
        assert c.source_path == "pkg/mod.py"
        assert c.start_line is not None and c.end_line is not None
        assert 1 <= c.start_line <= c.end_line
        body = c.text.split("\n", 1)[1]  # drop the "File: ..." header
        # the recorded lines contain exactly the chunk text (modulo stripped surrounding whitespace)
        assert body.strip() in _lines(content, c.start_line, c.end_line)
        assert _lines(content, c.start_line, c.end_line).strip().startswith(body.strip().split("\n")[0])
    # chunks advance through the file
    starts = [c.start_line for c in chunks]
    assert starts == sorted(starts)
    assert chunks[-1].end_line == content.rstrip("\n").count("\n") + 1


def test_chunk_files_crlf_files(tmp_path: Path):
    src = tmp_path / "a.txt"
    src.write_bytes(b"first\r\nsecond\r\nthird\r\n")
    [chunk] = chunk_files([src], tmp_path)
    assert (chunk.start_line, chunk.end_line) == (1, 3)
