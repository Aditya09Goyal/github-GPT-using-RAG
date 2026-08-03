import os
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_classic.retrievers import (
    EnsembleRetriever,
    ContextualCompressionRetriever,
)
from langchain_community.retrievers import BM25Retriever
from langchain_classic.retrievers.document_compressors import CrossEncoderReranker
from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from config import configs
from src.data_pipeline import DatabaseManager
from src.vector_store import get_vector_store

SYSTEM_PROMPT = """You are a code assistant which answers user questions about a GitHub repo.
You will receive a user query, relevant context, and past conversation history.
Think step by step and cite file paths where relevant."""

PROMPT = ChatPromptTemplate.from_messages(
    [
        ("system", SYSTEM_PROMPT),
        (
            "human",
            "Conversation history:\n{history}\n\nContext:\n{context}\n\nQuestion: {question}",
        ),
    ]
)


class RAG:
    """RAG over one repo at a time, with hybrid retrieval + reranking, backed by Postgres/pgvector."""

    def __init__(self):
        self.db_manager = DatabaseManager()
        self.repo_name = None
        self.llm = ChatGoogleGenerativeAI(
            model=configs["chat_model"], temperature=configs["temperature"]
        )
        self.history = []
        self.retriever = None

    def prepare_retriever(self, repo_url_or_path: str):
        self.db_manager.prepare_database(repo_url_or_path)
        self.repo_name = self.db_manager.repo_name
        self.history = []

        store = get_vector_store(self.repo_name)
        vector_retriever = store.as_retriever(search_kwargs={"k": configs["top_k"]})

        from src.vector_store import get_all_documents

        all_docs = get_all_documents(self.repo_name)
        bm25_retriever = BM25Retriever.from_documents(all_docs)
        bm25_retriever.k = configs["top_k"]

        hybrid_retriever = EnsembleRetriever(
            retrievers=[vector_retriever, bm25_retriever],
            weights=[0.5, 0.5],
        )

        cross_encoder = HuggingFaceCrossEncoder(
            model_name="cross-encoder/ms-marco-MiniLM-L-6-v2"
        )
        reranker = CrossEncoderReranker(
            model=cross_encoder, top_n=configs["rerank_top_k"]
        )
        self.retriever = ContextualCompressionRetriever(
            base_compressor=reranker,
            base_retriever=hybrid_retriever,
        )

    def _format_history(self):
        return "\n".join(f"User: {u}\nAssistant: {a}" for u, a in self.history[-5:])

    def _format_context(self, docs):
        return "\n\n".join(
            f"[{d.metadata.get('file_path', 'unknown')}]\n{d.page_content}"
            for d in docs
        )

    def call(self, query: str):
        docs = self.retriever.invoke(query)
        context = self._format_context(docs)
        history_str = self._format_history()

        chain = PROMPT | self.llm | StrOutputParser()
        answer = chain.invoke(
            {"question": query, "context": context, "history": history_str}
        )

        self.history.append((query, answer))
        return answer, docs

    def call_stream(self, query: str):
        docs = self.retriever.invoke(query)
        context = self._format_context(docs)
        history_str = self._format_history()

        chain = PROMPT | self.llm | StrOutputParser()
        full_text = ""
        for chunk in chain.stream(
            {"question": query, "context": context, "history": history_str}
        ):
            full_text += chunk
            yield chunk
        self.history.append((query, full_text))


if __name__ == "__main__":
    repo_url = "https://github.com/Aditya09Goyal/github-GPT-using-RAG"
    rag = RAG()
    rag.prepare_retriever(repo_url)
    print(f"RAG ready for {repo_url}. Type 'exit' to quit.")
    while True:
        query = input("Query: ")
        if query.lower() in ["exit", "quit"]:
            break
        answer, docs = rag.call(query)
        print(f"\nAnswer:\n{answer}\n")
