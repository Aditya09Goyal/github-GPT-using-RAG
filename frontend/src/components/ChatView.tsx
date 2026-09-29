import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileCode2, Sparkles } from "lucide-react";
import Markdown from "./Markdown";
import type { ChatMessage, Repo } from "../types/api";

const STARTERS = [
  "What does this project do?",
  "How do I run it locally?",
  "Explain the folder structure",
  "Where is the main entry point?",
];

interface Props {
  repo: Repo;
  messages: ChatMessage[];
  loading: boolean;
  onSend: (q: string) => void;
  onOpenFile: (path: string) => void;
}

export default function ChatView({ repo, messages, loading, onSend, onOpenFile }: Props) {
  const [q, setQ] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, loading]);

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
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
          {messages.length === 0 && (
            <div className="animate-blurIn pt-10 text-center">
              <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Sparkles size={22} />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">
                Ask anything about <span className="text-accent">{repo.repo}</span>
              </h2>
              <p className="mt-2 text-sm text-muted">Answers come only from this repository's files — with sources you can open.</p>
              <div className="mx-auto mt-6 grid max-w-xl gap-2 sm:grid-cols-2">
                {STARTERS.map((s) => (
                  <button key={s} onClick={() => send(s)} className="rounded-xl border border-line bg-panel px-4 py-3 text-left text-sm shadow-sm transition hover:-translate-y-0.5 hover:border-accent">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end animate-fadeIn">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent-fill px-4 py-2.5 text-sm text-white shadow-sm">{m.content}</div>
              </div>
            ) : (
              <div key={m.id} className="animate-blurIn">
                {m.error ? (
                  <div className="rounded-xl border border-bad/40 bg-bad/5 px-4 py-3 text-sm text-bad">{m.content}</div>
                ) : (
                  <Markdown text={m.content} />
                )}
                {!!m.sources?.length && (
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] font-medium uppercase tracking-wider text-muted">Sources</span>
                    {m.sources.map((s) => (
                      <button key={s} onClick={() => onOpenFile(s)} title={`Open ${s}`} className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 font-mono text-[11.5px] text-muted transition hover:border-accent hover:text-accent">
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

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted animate-fadeIn">
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-dot rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              Searching the repository and thinking…
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
          className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-line bg-panel p-2 shadow-sm focus-within:border-accent"
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
          <button type="submit" disabled={!q.trim() || loading} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-fill text-white transition-opacity disabled:opacity-30" aria-label="Send">
            <ArrowUp size={18} />
          </button>
        </form>
        <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-muted/80">Enter to send · Shift + Enter for a new line</p>
      </div>
    </div>
  );
}
