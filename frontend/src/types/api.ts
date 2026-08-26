// Mirrors app/schemas/repo.py and app/schemas/chat.py on the backend.
// Keeping these in sync by hand is a real maintenance burden worth knowing
// about now — if a backend field changes, this file has to be updated too.

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

export interface ChatRequest {
  question: string;
  collection_name: string;
}

export interface ChatResponse {
  answer: string;
  sources: string[];
}

// Frontend-only type — the backend doesn't know about "chat history,"
// it only ever sees one question at a time. We build the conversation
// view entirely on the frontend by accumulating these locally.
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

// Mirrors the shape FastAPI sends back on an HTTPException — e.g. our
// 409 "already indexed" and 404 "collection not found" errors.
export interface ApiError {
  detail: string;
}