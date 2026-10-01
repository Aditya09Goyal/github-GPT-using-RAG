import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "./CodeBlock";

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-accent-soft">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
            const code = String(children).replace(/\n$/, "");
            if (!lang && !code.includes("\n")) {
              return <code className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[0.85em] text-accent">{children}</code>;
            }
            return <CodeBlock code={code} lang={lang} />;
          },
          table: ({ children }) => (
            <div className="scroll-thin my-3 overflow-x-auto rounded-lg border border-line">
              <table className="my-0 w-full">{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}