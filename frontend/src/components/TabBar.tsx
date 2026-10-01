import { FileCode2, Menu, MessageSquare, X } from "lucide-react";

interface Props {
  tabs: string[];
  active: string; // "chat" or a file path
  onSelect: (t: string) => void;
  onClose: (t: string) => void;
  onMenu: () => void;
}

export default function TabBar({ tabs, active, onSelect, onClose, onMenu }: Props) {
  const tab = (id: string, label: string, icon: JSX.Element, closable: boolean) => {
    const on = active === id;
    return (
      <div
        key={id}
        className={`group relative flex shrink-0 items-center gap-1.5 border-r border-line px-3 py-2.5 text-[12.5px] transition-colors ${on ? "bg-bg text-text" : "text-muted hover:bg-bg/50 hover:text-text"}`}
      >
        {on && <span className="absolute inset-x-0 top-0 h-0.5 animate-fadeIn bg-gradient-to-r from-accent-fill to-accent-2" />}
        <button onClick={() => onSelect(id)} className="flex items-center gap-1.5" title={id === "chat" ? "Chat" : id}>
          {icon}
          <span className={id === "chat" ? "font-medium" : "font-mono"}>{label}</span>
        </button>
        {closable && (
          <button onClick={() => onClose(id)} className={`rounded p-0.5 hover:bg-line ${on ? "" : "opacity-0 group-hover:opacity-100"}`} aria-label={`Close ${label}`}>
            <X size={12} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="scroll-thin flex items-stretch overflow-x-auto border-b border-line bg-side">
      <button onClick={onMenu} className="border-r border-line px-3 text-muted hover:text-text md:hidden" aria-label="Open menu">
        <Menu size={18} />
      </button>
      {tab("chat", "Chat", <MessageSquare size={14} />, false)}
      {tabs.map((t) => tab(t, t.split("/").pop()!, <FileCode2 size={14} />, true))}
    </div>
  );
}
