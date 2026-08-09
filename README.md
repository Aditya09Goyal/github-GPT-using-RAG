# 🧭 GithubGPT - GitHub Repo Chat

![Hero](assets/hero.svg)

CodeCompass turns a GitHub repository into an interactive, searchable knowledge base. Add a public repo, index it locally with embeddings (Chroma), and chat with an LLM grounded on real files from that repo.

🔒 Privacy‑first • 🎯 Repo‑scoped answers • 💾 Local vector store • 🔖 Clear citations

---

## Project Structure

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py
│   ├── core/
│   │   ├── config.py
│   │   └── logging.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── routes_repo.py
│   │   └── routes_chat.py
│   ├── schemas/
│   │   ├── repo.py
│   │   └── chat.py
│   ├── services/
│   │   ├── github_loader.py
│   │   ├── chunker.py
│   │   ├── embeddings.py
│   │   ├── vectorstore.py
│   │   ├── retriever.py
│   │   └── rag_chain.py
│   └── db/
│       └── chroma/
├── data/
│   └── repos/
├── .env.example
├── .gitignore
├── pyproject.toml
└── README.md
```

---

## ✨ Highlights

- Repo‑scoped conversational search - answers stay focused on the repo you select
- Source grounding - responses reference retrieved passages and files
- Persistent index - once indexed, the repo remains searchable
- Simple ingestion - accepts `owner/repo` or full GitHub URLs; normalization prevents duplicates

---

## 📸 Screenshots

![Home UI](assets/home.png)
![Analyzing](assets/analyzing.png)
![Chat UI](assets/chat.png)

---

## 🏗️ Architecture

```
React (Vite + Tailwind)
       ↕
FastAPT REST API
       ↕
Embedchain (ingest + retrieve)
       ↕               ↘
   Chroma (vectors)   Gemini LLM
```

---
## Design Choices

 - In `app/services/embeddings.py`, `normalize_embeddings=True` is a small but important detail — it scales every vector to unit length, so when we later compare vectors for similarity, the comparison is purely about direction (meaning) rather than being skewed by magnitude (which has nothing to do with semantic similarity).
 - In `app/services/vectorstore.py`, `collection_name` per repo — Chroma lets you have multiple separate "collections" inside one database, like separate folders. We're using one collection per repo (e.g. `"hello-world"`, `"my-flask-app"`), so if a user later indexes two different repos, searching one never accidentally returns chunks from the other.
 - `Document` wrapping — LangChain's vectorstores don't work with our own Chunk dataclass directly; they expect their own Document type, which pairs `page_content` (the actual text) with metadata (a dictionary of anything else worth remembering — here, which file it came from). This metadata is what lets the chatbot later say "this answer is based on `src/auth.py`" instead of just returning a floating paragraph with no origin.


---

## 🗺️ Roadmap

- File/line citations with clickable open‑in‑editor behavior
- Partial/continuous indexing for very large repos
- Answer streaming UI for progressive responses
- Docker images and a simple hosted deployment option