'use client';

import { useEffect, useMemo, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { useCurrentEngine } from '@/components/EngineSelect';
import ChatMessage, { RobotLogo } from '@/components/chat/ChatMessage';
import { Persona } from '@/components/ai-elements/persona';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { normalizeAssistantDisplay } from '@/lib/chat/actions';

function hasOwnKey<T extends object>(value: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeSessionId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  rawContent?: string;
  costUsd?: number;
  durationMs?: number;
  usage?: { input_tokens: number; output_tokens: number };
  engine?: string;
  model?: string;
  timestamp: number;
}

export default function ChatModal() {
  const { isOpen, toggleChat, closeChat, model: ctxModel, effectiveEngine: ctxEffectiveEngine } = useChat();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [engine, setEngine] = useState('');
  const effectiveEngine = useCurrentEngine(engine);

  useEffect(() => {
    if (!model && ctxModel) setModel(ctxModel);
  }, [ctxModel, model]);

  useEffect(() => {
    if (!engine && ctxEffectiveEngine) setEngine(ctxEffectiveEngine);
  }, [ctxEffectiveEngine, engine]);
  const makeMessageId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setMessages(prev => [...prev, {
      id: makeMessageId(),
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, model, engine: effectiveEngine, sessionId }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setMessages(prev => [...prev, {
          id: makeMessageId(),
          role: 'error',
          content: data.error || `HTTP ${res.status}`,
          timestamp: Date.now(),
        }]);
      } else {
        if (hasOwnKey(data, 'sessionId')) setSessionId(normalizeSessionId(data.sessionId));
        setMessages(prev => [...prev, {
          id: makeMessageId(),
          role: 'assistant',
          content: data.result,
          rawContent: data.result,
          costUsd: data.costUsd, durationMs: data.durationMs, usage: data.usage,
          engine: effectiveEngine,
          model,
          timestamp: Date.now(),
        }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, {
        id: makeMessageId(),
        role: 'error',
        content: err.message || '请求失败',
        timestamp: Date.now(),
      }]);
    }
    setLoading(false);
  };

  const handleSubmit = (message: PromptInputMessage) => {
    send(message.text);
  };

  const clearChat = () => { setMessages([]); setSessionId(null); };

  const renderedMessages = useMemo(() => (
    messages.map((msg) => {
      let displayMessage = msg;
      if (msg.role === 'assistant') {
        const raw = msg.rawContent || msg.content || '';
        const normalized = normalizeAssistantDisplay(raw, false);
        if (normalized.hasMachineResult) {
          displayMessage = { ...msg, content: normalized.visibleText };
        }
      }
      return (
        <div key={msg.id} className="pb-4">
          <ChatMessage
            message={displayMessage}
            isStreaming={false}
            onConfirmAction={() => {}}
            onRejectAction={() => {}}
            onUndoAction={() => {}}
            onRetryAction={() => {}}
          />
        </div>
      );
    })
  ), [messages]);

  return (
    <>
      {!isOpen && (
        <div className="fixed bottom-6 right-0 z-50 translate-x-[calc(100%-22px)] transition-transform duration-200 hover:translate-x-0 focus-within:translate-x-0">
          <div className="relative flex items-center pl-4">
            <div className="pointer-events-none absolute left-0 top-1/2 flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-l-full border border-r-0 border-border/70 bg-background/94 text-muted-foreground shadow-sm backdrop-blur">
              <span className="material-symbols-outlined text-[14px]">bolt</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-14 w-14 rounded-full p-0 shadow-lg hover:bg-transparent"
              onClick={toggleChat}
              title="ACEHarness 在线"
            >
              <Persona
                state="idle"
                variant="obsidian"
                className="h-14 w-14 rounded-full"
              />
            </Button>
          </div>
        </div>
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

          <Conversation className="flex-1">
            <ConversationContent className="gap-3 p-4">
              {messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <RobotLogo size={48} className="mb-2 opacity-50" />
                  <span className="text-sm">输入消息开始对话</span>
                </div>
              )}
              {renderedMessages}
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RobotLogo size={24} />
                  <Shimmer as="span" className="text-sm">思考中...</Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="flex-shrink-0 px-4 pb-4 pt-3">
            <PromptInput
              onSubmit={handleSubmit}
              disabled={loading}
              className="rounded-xl border-border/70 bg-background shadow-sm"
            >
              <PromptInputTextarea placeholder="输入消息... (Enter 发送)" />
              <PromptInputFooter className="justify-end">
                <PromptInputSubmit />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      )}
    </>
  );
}
