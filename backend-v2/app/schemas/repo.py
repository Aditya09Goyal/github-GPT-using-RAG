from pydantic import BaseModel, Field


class IndexRepoRequest(BaseModel):
    """
    What the client sends to index a new GitHub repo.
    """
    repo_url: str = Field(..., description="Full GitHub repo URL, e.g. https://github.com/owner/repo")
    collection_name: str = Field(..., description="Unique name to store this repo's vectors under")


class IndexRepoResponse(BaseModel):
    """
    What we send back after indexing completes.
    """
    collection_name: str
    files_indexed: int
    chunks_created: int
    message: str