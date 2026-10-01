import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Compass, FolderTree, Sparkles, Square, Terminal } from "lucide-react";
import Logo from "./Logo";
import Markdown from "./Markdown";
import MessageActions from "./MessageActions";
import { ContextDrawer, SourceChips } from "./Citations";
import { citationsOf } from "../lib/citations";
import type { ChatMessage, Citation, Repo } from "../types/api";

const STARTERS = [
  { q: "What does this project do?", Icon: BookOpen, hint: "The big picture" },
  { q: "How do I run it locally?", Icon: Terminal, hint: "Setup & commands" },
  { q: "Explain the folder structure", Icon: FolderTree, hint: "Where things live" },
  { q: "Where is the main entry point?", Icon: Compass, hint: "Start reading here" },
];

// what the backend is doing while we wait for the first token
const THINKING = ["🔎 Searching the code — keywords + meaning…", "📚 Reading the most relevant chunks…", "🧠 Thinking it through…"];

interface Props {
  repo: Repo;
  messages: ChatMessage[];
  loading: boolean;
  onSend: (q: string) => void;
  onStop: () => void;
  onOpenCitation: (c: Citation) => void;
  onFeedback: (messageId: string, value: "up" | "down" | undefined) => void;
}

export default function ChatView({ repo, messages, loading, onSend, onStop, onOpenCitation, onFeedback }: Props) {
  const [q, setQ] = useState("");
  const [atBottom, setAtBottom] = useState(true);
  const [phase, setPhase] = useState(0);
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
    if (!waiting) return setPhase(0);
    const t = setInterval(() => setPhase((p) => Math.min(p + 1, THINKING.length - 1)), 1600);
    return () => clearInterval(t);
  }, [waiting]);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [q]);

  function send(text = q) {
    const t = text.trim();
    if (!t || loading) return;
    onSend(t);
    setQ("");
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
        }}
        className="scroll-thin min-h-0 flex-1 overflow-y-auto"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-4 pb-40 pt-8 sm:px-6">
          {messages.length === 0 && (
            <div className="animate-blurIn pt-12 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 animate-float items-center justify-center rounded-3xl bg-gradient-to-br from-accent-fill to-accent-2 text-white shadow-2xl shadow-accent-fill/30">
                <Sparkles size={28} />
              </div>
              <h2 className="text-2xl font-bold tracking-tight sm:text-[32px] sm:leading-tight">
                👋 Ask anything about <span className="text-gradient">{repo.repo}</span>
              </h2>
              <p className="mx-auto mt-3 max-w-md text-[14.5px] leading-relaxed text-muted">
                Answers come only from this repository's code, with exact file &amp; line sources you can open.
              </p>
              <div className="mx-auto mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
                {STARTERS.map(({ q: s, Icon, hint }, i) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    style={{ animationDelay: `${120 + i * 70}ms` }}
                    className="surface lift group flex animate-springIn items-center gap-3 px-4 py-3.5 text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition-transform duration-500 ease-spring group-hover:-rotate-6 group-hover:scale-110">
                      <Icon size={17} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{s}</span>
                      <span className="block text-xs text-muted">{hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) =>
            m.role === "user" ? (
              <div key={m.id} className="flex justify-end animate-slideInRight">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-gradient-to-br from-accent-fill to-accent-2 px-4 py-2.5 text-[14.5px] leading-relaxed text-white shadow-lg shadow-accent-fill/20">
                  {m.content}
                </div>
              </div>
            ) : (
              <AssistantMessage key={m.id} repo={repo} m={m} onOpenCitation={onOpenCitation} onFeedback={(v) => onFeedback(m.id, v)} />
            ),
          )}

          {waiting && (
            <div className="flex items-center gap-3 text-sm animate-fadeIn">
              <Logo className="h-6 w-6 animate-pulse" />
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="h-1.5 w-1.5 animate-dot rounded-full bg-accent" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </span>
              <span key={phase} className="text-shimmer animate-blurIn font-medium">
                {THINKING[phase]}
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* floating composer: content scrolls under a soft fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-bg via-bg/95 to-transparent px-4 pb-4 pt-10 sm:px-6">
        <button
          onClick={() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })}
          className={`surface absolute left-1/2 top-0 flex h-8 -translate-x-1/2 items-center gap-1 rounded-full px-3 text-xs text-muted transition-all duration-500 ease-spring hover:text-text ${
            atBottom || messages.length === 0 ? "pointer-events-none translate-y-3 scale-90 opacity-0" : "pointer-events-auto opacity-100"
          }`}
          tabIndex={atBottom ? -1 : 0}
          aria-label="Scroll to latest message"
        >
          <ArrowDown size={13} /> Latest
        </button>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
          className="surface glow-ring pointer-events-auto mx-auto flex max-w-3xl items-end gap-2 p-2"
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
            className="scroll-thin max-h-44 min-h-[40px] flex-1 resize-none bg-transparent px-2.5 py-2.5 text-[14.5px] outline-none placeholder:text-muted/60"
          />
          {loading ? (
            <button type="button" onClick={onStop} className="btn-primary h-10 w-10 shrink-0 animate-glow" aria-label="Stop generating" title="Stop">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" disabled={!q.trim()} className="btn-primary group/send h-10 w-10 shrink-0" aria-label="Send">
              <ArrowUp size={18} className="transition-transform duration-300 ease-spring group-hover/send:-translate-y-0.5" />
            </button>
          )}
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted/70">
          <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift + Enter</kbd> for a new line
        </p>
      </div>
    </div>
  );
}

function AssistantMessage({
  repo,
  m,
  onOpenCitation,
  onFeedback,
}: {
  repo: Repo;
  m: ChatMessage;
  onOpenCitation: (c: Citation) => void;
  onFeedback: (v: "up" | "down" | undefined) => void;
}) {
  const citations = citationsOf(m);
  return (
    <div className="animate-blurIn">
      <div className="mb-2.5 flex items-center gap-2 text-xs font-semibold text-muted">
        <Logo className={`h-6 w-6 ${m.streaming ? "animate-pulse" : ""}`} />
        <span className="text-text/90">GitHub-GPT</span>
        {m.streaming && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10.5px] font-medium text-accent animate-fadeIn">✍️ writing…</span>}
      </div>
      <div className="pl-8">
        {m.error ? (
          <div className="rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">⚠️ {m.content}</div>
        ) : (
          <Markdown text={m.content} />
        )}
        {m.streaming && <span className="mt-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-middle" aria-hidden />}

        {!m.streaming && !m.error && (
          <div className="mt-4 space-y-1">
            {citations.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted/80">Sources</span>
                <SourceChips citations={citations} onOpen={onOpenCitation} />
              </div>
            )}
            {citations.length > 0 && <ContextDrawer repo={repo} citations={citations} onOpen={onOpenCitation} />}
            <div className="pt-1">
              <MessageActions message={m} onFeedback={onFeedback} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
