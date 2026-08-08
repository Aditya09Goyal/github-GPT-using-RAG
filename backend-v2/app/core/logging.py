import logging
import sys


def setup_logging(level: str = "INFO") -> None:
    """
    Configures root logging for the whole app.
    Call this once, at startup, in main.py — before anything else runs.
    """
    logging.basicConfig(
        level=level,
        format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
        handlers=[
            logging.StreamHandler(sys.stdout),
        ],
    )

    # Quiet down noisy third-party libraries — we don't need their debug-level
    # chatter cluttering our logs (this matters a lot once chromadb / langchain
    # are in the mix, they log aggressively at INFO level)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("chromadb").setLevel(logging.WARNING)
    logging.getLogger("sentence_transformers").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """
    Standard way to get a logger in any module:
        logger = get_logger(__name__)
    """
    return logging.getLogger(name)