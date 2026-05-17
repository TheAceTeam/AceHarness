'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import ChatMessage from '@/components/chat/ChatMessage';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run/state-persistence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from '@/components/ai-elements/prompt-input';
import type { FormEvent } from 'react';

interface WorkflowSupervisorChatPanelProps {
  sessionId?: string | null;
  configFile: string;
  runId?: string | null;
  supervisorAgent?: string | null;
  supervisorSessionId?: string | null;
  mentionCandidates?: string[];
  pendingHumanQuestion?: HumanQuestion | null;
  submittingHumanQuestion?: boolean;
  onSubmitHumanQuestion?: (answer: HumanQuestionAnswer) => Promise<void> | void;
}

const noop = () => {};

function getMentionQuery(input: string): string | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex < 0) return null;
  const tail = input.slice(atIndex + 1);
  if (/[\s\n\r，。,.!！?？:：；;]/u.test(tail)) return null;
  return tail;
}

function insertMention(input: string, mention: string): string {
  const atIndex = input.lastIndexOf('@');
  const replacement = `@${mention} `;
  if (atIndex < 0) return `${input}${replacement}`;
  const before = input.slice(0, atIndex);
  const after = input.slice(atIndex + 1).replace(/^[^\s\n\r，。,.!！?？:：；;]*/u, '');
  return `${before}${replacement}${after}`;
}

export default function WorkflowSupervisorChatPanel({
  sessionId,
  configFile,
  runId,
  supervisorAgent,
  supervisorSessionId,
  mentionCandidates = [],
  pendingHumanQuestion,
  submittingHumanQuestion,
  onSubmitHumanQuestion,
}: WorkflowSupervisorChatPanelProps) {
  const {
    activeSessionId,
    activeSession,
    setActiveSessionId,
    sendMessage,
    loading,
    streamingMessageId,
  } = useChat();
  const [draft, setDraft] = useState('');
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    if (activeSessionId !== sessionId) {
      setActiveSessionId(sessionId);
    }
  }, [activeSessionId, sessionId, setActiveSessionId]);

  const loaded = Boolean(sessionId && activeSession?.id === sessionId);
  const messages = useMemo(() => {
    if (!loaded) return [];
    return (activeSession?.messages || []).filter((message) => {
      const hasVisibleContent = Boolean((message.content || '').trim());
      const hasAttachments = Boolean(message.actions?.length || message.cards?.length);
      if (hasVisibleContent || hasAttachments) return true;
      return message.id === streamingMessageId;
    });
  }, [activeSession?.messages, loaded, streamingMessageId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingMessageId]);

  const mentionQuery = getMentionQuery(draft);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim().toLowerCase();
    const candidates = ['全员', ...mentionCandidates]
      .filter((name, index, array) => array.indexOf(name) === index);
    return candidates
      .filter((name) => !query || name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [mentionCandidates, mentionQuery]);

  useEffect(() => {
    setActiveMentionIndex(0);
  }, [mentionQuery]);

  const applyMention = (mention: string) => {
    const next = insertMention(draft, mention);
    setDraft(next);
  };

  const submit = async () => {
    const text = draft.trim();
    if (!text || !loaded || loading) return;
    setDraft('');
    await sendMessage(text);
  };

  const handlePromptSubmit = (_message: import('@/components/ai-elements/prompt-input').PromptInputMessage, _event: FormEvent) => {
    void submit();
  };

  if (!sessionId) {
    return (
      <div className="rounded-2xl border border-dashed bg-background/70 p-5 text-sm text-muted-foreground">
        工作流启动后会自动创建 Supervisor 对话，并在这里与首页共用同一条会话。
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-background/80 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Supervisor 对话</span>
            <Badge variant="outline" className="text-[10px]">同首页会话</Badge>
            <Badge variant="secondary" className="text-[10px]">@ 圆桌走首页协作室</Badge>
            {pendingHumanQuestion ? <Badge variant="destructive" className="text-[10px]">等待人工回复</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span>{configFile}</span>
            {runId ? <span>Run: {runId}</span> : null}
            {supervisorAgent ? <span>Supervisor: {supervisorAgent}</span> : null}
            {supervisorSessionId ? <span>Session: {supervisorSessionId}</span> : null}
          </div>
        </div>
      </div>

      {pendingHumanQuestion && onSubmitHumanQuestion ? (
        <div className="border-b bg-amber-500/5 p-4">
          <HumanQuestionCard
            question={pendingHumanQuestion}
            submitting={submittingHumanQuestion}
            onSubmit={onSubmitHumanQuestion}
          />
        </div>
      ) : null}

      <div className="max-h-[440px] min-h-[260px] overflow-y-auto px-4 py-4">
        {!loaded ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            正在载入绑定会话...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            暂无 Supervisor 事件。
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                isStreaming={message.id === streamingMessageId}
                onConfirmAction={noop}
                onRejectAction={noop}
                onUndoAction={noop}
                onRetryAction={noop}
                onAction={(prompt) => setDraft(prompt)}
              />
            ))}
            <div ref={bottomRef} />
          </>
        )}
      </div>

      <div className="border-t p-3">
        <div className="mb-2 rounded-lg border bg-muted/20 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
          这里发送的是 Supervisor 单聊消息。需要多 Agent 圆桌时，到首页协作室使用
          <span className="font-mono"> @agent </span>
          或
          <span className="font-mono"> @全员 </span>
          主持；没有新的 @ 时本轮会自然结束。
        </div>
        <div className="relative">
          {mentionSuggestions.length > 0 ? (
            <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full rounded-xl border bg-background p-2 shadow-lg">
              <div className="mb-1 text-[10px] text-muted-foreground">@ 提示</div>
              <div className="flex flex-wrap gap-1.5">
                {mentionSuggestions.map((name, index) => (
                  <Button
                    key={name}
                    type="button"
                    size="sm"
                    variant={index === activeMentionIndex ? 'secondary' : 'ghost'}
                    className="h-7 max-w-full px-2 text-xs"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyMention(name)}
                  >
                    <span className="truncate">@{name}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
          <PromptInput onSubmit={handlePromptSubmit}>
            <PromptInputTextarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="给 Supervisor 发送单聊消息，系统会自动携带当前 workflow / run 上下文..."
              className="min-h-[64px]"
              disabled={!loaded}
              onKeyDown={(event) => {
                if (mentionSuggestions.length > 0) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveMentionIndex((prev) => (prev + 1) % mentionSuggestions.length);
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveMentionIndex((prev) => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
                    return;
                  }
                  if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
                    event.preventDefault();
                    applyMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setDraft((prev) => `${prev} `);
                    return;
                  }
                }
              }}
            />
            <PromptInputFooter>
              <div />
              <PromptInputSubmit disabled={!loaded || loading || !draft.trim()} />
            </PromptInputFooter>
          </PromptInput>
        </div>
      </div>
    </div>
  );
}
