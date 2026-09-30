import { useEffect } from "react";
import { Github } from "lucide-react";
import Logo from "./Logo";
import { health, loginUrl } from "../api/client";

export default function Login({ error }: { error: string | null }) {
  // Start waking the free-tier backend now, so it's ready by the time the user clicks.
  useEffect(() => {
    health().catch(() => {});
  }, []);

  return (
    <div className="flex h-full items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md animate-blurIn text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-5 text-3xl font-extrabold tracking-tight">
          Welcome to <span className="brand-shine animate-shine">GitHub-GPT</span>
        </h1>
        <p className="mx-auto mt-3 max-w-sm text-[15px] text-muted">
          Chat with any GitHub repository — answers come only from its real files, with sources you can open.
        </p>

        <a
          href={loginUrl()}
          className="mt-8 inline-flex items-center gap-2.5 rounded-xl bg-accent-fill px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-0.5"
        >
          <Github size={18} />
          Sign in with GitHub
        </a>

        {error && <p className="mt-4 text-sm text-bad">{error}</p>}

        <p className="mx-auto mt-6 max-w-sm text-xs leading-relaxed text-muted/80">
          We only read your public GitHub profile (name and avatar) to keep your repositories and chats separate from
          other people's. The first sign-in can take up to a minute while the free server wakes up.
        </p>
      </div>
    </div>
  );
}
