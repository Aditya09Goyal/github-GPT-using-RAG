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

export interface ChatResponse {
  answer: string;
  sources: string[];
}

// ---------- frontend-only types ----------

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
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
