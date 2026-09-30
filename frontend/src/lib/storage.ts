export function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked — app still works, just won't remember */
  }
}

/** Per-user key, so two people signing in on the same browser don't see each other's chats. */
export const userKey = (userId: string, name: string) => `ghgpt:u${userId}:${name}`;

const PER_USER = ["repos", "chats", "active"];

/**
 * Before sign-in existed, repos/chats were saved under shared keys.
 * Hand them to the first user who signs in on this browser, then remove them.
 */
export function migrateLegacyStorage(userId: string) {
  try {
    for (const name of PER_USER) {
      const old = localStorage.getItem(`ghgpt:${name}`);
      if (old == null) continue;
      if (localStorage.getItem(userKey(userId, name)) == null) localStorage.setItem(userKey(userId, name), old);
      localStorage.removeItem(`ghgpt:${name}`);
    }
  } catch {
    /* storage blocked — nothing to migrate */
  }
}
