import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: v("bg"),
        side: v("side"),
        panel: v("panel"),
        line: v("line"),
        text: v("text"),
        muted: v("muted"),
        accent: v("accent"),
        "accent-soft": v("accent-soft"),
        "accent-fill": v("accent-fill"),
        ok: v("ok"),
        warn: v("warn"),
        bad: v("bad"),
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        blurIn: {
          "0%": { opacity: "0", filter: "blur(6px)", transform: "translateY(4px)" },
          "100%": { opacity: "1", filter: "blur(0)", transform: "none" },
        },
        shine: { to: { backgroundPosition: "-200% 0" } },
        dot: { "0%,80%,100%": { opacity: "0.25" }, "40%": { opacity: "1" } },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
      },
      animation: {
        blurIn: "blurIn .45s ease-out both",
        shine: "shine 4s linear infinite",
        dot: "dot 1.2s infinite",
        fadeIn: "fadeIn .2s ease-out both",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
