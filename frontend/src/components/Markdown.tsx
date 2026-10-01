import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeBlock from "./CodeBlock";

export default function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none text-[14.5px] dark:prose-invert prose-p:leading-7 prose-li:my-1 prose-li:leading-7 prose-headings:font-semibold prose-headings:tracking-tight prose-strong:text-text prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none prose-a:text-accent prose-a:underline-offset-4 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-accent-soft prose-hr:border-line">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const lang = /language-([\w-]+)/.exec(className ?? "")?.[1];
            const code = String(children).replace(/\n$/, "");
            if (!lang && !code.includes("\n")) {
              return <code className="rounded-md border border-line/70 bg-accent-soft/70 px-1.5 py-0.5 font-mono text-[0.84em] font-medium text-accent">{children}</code>;
            }
            return <CodeBlock code={code} lang={lang} />;
          },
          table: ({ children }) => (
            <div className="scroll-thin surface my-3 overflow-x-auto !rounded-xl">
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