from pydantic import BaseModel, Field

# Only public GitHub repo URLs: https://github.com/owner/repo (optional .git or trailing /)
GITHUB_URL_PATTERN = r"^https://github\.com/[\w.-]+/[\w.-]+?(\.git)?/?$"

# Safe collection names: 3-63 chars, letters/digits/-/_ , must start and end with a letter or digit.
# This also stops names like "../../app" from being used as a folder path on the server.
COLLECTION_NAME_PATTERN = r"^[a-zA-Z0-9][a-zA-Z0-9_-]{1,61}[a-zA-Z0-9]$"


class IndexRepoRequest(BaseModel):
    """
    What the client sends to index a new GitHub repo.
    """

    repo_url: str = Field(
        ...,
        pattern=GITHUB_URL_PATTERN,
        description="Full GitHub repo URL, e.g. https://github.com/owner/repo",
    )
    collection_name: str = Field(
        ...,
        pattern=COLLECTION_NAME_PATTERN,
        description="Unique name to store this repo's vectors under (3-63 chars: letters, digits, - or _)",
    )


class IndexRepoResponse(BaseModel):
    """
    What we send back after indexing completes.
    """

    collection_name: str
    files_indexed: int
    chunks_created: int
    message: str
