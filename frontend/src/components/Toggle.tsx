import type { ReactNode } from "react";

interface Props {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string; // accessible name (also shown unless hideLabel)
  hideLabel?: boolean;
  icon?: ReactNode; // rendered inside the thumb
  size?: "sm" | "md";
}

/** Accessible switch: the thumb glides across on a spring and the track fades to the accent gradient. */
export default function Toggle({ checked, onChange, label, hideLabel, icon, size = "md" }: Props) {
  const dims = size === "sm" ? { track: "h-5 w-9", thumb: "h-4 w-4", on: "translate-x-4" } : { track: "h-6 w-11", thumb: "h-5 w-5", on: "translate-x-5" };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={hideLabel ? label : undefined}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 text-xs text-muted transition-colors hover:text-text"
    >
      <span
        className={`relative inline-flex shrink-0 items-center rounded-full p-0.5 transition-colors duration-300 ${dims.track} ${
          checked ? "bg-gradient-to-r from-accent-fill to-accent-2 shadow-[0_0_14px_-4px_rgb(var(--accent-fill)/0.8)]" : "bg-line"
        }`}
      >
        <span
          className={`flex items-center justify-center rounded-full bg-white text-[10px] text-accent-fill shadow-md transition-transform duration-500 ease-spring group-active:scale-90 ${dims.thumb} ${
            checked ? dims.on : "translate-x-0"
          }`}
        >
          {icon}
        </span>
      </span>
      {!hideLabel && <span>{label}</span>}
    </button>
  );
}
