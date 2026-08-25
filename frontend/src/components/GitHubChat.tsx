import React, { useState, useEffect, useRef, FormEvent, KeyboardEvent, ChangeEvent } from 'react';

// ==========================================
// TYPES & INTERFACES
// ==========================================

interface RepoData {
  name: string;
  owner: string;
  description: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  isStreaming: boolean;
}

// ==========================================
// GITHUBCHAT - Single File React Component (TSX)
// ==========================================

export default function GithubChat(): JSX.Element {
  // -- Core State --
  const [repoUrl, setRepoUrl] = useState<string>('');
  const [repoSet, setRepoSet] = useState<boolean>(false);
  const [repoData, setRepoData] = useState<RepoData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);

  // -- Refs --
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const streamingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // -- Auto Scroll to Bottom --
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // -- Auto-resize Textarea --
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 160)}px`;
    }
  }, [input]);

  // -- Cleanup streaming on unmount --
  useEffect(() => {
    return () => {
      if (streamingIntervalRef.current) clearInterval(streamingIntervalRef.current);
    };
  }, []);

  // ==========================================
  // REPO SUBMISSION
  // ==========================================
  const handleRepoSubmit = (e?: FormEvent<HTMLFormElement>): void => {
    e?.preventDefault();
    if (!repoUrl.trim() || !repoUrl.includes('github.com')) return;

    // TODO: Add your API integration here
    // Fetch repo metadata, index the codebase, etc.
    // const res = await fetch('/api/repo/analyze', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ url: repoUrl })
    // });
    // const data = await res.json();

    // Mock metadata for UI demonstration
    const parts: string[] = repoUrl.replace('https://github.com/', '').split('/');
    const owner: string = parts[0] || 'owner';
    const name: string = parts[1] || 'repository';

    setRepoData({
      name,
      owner,
      description: 'Ready for conversation',
    });

    setRepoSet(true);
    setMessages([
      {
        id: 'welcome',
        role: 'assistant',
        content: `Repository connected. I've indexed **${name}**. Ask me about the architecture, specific files, or how to contribute.`,
        isStreaming: false,
      },
    ]);
  };

  // ==========================================
  // STREAMING ANIMATION ENGINE
  // ==========================================
  const streamMessage = (messageId: string, fullText: string): void => {
    let currentIndex: number = 0;
    const speed: number = 10; // ms per character (tweak for faster/slower streaming)

    streamingIntervalRef.current = setInterval(() => {
      currentIndex++;

      setMessages((prev: Message[]) =>
        prev.map((msg: Message) => {
          if (msg.id !== messageId) return msg;
          return { ...msg, content: fullText.slice(0, currentIndex) };
        })
      );

      if (currentIndex >= fullText.length) {
        if (streamingIntervalRef.current) clearInterval(streamingIntervalRef.current);
        streamingIntervalRef.current = null;
        setMessages((prev: Message[]) =>
          prev.map((msg: Message) =>
            msg.id === messageId ? { ...msg, isStreaming: false } : msg
          )
        );
      }
    }, speed);
  };

  // ==========================================
  // SEND MESSAGE
  // ==========================================
  const handleSend = (): void => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim(),
      isStreaming: false,
    };

    setMessages((prev: Message[]) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    if (inputRef.current) inputRef.current.style.height = 'auto';

    // TODO: Add your API integration here
    // Replace this setTimeout with your actual fetch/streaming logic.
    // If your API returns a stream, feed chunks into streamMessage().
    setTimeout(() => {
      const botMessageId: string = (Date.now() + 1).toString();

      const responseText: string = `Here's an analysis of the repository structure:

The project follows a **modular architecture** with clear separation of concerns. Here is a sample of how the core logic is organized:

\`\`\`typescript
// Core service pattern used throughout
export async function analyzeRepository(
  url: string,
  options: AnalysisOptions
) {
  const indexer = new CodeIndexer();
  
  await indexer.clone(url);
  const graph = await indexer.buildDependencyGraph();
  
  return {
    modules: graph.getModules(),
    complexity: graph.calculateComplexity(),
    entryPoints: graph.findEntryPoints()
  };
}
\`\`\`

Key findings:
• **Entry point**: \`src/index.ts\` — clean bootstrap logic
• **Testing**: Jest configuration found with 85% coverage
• **Dependencies**: Mostly stable, 2 minor vulnerabilities detected in dev-deps

Would you like me to explain a specific module or generate a contribution guide?`;

      setMessages((prev: Message[]) => [
        ...prev,
        {
          id: botMessageId,
          role: 'assistant',
          content: '',
          isStreaming: true,
        },
      ]);

      setIsLoading(false);
      streamMessage(botMessageId, responseText);
    }, 1200);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ==========================================
  // MARKDOWN RENDERER (Lightweight)
  // ==========================================
  const renderContent = (text: string): JSX.Element | JSX.Element[] => {
    if (!text) return <span className="text-slate-500 italic">Thinking...</span>;

    const segments: string[] = text.split(/(```[\s\S]*?```)/g);

    return segments.map((segment: string, idx: number) => {
      // Code blocks
      if (segment.startsWith('```')) {
        const match: RegExpMatchArray | null = segment.match(/```(\w+)?\n?([\s\S]*?)```/);
        const language: string = match?.[1] || '';
        const code: string = match?.[2] || segment.replace(/```/g, '');

        return (
          <div
            key={idx}
            className="my-4 rounded-xl overflow-hidden bg-slate-950 border border-slate-800 group"
          >
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
              <span className="text-xs font-mono text-slate-500 uppercase tracking-wider">
                {language || 'code'}
              </span>
              <button
                onClick={() => navigator.clipboard?.writeText(code)}
                className="text-xs text-slate-500 hover:text-emerald-400 transition-colors font-medium"
              >
                Copy
              </button>
            </div>
            <pre className="p-4 overflow-x-auto">
              <code className="text-sm font-mono text-emerald-300 leading-relaxed">
                {code}
              </code>
            </pre>
          </div>
        );
      }

      // Inline formatting: bold, italic, inline code
      const parts: string[] = segment.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g);
      return (
        <span key={idx}>
          {parts.map((part: string, pIdx: number) => {
            if (part.startsWith('`') && part.endsWith('`')) {
              return (
                <code
                  key={pIdx}
                  className="px-1.5 py-0.5 rounded-md bg-slate-800 text-emerald-200 text-sm font-mono border border-slate-700"
                >
                  {part.slice(1, -1)}
                </code>
              );
            }
            if (part.startsWith('**') && part.endsWith('**')) {
              return (
                <strong key={pIdx} className="text-white font-semibold">
                  {part.slice(2, -2)}
                </strong>
              );
            }
            if (part.startsWith('*') && part.endsWith('*')) {
              return (
                <em key={pIdx} className="text-slate-300">
                  {part.slice(1, -1)}
                </em>
              );
            }
            return (
              <span key={pIdx} className="whitespace-pre-wrap">
                {part}
              </span>
            );
          })}
        </span>
      );
    });
  };

  // ==========================================
  // ICONS (Inline SVGs — no extra deps)
  // ==========================================
  const GitBranchIcon = ({ className = 'w-5 h-5' }: { className?: string }): JSX.Element => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="6" y1="3" x2="6" y2="15"></line>
      <circle cx="18" cy="6" r="3"></circle>
      <circle cx="6" cy="18" r="3"></circle>
      <path d="M18 9a9 9 0 0 1-9 9"></path>
    </svg>
  );

  const SendIcon = ({ className = 'w-4 h-4' }: { className?: string }): JSX.Element => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"></line>
      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
    </svg>
  );

  const BotIcon = ({ className = 'w-5 h-5' }: { className?: string }): JSX.Element => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="10" rx="2"></rect>
      <circle cx="12" cy="5" r="2"></circle>
      <path d="M12 7v4"></path>
      <line x1="8" y1="16" x2="8" y2="16"></line>
      <line x1="16" y1="16" x2="16" y2="16"></line>
    </svg>
  );

  const UserIcon = ({ className = 'w-5 h-5' }: { className?: string }): JSX.Element => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
      <circle cx="12" cy="7" r="4"></circle>
    </svg>
  );

  const SparklesIcon = ({ className = 'w-4 h-4' }: { className?: string }): JSX.Element => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
    </svg>
  );

  const examplePrompts: string[] = [
    'Explain the project architecture',
    'How do I run this locally?',
    'Find potential bugs',
    'Summarize the main modules',
  ];

  const quickRepos: string[] = ['facebook/react', 'vercel/next.js', 'microsoft/vscode'];

  // ==========================================
  // VIEW: LANDING PAGE
  // ==========================================
  if (!repoSet) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center relative overflow-hidden selection:bg-emerald-500/30">
        {/* Ambient Background */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(16,185,129,0.12),transparent)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808008_1px,transparent_1px),linear-gradient(to_bottom,#80808008_1px,transparent_1px)] bg-[size:32px_32px]" />

        <div className="relative z-10 w-full max-w-xl px-6">
          {/* Logo */}
          <div className="flex justify-center mb-10">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shadow-2xl shadow-emerald-500/20 ring-1 ring-white/10">
              <GitBranchIcon className="w-8 h-8 text-white" />
            </div>
          </div>

          {/* Headline */}
          <div className="text-center mb-10">
            <h1 className="text-5xl font-bold tracking-tight bg-gradient-to-b from-white via-white to-slate-500 bg-clip-text text-transparent">
              GithubChat
            </h1>
            <p className="mt-4 text-lg text-slate-400 font-light">
              Understand any codebase through conversation
            </p>
          </div>

          {/* Repo Input */}
          <form onSubmit={handleRepoSubmit} className="relative group">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-blue-600 rounded-2xl opacity-20 group-hover:opacity-40 transition duration-500 blur" />
            <div className="relative bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-2xl p-2 flex items-center gap-3 shadow-2xl">
              <div className="pl-4 text-slate-500">
                <GitBranchIcon />
              </div>
              <input
                type="text"
                value={repoUrl}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setRepoUrl(e.target.value)}
                placeholder="https://github.com/owner/repository"
                className="flex-1 bg-transparent text-white placeholder-slate-600 focus:outline-none py-3 text-[15px]"
              />
              <button
                type="submit"
                disabled={!repoUrl.includes('github.com')}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 text-white rounded-xl font-medium transition-all flex items-center gap-2 text-sm"
              >
                <SparklesIcon />
                Analyze
              </button>
            </div>
          </form>

          {/* Quick Select */}
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {quickRepos.map((repo: string) => (
              <button
                key={repo}
                onClick={() => {
                  setRepoUrl(`https://github.com/${repo}`);
                  setTimeout(() => handleRepoSubmit(), 50);
                }}
                className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
              >
                {repo}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // VIEW: CHAT INTERFACE
  // ==========================================
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col selection:bg-emerald-500/30">
      {/* Top Navigation */}
      <header className="h-16 border-b border-white/5 bg-slate-950/80 backdrop-blur-xl fixed top-0 w-full z-50">
        <div className="max-w-5xl mx-auto h-full flex items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center ring-1 ring-white/10">
              <GitBranchIcon className="w-4 h-4 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="font-semibold text-white text-sm tracking-tight">GithubChat</h1>
              <p className="text-xs text-slate-500 truncate max-w-[240px] font-mono">
                {repoData?.owner}/{repoData?.name}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Badge */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-emerald-400 font-medium">Indexed</span>
            </div>

            <button
              onClick={() => {
                setRepoSet(false);
                setMessages([]);
                setRepoData(null);
                setInput('');
              }}
              className="text-sm text-slate-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
            >
              New Repo
            </button>
          </div>
        </div>
      </header>

      {/* Chat Messages */}
      <main className="flex-1 overflow-y-auto pt-24 pb-48 px-4">
        <div className="max-w-3xl mx-auto space-y-8">
          {messages.map((message: Message) => (
            <div
              key={message.id}
              className={`flex gap-4 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {/* Assistant Avatar */}
              {message.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-slate-900 border border-white/10 flex items-center justify-center flex-shrink-0 mt-1 shadow-sm">
                  <BotIcon className="w-4 h-4 text-emerald-400" />
                </div>
              )}

              {/* Message Content */}
              <div
                className={`max-w-[88%] sm:max-w-[80%] ${
                  message.role === 'user'
                    ? 'bg-emerald-600/10 border border-emerald-500/20 rounded-2xl rounded-tr-sm'
                    : 'bg-slate-900/60 border border-white/5 rounded-2xl rounded-tl-sm backdrop-blur-sm'
                } px-5 py-4 shadow-sm`}
              >
                <div
                  className={`text-[15px] leading-7 ${
                    message.role === 'user' ? 'text-emerald-50' : 'text-slate-300'
                  }`}
                >
                  {renderContent(message.content)}

                  {/* Streaming Cursor */}
                  {message.isStreaming && (
                    <span className="inline-block w-2 h-4 bg-emerald-400 ml-1 animate-pulse align-middle rounded-sm" />
                  )}
                </div>
              </div>

              {/* User Avatar */}
              {message.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 mt-1">
                  <UserIcon className="w-4 h-4 text-emerald-400" />
                </div>
              )}
            </div>
          ))}

          {/* Loading Skeleton */}
          {isLoading && (
            <div className="flex gap-4">
              <div className="w-8 h-8 rounded-lg bg-slate-900 border border-white/10 flex items-center justify-center flex-shrink-0">
                <BotIcon className="w-4 h-4 text-emerald-400" />
              </div>
              <div className="bg-slate-900/60 border border-white/5 rounded-2xl rounded-tl-sm px-5 py-4">
                <div className="flex gap-1.5 items-center h-6">
                  <div className="w-2 h-2 rounded-full bg-slate-600 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <div className="w-2 h-2 rounded-full bg-slate-600 animate-bounce" style={{ animationDelay: '120ms' }} />
                  <div className="w-2 h-2 rounded-full bg-slate-600 animate-bounce" style={{ animationDelay: '240ms' }} />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950 via-slate-950 to-transparent pt-16 pb-8 px-4 z-40">
        <div className="max-w-3xl mx-auto">
          {/* Suggestion Chips */}
          {messages.length <= 1 && (
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {examplePrompts.map((prompt: string) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setInput(prompt);
                    inputRef.current?.focus();
                  }}
                  className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-sm text-slate-400 hover:text-white hover:bg-white/10 hover:border-white/20 transition-all"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}

          <div className="relative bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 focus-within:border-emerald-500/30 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this repository..."
              rows={1}
              className="w-full bg-transparent text-white placeholder-slate-600 focus:outline-none px-5 py-4 pr-14 resize-none max-h-40 text-[15px] leading-relaxed"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-3 bottom-3 p-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-emerald-600 text-white rounded-xl transition-all shadow-lg shadow-emerald-900/20"
            >
              <SendIcon />
            </button>
          </div>

          <p className="text-center text-xs text-slate-700 mt-3">
            GithubChat can make mistakes. Always verify critical information against the source code.
          </p>
        </div>
      </div>
    </div>
  );
}