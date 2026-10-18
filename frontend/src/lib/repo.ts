import type { Repo } from "../types/api";

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const m = url.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[#?].*)?$/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Collection names: 3-63 chars, letters/digits/-/_ , start & end with a letter/digit
export function collectionFromRepo(owner: string, repo: string): string {
  const s = `${owner}-${repo}`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "");
  return (s.length < 3 ? `${s}-repo` : s).slice(0, 63).replace(/[-_]+$/, "");
}

// The commit that was indexed, so line numbers always match the code the answer was based on.
// Repos indexed before this existed have no sha → fall back to the latest code (HEAD).
const versionOf = (r: Repo) => r.sha ?? "HEAD";

export const rawFileUrl = (r: Repo, path: string) =>
  `https://raw.githubusercontent.com/${r.owner}/${r.repo}/${versionOf(r)}/${path.split("/").map(encodeURIComponent).join("/")}`;

export const blobUrl = (r: Repo, path: string, anchor = "") => `https://github.com/${r.owner}/${r.repo}/blob/${versionOf(r)}/${path}${anchor}`;

export const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);