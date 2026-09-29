import { useCallback, useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import TabBar from "./components/TabBar";
import ChatView from "./components/ChatView";
import FileView from "./components/FileView";
import IndexPanel from "./components/IndexPanel";
import StatusBar, { type ServerState } from "./components/StatusBar";
import Logo from "./components/Logo";
import { askQuestion, health } from "./api/client";
import { load, save } from "./lib/storage";
import { uid } from "./lib/repo";
import type { ChatMessage, Repo } from "./types/api";

export default function App() {
  const [repos, setRepos] = useState<Repo[]>(() => load("ghgpt:repos", []));
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>(() => load("ghgpt:chats", {}));
  const [active, setActive] = useState<string | null>(() => load<string | null>("ghgpt:active", null));
  const [showNew, setShowNew] = useState(false);
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("chat");
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [server, setServer] = useState<ServerState>("checking");
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  const repo = repos.find((r) => r.name === active) ?? null;
  const messages = useMemo(() => (active ? chats[active] ?? [] : []), [chats, active]);
  const files = useMemo(() => [...new Set(messages.flatMap((m) => m.sources ?? []))], [messages]);

  useEffect(() => save("ghgpt:repos", repos), [repos]);
  useEffect(() => save("ghgpt:active", active), [active]);
  useEffect(() => {
    const trimmed = Object.fromEntries(Object.entries(chats).map(([k, v]) => [k, v.slice(-60)]));
    save("ghgpt:chats", trimmed);
  }, [chats]);

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
    const add = (m: ChatMessage) => setChats((c) => ({ ...c, [name]: [...(c[name] ?? []), m] }));
    add({ id: uid(), role: "user", content: question });
    setLoading(true);
    const t0 = performance.now();
    try {
      const r = await askQuestion({ question, collection_name: name });
      add({ id: uid(), role: "assistant", content: r.answer, sources: r.sources, ms: performance.now() - t0 });
      setServer("online");
    } catch (e) {
      add({ id: uid(), role: "assistant", content: e instanceof Error ? e.message : "Something went wrong.", error: true });
    } finally {
      setLoading(false);
    }
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
                    <IndexPanel onIndexed={onIndexed} autoFocus />
                  </div>
                  <div className="mx-auto mt-10 grid max-w-xl gap-3 text-left sm:grid-cols-3">
                    {[
                      ["1", "Index", "Code is split into chunks and embedded into pgvector."],
                      ["2", "Ask", "Your question finds the 5 most relevant chunks."],
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
                  <ChatView repo={repo} messages={messages} loading={loading} onSend={send} onOpenFile={openFile} />
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
