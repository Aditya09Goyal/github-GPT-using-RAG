import type { User } from "../types/api";

const KEY = "ghgpt:token";

export const getToken = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const clearToken = () => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
};

// Reads the user straight out of the token (JWT payload) — no server call needed on page load.
// The server still checks the signature on every protected request.
export function userFromToken(token: string | null): User | null {
  if (!token) return null;
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (!p.sub || (p.exp && p.exp * 1000 < Date.now())) return null;
    return { login: p.sub, name: p.name ?? p.sub, avatar_url: p.avatar ?? "" };
  } catch {
    return null;
  }
}

// After GitHub login the backend redirects to  /#token=...  (or  /#auth_error=...).
// Save the token, then wipe it from the address bar.
export function consumeLoginRedirect(): { error: string | null } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  const error = params.get("auth_error");
  if (token) {
    try {
      localStorage.setItem(KEY, token);
    } catch {
      /* ignore */
    }
  }
  if (token || error) history.replaceState(null, "", window.location.pathname + window.location.search);
  return { error };
}