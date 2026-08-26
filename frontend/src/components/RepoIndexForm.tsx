import { useState } from "react";
import { indexRepo } from "../api/client";

interface RepoIndexFormProps {
  onIndexed: (collectionName: string) => void;
}

export default function RepoIndexForm({ onIndexed }: RepoIndexFormProps) {
  const [repoUrl, setRepoUrl] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [lastResult, setLastResult] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage("");

    try {
      const result = await indexRepo({
        repo_url: repoUrl.trim(),
        collection_name: collectionName.trim(),
      });
      setStatus("idle");
      setLastResult(
        `Indexed ${result.files_indexed} files into ${result.chunks_created} chunks.`
      );
      onIndexed(result.collection_name);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Indexing failed.");
    }
  }

  const isLoading = status === "loading";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-panel border border-line rounded-lg p-4 flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="repo-url" className="font-mono text-xs text-muted">
          Repository URL
        </label>
        <input
          id="repo-url"
          type="text"
          required
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          placeholder="https://github.com/owner/repo"
          className="bg-ink border border-line rounded px-3 py-2 font-mono text-sm
                     focus-visible:border-amber outline-none"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="collection-name" className="font-mono text-xs text-muted">
          Collection name
        </label>
        <input
          id="collection-name"
          type="text"
          required
          value={collectionName}
          onChange={(e) => setCollectionName(e.target.value)}
          placeholder="e.g. my-repo"
          className="bg-ink border border-line rounded px-3 py-2 font-mono text-sm
                     focus-visible:border-amber outline-none"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="self-start bg-amber text-ink font-mono text-sm font-semibold
                   px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Indexing..." : "Index repository"}
      </button>

      {errorMessage && (
        <p className="text-sm text-red-400 font-mono">{errorMessage}</p>
      )}

      {lastResult && !errorMessage && (
        <p className="text-sm text-teal font-mono">{lastResult}</p>
      )}
    </form>
  );
}