import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, FileCode2, Loader2, ScrollText, TriangleAlert } from "lucide-react";
import type { Citation, Repo } from "../types/api";
import { baseName, formatRange, githubAnchor, hasLines } from "../lib/citations";
import { cachedFile, fetchFile } from "../lib/files";
import { highlight, langFromPath } from "../lib/highlight";
import { blobUrl } from "../lib/repo";

const MAX_EXCERPT_LINES = 60;

/** Inline source chips:  [📄 auth.py  L12–40]  — click to open the file scrolled to those lines. */
export function SourceChips({ citations, onOpen }: { citations: Citation[]; onOpen: (c: Citation) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {citations.map((c, i) => {
        const range = formatRange(c);
        return (
          <button
            key={`${c.path}:${c.start_line}`}
            onClick={() => onOpen(c)}
            title={`Open ${c.path}${range ? ` · ${range}` : ""}`}
            style={{ animationDelay: `${i * 45}ms` }}
            className="chip animate-springIn"
          >
            <FileCode2 size={12} className="shrink-0 text-muted/80" />
            <span className="truncate">{baseName(c.path)}</span>
            {range && <span className="line-badge">{range}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** "Show context" — the exact code each citation points at, read straight from the repo. */
export function ContextDrawer({ repo, citations, onOpen }: { repo: Repo; citations: Citation[]; onOpen: (c: Citation) => void }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false); // fetch nothing until first opened; keep content for the close animation
  const anyWithoutLines = citations.some((c) => !hasLines(c));

  return (
    <div className="mt-2">
      <button
        onClick={() => {
          setMounted(true);
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        className="btn-ghost px-2 py-1 text-[12px]"
      >
        <ScrollText size={13} />
        {open ? "Hide context" : "Show context"}
        <span className="rounded-full bg-line/70 px-1.5 text-[10.5px] font-semibold tabular-nums">{citations.length}</span>
        <ChevronDown size={13} className={`transition-transform duration-500 ease-spring ${open ? "rotate-180" : ""}`} />
      </button>

      <div className="expand" data-open={open}>
        {/* inert while closed: hidden buttons shouldn't be reachable with Tab */}
        <div ref={(el) => el?.toggleAttribute("inert", !open)}>
          {mounted && (
            <div className="mt-2 space-y-2.5 pb-1">
              {anyWithoutLines && (
                <p className="flex items-center gap-1.5 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-warn">
                  <TriangleAlert size={13} className="shrink-0" />
                  Some sources have no line numbers yet — re-index this repo (⟳ in the sidebar) to get exact ranges.
                </p>
              )}
              {citations.map((c) => (
                <Excerpt key={`${c.path}:${c.start_line}`} repo={repo} c={c} onOpen={onOpen} />
              ))}
              <p className="px-1 text-[11px] text-muted/80">Lines refer to the version that was indexed; the file may have changed on GitHub since.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Excerpt({ repo, c, onOpen }: { repo: Repo; c: Citation; onOpen: (c: Citation) => void }) {
  const [text, setText] = useState<string | null>(() => cachedFile(repo, c.path));
  const [error, setError] = useState("");

  useEffect(() => {
    if (text != null) return;
    let alive = true;
    fetchFile(repo, c.path)
      .then((t) => alive && setText(t))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repo, c.path, text]);

  const excerpt = useMemo(() => {
    if (text == null) return null;
    const all = text.split("\n");
    const start = hasLines(c) ? Math.min(c.start_line, all.length) : 1;
    const end = hasLines(c) ? Math.min(c.end_line, all.length) : Math.min(all.length, 20);
    const shownEnd = Math.min(end, start + MAX_EXCERPT_LINES - 1);
    const code = all.slice(start - 1, shownEnd).join("\n");
    return { start, shownEnd, hidden: end - shownEnd, html: highlight(code, langFromPath(c.path)) };
  }, [text, c]);

  const range = formatRange(c);
  const anchor = hasLines(c) ? githubAnchor(c.start_line, c.end_line) : "";

  return (
    <div className="surface overflow-hidden animate-springIn">
      <div className="flex items-center gap-2 border-b border-line/70 bg-panel-2 px-3 py-1.5 text-[11.5px]">
        <FileCode2 size={12} className="shrink-0 text-muted" />
        <span className="min-w-0 truncate font-mono text-muted" title={c.path}>
          {c.path}
        </span>
        {range && <span className="line-badge font-mono">{range}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          <button onClick={() => onOpen(c)} className="btn-ghost px-1.5 py-0.5 text-[11px]">
            Open
          </button>
          <a href={blobUrl(repo, c.path, anchor)} target="_blank" rel="noreferrer" className="btn-ghost p-1" title="View on GitHub" aria-label="View on GitHub">
            <ExternalLink size={12} />
          </a>
        </span>
      </div>

      {error ? (
        <p className="px-3 py-2.5 text-[12px] text-bad">Couldn't load this file: {error}</p>
      ) : !excerpt ? (
        <p className="flex items-center gap-2 px-3 py-2.5 text-[12px] text-muted">
          <Loader2 size={13} className="animate-spin" /> Loading lines…
        </p>
      ) : (
        <div className="scroll-thin max-h-72 overflow-auto">
          <div className="flex min-w-max font-mono text-[12px] leading-[1.65]">
            <pre aria-hidden className="select-none border-r border-line/70 px-2.5 py-2 text-right text-muted/50">
              {Array.from({ length: excerpt.shownEnd - excerpt.start + 1 }, (_, i) => excerpt.start + i).join("\n")}
            </pre>
            <pre className="px-3 py-2">
              <code className="code" dangerouslySetInnerHTML={{ __html: excerpt.html }} />
            </pre>
          </div>
          {excerpt.hidden > 0 && (
            <button onClick={() => onOpen(c)} className="w-full border-t border-line/70 px-3 py-1.5 text-left text-[11.5px] text-muted hover:text-accent">
              … {excerpt.hidden} more lines — open the file
            </button>
          )}
        </div>
      )}
    </div>
  );
}
