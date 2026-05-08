'use client';

import { useState, useRef, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import Markdown from '@/components/Markdown';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { useCurrentEngine } from '@/components/EngineSelect';
import { RobotLogo } from '@/components/chat/ChatMessage';
import dynamic from 'next/dynamic';
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });

interface Message {
  role: 'user' | 'assistant' | 'error';
  content: string;
  costUsd?: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
}

export default function ChatModal() {
  const { isOpen, toggleChat, closeChat } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [engine, setEngine] = useState('');
  const effectiveEngine = useCurrentEngine(engine);
  const prevEngineRef = useRef(effectiveEngine);

  // Reset session when engine changes (session is tied to engine)
  useEffect(() => {
    if (prevEngineRef.current && prevEngineRef.current !== effectiveEngine) {
      setSessionId(null);
    }
    prevEngineRef.current = effectiveEngine;
  }, [effectiveEngine]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const editorRef = useRef<RichTextEditorHandle>(null);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      autoScrollLockedRef.current = !nearBottom;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (!autoScrollLockedRef.current) {
      isProgrammaticScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      setTimeout(() => { isProgrammaticScrollRef.current = false; }, 500);
    }
  }, [messages, loading]);

  useEffect(() => {
    if (isOpen) setTimeout(() => editorRef.current?.focus(), 100);
  }, [isOpen]);

  const send = async (textToSend?: string) => {
    const text = textToSend?.trim() || editorRef.current?.getMarkdown().trim() || input.trim();
    if (!text || loading) return;
    autoScrollLockedRef.current = false;
    setInput('');
    editorRef.current?.clear();
    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, model, engine: effectiveEngine, sessionId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessages(prev => [...prev, { role: 'error', content: data.error || `HTTP ${res.status}` }]);
      } else {
        if (data.sessionId) setSessionId(data.sessionId);
        setMessages(prev => [...prev, {
          role: 'assistant', content: data.result,
          costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
        }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'error', content: err.message || '请求失败' }]);
    }
    setLoading(false);
    editorRef.current?.focus();
  };

  const handleEditorEnter = (text: string) => {
    send(text);
  };

  const clearChat = () => { setMessages([]); setSessionId(null); };

  return (
    <>
      {!isOpen && (
        <Button
          className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg z-50"
          onClick={toggleChat}
          title="ACEHarness 在线"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>chat</span>
        </Button>
      )}

      {isOpen && (
        <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-background border rounded-lg shadow-2xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted flex-shrink-0">
            <span className="font-semibold text-sm">ACEHarness 在线</span>
            <div className="flex items-center gap-2">
              <div className="w-44">
                <EngineModelSelect
                  engine={engine}
                  model={model}
                  onEngineChange={setEngine}
                  onModelChange={setModel}
                  className="h-7 text-xs"
                />
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearChat} title="清空对话">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_sweep</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={closeChat} title="关闭">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
              </Button>
            </div>
          </div>

          <div ref={scrollContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <RobotLogo size={48} className="mb-2 opacity-50" />
                <span className="text-sm">输入消息开始对话</span>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`text-sm rounded-lg px-3 py-2 max-w-[85%] ${
                msg.role === 'user' ? 'ml-auto bg-primary text-primary-foreground whitespace-pre-wrap' :
                msg.role === 'error' ? 'bg-destructive/10 text-destructive whitespace-pre-wrap' :
                'bg-muted'
              }`}>
                {msg.role === 'assistant' ? (
                  <div className="prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:text-foreground [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_h1]:text-base [&_h2]:text-sm [&_h3]:text-sm [&_blockquote]:border-l-2 [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_table]:text-xs [&_img]:my-2 [&_img]:max-h-56 [&_img]:max-w-[280px] [&_img]:rounded-md [&_img]:border [&_img]:border-border [&_img]:object-contain">
                    <Markdown>{msg.content}</Markdown>
                  </div>
                ) : msg.content}
                {msg.role === 'assistant' && (msg.usage || msg.costUsd !== undefined) && (
                  <div className="text-xs text-muted-foreground mt-1 opacity-70">
                    {msg.usage && `${msg.usage.input_tokens}↓ ${msg.usage.output_tokens}↑`}
                    {msg.costUsd !== undefined && ` · $${msg.costUsd.toFixed(4)}`}
                    {msg.durationMs !== undefined && ` · ${(msg.durationMs / 1000).toFixed(1)}s`}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <RobotLogo size={24} className="animate-robotPulse" />
                <span className="text-sm">思考中</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex items-end gap-2 p-3 border-t flex-shrink-0">
            <div className="flex-1">
              <RichTextEditor
                ref={editorRef}
                onEnter={handleEditorEnter}
                onChange={(markdown) => setInput(markdown)}
                placeholder="输入消息... (Enter 发送)"
                minHeight={36}
                maxHeight={120}
                disabled={loading}
                showToolbar={false}
              />
            </div>
            <Button size="sm" onClick={() => send()} disabled={loading || !((editorRef.current?.getMarkdown().trim()) || input.trim())}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>send</span>
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
