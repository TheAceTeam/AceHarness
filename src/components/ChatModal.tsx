'use client';

import { useState, useEffect } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import Markdown from '@/components/Markdown';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { useCurrentEngine } from '@/components/EngineSelect';
import { RobotLogo } from '@/components/chat/ChatMessage';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Message as AIMessage, MessageContent as AIMessageContent } from '@/components/ai-elements/message';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';

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
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [engine, setEngine] = useState('');
  const effectiveEngine = useCurrentEngine(engine);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setMessages(prev => [...prev, { role: 'user', content: trimmed }]);
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed, model, engine: effectiveEngine, sessionId }),
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
  };

  const handleSubmit = (message: PromptInputMessage) => {
    send(message.text);
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

          <Conversation className="flex-1">
            <ConversationContent className="gap-3 p-4">
              {messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <RobotLogo size={48} className="mb-2 opacity-50" />
                  <span className="text-sm">输入消息开始对话</span>
                </div>
              )}
              {messages.map((msg, i) => (
                msg.role === 'error' ? (
                  <div key={i} className="text-sm rounded-lg px-3 py-2 max-w-[85%] bg-destructive/10 text-destructive whitespace-pre-wrap">
                    {msg.content}
                  </div>
                ) : (
                  <AIMessage key={i} from={msg.role as 'user' | 'assistant'}>
                    <AIMessageContent className={msg.role === 'user' ? 'rounded-lg bg-primary text-primary-foreground px-3 py-2 whitespace-pre-wrap' : 'bg-muted rounded-lg px-3 py-2'}>
                      {msg.role === 'assistant' ? (
                        <div className="prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:text-foreground [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
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
                    </AIMessageContent>
                  </AIMessage>
                )
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RobotLogo size={24} />
                  <Shimmer as="span" className="text-sm">思考中...</Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="border-t flex-shrink-0">
            <PromptInput onSubmit={handleSubmit} disabled={loading}>
              <PromptInputTextarea placeholder="输入消息... (Enter 发送)" />
              <PromptInputFooter>
                <PromptInputSubmit />
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      )}
    </>
  );
}
