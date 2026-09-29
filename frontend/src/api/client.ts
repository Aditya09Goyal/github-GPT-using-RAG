import type { IndexRepoRequest, IndexRepoResponse, ChatRequest, ChatResponse } from "../types/api";

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

export const indexRepo = (body: IndexRepoRequest) =>
  request<IndexRepoResponse>("/repos", { method: "POST", body: JSON.stringify(body) });

export const askQuestion = (body: ChatRequest) =>
  request<ChatResponse>("/chat", { method: "POST", body: JSON.stringify(body) });

export const health = () => request<{ status: string }>("/health");
