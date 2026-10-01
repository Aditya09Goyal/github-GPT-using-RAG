import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Crosshair, ExternalLink, Link2, Loader2, TriangleAlert } from "lucide-react";
import type { LineFocus, Repo } from "../types/api";
import { blobUrl } from "../lib/repo";
import { cachedFile, fetchFile } from "../lib/files";
import { githubAnchor } from "../lib/citations";
import { highlight, langFromPath } from "../lib/highlight";

// Fixed metrics so the highlight band lines up with the text exactly.
const LINE_PX = 20;
const PAD_PX = 12; // py-3

export default function FileView({ repo, path, focus }: { repo: Repo; path: string; focus?: LineFocus | null }) {
  const [text, setText] = useState<string | null>(() => cachedFile(repo, path));
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const bandRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hit = cachedFile(repo, path);
    if (hit != null) {
      setText(hit);
      return;
    }
    let alive = true;
    setText(null);
    setError("");
    fetchFile(repo, path)
      .then((t) => alive && setText(t))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [repo, path]);

  const html = useMemo(() => (text == null ? "" : highlight(text, langFromPath(path))), [text, path]);
  const lines = text == null ? 0 : text.split("\n").length;
  const parts = path.split("/");

  // clamp to the file as it is on GitHub now (it may have changed since indexing)
  const range = focus && lines ? { start: Math.min(focus.start, lines), end: Math.min(focus.end, lines) } : null;
  const outOfRange = !!(focus && lines && focus.start > lines);
  const anchor = focus ? githubAnchor(focus.start, focus.end) : "";

  const jump = (smooth = true) => bandRef.current?.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });

  // scroll to the cited lines when the file loads, and again on every click of a citation (nonce)
  useEffect(() => {
    if (!range || outOfRange) return;
    const id = requestAnimationFrame(() => jump(true));
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.nonce, focus?.start, focus?.end, text != null]);

  function copyLink() {
    navigator.clipboard?.writeText(blobUrl(repo, path, anchor)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col animate-fadeIn">
      <div className="flex items-center justify-between gap-3 border-b border-line/80 bg-side/60 px-4 py-2 text-xs backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <div className="truncate font-mono text-muted">
            <span className="text-muted/60">
              {repo.owner}/{repo.repo}
            </span>
            {parts.map((p, i) => (
              <span key={i}>
                <span className="mx-1 text-muted/40">/</span>
                <span className={i === parts.length - 1 ? "font-medium text-text" : ""}>{p}</span>
              </span>
            ))}
          </div>
          {focus && (
            <span className="line-badge shrink-0 font-mono animate-springIn">
              {focus.start === focus.end ? `L${focus.start}` : `L${focus.start}–${focus.end}`}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {focus && !outOfRange && (
            <button onClick={() => jump()} className="btn-ghost h-7 px-2" title="Scroll to the cited lines">
              <Crosshair size={13} /> <span className="hidden sm:inline">Jump to lines</span>
            </button>
          )}
          <button onClick={copyLink} className={`btn-ghost h-7 px-2 ${copied ? "text-ok hover:text-ok" : ""}`} title="Copy a GitHub link to these lines">
            {copied ? <Check size={13} className="animate-morph" /> : <Link2 size={13} className="animate-morph" />}
            <span className="hidden sm:inline">{copied ? "Copied!" : "Copy link"}</span>
          </button>
          <a href={blobUrl(repo, path, anchor)} target="_blank" rel="noreferrer" className="btn-ghost h-7 border border-line/80 px-2">
            <ExternalLink size={12} /> GitHub
          </a>
        </div>
      </div>

      {outOfRange && (
        <p className="flex items-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 text-xs text-warn">
          <TriangleAlert size={13} /> Lines {focus!.start}–{focus!.end} aren't in the current file — it changed on GitHub since this repo was indexed.
        </p>
      )}
      {error && <div className="p-6 text-sm text-bad">😕 Couldn't load this file: {error}</div>}
      {!error && text == null && (
        <div className="flex items-center gap-2 p-6 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading file…
        </div>
      )}
      {text != null && (
        <div className="scroll-thin min-h-0 flex-1 overflow-auto">
          <div className="relative flex min-w-max font-mono text-[12.5px]" style={{ lineHeight: `${LINE_PX}px` }}>
            {range && !outOfRange && (
              <div
                key={focus!.nonce}
                ref={bandRef}
                aria-hidden
                className="line-band pointer-events-none absolute inset-x-0"
                style={{ top: PAD_PX + (range.start - 1) * LINE_PX, height: (range.end - range.start + 1) * LINE_PX }}
              />
            )}
            <pre aria-hidden className="relative select-none border-r border-line/70 bg-side/50 px-3 text-right text-muted/50" style={{ paddingBlock: PAD_PX }}>
              {Array.from({ length: lines }, (_, i) => i + 1).join("\n")}
            </pre>
            <pre className="relative px-4" style={{ paddingBlock: PAD_PX }}>
              <code className="code" dangerouslySetInnerHTML={{ __html: html }} />
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
