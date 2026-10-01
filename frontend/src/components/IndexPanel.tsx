import { useEffect, useState } from "react";
import { ArrowRight, Check, Github, Loader2, Star } from "lucide-react";
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

// GitHub's own language colours for the small dot on each repo chip
const LANG_COLORS: Record<string, string> = {
  JavaScript: "#f1e05a",
  TypeScript: "#3178c6",
  Python: "#3572A5",
  Java: "#b07219",
  "C++": "#f34b7d",
  C: "#555555",
  "C#": "#178600",
  Go: "#00ADD8",
  Rust: "#dea584",
  HTML: "#e34c26",
  CSS: "#563d7c",
  "Jupyter Notebook": "#DA5B0B",
  Kotlin: "#A97BFF",
  PHP: "#4F5D95",
  Ruby: "#701516",
  Swift: "#F05138",
  Shell: "#89e051",
};

const STEPS = ["Download", "Chunk", "Embed", "Done"];

// which step the backend's stage text belongs to
function stepOf(job: IndexJob | null): number {
  if (!job) return 0;
  if (job.status === "done") return 3;
  if (job.stage.startsWith("Embedding")) return 2;
  if (/Scanning|Splitting|Reading repo info/.test(job.stage)) return 1;
  return 0;
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

  const step = stepOf(job);

  return (
    <form onSubmit={submit} className="w-full">
      <div
        className={`glow-ring flex items-center gap-2 rounded-2xl border bg-panel/90 px-3 py-2 shadow-sm backdrop-blur ${error ? "border-bad/60" : "border-line"}`}
      >
        <Github size={18} className={`shrink-0 transition-colors ${parsed ? "text-accent" : "text-muted"}`} />
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
        <button type="submit" disabled={!parsed || busy} className="btn-primary group/btn shrink-0 px-4 py-2 text-sm">
          {busy ? <Loader2 size={14} className="animate-spin" /> : null}
          {busy ? "Indexing" : "Index"}
          {!busy && <ArrowRight size={14} className="transition-transform group-hover/btn:translate-x-0.5" />}
        </button>
      </div>

      <div className="mt-2 min-h-[20px] px-1 text-xs">
        {busy ? (
          <div className="animate-fadeIn">
            <div className="flex items-center justify-between gap-2">
              {STEPS.map((label, i) => (
                <div key={label} className="flex flex-1 items-center gap-1.5">
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all duration-300 ${
                      i < step
                        ? "border-transparent bg-gradient-to-br from-accent-fill to-accent-2 text-white"
                        : i === step
                          ? "border-accent text-accent ring-4 ring-accent/15"
                          : "border-line text-muted"
                    }`}
                  >
                    {i < step ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  <span className={`hidden text-[11px] sm:inline ${i <= step ? "text-text" : "text-muted"}`}>{label}</span>
                  {i < STEPS.length - 1 && (
                    <span className="h-px flex-1 overflow-hidden rounded bg-line">
                      <span className={`block h-full bg-accent transition-all duration-500 ${i < step ? "w-full" : "w-0"}`} />
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex items-center justify-between text-muted">
              <span>
                {stage}
                {job?.files ? <span> · {job.files} files</span> : null}
              </span>
              <span className="font-mono">{secs}s</span>
            </div>
            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-line">
              <span className="bar-shimmer block h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
            </span>
          </div>
        ) : error ? (
          <span className="text-bad animate-fadeIn">{error}</span>
        ) : url && !parsed ? (
          <span className="text-warn">Paste a link like https://github.com/owner/repo</span>
        ) : parsed ? (
          <span className="text-muted animate-fadeIn">
            Will be saved as <span className="font-mono text-text">{name}</span>
          </span>
        ) : null}
      </div>

      {!busy && (
        <div className="mt-4 px-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
            {userBusy && <Loader2 size={12} className="animate-spin" />}
            Your repositories
          </div>

          {userError && <p className="mt-1.5 text-xs text-bad">{userError}</p>}

          {!!userRepos.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {userRepos.map((r, i) => (
                <button
                  key={r.html_url}
                  type="button"
                  onClick={() => {
                    setUrl(r.html_url);
                    setError("");
                  }}
                  title={r.language ? `${r.html_url} · ${r.language}` : r.html_url}
                  style={{ animationDelay: `${i * 35}ms` }}
                  className={`lift flex animate-popIn items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs ${
                    url === r.html_url ? "border-accent bg-accent-soft text-text" : "border-line bg-panel/80 text-muted hover:text-text"
                  }`}
                >
                  {r.language && (
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: LANG_COLORS[r.language] ?? "rgb(var(--muted))" }} />
                  )}
                  {r.name}
                  {r.stargazers_count > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted/80">
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
