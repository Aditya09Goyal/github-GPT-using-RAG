import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileCode2, Folder, Github, LogOut, Moon, Plus, Sun, Trash2, X } from "lucide-react";
import Logo from "./Logo";
import type { Repo, User } from "../types/api";

interface Props {
  repos: Repo[];
  active: string | null;
  files: string[];
  openFile: string | null;
  dark: boolean;
  onSelect: (name: string) => void;
  onNew: () => void;
  onRemove: (name: string) => void;
  onOpenFile: (path: string) => void;
  onToggleTheme: () => void;
  user: User | null;
  onLogout: () => void;
  onClose?: () => void;
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
            className={`flex w-full items-center gap-1.5 truncate rounded-md py-1 pr-2 text-left font-mono text-[12px] ${openFile === n.path ? "bg-accent-soft text-accent" : "text-muted hover:bg-line/50 hover:text-text"}`}
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
              className="flex w-full items-center gap-1 truncate rounded-md py-1 pr-2 text-left font-mono text-[12px] text-muted hover:bg-line/50 hover:text-text"
            >
              {open[n.path] ?? true ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <Folder size={13} className="shrink-0" />
              <span className="truncate">{n.name}</span>
            </button>
            {(open[n.path] ?? true) && <Tree node={n} depth={depth + 1} openFile={openFile} onOpenFile={onOpenFile} />}
          </div>
        ),
      )}
    </>
  );
}

export default function Sidebar(p: Props) {
  const tree = useMemo(() => buildTree(p.files), [p.files]);

  return (
    <aside className="flex h-full w-72 flex-col border-r border-line bg-side">
      <div className="group/logo flex items-center gap-2.5 px-4 pb-3 pt-4">
        <span className="transition-transform duration-300 group-hover/logo:-rotate-6 group-hover/logo:scale-110">
          <Logo />
        </span>
        <span className="brand-shine animate-shine text-[17px] font-extrabold tracking-tight">GitHub-GPT</span>
        {p.onClose && (
          <button onClick={p.onClose} className="ml-auto rounded-md p-1 text-muted hover:text-text md:hidden" aria-label="Close menu">
            <X size={18} />
          </button>
        )}
      </div>

      <div className="px-3">
        <button onClick={p.onNew} className="lift group flex w-full items-center gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm font-medium shadow-sm">
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-accent-fill to-accent-2 text-white transition-transform duration-300 group-hover:rotate-90">
            <Plus size={14} />
          </span>
          New repository
        </button>
      </div>

      <div className="scroll-thin mt-4 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted/80">Repositories</div>
        {p.repos.length === 0 && <p className="px-1 text-xs text-muted animate-fadeIn">No repositories yet. Index one to start.</p>}
        {p.repos.map((r, i) => {
          const on = r.name === p.active;
          return (
            <div key={r.name} className="mb-0.5 animate-popIn" style={{ animationDelay: `${i * 40}ms` }}>
              <div
                className={`group relative flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-all duration-200 ${
                  on ? "bg-panel shadow-sm ring-1 ring-line" : "hover:translate-x-0.5 hover:bg-line/50"
                }`}
              >
                <span
                  className={`absolute -left-1 top-1.5 bottom-1.5 w-1 rounded-full bg-gradient-to-b from-accent-fill to-accent-2 transition-transform duration-300 ${on ? "scale-y-100" : "scale-y-0"}`}
                />
                <button onClick={() => p.onSelect(r.name)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <Github size={14} className={on ? "text-accent" : "text-muted"} />
                  <span className="truncate">
                    <span className="text-muted">{r.owner}/</span>
                    <span className="font-medium">{r.repo}</span>
                  </span>
                </button>
                <button onClick={() => p.onRemove(r.name)} className="hidden rounded p-0.5 text-muted hover:text-bad group-hover:block" aria-label={`Remove ${r.repo} from list`} title="Remove from list">
                  <Trash2 size={13} />
                </button>
              </div>

              {on && (
                <div className="mb-2 ml-2 mt-1 border-l border-line pl-1">
                  <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted/70">Referenced files</div>
                  {p.files.length === 0 ? (
                    <p className="px-2 pb-1 text-[11.5px] text-muted">Files cited in answers appear here.</p>
                  ) : (
                    <Tree node={tree} depth={0} openFile={p.openFile} onOpenFile={p.onOpenFile} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {p.user && (
        <div className="flex items-center gap-2.5 border-t border-line px-4 py-2.5 animate-fadeIn">
          <span className="rounded-full bg-gradient-to-br from-accent-fill to-accent-2 p-[2px]">
            {p.user.avatar_url ? (
              <img src={p.user.avatar_url} alt="" className="h-7 w-7 rounded-full border-2 border-side" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-side bg-panel text-xs font-bold text-accent">
                {p.user.login.slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium">{p.user.name}</div>
            <div className="truncate font-mono text-[11px] text-muted">@{p.user.login}</div>
          </div>
          <button onClick={p.onLogout} className="group rounded-md p-1.5 text-muted transition-colors hover:bg-bad/10 hover:text-bad" aria-label="Sign out" title="Sign out">
            <LogOut size={14} className="transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line px-4 py-3 text-xs text-muted">
        <a href="https://github.com/Aditya09Goyal/github-GPT-using-RAG" target="_blank" rel="noreferrer" className="flex items-center gap-1.5 hover:text-text">
          <Github size={14} /> Source
        </a>
        <button onClick={p.onToggleTheme} className="flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-line/50 hover:text-text" aria-label="Toggle theme">
          {p.dark ? <Sun size={14} /> : <Moon size={14} />}
          {p.dark ? "Light" : "Dark"}
        </button>
      </div>
    </aside>
  );
}
