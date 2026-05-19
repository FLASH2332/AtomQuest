'use client';

import { useChat } from '@ai-sdk/react';
import { useEffect, useRef, useState } from 'react';

function BotIcon({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" className="text-indigo-400">
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2.5" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2.5" transform="rotate(60 18 18)" />
      <ellipse cx="18" cy="18" rx="16" ry="7" stroke="currentColor" strokeWidth="2.5" transform="rotate(120 18 18)" />
      <circle cx="18" cy="18" r="3" fill="currentColor" />
    </svg>
  );
}

function UserIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export default function AdminChatbotPage() {
  const chatHook = useChat({ api: '/api/chat' });
  console.log('useChat exports:', Object.keys(chatHook));
  const { messages, sendMessage, status } = useChat({
    api: '/api/chat',
  });

  const [input, setInput] = useState('');
  const isLoading = status === 'submitted' || status === 'streaming';
  const chatContainerRef = useRef(null);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!input?.trim()) return;
    sendMessage({ role: 'user', content: input });
    setInput('');
  }

  const suggestions = [
    'How are scores computed?',
    'Show active goal cycles',
    'List all employee profiles',
    'How to approve a sheet?',
  ];

  return (
    <main className="max-w-4xl mx-auto px-4 py-8 text-slate-100 flex flex-col h-[calc(100vh-5rem)]">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-5 mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-800/60 border border-slate-700/50 rounded-xl">
            <BotIcon />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight text-white flex items-center gap-2">
              AtomQuest Assistant
              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-wide">
                MCP Powered
              </span>
            </h1>
            <p className="text-slate-400 text-xs mt-0.5">
              Live database tools via Supabase MCP · Powered by Groq
            </p>
          </div>
        </div>
      </div>

      {/* Message Feed */}
      <div
        ref={chatContainerRef}
        className="flex-1 bg-slate-800/30 border border-slate-700/50 rounded-2xl p-4 sm:p-6 overflow-y-auto backdrop-blur-md flex flex-col gap-5"
      >
        {messages.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="p-4 bg-slate-800/80 border border-slate-700/50 rounded-full text-indigo-400 mb-5">
              <BotIcon size={40} />
            </div>
            <h3 className="text-lg font-bold text-white mb-2">Hello, I am the AtomQuest Assistant!</h3>
            <p className="text-slate-400 text-sm max-w-md mb-8">
              I can answer questions about the portal, navigate you through workflows, and query live database data. Try a suggestion below.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl w-full">
              {suggestions.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setInput(s)}
                  className="px-4 py-3 bg-slate-800/50 hover:bg-slate-700/40 text-slate-300 hover:text-white border border-slate-700/40 hover:border-indigo-500/30 rounded-xl text-xs font-semibold transition text-left"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isUser = m.role === 'user';
            const text = m.parts
              ? m.parts.filter(p => p.type === 'text').map(p => p.text).join('')
              : m.content;
            return (
              <div
                key={m.id}
                className={`flex gap-3 max-w-[85%] ${isUser ? 'self-end flex-row-reverse' : 'self-start'}`}
              >
                <div className={`h-8 w-8 shrink-0 rounded-xl flex items-center justify-center border ${
                  isUser
                    ? 'bg-indigo-600 border-indigo-500 text-white'
                    : 'bg-slate-800 border-slate-700/60 text-indigo-400'
                }`}>
                  {isUser ? <UserIcon size={14} /> : <BotIcon size={18} />}
                </div>
                <div className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed border whitespace-pre-wrap ${
                  isUser
                    ? 'bg-indigo-600/80 border-indigo-500/50 text-white rounded-tr-none'
                    : 'bg-slate-800/80 border-slate-700/50 text-slate-100 rounded-tl-none'
                }`}>
                  {text}
                </div>
              </div>
            );
          })
        )}

        {/* Typing indicator */}
        {isLoading && (
          <div className="flex gap-3 max-w-[80%] self-start">
            <div className="h-8 w-8 shrink-0 rounded-xl flex items-center justify-center border bg-slate-800 border-slate-700/60 text-indigo-400">
              <BotIcon size={18} />
            </div>
            <div className="rounded-2xl rounded-tl-none px-4 py-3 bg-slate-800/80 border border-slate-700/50 flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '0ms' }} />
              <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="h-2 w-2 rounded-full bg-indigo-400 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex gap-2.5 mt-4">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about goals, cycles, profiles, or how to navigate..."
          className="flex-1 px-4 py-3 bg-slate-800/60 border border-slate-700/50 focus:border-indigo-500 rounded-xl text-sm text-slate-100 placeholder-slate-500 outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="px-5 py-3 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:opacity-40 text-white font-bold text-sm rounded-xl transition flex items-center gap-2"
        >
          <span>Send</span>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
      </form>
    </main>
  );
}