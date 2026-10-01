import type { ChatMessage, Citation } from "../types/api";

export const hasLines = (c: Citation): c is Citation & { start_line: number; end_line: number } =>
  c.start_line != null && c.end_line != null;

/** "L12–40", "L7" for one line, "" when the citation has no line numbers. */
export function formatRange(c: Citation): string {
  if (!hasLines(c)) return "";
  return c.start_line === c.end_line ? `L${c.start_line}` : `L${c.start_line}–${c.end_line}`;
}

/** GitHub's own line anchor: #L12-L40 (or #L7). */
export function githubAnchor(start: number, end: number): string {
  return start === end ? `#L${start}` : `#L${start}-L${end}`;
}

/** Citations for a message — older messages / backends only have file paths. */
export function citationsOf(m: ChatMessage): Citation[] {
  if (m.citations?.length) return m.citations;
  return (m.sources ?? []).map((path) => ({ path, start_line: null, end_line: null }));
}

export const baseName = (path: string) => path.split("/").pop() ?? path;
