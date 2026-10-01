import type { IndexRepoRequest, IndexJob, ChatRequest, ChatResponse } from "../types/api";
const BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

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
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError("Can't reach the server. It may be waking up — try again in a few seconds.", 0);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const detail = typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status);
  }
  return res.json() as Promise<T>;
}

export const startIndex = (body: IndexRepoRequest) =>
  request<IndexJob>("/repos", { method: "POST", body: JSON.stringify(body) });

export const indexStatus = (name: string) => request<IndexJob>(`/repos/${encodeURIComponent(name)}/status`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Starts indexing and polls until it finishes. Polling every 2s also keeps the
 * free Render server awake while a big repo is being embedded.
 */
export async function indexRepo(body: IndexRepoRequest, onProgress: (job: IndexJob) => void): Promise<IndexJob> {
  let job = await startIndex(body);
  let misses = 0;
  for (;;) {
    onProgress(job);
    if (job.status === "done") return job;
    if (job.status === "failed") throw new ApiError(job.error ?? "Indexing failed.", 500);
    await sleep(2000);
    try {
      job = await indexStatus(body.collection_name);
      misses = 0;
    } catch (e) {
      // a 404 means the server lost the job (restarted); network blips are retried a few times
      if (e instanceof ApiError && e.status === 404) throw e;
      if (++misses > 15) throw e;
    }
  }
}

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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError("Can't reach the server. It may be waking up — try again in a few seconds.", 0);
  }
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => null);
    const detail = typeof data?.detail === "string" ? data.detail : `Request failed (${res.status})`;
    throw new ApiError(detail, res.status);
  }

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
