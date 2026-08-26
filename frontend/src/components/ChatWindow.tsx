import { useState } from "react";
import { askQuestion } from "../api/client";
import type { ChatMessage } from "../types/api";
import MessageBubble from "./MessageBubble";

interface ChatWindowProps {
  activeCollection: string | null;
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
}

export default function ChatWindow({
  activeCollection,
  messages,
  setMessages,
}: ChatWindowProps) {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const isDisabled = !activeCollection || isLoading;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!activeCollection || !question.trim()) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: question.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setQuestion("");
    setIsLoading(true);

    try {
      const result = await askQuestion({
        question: userMessage.content,
        collection_name: activeCollection,
      });

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: result.answer,
        sources: result.sources,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const errorMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content:
          err instanceof Error ? err.message : "Something went wrong. Try again.",
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="bg-panel border border-line rounded-lg flex flex-col h-[500px]">
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {!activeCollection && (
          <p className="text-muted text-sm font-mono m-auto">
            Index a repository above to start chatting.
          </p>
        )}

        {activeCollection && messages.length === 0 && (
          <p className="text-muted text-sm font-mono m-auto">
            Ask something about {activeCollection}.
          </p>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isLoading && (
          <p className="text-muted text-sm font-mono">Thinking...</p>
        )}
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-t border-line p-3 flex gap-2"
      >
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={isDisabled}
          placeholder={
            activeCollection ? "Ask a question..." : "Index a repo first"
          }
          className="flex-1 bg-ink border border-line rounded px-3 py-2 font-sans text-sm
                     focus-visible:border-amber outline-none disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={isDisabled || !question.trim()}
          className="bg-amber text-ink font-mono text-sm font-semibold px-4 py-2 rounded
                     disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}