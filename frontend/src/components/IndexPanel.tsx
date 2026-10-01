import { useEffect, useState } from "react";
import { Github, Loader2, Star, User } from "lucide-react";
import { indexRepo, ApiError } from "../api/client";
import { collectionFromRepo, parseGithubUrl } from "../lib/repo";
import { load, save } from "../lib/storage";
import type { IndexJob, Repo } from "../types/api";

interface GhRepo {
  name: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  fork: boolean;
  size: number;
}

export default function IndexPanel({ onIndexed, autoFocus }: { onIndexed: (r: Repo) => void; autoFocus?: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(0);
  const [job, setJob] = useState<IndexJob | null>(null);
  const [user, setUser] = useState(() => load("ghgpt:user", ""));
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

  // public GitHub API, no login needed (60 requests / hour per visitor)
  async function loadUserRepos(name = user) {
    const u = name.trim().replace(/^@/, "");
    if (!u) return;
    setUserBusy(true);
    setUserError("");
    try {
      const res = await fetch(`https://api.github.com/users/${encodeURIComponent(u)}/repos?sort=updated&per_page=30`);
      if (res.status === 404) throw new Error(`No GitHub user "${u}"`);
      if (res.status === 403) throw new Error("GitHub rate limit hit — try again in a while");
      if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
      const list = ((await res.json()) as GhRepo[]).filter((r) => r.size > 0).slice(0, 12);
      setUserRepos(list);
      if (!list.length) setUserError(`${u} has no public repos with code`);
      save("ghgpt:user", u);
    } catch (e) {
      setUserRepos([]);
      setUserError(e instanceof Error ? e.message : "Couldn't load repos");
    } finally {
      setUserBusy(false);
    }
  }

  useEffect(() => {
    if (user) loadUserRepos(user);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      if (err instanceof ApiError && err.status === 409) {
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
          <div className="flex items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-line bg-panel px-2 py-1 focus-within:border-accent">
              <User size={13} className="shrink-0 text-muted" />
              <input
                value={user}
                onChange={(e) => {
                  setUser(e.target.value);
                  setUserError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    loadUserRepos();
                  }
                }}
                placeholder="Your GitHub username"
                aria-label="GitHub username"
                className="min-w-0 flex-1 bg-transparent py-0.5 font-mono text-xs outline-none placeholder:text-muted/70"
              />
            </div>
            <button
              type="button"
              onClick={() => loadUserRepos()}
              disabled={!user.trim() || userBusy}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text disabled:opacity-40"
            >
              {userBusy && <Loader2 size={12} className="animate-spin" />}
              Show my repos
            </button>
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