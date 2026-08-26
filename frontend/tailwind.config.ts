// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#12141C",       // page background
        panel: "#1A1D29",     // card/panel background
        line: "#2A2E3F",      // borders, hairlines
        text: "#E8E6E3",      // primary text
        muted: "#8B8F9E",     // secondary text
        amber: "#E8A33D",     // primary accent — inputs, send action
        teal: "#5FB3B3",      // reserved ONLY for source/citation tags
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "monospace"],
        sans: ["Inter", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;