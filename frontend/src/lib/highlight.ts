import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import java from "highlight.js/lib/languages/java";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import yaml from "highlight.js/lib/languages/yaml";
import ini from "highlight.js/lib/languages/ini";
import markdown from "highlight.js/lib/languages/markdown";
import cpp from "highlight.js/lib/languages/cpp";
import sql from "highlight.js/lib/languages/sql";
import dockerfile from "highlight.js/lib/languages/dockerfile";

// Only the languages we need → small bundle, fast load
const langs = { python, javascript, typescript, json, bash, css, xml, java, go, rust, yaml, ini, markdown, cpp, sql, dockerfile };
Object.entries(langs).forEach(([name, lang]) => hljs.registerLanguage(name, lang));
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["js", "jsx", "mjs", "cjs"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["sh", "shell", "zsh", "powershell", "ps1"], { languageName: "bash" });
hljs.registerAliases(["html", "svg"], { languageName: "xml" });
hljs.registerAliases(["yml"], { languageName: "yaml" });
hljs.registerAliases(["toml"], { languageName: "ini" });
hljs.registerAliases(["md"], { languageName: "markdown" });
hljs.registerAliases(["rs"], { languageName: "rust" });
hljs.registerAliases(["c", "h", "hpp", "cc"], { languageName: "cpp" });

export function langFromPath(path: string): string | undefined {
  const name = path.split("/").pop() ?? "";
  if (name === "Dockerfile") return "dockerfile";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return hljs.getLanguage(ext) ? ext : undefined;
}

export function highlight(code: string, lang?: string): string {
  try {
    if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    if (code.length < 20000) return hljs.highlightAuto(code).value;
  } catch {
    /* fall through */
  }
  return code.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}
