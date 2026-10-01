import { useEffect, useRef, useState } from "react";
import { ArrowUp, BookOpen, Compass, FileCode2, FolderTree, Sparkles, Square, Terminal } from "lucide-react";
import Logo from "./Logo";
import Markdown from "./Markdown";
import type { ChatMessage, Repo } from "../types/api";

const STARTERS = [
  { q: "What does this project do?", Icon: BookOpen },
  { q: "How do I run it locally?", Icon: Terminal },
  { q: "Explain the folder structure", Icon: FolderTree },
  { q: "Where is the main entry point?", Icon: Compass },
];

interface Props {
  repo: Repo;
  messages: ChatMessage[];
  loading: boolean;
  onSend: (q: string) => void;
  onStop: () => void;
  onOpenFile: (path: string) => void;
}

export default function ChatView({ repo, messages, loading, onSend, onStop, onOpenFile }: Props) {
  const [q, setQ] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1];
  const streaming = !!last?.streaming;
  const waiting = loading && !streaming; // request sent, first token not here yet

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

  // Follow the answer while it streams in — unless the user scrolled up to read something.
  useEffect(() => {
    const el = scrollRef.current;
    if (!streaming || !el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) el.scrollTop = el.scrollHeight;
  }, [streaming, last?.content]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, [q]);

  function send(text = q) {
    const t = text.trim();
    if (!t || loading) return;
    onSend(t);
    setQ("");
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
          {messages.length === 0 && (
            <div className="animate-blurIn pt-10 text-center">
              <div className="mx-auto mb-5 flex h-14 w-14 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-accent-fill to-accent-2 text-white shadow-lg shadow-accent-fill/30">
                <Sparkles size={26} />
              </div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Ask anything about <span className="text-gradient">{repo.repo}</span>
              </h2>
              <p className="mt-2 text-sm text-muted">Answers come only from this repository's files — with sources you can open.</p>
              <div className="mx-auto mt-7 grid max-w-xl gap-2.5 sm:grid-cols-2">
                {STARTERS.map(({ q: s, Icon }, i) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{ animationDelay: `${120 + i * 70}ms` }}
                    className="lift group flex animate-popIn items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm shadow-sm"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6">
                      <Icon size={16} />
                    </span>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end animate-slideInRight">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-accent-fill to-accent-2 px-4 py-2.5 text-sm text-white shadow-md shadow-accent-fill/25">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={m.id} className="animate-blurIn">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-muted">
                  <Logo className={`h-5 w-5 ${m.streaming ? "animate-pulse" : ""}`} />
                  GitHub-GPT
                </div>
                {m.error ? (
                  <div className="rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-sm text-bad">{m.content}</div>
                ) : (
                  <Markdown text={m.content} />
                )}
                {m.streaming && <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-middle" aria-hidden />}
                {!!m.sources?.length && !m.streaming && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted">Sources</span>
                    {m.sources.map((s) => (
                      <button key={s} onClick={() => onOpenFile(s)} title={`Open ${s}`} className="lift flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11.5px] text-muted hover:text-accent">
                        <FileCode2 size={12} />
                        {s}
                      </button>
                    ))}
                    {m.ms != null && <span className="ml-auto font-mono text-[11px] text-muted/80">{(m.ms / 1000).toFixed(1)}s</span>}
                  </div>
                )}
              </div>
            ),
          )}

          {waiting && (
            <div className="flex items-center gap-2.5 text-sm animate-fadeIn">
              <Logo className="h-5 w-5 animate-pulse" />
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-dot rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              <span className="text-shimmer font-medium">Searching the repository and thinking…</span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="border-t border-line bg-bg px-4 pb-4 pt-3 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="glow-ring mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-sm"
        >
          <textarea
            ref={boxRef}
            rows={1}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={`Ask about ${repo.owner}/${repo.repo}…`}
            aria-label="Your question"
            className="scroll-thin max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted/70"
          />
          {loading ? (
            <button type="button" onClick={onStop} className="btn-primary h-9 w-9 shrink-0 animate-glow" aria-label="Stop generating" title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!q.trim()} className="btn-primary group/send h-9 w-9 shrink-0" aria-label="Send">
              <ArrowUp size={18} className="transition-transform duration-200 group-hover/send:-translate-y-0.5" />
            </button>
          )}
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted/80">Enter to send · Shift + Enter for a new line</p>
      </div>
    </div>
  );
}
