import { useState } from "react";
import RepoIndexForm from "./components/RepoIndexForm";
import ChatWindow from "./components/ChatWindow";
import type { ChatMessage } from "./types/api";

/**
 * App holds the two pieces of state that both halves of the screen need:
 * - activeCollection: which repo is currently indexed and ready to chat with
 * - messages: the running conversation for that collection
 *
 * Everything else (form inputs, loading states) stays local to each
 * component — only state that's genuinely SHARED lives here.
 */
export default function App() {
  const [activeCollection, setActiveCollection] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  function handleIndexed(collectionName: string) {
    setActiveCollection(collectionName);
    setMessages([]); // fresh conversation whenever a new repo becomes active
  }

  return (
    <div className="min-h-screen bg-ink text-text flex flex-col items-center px-4 py-10">
      <header className="w-full max-w-2xl mb-8">
        <h1 className="font-mono text-xl font-semibold tracking-tight">
          github-gpt
        </h1>
        <p className="text-muted text-sm mt-1">
          Index a repository, then ask questions grounded in its actual files.
        </p>
      </header>

      <main className="w-full max-w-2xl flex flex-col gap-6">
        <RepoIndexForm onIndexed={handleIndexed} />

        <ChatWindow
          activeCollection={activeCollection}
          messages={messages}
          setMessages={setMessages}
        />
      </main>
    </div>
  );
}