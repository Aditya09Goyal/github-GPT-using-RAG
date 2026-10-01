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
        "accent-2": v("accent-2"),
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
        popIn: {
          "0%": { opacity: "0", transform: "translateY(8px) scale(0.96)" },
          "100%": { opacity: "1", transform: "none" },
        },
        slideInRight: {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "none" },
        },
        float: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-6px)" } },
        glow: {
          "0%,100%": { boxShadow: "0 0 0 0 rgb(var(--accent-fill) / 0.45)" },
          "50%": { boxShadow: "0 0 28px 4px rgb(var(--accent-fill) / 0.35)" },
        },
      },
      animation: {
        blurIn: "blurIn .45s ease-out both",
        shine: "shine 4s linear infinite",
        dot: "dot 1.2s infinite",
        fadeIn: "fadeIn .2s ease-out both",
        popIn: "popIn .45s cubic-bezier(.2,.8,.2,1) both",
        slideInRight: "slideInRight .35s cubic-bezier(.2,.8,.2,1) both",
        float: "float 4s ease-in-out infinite",
        glow: "glow 3s ease-in-out infinite",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
