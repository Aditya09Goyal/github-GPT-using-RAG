import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import type { Repo } from "../types/api";
import { blobUrl, rawFileUrl } from "../lib/repo";
import { highlight, langFromPath } from "../lib/highlight";

const cache = new Map<string, string>();

export default function FileView({ repo, path }: { repo: Repo; path: string }) {
  const key = `${repo.name}:${path}`;
  const [text, setText] = useState<string | null>(cache.get(key) ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cache.has(key)) {
      setText(cache.get(key)!);
      return;
    }
    let alive = true;
    setText(null);
    setError("");
    fetch(rawFileUrl(repo, path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`GitHub returned ${r.status}`))))
      .then((t) => {
        cache.set(key, t);
        if (alive) setText(t);
      })
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [key, repo, path]);

  const html = useMemo(() => (text == null ? "" : highlight(text, langFromPath(path))), [text, path]);
  const lines = text == null ? 0 : text.split("\n").length;
  const parts = path.split("/");

  return (
    <div className="flex h-full min-h-0 flex-col animate-fadeIn">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2 text-xs">
        <div className="truncate font-mono text-muted">
          <span className="text-muted/70">{repo.owner}/{repo.repo}</span>
          {parts.map((p, i) => (
            <span key={i}>
              <span className="mx-1 text-muted/50">/</span>
              <span className={i === parts.length - 1 ? "text-text" : ""}>{p}</span>
            </span>
          ))}
        </div>
        <a href={blobUrl(repo, path)} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 rounded-md border border-line px-2 py-1 text-muted hover:text-text">
          <ExternalLink size={12} /> GitHub
        </a>
      </div>

      {error && <div className="p-6 text-sm text-bad">Couldn't load this file: {error}</div>}
      {!error && text == null && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading file…
        </div>
      )}
      {text != null && (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          <div className="flex min-w-max font-mono text-[12.5px] leading-[1.6]">
            <pre aria-hidden className="select-none border-r border-line bg-side px-3 py-3 text-right text-muted/60">
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </pre>
            <pre className="px-4 py-3">
              <code className="code" dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
