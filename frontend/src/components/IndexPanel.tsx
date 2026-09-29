import { useEffect, useState } from "react";
import { Github, Loader2 } from "lucide-react";
import { indexRepo, ApiError } from "../api/client";
import { collectionFromRepo, parseGithubUrl } from "../lib/repo";
import type { Repo } from "../types/api";

const EXAMPLES = [
  "https://github.com/octocat/Hello-World",
  "https://github.com/Aditya09Goyal/github-GPT-using-RAG",
  "https://github.com/pallets/click",
];

export default function IndexPanel({ onIndexed, autoFocus }: { onIndexed: (r: Repo) => void; autoFocus?: boolean }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secs, setSecs] = useState(0);

  const parsed = parseGithubUrl(url);
  const name = parsed ? collectionFromRepo(parsed.owner, parsed.repo) : "";

  useEffect(() => {
    if (!busy) return;
    setSecs(0);
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!parsed || busy) return;
    setBusy(true);
    setError("");
    const base: Repo = { name, url: `https://github.com/${parsed.owner}/${parsed.repo}`, owner: parsed.owner, repo: parsed.repo, indexedAt: Date.now() };
    try {
      const r = await indexRepo({ repo_url: base.url, collection_name: name });
      onIndexed({ ...base, files: r.files_indexed, chunks: r.chunks_created });
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

  const stage = secs < 6 ? "Downloading repository…" : secs < 25 ? "Chunking & embedding files…" : "Still working — the free server is slow on big repos…";

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
          </span>
        ) : error ? (
          <span className="text-bad">{error}</span>
        ) : url && !parsed ? (
          <span className="text-warn">Paste a link like https://github.com/owner/repo</span>
        ) : parsed ? (
          <span className="text-muted">
            Will be saved as <span className="font-mono text-text">{name}</span>
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5 text-muted">
            Try:
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setUrl(ex)} className="rounded-md border border-line bg-panel px-2 py-0.5 font-mono hover:border-accent hover:text-text">
                {ex.replace("https://github.com/", "")}
              </button>
            ))}
          </span>
        )}
      </div>
    </form>
  );
}
