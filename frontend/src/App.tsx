import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import ChatView from "./components/ChatView";
import FileView from "./components/FileView";
import IndexPanel from "./components/IndexPanel";
import StatusBar, { type ServerState } from "./components/StatusBar";
import Logo from "./components/Logo";
import { Toaster, toast } from "react-hot-toast";
import { ApiError, health, indexRepo, listRepos, loginUrl, removeRepo as removeRepoApi, streamQuestion } from "./api/client";
import { clearToken, consumeLoginRedirect, getToken, userFromToken } from "./lib/auth";
import { Database, Github, MessageSquareText, Sparkles } from "lucide-react";
import { load, save } from "./lib/storage";
import { parseGithubUrl, uid } from "./lib/repo";
import { hasLines } from "./lib/citations";
import type { ChatMessage, ChatTurn, Citation, LineFocus, ReindexState, Repo, User } from "./types/api";

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
  const [collapsed, setCollapsed] = useState(() => load<boolean>("ghgpt:sidebar-collapsed", false));
  const [focus, setFocus] = useState<Record<string, LineFocus | null>>({}); // cited lines per open file tab
  const [reindexing, setReindexing] = useState<Record<string, ReindexState>>({});
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
  useEffect(() => save("ghgpt:sidebar-collapsed", collapsed), [collapsed]);

  // "[" toggles the sidebar (like Linear) — but never while typing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, [contenteditable]")) return;
      setCollapsed((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
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

  // range: lines to scroll to and highlight; without one (e.g. from the file tree) the file opens at the top
  const openFile = useCallback((path: string, range?: { start: number; end: number }) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setFocus((f) => ({ ...f, [path]: range ? { ...range, nonce: Date.now() } : null }));
    setTab(path);
    setMenu(false);
  }, []);

  const openCitation = useCallback(
    (c: Citation) => openFile(c.path, hasLines(c) ? { start: c.start_line, end: c.end_line } : undefined),
    [openFile],
  );

  function closeTab(path: string) {
    setTabs((t) => t.filter((x) => x !== path));
    setFocus(({ [path]: _closed, ...rest }) => rest);
    if (tab === path) setTab("chat");
  }

  function setFeedback(messageId: string, value: "up" | "down" | undefined) {
    if (!active) return;
    setChats((c) => ({ ...c, [active]: (c[active] ?? []).map((m) => (m.id === messageId ? { ...m, feedback: value } : m)) }));
  }

  // Re-index in place: the old vectors keep answering until the new copy is swapped in (atomic on the backend).
  async function reindex(name: string) {
    const r = repos.find((x) => x.name === name);
    if (!r || reindexing[name]?.status === "running") return;
    const set = (s: ReindexState) => setReindexing((m) => ({ ...m, [name]: s }));
    set({ status: "running", stage: "Starting…", pct: 0 });
    try {
      const job = await indexRepo({ repo_url: r.url, collection_name: name, force: true }, (j) =>
        set({ status: "running", stage: j.stage, pct: j.chunks ? Math.round((j.embedded / j.chunks) * 100) : 0 }),
      );
      setRepos((list) => list.map((x) => (x.name === name ? { ...x, files: job.files || x.files, chunks: job.chunks || x.chunks, indexedAt: Date.now() } : x)));
      set({ status: "done", stage: "Done", pct: 100 });
      toast.success(`${r.repo} re-indexed — line-level sources are ready ✨`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return logout("Your login expired — sign in again.");
      set({ status: "failed", stage: "Failed", pct: 0 });
      toast.error(e instanceof Error ? e.message : "Re-indexing failed.");
    }
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
          onSources: (sources, citations) => patch((m) => ({ ...m, sources, citations })),
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

  const sidebar = (mobile: boolean) => (
    <Sidebar
      repos={repos}
      active={showNew ? null : active}
      files={files}
      openFile={tab === "chat" ? null : tab}
      dark={dark}
      collapsed={!mobile && collapsed}
      reindexing={reindexing}
      onSelect={selectRepo}
      onNew={() => {
        setShowNew(true);
        setMenu(false);
      }}
      onRemove={removeRepo}
      onReindex={reindex}
      onOpenFile={(path) => openFile(path)}
      onToggleTheme={toggleTheme}
      onToggleCollapse={mobile ? undefined : () => setCollapsed((c) => !c)}
      user={user}
      onLogout={() => logout()}
      onClose={mobile ? () => setMenu(false) : undefined}
    />
  );

  const welcome = !repo || showNew;

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="hidden md:block">{sidebar(false)}</div>

        {menu && (
          <div className="fixed inset-0 z-40 md:hidden">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-fadeIn" onClick={() => setMenu(false)} />
            <div className="relative h-full w-72 animate-slideInLeft shadow-2xl shadow-black/40">{sidebar(true)}</div>
          </div>
        )}

        <main className="app-glow flex min-w-0 flex-1 flex-col">
          {welcome ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-line bg-side px-3 py-2.5 md:hidden">
                <button onClick={() => setMenu(true)} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                  Menu
                </button>
                <Logo className="h-6 w-6" />
                <span className="font-extrabold tracking-tight">GitHub-GPT</span>
              </div>
              <div className="relative flex min-h-0 flex-1">
                <div className="aurora" aria-hidden />
                <div className="dot-grid" aria-hidden />
                <div className="scroll-thin relative flex flex-1 justify-center overflow-y-auto px-4 py-10">
                  {/* my-auto (not items-center) so tall content scrolls instead of being cut off at the top on phones */}
                  <div className="my-auto w-full max-w-2xl animate-blurIn text-center">
                    <div className="mx-auto w-fit animate-float">
                      <div className="rounded-2xl animate-glow">
                        <Logo className="h-14 w-14" />
                      </div>
                    </div>
                    <h1 className="mt-6 text-3xl font-extrabold tracking-tight sm:text-5xl">
                      Chat with any <span className="text-gradient whitespace-nowrap">GitHub repository</span>
                    </h1>
                    <p className="mx-auto mt-4 max-w-lg text-[15px] leading-relaxed text-muted">
                      Paste a public repo. GitHub-GPT reads its code, and answers your questions using only the real files — with sources you can open.
                    </p>
                    <div className="mx-auto mt-8 max-w-xl text-left">
                      {user ? (
                        <IndexPanel user={user} onIndexed={onIndexed} onAuthExpired={() => logout("Your login expired — sign in again.")} autoFocus />
                      ) : (
                        <div className="flex flex-col items-center gap-3 animate-popIn">
                          <a href={loginUrl} className="btn-primary px-6 py-3 text-[15px]">
                            <Github size={19} /> Sign in with GitHub
                          </a>
                          <p className="text-xs text-muted">Free · we only read your public GitHub profile.</p>
                          {authError && <p className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-1.5 text-xs text-bad animate-popIn">{authError}</p>}
                        </div>
                      )}
                    </div>
                    <div className="mx-auto mt-12 grid max-w-xl gap-3 text-left sm:grid-cols-3">
                      {(
                        [
                          [Database, "Index", "Code is split into chunks and embedded into pgvector."],
                          [MessageSquareText, "Ask", "Your question finds the 8 most relevant chunks."],
                          [Sparkles, "Answer", "Groq's LLM answers from them and cites the files."],
                        ] as const
                      ).map(([Icon, t, d], i) => (
                        <div
                          key={t}
                          className="lift group relative overflow-hidden rounded-xl border border-line bg-panel/80 p-4 shadow-sm backdrop-blur animate-popIn"
                          style={{ animationDelay: `${150 + i * 90}ms` }}
                        >
                          <span className="absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-accent-fill to-accent-2 transition-transform duration-300 group-hover:scale-x-100" />
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-soft text-accent transition-transform duration-300 group-hover:rotate-6 group-hover:scale-110">
                              <Icon size={15} />
                            </span>
                            <span className="font-mono text-[11px] text-muted">0{i + 1}</span>
                            {t}
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-muted">{d}</p>
                        </div>
                      ))}
                    </div>
                    {repo && showNew && (
                      <button onClick={() => setShowNew(false)} className="mt-6 text-sm text-muted underline-offset-4 transition-colors hover:text-text hover:underline">
                        ← Back to {repo.repo}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <TabBar tabs={tabs} active={tab} onSelect={setTab} onClose={closeTab} onMenu={() => setMenu(true)} />
              <div className="min-h-0 flex-1">
                {tab === "chat" ? (
                  <ChatView
                    repo={repo}
                    messages={messages}
                    loading={loading}
                    onSend={send}
                    onStop={stop}
                    onOpenCitation={openCitation}
                    onFeedback={setFeedback}
                  />
                ) : (
                  <FileView key={tab} repo={repo} path={tab} focus={focus[tab]} />
                )}
              </div>
            </>
          )}
        </main>
      </div>
      <StatusBar server={server} repo={welcome ? null : repo} />
      <Toaster
        position="top-right"
        toastOptions={{
          className: "!rounded-xl !border !border-line !bg-panel !text-text !text-sm !shadow-2xl !shadow-black/30",
          success: { iconTheme: { primary: "rgb(var(--ok))", secondary: "white" } },
          error: { iconTheme: { primary: "rgb(var(--bad))", secondary: "white" } },
        }}
      />
    </div>
  );
}