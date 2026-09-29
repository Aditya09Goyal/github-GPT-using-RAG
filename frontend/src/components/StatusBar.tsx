import type { Repo } from "../types/api";

export type ServerState = "checking" | "waking" | "online" | "offline";

export default function StatusBar({ server, repo }: { server: ServerState; repo: Repo | null }) {
  const dot = { checking: "bg-muted", waking: "bg-warn animate-pulse", online: "bg-ok", offline: "bg-bad" }[server];
  const label = {
    checking: "Connecting…",
    waking: "Waking server (free tier, ~1 min)…",
    online: "Server online",
    offline: "Server unreachable",
  }[server];

  return (
    <footer className="flex items-center gap-4 border-t border-line bg-side px-3 py-1 font-mono text-[11px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </span>
      {repo && (
        <span className="hidden truncate sm:inline">
          {repo.owner}/{repo.repo}
          {repo.files != null && ` · ${repo.files} files · ${repo.chunks} chunks`}
        </span>
      )}
      <span className="ml-auto hidden md:inline">RAG · pgvector · Groq gpt-oss-120b</span>
    </footer>
  );
}
