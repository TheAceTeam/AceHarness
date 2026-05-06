'use client';

import { useEffect, useRef, useState } from 'react';
import { useChat } from '@/contexts/ChatContext';
import ChatMessage from '@/components/chat/ChatMessage';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run-state-persistence';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface WorkflowSupervisorChatPanelProps {
  sessionId?: string | null;
  configFile: string;
  runId?: string | null;
  supervisorAgent?: string | null;
  supervisorSessionId?: string | null;
  pendingHumanQuestion?: HumanQuestion | null;
  submittingHumanQuestion?: boolean;
  onSubmitHumanQuestion?: (answer: HumanQuestionAnswer) => Promise<void> | void;
  onOpenHome?: () => void;
}

const noop = () => {};

export default function WorkflowSupervisorChatPanel({
  sessionId,
  configFile,
  runId,
  supervisorAgent,
  supervisorSessionId,
  pendingHumanQuestion,
  submittingHumanQuestion,
  onSubmitHumanQuestion,
  onOpenHome,
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
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    if (activeSessionId !== sessionId) {
      setActiveSessionId(sessionId);
    }
  }, [activeSessionId, sessionId, setActiveSessionId]);

  const loaded = Boolean(sessionId && activeSession?.id === sessionId);
  const messages = loaded ? activeSession?.messages || [] : [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, streamingMessageId]);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !loaded || loading) return;
    setDraft('');
    await sendMessage(text);
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
            {pendingHumanQuestion ? <Badge variant="destructive" className="text-[10px]">等待人工回复</Badge> : null}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
            <span>{configFile}</span>
            {runId ? <span>Run: {runId}</span> : null}
            {supervisorAgent ? <span>Supervisor: {supervisorAgent}</span> : null}
            {supervisorSessionId ? <span>Session: {supervisorSessionId}</span> : null}
          </div>
        </div>
        {onOpenHome ? (
          <Button size="sm" variant="outline" onClick={onOpenHome}>
            打开首页对话
          </Button>
        ) : null}
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
        <div className="flex items-end gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="给 Supervisor 发送消息，系统会自动携带当前 workflow / run 上下文..."
            className="min-h-[64px] resize-none"
            disabled={!loaded}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                void submit();
              }
            }}
          />
          <Button className="h-[64px]" onClick={() => void submit()} disabled={!loaded || loading || !draft.trim()}>
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
