'use client';

import { useState, useRef, useEffect } from 'react';
import { useChatStore, useBentoStore } from '@/stores';
import { AgentoStatus } from './agento-status';
import { ArrowUp, Bot, User, MoreHorizontal } from 'lucide-react';

interface AgentoChatProps {
  bentoId: string;
}

export function AgentoChat({ bentoId }: AgentoChatProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const messages = useChatStore((s) => s.getMessages(bentoId));
  const addMessage = useChatStore((s) => s.addMessage);
  const bento = useBentoStore((s) => s.getBento(bentoId));

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    addMessage(bentoId, {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      ts: new Date().toISOString(),
    });

    setInput('');

    // Simulate Agento response after a short delay
    setTimeout(() => {
      addMessage(bentoId, {
        id: `msg-${Date.now()}`,
        role: 'agento',
        content: 'I received your message. Working on it...',
        ts: new Date().toISOString(),
      });
    }, 1000);
  };

  const formatTime = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div
      className="w-[280px] bg-[#2b303b] flex flex-col h-screen"
      style={{
        boxShadow: '4px 0 20px rgba(0,0,0,0.3)',
      }}
    >
      {/* Header */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-xl font-bold text-[#c0c5ce]">AGENTO</h2>
          <button className="p-2 hover:bg-[#363c4a] rounded-full transition-colors">
            <MoreHorizontal className="w-5 h-5 text-[#65737e]" />
          </button>
        </div>
        <AgentoStatus online={bento?.agentoOnline ?? false} />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 space-y-3">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 bg-[#4f5b66] rounded-full flex items-center justify-center mb-3">
              <Bot className="w-6 h-6 text-[#8fa1b3]" />
            </div>
            <p className="text-[#65737e] text-sm">
              Start a conversation with Agento to orchestrate your agents.
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id}>
              <div className="flex gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    msg.role === 'agento' ? 'bg-[#8fa1b3]' : 'bg-[#e59758]'
                  }`}
                >
                  {msg.role === 'agento' ? (
                    <Bot className="w-4 h-4 text-[#2b303b]" />
                  ) : (
                    <User className="w-4 h-4 text-[#2b303b]" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div
                    className={`rounded-2xl rounded-tl-sm p-3 ${
                      msg.role === 'agento'
                        ? 'bg-[#333944] text-[#c0c5ce]'
                        : 'bg-[#4f5b66] text-[#c0c5ce]'
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap break-words">{msg.content}</p>
                  </div>
                </div>
              </div>
              <span className="text-xs text-[#65737e] mt-1 ml-10 block">
                {formatTime(msg.ts)}
              </span>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 bg-transparent rounded-full px-4 py-2 border border-[#4f5b66]">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Message Agento..."
            className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-[#65737e]"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-8 h-8 rounded-full bg-[#e59758] flex items-center justify-center hover:opacity-80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <ArrowUp className="w-4 h-4 text-[#2b303b]" />
          </button>
        </form>
      </div>
    </div>
  );
}
