import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import ChatView from "./components/ChatView";
import FileView from "./components/FileView";
import IndexPanel from "./components/IndexPanel";
import StatusBar, { type ServerState } from "./components/StatusBar";
import Logo from "./components/Logo";
import { ApiError, health, listRepos, loginUrl, removeRepo as removeRepoApi, streamQuestion } from "./api/client";
import { clearToken, consumeLoginRedirect, getToken, userFromToken } from "./lib/auth";
import { Github } from "lucide-react";
import { load, save } from "./lib/storage";
import { parseGithubUrl, uid } from "./lib/repo";
import type { ChatMessage, ChatTurn, Repo, User } from "./types/api";

// runs once, before the first render: picks up  /#token=...  after GitHub login
const loginRedirect = consumeLoginRedirect();

// Who is signed in never changes without a full page load (GitHub login and logout both reload),
// so every per-user storage key can be fixed once here.
const me0 = userFromToken(getToken());
const key = (name: string) => `ghgpt:${name}:${me0?.login ?? "guest"}`;

// How many earlier messages are sent with each question (the backend trims further).
const HISTORY_MESSAGES = 10;

export default function App() {
  const [user] = useState<User | null>(me0);
  const [authError] = useState<string | null>(loginRedirect.error);
  const [repos, setRepos] = useState<Repo[]>(() => (me0 ? load(key("repos"), []) : []));
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>(() =>
    // an answer interrupted by a page reload is never going to finish
    Object.fromEntries(
      Object.entries(load<Record<string, ChatMessage[]>>(key("chats"), {})).map(([k, v]) => [k, v.map(({ streaming: _s, ...m }) => m)]),
    ),
  );
  const [active, setActive] = useState<string | null>(() => load<string | null>(key("active"), null));
  const [showNew, setShowNew] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("chat");
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [server, setServer] = useState<ServerState>("checking");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const abortRef = useRef<AbortController | null>(null);

  const repo = repos.find((r) => r.name === active) ?? null;
  const messages = useMemo(() => (active ? chats[active] ?? [] : []), [chats, active]);
  const files = useMemo(() => [...new Set(messages.flatMap((m) => m.sources ?? []))], [messages]);

  // chats + open repo are remembered per user in this browser
  useEffect(() => {
    if (user) save(key("repos"), repos);
  }, [repos, user]);
  useEffect(() => {
    if (user) save(key("active"), active);
  }, [active, user]);
  useEffect(() => {
    if (!user) return;
    const trimmed = Object.fromEntries(Object.entries(chats).map(([k, v]) => [k, v.slice(-60)]));
    save(key("chats"), trimmed);
  }, [chats, user]);

  // the repo list itself comes from the server, so it follows the user to any device
  useEffect(() => {
    if (!user) return;
    listRepos()
      .then((list) =>
        setRepos(
          list.flatMap((r) => {
            const p = parseGithubUrl(r.url);
            if (!p) return [];
            const at = r.indexed_at ? Date.parse(r.indexed_at) : Date.now();
            return [{ name: r.name, url: r.url, owner: p.owner, repo: p.repo, files: r.files || undefined, chunks: r.chunks || undefined, indexedAt: at }];
          }),
        ),
      )
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) logout("Your login expired — sign in again.");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Wake the (free-tier) backend as soon as the page opens
  useEffect(() => {
    let alive = true;
    const slow = setTimeout(() => alive && setServer((s) => (s === "checking" ? "waking" : s)), 2500);
    const ping = (tries: number) =>
      health()
        .then(() => alive && setServer("online"))
        .catch(() => {
          if (!alive) return;
          if (tries > 0) setTimeout(() => ping(tries - 1), 5000);
          else setServer("offline");
        });
    ping(18);
    return () => {
      alive = false;
      clearTimeout(slow);
    };
  }, []);

  // full reload so no state from this user leaks into the next one
  function logout(message: string | null = null) {
    clearToken();
    window.location.replace(message ? `/#auth_error=${encodeURIComponent(message)}` : "/");
  }

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    save("ghgpt:theme", next ? "dark" : "light");
  }

  function selectRepo(name: string) {
    setActive(name);
    setShowNew(false);
    setTabs([]);
    setTab("chat");
    setMenu(false);
  }

  function onIndexed(r: Repo) {
    setRepos((list) => [r, ...list.filter((x) => x.name !== r.name)]);
    setServer("online");
    selectRepo(r.name);
  }

  function removeRepo(name: string) {
    removeRepoApi(name).catch(() => {});
    setRepos((l) => l.filter((r) => r.name !== name));
    setChats(({ [name]: _removed, ...rest }) => rest);
    if (active === name) {
      setActive(null);
      setTabs([]);
      setTab("chat");
    }
  }

  const openFile = useCallback((path: string) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setTab(path);
    setMenu(false);
  }, []);

  function closeTab(path: string) {
    setTabs((t) => t.filter((x) => x !== path));
    if (tab === path) setTab("chat");
  }

  async function send(question: string) {
    if (!active) return;
    const name = active;
    const history: ChatTurn[] = (chats[name] ?? [])
      .filter((m) => !m.error && m.content.trim())
      .slice(-HISTORY_MESSAGES)
      .map((m) => ({ role: m.role, content: m.content }));

    const answerId = uid();
    const add = (m: ChatMessage) => setChats((c) => ({ ...c, [name]: [...(c[name] ?? []), m] }));
    // create the answer bubble on the first event, then keep patching it as tokens arrive
    const patch = (fn: (m: ChatMessage) => ChatMessage) =>
      setChats((c) => {
        const list = c[name] ?? [];
        const exists = list.some((m) => m.id === answerId);
        const next = exists
          ? list.map((m) => (m.id === answerId ? fn(m) : m))
          : [...list, fn({ id: answerId, role: "assistant", content: "", streaming: true })];
        return { ...c, [name]: next };
      });

    add({ id: uid(), role: "user", content: question });
    setLoading(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const t0 = performance.now();
    try {
      await streamQuestion(
        { question, collection_name: name, history },
        {
          onSources: (sources) => patch((m) => ({ ...m, sources })),
          onToken: (text) => patch((m) => ({ ...m, content: m.content + text })),
        },
        controller.signal,
      );
      patch((m) => ({ ...m, streaming: false, ms: performance.now() - t0 }));
      setServer("online");
    } catch (e) {
      if (controller.signal.aborted) {
        patch((m) => ({ ...m, streaming: false, content: m.content ? m.content + "\n\n_(stopped)_" : "_Stopped._" }));
      } else if (e instanceof ApiError && e.status === 401) {
        logout("Your login expired — sign in again.");
      } else {
        const msg = e instanceof Error ? e.message : "Something went wrong.";
        patch((m) =>
          m.content
            ? { ...m, streaming: false, content: `${m.content}\n\n_(Answer interrupted: ${msg})_` }
            : { ...m, streaming: false, content: msg, error: true },
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  const sidebar = (onClose?: () => void) => (
    <Sidebar
      repos={repos}
      active={showNew ? null : active}
      files={files}
      openFile={tab === "chat" ? null : tab}
      dark={dark}
      onSelect={selectRepo}
      onNew={() => {
        setShowNew(true);
        setMenu(false);
      }}
      onRemove={removeRepo}
      onOpenFile={openFile}
      onToggleTheme={toggleTheme}
      user={user}
      onLogout={() => logout()}
      onClose={onClose}
    />
  );

  const welcome = !repo || showNew;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="hidden md:block">{sidebar()}</div>

        {menu && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/40 animate-fadeIn" onClick={() => setMenu(false)} />
            <div className="relative h-full w-72 animate-fadeIn">{sidebar(() => setMenu(false))}</div>
          </div>
        )}

        <main className="flex min-w-0 flex-1 flex-col bg-bg">
          {welcome ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-line bg-side px-3 py-2.5 md:hidden">
                <button onClick={() => setMenu(true)} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                  Menu
                </button>
                <Logo className="h-6 w-6" />
                <span className="font-extrabold tracking-tight">GitHub-GPT</span>
              </div>
              <div className="scroll-thin flex flex-1 items-center justify-center overflow-y-auto px-4 py-10">
                <div className="w-full max-w-2xl animate-blurIn text-center">
                  <Logo className="mx-auto h-12 w-12" />
                  <h1 className="mt-5 text-3xl font-extrabold tracking-tight sm:text-4xl">
                    Chat with any <span className="brand-shine animate-shine">GitHub repository</span>
                  </h1>
                  <p className="mx-auto mt-3 max-w-lg text-[15px] text-muted">
                    Paste a public repo. GitHub-GPT reads its code, and answers your questions using only the real files — with sources you can open.
                  </p>
                  <div className="mx-auto mt-8 max-w-xl text-left">
                    {user ? (
                      <IndexPanel user={user} onIndexed={onIndexed} onAuthExpired={() => logout("Your login expired — sign in again.")} autoFocus />
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <a
                          href={loginUrl}
                          className="flex items-center gap-2 rounded-xl bg-accent-fill px-5 py-3 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90"
                        >
                          <Github size={18} /> Sign in with GitHub
                        </a>
                        <p className="text-xs text-muted">Sign in to index repositories. We only read your public profile.</p>
                        {authError && <p className="text-xs text-bad">{authError}</p>}
                      </div>
                    )}
                  </div>
                  <div className="mx-auto mt-10 grid max-w-xl gap-3 text-left sm:grid-cols-3">
                    {[
                      ["1", "Index", "Code is split into chunks and embedded into pgvector."],
                      ["2", "Ask", "Your question finds the 8 most relevant chunks."],
                      ["3", "Answer", "Groq's LLM answers from them and cites the files."],
                    ].map(([n, t, d]) => (
                      <div key={n} className="rounded-xl border border-line bg-panel p-3.5 shadow-sm">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-accent-soft font-mono text-[11px] text-accent">{n}</span>
                          {t}
                        </div>
                        <p className="mt-1.5 text-xs leading-relaxed text-muted">{d}</p>
                      </div>
                    ))}
                  </div>
                  {repo && showNew && (
                    <button onClick={() => setShowNew(false)} className="mt-6 text-sm text-muted underline-offset-4 hover:text-text hover:underline">
                      ← Back to {repo.repo}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <TabBar tabs={tabs} active={tab} onSelect={setTab} onClose={closeTab} onMenu={() => setMenu(true)} />
              <div className="min-h-0 flex-1">
                {tab === "chat" ? (
                  <ChatView repo={repo} messages={messages} loading={loading} onSend={send} onStop={stop} onOpenFile={openFile} />
                ) : (
                  <FileView key={tab} repo={repo} path={tab} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
      <StatusBar server={server} repo={welcome ? null : repo} />
    </div>
  );
}