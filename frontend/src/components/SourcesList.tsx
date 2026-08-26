interface SourcesListProps {
  sources: string[];
}

/**
 * Renders each source file as a small tab-like chip — the signature
 * element of this UI. This is what makes an answer feel "grounded"
 * rather than just trusting the LLM: the reader can see exactly which
 * files in the repo the answer came from.
 */
export default function SourcesList({ sources }: SourcesListProps) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-line">
      {sources.map((source) => (
        <span
          key={source}
          className="flex items-center gap-1.5 bg-panel border border-line rounded px-2 py-0.5 text-xs font-mono text-teal"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-teal" />
          {source}
        </span>
      ))}
    </div>
  );
}