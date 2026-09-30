const TOKEN_KEY = "ghgpt:token";

export interface User {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
  exp: number; // seconds since epoch
}

/** Reads the profile out of our JWT (no verification needed here — the server checks it on every request). */
export function userFromToken(token: string): User | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = decodeURIComponent(
      atob(b64)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const p = JSON.parse(json);
    if (!p.sub || !p.login || typeof p.exp !== "number" || p.exp * 1000 <= Date.now()) return null;
    return { id: String(p.sub), login: p.login, name: p.name ?? null, avatar_url: p.avatar_url ?? null, exp: p.exp };
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  try {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && userFromToken(t) ? t : null;
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* blocked storage — the session just won't survive a reload */
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * After GitHub sign-in the backend redirects to /#token=... (or /#auth_error=...).
 * Picks those up, stores the token, and cleans the URL.
 */
export function consumeAuthRedirect(): { error: string | null } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  const error = params.get("auth_error");
  if (!token && !error) return { error: null };
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (token && userFromToken(token)) {
    setToken(token);
    return { error: null };
  }
  return { error: error ?? "Sign-in failed. Please try again." };
}
