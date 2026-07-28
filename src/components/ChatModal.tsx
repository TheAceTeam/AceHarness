'use client';

import { useEffect, useMemo, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import { Button } from '@/components/ui/button';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { useCurrentEngine } from '@/components/EngineSelect';
import ChatMessage from '@/components/chat/ChatMessage';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation';
import { PromptInput, PromptInputTextarea, PromptInputFooter, PromptInputSubmit } from '@/components/ai-elements/prompt-input';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { normalizeAssistantDisplay } from '@/lib/chat/actions';
import { resolveChatRuntimeDisplay } from '@/lib/chat/runtime-session-display';
import { cn } from '@/lib/core/utils';

interface AuthViewer {
  username: string;
  email?: string;
  role?: 'admin' | 'user';
  avatar?: string;
}

function hasOwnKey<T extends object>(value: T | null | undefined, key: PropertyKey): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, key));
}

function normalizeSessionId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function makeMessageId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createWelcomeMessage(): Message {
  return {
    id: makeMessageId(),
    role: 'assistant',
    content: '你好，请问有什么能够帮忙的',
    rawContent: '你好，请问有什么能够帮忙的',
    timestamp: Date.now(),
  };
}

function createInitialMessages(): Message[] {
  return [createWelcomeMessage()];
}

function readStoredAuthUser(): AuthViewer | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem('auth-user');
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (parsed?.username) {
      return parsed as AuthViewer;
    }
  } catch {}
  return null;
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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
  const { isOpen, toggleChat, closeChat, model: ctxModel, isModelSelectionReady } = useChat();
  const [messages, setMessages] = useState<Message[]>(createInitialMessages);
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [engine, setEngine] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [draft, setDraft] = useState('');
  const [currentUser, setCurrentUser] = useState<AuthViewer | null>(() => readStoredAuthUser());
  const effectiveEngine = useCurrentEngine(engine);
  const effectiveModel = model || ctxModel;
  const isComposerReady = isModelSelectionReady && Boolean(effectiveModel && effectiveEngine);
  const runtimeDisplay = useMemo(() => resolveChatRuntimeDisplay({
    engine: effectiveEngine,
    model: effectiveModel,
    isStreaming: loading,
    hasError: messages.some((message) => message.role === 'error'),
  }), [effectiveEngine, effectiveModel, loading, messages]);

  useEffect(() => {
    if (!isOpen) return;
    setCurrentUser(readStoredAuthUser());
  }, [isOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncCurrentUser = () => setCurrentUser(readStoredAuthUser());
    window.addEventListener('storage', syncCurrentUser);
    window.addEventListener('focus', syncCurrentUser);
    return () => {
      window.removeEventListener('storage', syncCurrentUser);
      window.removeEventListener('focus', syncCurrentUser);
    };
  }, []);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || !isComposerReady) return;
    setDraft('');
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
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ message: trimmed, model: effectiveModel, engine: effectiveEngine, sessionId }),
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
          model: effectiveModel,
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

  const handleTextareaKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || !event.shiftKey) return;
    event.preventDefault();
    if (loading || !draft.trim()) return;
    event.currentTarget.form?.requestSubmit();
  };

  const clearChat = () => {
    setMessages(createInitialMessages());
    setSessionId(null);
    setDraft('');
  };
  const handleClose = () => {
    setIsFullscreen(false);
    closeChat();
  };

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
            currentUser={currentUser ? { username: currentUser.username, avatar: currentUser.avatar } : null}
          />
        </div>
      );
    })
  ), [currentUser, messages]);

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
              className="h-14 w-14 rounded-full border border-border/60 bg-background/94 p-0 shadow-lg backdrop-blur hover:bg-background"
              onClick={toggleChat}
              title="轻聊"
            >
              <span className="chat-modal-rainbow" aria-hidden="true">
                <span className="chat-modal-rainbow__curve chat-modal-rainbow__curve--green" />
                <span className="chat-modal-rainbow__curve chat-modal-rainbow__curve--pink" />
                <span className="chat-modal-rainbow__curve chat-modal-rainbow__curve--blue" />
              </span>
            </Button>
          </div>
        </div>
      )}

      {isOpen && (
        <div
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden border bg-background shadow-2xl transition-all duration-200',
            isFullscreen
              ? 'inset-4 rounded-2xl md:inset-6'
              : 'bottom-6 right-6 h-[600px] w-96 rounded-lg'
          )}
        >
          <div className="flex items-center justify-between border-b bg-muted px-4 py-3 flex-shrink-0">
            <div className="min-w-0">
              <span className="block text-sm font-semibold">轻聊</span>
              <span className="block truncate text-[11px] text-muted-foreground">
                {runtimeDisplay.status === 'idle' ? runtimeDisplay.routeLabel : `${runtimeDisplay.routeLabel} · ${runtimeDisplay.statusLabel}`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => setIsFullscreen((prev) => !prev)}
                title={isFullscreen ? '退出全屏' : '全屏'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>
                  {isFullscreen ? 'close_fullscreen' : 'open_in_full'}
                </span>
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={clearChat} title="清空对话">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete_sweep</span>
              </Button>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose} title="关闭">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
              </Button>
            </div>
          </div>

          <Conversation className="flex-1">
            <ConversationContent className="gap-3 p-4">
              {renderedMessages}
              {loading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <RobotLogo size={24} />
                  <Shimmer as="span" className="text-sm">{runtimeDisplay.statusLabel}</Shimmer>
                </div>
              )}
            </ConversationContent>
            <ConversationScrollButton />
          </Conversation>

          <div className="flex-shrink-0 px-4 pb-4 pt-3">
            <PromptInput
              onSubmit={handleSubmit}
              disabled={loading || !isComposerReady}
              className="rounded-[28px] border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]"
            >
              <PromptInputTextarea
                placeholder={isComposerReady ? '输入消息... (Enter 发送)' : '加载模型配置中...'}
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                onKeyDown={handleTextareaKeyDown}
                maxLength={10000}
                rows={2}
                className="min-h-[88px] max-h-[220px] border-0 bg-transparent px-6 pb-4 pt-5 text-[15px] leading-6 shadow-none focus-visible:ring-0 placeholder:text-[#64748b]"
              />
              <PromptInputFooter className="items-center justify-between gap-3 border-t border-border/60 px-6 pb-4 pt-4">
                <div className={cn('min-w-0 flex-1', isFullscreen ? 'max-w-sm' : 'max-w-[13rem]')}>
                  <EngineModelSelect
                    engine={engine}
                    model={model}
                    onEngineChange={setEngine}
                    onModelChange={setModel}
                    className="h-12 rounded-xl border-border/70 bg-background px-3 text-sm shadow-none"
                  />
                </div>
                <div className="flex shrink-0 items-center">
                  <PromptInputSubmit
                    className="h-11 w-11 rounded-2xl bg-[#1f6fff] px-0 text-white shadow-sm transition-colors duration-150 hover:bg-[#1a61de] disabled:bg-[#8eb1f7] disabled:text-white"
                    disabled={loading || !draft.trim() || !isComposerReady}
                  >
                    {loading ? (
                      <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                    ) : (
                      <span className="material-symbols-outlined text-[18px]">subdirectory_arrow_left</span>
                    )}
                  </PromptInputSubmit>
                </div>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      )}
    </>
  );
}
