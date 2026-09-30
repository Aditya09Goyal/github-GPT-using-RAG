import type { IndexRepoRequest, IndexRepoResponse, ChatRequest, ChatResponse } from "../types/api";

import { clearToken, getToken } from "../lib/auth";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

/** Full-page navigation target for "Sign in with GitHub" (the backend redirects on to GitHub). */
export const loginUrl = () => `${BASE_URL}/auth/github/login?redirect_to=${encodeURIComponent(window.location.origin)}`;

// Called when the server says the session is missing/expired, so the app can show the sign-in screen.
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function failure(res: Response): Promise<ApiError> {
  if (res.status === 401) {
    clearToken();
    onUnauthorized();
  }
  const data = await res.json().catch(() => null);
  const detail = typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`;
  return new ApiError(detail, res.status);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...authHeaders(), ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Can't reach the server. It may be waking up — try again in a few seconds.", 0);
  }
  if (!res.ok) throw await failure(res);
  return res.json() as Promise<T>;
}

export const indexRepo = (body: IndexRepoRequest) =>
  request<IndexRepoResponse>("/repos", { method: "POST", body: JSON.stringify(body) });

export const askQuestion = (body: ChatRequest) =>
  request<ChatResponse>("/chat", { method: "POST", body: JSON.stringify(body) });

export const health = () => request<{ status: string }>("/health");

export interface StreamHandlers {
  onSources: (sources: string[]) => void;
  onToken: (text: string) => void;
}

/**
 * POST /chat/stream — reads the Server-Sent Events response as it arrives.
 * (EventSource only supports GET, so the stream is parsed by hand from fetch.)
 * Resolves when the server sends "done"; rejects with ApiError on an "error" event.
 */
export async function streamQuestion(body: ChatRequest, handlers: StreamHandlers, signal?: AbortSignal): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("Can't reach the server. It may be waking up — try again in a few seconds.", 0);
  }
  if (!res.ok || !res.body) throw await failure(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value.replace(/\r\n/g, "\n");

    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      const data = dataLines.length ? JSON.parse(dataLines.join("\n")) : {};

      if (event === "sources") handlers.onSources(data.sources ?? []);
      else if (event === "token") handlers.onToken(data.content ?? "");
      else if (event === "error") throw new ApiError(data.detail ?? "Something went wrong.", 500);
      else if (event === "done") return;
    }
  }
  throw new ApiError("The connection closed before the answer finished.", 0);
}
