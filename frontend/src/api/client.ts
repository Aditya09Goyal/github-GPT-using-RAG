import type {
  IndexRepoRequest,
  IndexRepoResponse,
  ChatRequest,
  ChatResponse,
  ApiError,
} from "../types/api";

// Vite exposes env vars prefixed with VITE_ to the browser.
// Add VITE_API_BASE_URL=http://localhost:8000 to your .env file.
const BASE_URL = import.meta.env.VITE_API_BASE_URL as string;

/**
 * Thin wrapper around fetch that:
 * - sends/receives JSON automatically
 * - throws a readable Error using the backend's own error message
 *   (our FastAPI routes return {"detail": "..."} on failure — see
 *   the 409/404/500 cases in routes_repo.py and routes_chat.py)
 */
async function request<TResponse>(
  path: string,
  body: unknown
): Promise<TResponse> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorData: ApiError = await res.json().catch(() => ({
      detail: `Request failed with status ${res.status}`,
    }));
    throw new Error(errorData.detail);
  }

  return res.json() as Promise<TResponse>;
}

/**
 * Calls POST /repos — clones, chunks, embeds, and stores a GitHub repo.
 * Throws if the collection already exists (409) or indexing fails (422/500).
 */
export function indexRepo(payload: IndexRepoRequest): Promise<IndexRepoResponse> {
  return request<IndexRepoResponse>("/repos", payload);
}

/**
 * Calls POST /chat — asks a question about an already-indexed repo.
 * Throws if the collection isn't found (404) or generation fails (500).
 */
export function askQuestion(payload: ChatRequest): Promise<ChatResponse> {
  return request<ChatResponse>("/chat", payload);
}