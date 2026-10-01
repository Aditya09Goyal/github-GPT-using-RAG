import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileCode2,
  Folder,
  Github,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import Logo from "./Logo";
import Toggle from "./Toggle";
import type { ReindexState, Repo, User } from "../types/api";

interface Props {
  repos: Repo[];
  active: string | null;
  files: string[];
  openFile: string | null;
  dark: boolean;
  collapsed?: boolean; // desktop icon rail
  reindexing: Record<string, ReindexState>;
  onSelect: (name: string) => void;
  onNew: () => void;
  onRemove: (name: string) => void;
  onReindex: (name: string) => void;
  onOpenFile: (path: string) => void;
  onToggleTheme: () => void;
  onToggleCollapse?: () => void;
  user: User | null;
  onLogout: () => void;
  onClose?: () => void; // mobile drawer
}

type Node = { name: string; path: string; children: Map<string, Node>; file: boolean };

function buildTree(paths: string[]): Node {
  const root: Node = { name: "", path: "", children: new Map(), file: false };
  for (const p of paths) {
    let cur = root;
    p.split("/").forEach((part, i, arr) => {
      const path = arr.slice(0, i + 1).join("/");
      if (!cur.children.has(part)) cur.children.set(part, { name: part, path, children: new Map(), file: i === arr.length - 1 });
      cur = cur.children.get(part)!;
    });
  }
  return root;
}

