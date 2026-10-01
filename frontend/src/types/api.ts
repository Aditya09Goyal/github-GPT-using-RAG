// Mirrors backend-v2/app/schemas — keep in sync if a backend field changes.

export interface IndexRepoRequest {
  repo_url: string;
  collection_name: string;
  force?: boolean; // re-index an existing repo
}

export interface IndexJob {
  collection_name: string;
  repo_url: string;
  status: "queued" | "running" | "done" | "failed";
  stage: string;
  files: number;
  chunks: number;
  embedded: number;
  error: string | null;
  started_at: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  question: string;
  collection_name: string;
  history?: ChatTurn[]; // earlier messages, oldest first — lets follow-up questions work
}

/** One file region an answer was grounded in. Lines are 1-based and inclusive;
 *  null for repos indexed before line numbers were recorded (re-index to get them). */
export interface Citation {
  path: string;
  start_line: number | null;
  end_line: number | null;
}

export interface ChatResponse {
  answer: string;
  sources: string[];
  citations?: Citation[];
}

export interface User {
  login: string;
  name: string;
  avatar_url: string;
}

// ---------- frontend-only types ----------

/** Lines to scroll to and highlight in the file viewer. `nonce` changes on every click,
 *  so clicking the same citation again scrolls back to it. */
export interface LineFocus {
  start: number;
  end: number;
  nonce: number;
}

/** Live state of a repo being (re-)indexed from the sidebar. */
export interface ReindexState {
  stage: string;
  pct: number; // 0-100, embedding progress
  status: "running" | "done" | "failed";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
  citations?: Citation[];
  feedback?: "up" | "down"; // the user's thumbs up / down (kept in this browser)
  error?: boolean;
  streaming?: boolean; // answer is still arriving
  ms?: number; // response time
}

export interface Repo {
  name: string; // collection name
  url: string;
  owner: string;
  repo: string;
  files?: number;
  chunks?: number;
  indexedAt: number;
}
