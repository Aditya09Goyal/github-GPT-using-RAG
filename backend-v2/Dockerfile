FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_SYMLINKS_WARNING=1

# git is needed to clone repos
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 1) install dependencies (cached unless pyproject.toml changes)
COPY pyproject.toml .
RUN pip install --no-cache-dir uv && uv pip install --system --no-cache -r pyproject.toml

# 2) download the embedding model at build time, so startup is fast
RUN python -c "from fastembed import TextEmbedding; TextEmbedding('sentence-transformers/all-MiniLM-L6-v2', cache_dir='/app/.cache/fastembed')"

# 3) copy the app code
COPY app ./app

# Render gives the port in $PORT
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]