import { useEffect, useRef, useState } from "react";
import { Check, Copy, ThumbsDown, ThumbsUp } from "lucide-react";
import type { ChatMessage } from "../types/api";

interface Props {
  message: ChatMessage;
  onFeedback: (value: "up" | "down" | undefined) => void;
}

/** Copy + thumbs up/down under an answer. Feedback is kept with the chat in this browser. */
export default function MessageActions({ message, onFeedback }: Props) {
  const [copied, setCopied] = useState(false);
  const [thanks, setThanks] = useState<"up" | "down" | null>(null);
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const later = (fn: () => void, ms: number) => timers.current.push(window.setTimeout(fn, ms));

  function copy() {
    navigator.clipboard?.writeText(message.content).then(() => {
      setCopied(true);
      later(() => setCopied(false), 1600);
    });
  }

  function vote(v: "up" | "down") {
    const next = message.feedback === v ? undefined : v; // clicking again clears it
    onFeedback(next);
    setThanks(next ?? null);
    if (next) later(() => setThanks(null), 2200);
  }

  return (
    <div className="flex items-center gap-0.5 text-muted">
      <button onClick={copy} className={`btn-ghost h-7 gap-1 px-2 text-[11.5px] ${copied ? "text-ok hover:text-ok" : ""}`} aria-label="Copy answer" title="Copy answer">
        {copied ? <Check key="ok" size={13} strokeWidth={2.6} className="animate-morph" /> : <Copy key="copy" size={13} className="animate-morph" />}
        <span className="hidden sm:inline">{copied ? "Copied!" : "Copy"}</span>
      </button>

      <span className="mx-1 h-4 w-px bg-line" aria-hidden />

      {(["up", "down"] as const).map((v) => {
        const on = message.feedback === v;
        const Icon = v === "up" ? ThumbsUp : ThumbsDown;
        const tone = v === "up" ? "text-ok hover:text-ok" : "text-bad hover:text-bad"; // literal names so Tailwind generates them
        return (
          <button
            key={v}
            onClick={() => vote(v)}
            aria-pressed={on}
            aria-label={v === "up" ? "Good answer" : "Bad answer"}
            title={v === "up" ? "Good answer" : "Bad answer"}
            className={`btn-ghost relative h-7 w-7 ${on ? tone : ""}`}
          >
            {on && <span key={`burst-${v}`} className="absolute inset-1 animate-burst rounded-full border-2 border-current" aria-hidden />}
            <Icon key={`${v}-${on}`} size={13} className={on ? "animate-hop" : ""} fill={on ? "currentColor" : "none"} fillOpacity={on ? 0.25 : 0} />
          </button>
        );
      })}

      <span aria-live="polite" className="ml-1.5 text-[11.5px]">
        {thanks && (
          <span key={thanks} className="inline-block animate-springIn">
            {thanks === "up" ? "Thanks! 🙌" : "Noted — we'll do better 🛠️"}
          </span>
        )}
      </span>

      {message.ms != null && <span className="ml-auto font-mono text-[11px] tabular-nums text-muted/70">⚡ {(message.ms / 1000).toFixed(1)}s</span>}
    </div>
  );
}