function Tree({ node, depth, openFile, onOpenFile }: { node: Node; depth: number; openFile: string | null; onOpenFile: (p: string) => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const items = [...node.children.values()].sort((a, b) => Number(a.file) - Number(b.file) || a.name.localeCompare(b.name));
  return (
    <>
      {items.map((n) =>
        n.file ? (
          <button
            key={n.path}
            onClick={() => onOpenFile(n.path)}
            style={{ paddingLeft: 10 + depth * 12 }}
            className={`flex w-full items-center gap-1.5 truncate rounded-md py-1 pr-2 text-left font-mono text-[12px] transition-colors ${
              openFile === n.path ? "bg-accent-soft text-accent" : "text-muted hover:bg-line/50 hover:text-text"
            }`}
            title={n.path}
          >
            <FileCode2 size={13} className="shrink-0" />
            <span className="truncate">{n.name}</span>
          </button>
        ) : (
          <div key={n.path}>
            <button
              onClick={() => setOpen((o) => ({ ...o, [n.path]: !(o[n.path] ?? true) }))}
              style={{ paddingLeft: 6 + depth * 12 }}
              aria-expanded={open[n.path] ?? true}
              className="flex w-full items-center gap-1 truncate rounded-md py-1 pr-2 text-left font-mono text-[12px] text-muted transition-colors hover:bg-line/50 hover:text-text"
            >
              <ChevronRight size={12} className={`shrink-0 transition-transform duration-300 ease-spring ${open[n.path] ?? true ? "rotate-90" : ""}`} />
              <Folder size={13} className="shrink-0" />
              <span className="truncate">{n.name}</span>
            </button>
            <div className="expand" data-open={open[n.path] ?? true}>
              <div>
                <Tree node={n} depth={depth + 1} openFile={openFile} onOpenFile={onOpenFile} />
              </div>
            </div>
          </div>
        ),
      )}
    </>
  );
}

/** Small status light: ✓ ready (emerald), re-indexing (amber, pulsing), failed (red). */
function StatusDot({ state }: { state?: ReindexState }) {
  const cls = !state || state.status === "done" ? "bg-ok" : state.status === "running" ? "bg-warn" : "bg-bad";
  const label = !state || state.status === "done" ? "Ready" : state.status === "running" ? state.stage : "Re-index failed";
  return (
    <span className="relative flex h-2 w-2 shrink-0" title={label}>
      {state?.status === "running" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn opacity-70" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${cls}`} />
    </span>
  );
}

export default function Sidebar(p: Props) {
  const tree = useMemo(() => buildTree(p.files), [p.files]);
  const [filter, setFilter] = useState("");
  const [filesOpen, setFilesOpen] = useState(true);
  const collapsed = !!p.collapsed;

  const shown = filter.trim() ? p.repos.filter((r) => `${r.owner}/${r.repo}`.toLowerCase().includes(filter.trim().toLowerCase())) : p.repos;

  return (
    <aside
      className={`flex h-full flex-col overflow-hidden border-r border-line/80 bg-side transition-[width] duration-500 ease-out-expo ${collapsed ? "w-[68px]" : "w-72"}`}
    >
      {/* brand */}
      <div className={`group/logo flex items-center gap-2.5 pb-3 pt-4 ${collapsed ? "justify-center px-0" : "px-4"}`}>
        <span className="transition-transform duration-500 ease-spring group-hover/logo:-rotate-6 group-hover/logo:scale-110">
          <Logo />
        </span>
        {!collapsed && <span className="brand-shine animate-shine whitespace-nowrap text-[17px] font-extrabold tracking-tight">GitHub-GPT</span>}
        {p.onClose && (
          <button onClick={p.onClose} className="btn-ghost ml-auto p-1 md:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        )}
      </div>

      {/* new repo */}
      <div className={collapsed ? "flex justify-center" : "px-3"}>
        <button
          onClick={p.onNew}
          title="New repository"
          aria-label="New repository"
          className={`surface lift group flex items-center gap-2 text-sm font-medium ${collapsed ? "h-10 w-10 justify-center rounded-xl p-0" : "w-full rounded-xl px-3 py-2"}`}
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-accent-fill to-accent-2 text-white transition-transform duration-500 ease-spring group-hover:rotate-90">
            <Plus size={14} />
          </span>
          {!collapsed && "New repository"}
        </button>
      </div>

      {/* repo list */}
      <div className={`scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto pb-3 ${collapsed ? "px-2" : "px-3"}`}>
        {!collapsed && (
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted/80">Repositories</span>
            {p.repos.length > 0 && <span className="rounded-full bg-line/60 px-1.5 text-[10px] font-semibold tabular-nums text-muted">{p.repos.length}</span>}
          </div>
        )}

        {!collapsed && p.repos.length > 4 && (
          <label className="glow-ring mb-2 flex items-center gap-1.5 rounded-lg border border-line/80 bg-panel px-2 py-1">
            <Search size={12} className="text-muted" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter repositories…"
              aria-label="Filter repositories"
              className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-muted/60"
            />
          </label>
        )}

        {!collapsed && p.repos.length === 0 && <p className="px-1 text-xs text-muted animate-fadeIn">🌱 No repositories yet — index one to start.</p>}
        {!collapsed && p.repos.length > 0 && shown.length === 0 && <p className="px-1 text-xs text-muted">No match for “{filter}”.</p>}

        {shown.map((r, i) => {
          const on = r.name === p.active;
          const job = p.reindexing[r.name];
          const busy = job?.status === "running";

          if (collapsed) {
            return (
              <button
                key={r.name}
                onClick={() => p.onSelect(r.name)}
                title={`${r.owner}/${r.repo}`}
                aria-label={`${r.owner}/${r.repo}`}
                className={`relative mx-auto mb-1.5 flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold uppercase transition-all duration-300 ease-spring active:scale-90 ${
                  on ? "surface text-accent" : "text-muted hover:bg-line/50 hover:text-text"
                }`}
              >
                {r.repo.slice(0, 2)}
                <span className="absolute -right-0.5 -top-0.5">
                  <StatusDot state={job} />
                </span>
              </button>
            );
          }

          return (
            <div key={r.name} className="mb-0.5 animate-springIn" style={{ animationDelay: `${i * 35}ms` }}>
              <div
                className={`group relative flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-all duration-300 ease-spring ${
                  on ? "surface !rounded-xl" : "hover:translate-x-0.5 hover:bg-line/40"
                }`}
              >
                <span
                  className={`absolute -left-1 bottom-2 top-2 w-1 rounded-full bg-gradient-to-b from-accent-fill to-accent-2 transition-transform duration-500 ease-spring ${on ? "scale-y-100" : "scale-y-0"}`}
                />
                <button onClick={() => p.onSelect(r.name)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <StatusDot state={job} />
                  <span className="min-w-0 truncate">
                    <span className="text-muted">{r.owner}/</span>
                    <span className="font-medium">{r.repo}</span>
                  </span>
                </button>
                <span className={`flex items-center gap-0.5 transition-opacity ${busy ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"}`}>
                  <button
                    onClick={() => p.onReindex(r.name)}
                    disabled={busy}
                    className="btn-ghost p-1 disabled:cursor-progress disabled:opacity-100"
                    aria-label={`Re-index ${r.repo}`}
                    title={busy ? job!.stage : "Re-index (fresh code + line numbers)"}
                  >
                    <RefreshCw size={13} className={busy ? "animate-spin text-warn" : "transition-transform duration-500 ease-spring hover:rotate-180"} />
                  </button>
                  {!busy && (
                    <button onClick={() => p.onRemove(r.name)} className="btn-ghost p-1 hover:!text-bad" aria-label={`Remove ${r.repo} from list`} title="Remove from list">
                      <Trash2 size={13} />
                    </button>
                  )}
                </span>
              </div>

              {/* live re-index progress */}
              <div className="expand" data-open={busy}>
                <div>
                  <div className="mx-2 mb-1.5 mt-1">
                    <div className="flex justify-between text-[10.5px] text-muted">
                      <span className="truncate">⏳ {job?.stage}</span>
                      {!!job?.pct && <span className="tabular-nums">{job.pct}%</span>}
                    </div>
                    <span className="mt-1 block h-1 overflow-hidden rounded-full bg-line">
                      <span className="bar-shimmer block h-full rounded-full transition-all duration-500" style={{ width: `${Math.max(job?.pct ?? 0, 4)}%` }} />
                    </span>
                  </div>
                </div>
              </div>

              {on && (
                <div className="mb-2 ml-2 mt-1 border-l border-line/80 pl-1">
                  <button
                    onClick={() => setFilesOpen((o) => !o)}
                    aria-expanded={filesOpen}
                    className="flex w-full items-center gap-1 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted/70 hover:text-text"
                  >
                    <ChevronDown size={11} className={`transition-transform duration-300 ease-spring ${filesOpen ? "" : "-rotate-90"}`} />
                    Referenced files
                    {p.files.length > 0 && <span className="ml-auto font-mono normal-case tracking-normal">{p.files.length}</span>}
                  </button>
                  <div className="expand" data-open={filesOpen}>
                    <div>
                      {p.files.length === 0 ? (
                        <p className="px-2 pb-1 text-[11.5px] text-muted">📎 Files cited in answers appear here.</p>
                      ) : (
                        <Tree node={tree} depth={0} openFile={p.openFile} onOpenFile={p.onOpenFile} />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* user */}
      {p.user && (
        <div className={`flex items-center gap-2.5 border-t border-line/80 py-2.5 animate-fadeIn ${collapsed ? "justify-center px-0" : "px-4"}`}>
          <span className="shrink-0 rounded-full bg-gradient-to-br from-accent-fill to-accent-2 p-[2px]" title={collapsed ? `@${p.user.login}` : undefined}>
            {p.user.avatar_url ? (
              <img src={p.user.avatar_url} alt="" className="h-7 w-7 rounded-full border-2 border-side" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-side bg-panel text-xs font-bold text-accent">
                {p.user.login.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm font-medium">{p.user.name}</div>
                <div className="truncate font-mono text-[11px] text-muted">@{p.user.login}</div>
              </div>
              <button onClick={p.onLogout} className="btn-ghost group p-1.5 hover:!bg-bad/10 hover:!text-bad" aria-label="Sign out" title="Sign out">
                <LogOut size={14} className="transition-transform duration-300 ease-spring group-hover:translate-x-0.5" />
              </button>
            </>
          )}
        </div>
      )}

      {/* footer: theme switch, source, collapse */}
      <div className={`flex items-center border-t border-line/80 py-3 text-xs text-muted ${collapsed ? "flex-col gap-3 px-0" : "justify-between gap-2 px-4"}`}>
        <Toggle
          checked={p.dark}
          onChange={p.onToggleTheme}
          label={collapsed ? "Dark mode" : p.dark ? "Dark" : "Light"}
          hideLabel={collapsed}
          size="sm"
          icon={p.dark ? <Moon size={9} strokeWidth={2.6} /> : <Sun size={9} strokeWidth={2.6} />}
        />
        {!collapsed && (
          <a href="https://github.com/Aditya09Goyal/github-GPT-using-RAG" target="_blank" rel="noreferrer" className="btn-ghost ml-auto px-1.5 py-1">
            <Github size={14} /> Source
          </a>
        )}
        {p.onToggleCollapse && (
          <button
            onClick={p.onToggleCollapse}
            className="btn-ghost p-1.5"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar  ([)" : "Collapse sidebar  ([)"}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>
        )}
      </div>
    </aside>
  );
}
