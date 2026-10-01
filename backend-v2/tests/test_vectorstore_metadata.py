from app.services.chunker import Chunk
from app.services.vectorstore import chunk_metadata


def test_chunk_metadata_with_lines():
    c = Chunk(text="t", source_path="a.py", chunk_index=2, start_line=3, end_line=9)
    assert chunk_metadata(c) == {"source": "a.py", "chunk_index": 2, "start_line": 3, "end_line": 9}


def test_chunk_metadata_without_lines():
    c = Chunk(text="t", source_path="__overview__", chunk_index=0)
    assert chunk_metadata(c) == {"source": "__overview__", "chunk_index": 0}
