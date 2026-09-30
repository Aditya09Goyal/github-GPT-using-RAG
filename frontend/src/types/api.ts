// Mirrors backend-v2/app/schemas — keep in sync if a backend field changes.

export interface IndexRepoRequest {
  repo_url: string;
  collection_name: string;
}

export interface IndexRepoResponse {
  collection_name: string;
  files_indexed: number;
  chunks_created: number;
  message: string;
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
