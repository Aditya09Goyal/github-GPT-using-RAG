import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { highlight } from "../lib/highlight";

export default function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);
  const html = useMemo(() => highlight(code, lang), [code, lang]);

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="not-prose surface group relative my-4 overflow-hidden !rounded-xl">
      <div className="flex items-center justify-between border-b border-line/70 bg-panel-2 px-3 py-1.5 text-[11px] text-muted">
        <span className="flex items-center gap-1.5 font-mono">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-bad/50" />
            <span className="h-2 w-2 rounded-full bg-warn/50" />
            <span className="h-2 w-2 rounded-full bg-ok/50" />
          </span>
          <span className="ml-1">{lang ?? "code"}</span>
        </span>
        <button
          onClick={copy}
          className={`btn-ghost gap-1 px-1.5 py-0.5 text-[11px] ${copied ? "text-ok hover:text-ok" : ""}`}
          aria-label="Copy code"
        >
          {copied ? <Check key="ok" size={12} strokeWidth={2.6} className="animate-morph" /> : <Copy key="copy" size={12} className="animate-morph" />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="scroll-thin overflow-x-auto bg-side/40 p-3.5 text-[12.5px] leading-relaxed">
        <code className="code font-mono" dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    </div>
  );
}
