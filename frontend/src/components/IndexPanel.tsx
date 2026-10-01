import { useEffect, useState } from "react";
import { Github, Loader2, Star } from "lucide-react";
import { indexRepo, ApiError } from "../api/client";
import { collectionFromRepo, parseGithubUrl } from "../lib/repo";
import type { IndexJob, Repo, User } from "../types/api";

interface GhRepo {
  name: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  size: number;
}

interface Props {
  user: User;
  onIndexed: (r: Repo) => void;
  onAuthExpired: () => void;
  autoFocus?: boolean;
}

export default function IndexPanel({ user, onIndexed, onAuthExpired, autoFocus }: Props) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(0);
  const [job, setJob] = useState<IndexJob | null>(null);
  const [userRepos, setUserRepos] = useState<GhRepo[]>([]);
  const [userBusy, setUserBusy] = useState(false);
  const [userError, setUserError] = useState("");

  const parsed = parseGithubUrl(url);
  const name = parsed ? collectionFromRepo(parsed.owner, parsed.repo) : "";

  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  // the signed-in user's public repos (public GitHub API, 60 requests / hour per visitor)
  useEffect(() => {
    let alive = true;
    setUserBusy(true);
    setUserError("");
    fetch(`https://api.github.com/users/${encodeURIComponent(user.login)}/repos?sort=updated&per_page=30`)
      .then((res) => {
        if (res.status === 403) throw new Error("GitHub rate limit hit — paste a repo link instead");
        if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
        return res.json() as Promise<GhRepo[]>;
      })
      .then((list) => {
        if (!alive) return;
        const withCode = list.filter((r) => r.size > 0).slice(0, 12);
        setUserRepos(withCode);
        if (!withCode.length) setUserError("You have no public repos with code yet — paste any public repo link above.");
      })
      .catch((e: Error) => alive && setUserError(e.message))
      .finally(() => alive && setUserBusy(false));
    return () => {
      alive = false;
    };
  }, [user.login]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed || busy) return;
    setBusy(true);
    setError("");
    setJob(null);
    const base: Repo = { name, url: `https://github.com/${parsed.owner}/${parsed.repo}`, owner: parsed.owner, repo: parsed.repo, indexedAt: Date.now() };
    try {
      const r = await indexRepo({ repo_url: base.url, collection_name: name }, setJob);
      onIndexed({ ...base, files: r.files || undefined, chunks: r.chunks || undefined });
      setUrl("");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onAuthExpired(); // token missing / expired → back to the sign-in screen
      } else if (err instanceof ApiError && err.status === 409) {
        onIndexed(base); // already indexed earlier → just open it
        setUrl("");
      } else {
        setError(err instanceof Error ? err.message : "Indexing failed.");
      }
    } finally {
      setBusy(false);
    }
  }

  const pct = job?.chunks ? Math.round((job.embedded / job.chunks) * 100) : 0;
  const stage = !job ? "Starting…" : job.status === "running" && job.chunks ? `Embedding ${job.embedded}/${job.chunks} chunks (${pct}%)` : job.stage;

  return (
    <form onSubmit={submit} className="w-full">
      <div className={`flex items-center gap-2 rounded-2xl border bg-panel px-3 py-2 shadow-sm transition-colors ${error ? "border-bad/60" : "border-line focus-within:border-accent"}`}>
        <Github size={18} className="shrink-0 text-muted" />
        <input
          autoFocus={autoFocus}
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setError("");
          }}
          disabled={busy}
          placeholder="https://github.com/owner/repo"
          aria-label="GitHub repository URL"
          className="min-w-0 flex-1 bg-transparent py-1.5 font-mono text-sm outline-none placeholder:text-muted/70"
        />
        <button
          type="submit"
          disabled={!parsed || busy}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-accent-fill px-3.5 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-40"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {busy ? "Indexing" : "Index"}
        </button>
      </div>

      <div className="mt-2 min-h-[20px] px-1 text-xs">
        {busy ? (
          <span className="text-muted">
            {stage} <span className="font-mono">{secs}s</span>
            {job?.files ? <span> · {job.files} files</span> : null}
            <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-line">
              <span className="block h-full bg-accent transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
            </span>
          </span>
        ) : error ? (
          <span className="text-bad">{error}</span>
        ) : url && !parsed ? (
          <span className="text-warn">Paste a link like https://github.com/owner/repo</span>
        ) : parsed ? (
          <span className="text-muted">
            Will be saved as <span className="font-mono text-text">{name}</span>
          </span>
        ) : null}
      </div>

      {!busy && (
        <div className="mt-3 px-1">
          <div className="flex items-center gap-1.5 text-xs text-muted">
            {userBusy && <Loader2 size={12} className="animate-spin" />}
            Your repositories
          </div>

          {userError && <p className="mt-1.5 text-xs text-bad">{userError}</p>}

          {!!userRepos.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {userRepos.map((r) => (
                <button
                  key={r.html_url}
                  type="button"
                  onClick={() => {
                    setUrl(r.html_url);
                    setError("");
                  }}
                  title={r.html_url}
                  className={`flex items-center gap-1.5 rounded-md border bg-panel px-2 py-0.5 font-mono text-xs hover:border-accent hover:text-text ${url === r.html_url ? "border-accent text-text" : "border-line text-muted"}`}
                >
                  {r.name}
                  {r.language && <span className="text-[10px] text-muted/70">{r.language}</span>}
                  {r.stargazers_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted/70">
                      <Star size={9} />
                      {r.stargazers_count}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </form>
  );
}