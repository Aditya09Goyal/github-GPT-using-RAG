import ReactMarkdown from "react-markdown";
import CodeBlock from "./CodeBlock";

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-p:leading-relaxed prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none prose-a:text-accent">
      <ReactMarkdown
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
