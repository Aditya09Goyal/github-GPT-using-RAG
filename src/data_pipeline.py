import os
import subprocess
import glob
import shutil
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document as LCDocument
from config import configs
from src.vector_store import get_vector_store


def get_storage_root() -> str:
    """Local folder for cloned repos, independent of any framework."""
    root = os.path.expanduser("~/.githubchat")
    os.makedirs(root, exist_ok=True)
    return root


def download_github_repo(repo_url: str, local_path: str):
    try:
        print(f"local_path: {local_path}")
        subprocess.run(
            ["git", "--version"],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        os.makedirs(local_path, exist_ok=True)
        result = subprocess.run(
            ["git", "clone", repo_url, local_path],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return result.stdout.decode("utf-8")
    except subprocess.CalledProcessError as e:
        return f"Error during cloning: {e.stderr.decode('utf-8')}"
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


    def read_all_documents(path: str):
    documents = []
    code_extensions = [".py", ".js", ".ts", ".java", ".cpp", ".c", ".go", ".rs"]
    doc_extensions = [".md", ".txt", ".rst", ".json", ".yaml", ".yml"]

    for ext in code_extensions + doc_extensions:
        files = glob.glob(f"{path}/**/*{ext}", recursive=True)
        for file_path in files:
            if ".venv" in file_path or "node_modules" in file_path:
                continue
            try:
                with open(file_path, "r", encoding="utf-8") as f:
                    content = f.read()
                    relative_path = os.path.relpath(file_path, path)
                    is_code = ext in code_extensions
                    documents.append(
                        LCDocument(
                            page_content=content,
                            metadata={
                                "file_path": relative_path,
                                "type": ext[1:],
                                "is_code": is_code,
                            },
                        )
                    )
            except Exception as e:
                print(f"Error reading {file_path}: {e}")
    return documents


class DatabaseManager:
    """Manages downloading a repo and indexing it into Postgres via LangChain's PGVector."""

    def __init__(self):
        self.repo_paths = None
        self.repo_name = None

    def reset_database(self):
        self.repo_paths = None
        self.repo_name = None

    def _create_repo(self, repo_url_or_path: str) -> None:
        root_path = get_storage_root()

        if repo_url_or_path.startswith("http"):
            repo_name = repo_url_or_path.split("/")[-1].replace(".git", "")
            save_repo_dir = os.path.join(root_path, "repos", repo_name)
            download_github_repo(repo_url_or_path, save_repo_dir)
        else:
            repo_name = os.path.basename(repo_url_or_path)
            save_repo_dir = repo_url_or_path

        os.makedirs(save_repo_dir, exist_ok=True)
        self.repo_paths = {"save_repo_dir": save_repo_dir}
        self.repo_name = repo_name
        print(f"Repo paths: {self.repo_paths}, repo_name: {self.repo_name}")

    def _collection_already_indexed(self) -> bool:
        from src.vector_store import table_exists, _table_name_for

        table_name = _table_name_for(self.repo_name)
        if not table_exists(table_name):
            return False
        store = get_vector_store(self.repo_name)
        results = store.similarity_search("test", k=1)
        return len(results) > 0

    def prepare_database(self, repo_url_or_path: str):
        self.reset_database()
        self._create_repo(repo_url_or_path)

        if self._collection_already_indexed():
            print(f"Repo '{self.repo_name}' already indexed, skipping re-embed.")
            return

        print("Creating new database...")
        documents = read_all_documents(self.repo_paths["save_repo_dir"])
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=configs["chunk_size"],
            chunk_overlap=configs["chunk_overlap"],
        )
        chunks = splitter.split_documents(documents)
        print(f"total documents: {len(documents)}, total chunks: {len(chunks)}")

        store = get_vector_store(self.repo_name)
        store.add_documents(chunks)
        print("Indexing complete.")



    def _create_repo(self, repo_url_or_path: str) -> None:
    root_path = get_storage_root()

    if repo_url_or_path.startswith("http"):
        repo_name = repo_url_or_path.split("/")[-1].replace(".git", "")
        save_repo_dir = os.path.join(root_path, "repos", repo_name)
        if os.path.exists(save_repo_dir):
            shutil.rmtree(save_repo_dir)
        download_github_repo(repo_url_or_path, save_repo_dir)
    else:
        repo_name = os.path.basename(repo_url_or_path)
        save_repo_dir = repo_url_or_path

    os.makedirs(save_repo_dir, exist_ok=True)
    self.repo_paths = {"save_repo_dir": save_repo_dir}
    self.repo_name = repo_name