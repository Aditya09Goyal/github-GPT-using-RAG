import threading
import time
from dataclasses import dataclass, field, asdict

# Indexing jobs live in memory. If the server restarts mid-job the job is simply gone,
# and the frontend reports that instead of waiting forever.
_jobs: dict[str, "Job"] = {}
_jobs_lock = threading.Lock()

# Only one repo is embedded at a time — two at once would blow the 512 MB free-tier RAM.
index_lock = threading.Lock()


@dataclass
class Job:
    collection_name: str
    repo_url: str
    status: str = "queued"  # queued | running | done | failed
    stage: str = "Waiting for another repo to finish…"
    files: int = 0
    chunks: int = 0
    embedded: int = 0
    error: str | None = None
    started_at: float = field(default_factory=time.time)
    requested_by: list[str] = field(default_factory=list)  # logins that get this repo added when it finishes

    def to_dict(self) -> dict:
        return asdict(self)


def create_job(collection_name: str, repo_url: str, login: str) -> Job:
    with _jobs_lock:
        job = Job(collection_name=collection_name, repo_url=repo_url, requested_by=[login])
        _jobs[collection_name] = job
        return job


def get_job(collection_name: str) -> Job | None:
    return _jobs.get(collection_name)


def update_job(collection_name: str, **fields) -> None:
    job = _jobs.get(collection_name)
    if job:
        for k, v in fields.items():
            setattr(job, k, v)


def is_active(collection_name: str) -> bool:
    job = _jobs.get(collection_name)
    return bool(job and job.status in ("queued", "running"))