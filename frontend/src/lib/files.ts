import type { Repo } from "../types/api";
import { rawFileUrl } from "./repo";

// Raw file texts from GitHub, shared by the file viewer and the "Show context" drawer.
// In-flight requests are shared too, so opening a file while its context loads costs one fetch.
const texts = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

const keyOf = (repo: Repo, path: string) => `${repo.name}:${path}`;

export const cachedFile = (repo: Repo, path: string): string | null => texts.get(keyOf(repo, path)) ?? null;

export function fetchFile(repo: Repo, path: string): Promise<string> {
  const key = keyOf(repo, path);
  const hit = texts.get(key);
  if (hit != null) return Promise.resolve(hit);
  let p = pending.get(key);
  if (!p) {
    p = fetch(rawFileUrl(repo, path))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`GitHub returned ${r.status}`))))
      .then((t) => {
        texts.set(key, t);
        return t;
      })
      .finally(() => pending.delete(key));
    pending.set(key, p);
  }
  return p;
}
