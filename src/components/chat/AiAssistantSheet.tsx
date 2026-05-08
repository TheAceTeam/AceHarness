'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useChat } from '@/contexts/ChatContext';
import ChatMessage from '@/components/chat/ChatMessage';
import { MessageHistoryCollapse } from '@/components/chat/MessageHistoryCollapse';
import { VirtualMessageList } from '@/components/chat/VirtualMessageList';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ComboboxPortalProvider } from '@/components/ui/combobox';
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { workspaceApi, type NotebookScope } from '@/lib/api';
import { buildNotebookFromAssistantMessage, createDefaultNotebookFileName } from '@/lib/chat-notebook';
import { useToast } from '@/components/ui/toast';
import { computeAdaptiveRecentWindow } from '@/lib/chat-message-window';

const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), { ssr: false });

interface AutoTask {
  id: string;
  displayText: string;
  prompt: string;
}

interface AiAssistantSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  context?: string;
  contextLabel?: string;
  autoTask?: AutoTask | null;
  onInsertResult?: (content: string) => void;
  insertButtonLabel?: string;
  inputPlaceholder?: string;
  sessionStorageKey?: string;
  sessionTitle?: string;
}

interface LastRequest {
  prompt: string;
  displayText: string;
}

export function AiAssistantSheet({
  open,
  onOpenChange,
  title = 'AI 助手',
  context = '',
  contextLabel = '当前上下文',
  autoTask,
  onInsertResult,
  insertButtonLabel = '插入回原文',
  inputPlaceholder = '输入问题...',
  sessionStorageKey = 'ai-assistant-session-id',
  sessionTitle = 'AI 助手',
}: AiAssistantSheetProps) {
  const { toast } = useToast();
  const {
    sessions,
    activeSession,
    activeSessionId,
    setActiveSessionId,
    createSession,
    renameSession,
    deleteSession,
    sendMessage,
    stopStreaming,
    loading,
    streamingMessageId,
    model,
    setModel,
    engine,
    setEngine,
    deleteMessage,
    retryFromMessage,
    continueFromMessage,
    confirmAction,
    rejectAction,
    undoActionById,
    retryAction,
  } = useChat();

  const [sheetSessionId, setSheetSessionId] = useState<string | null>(null);
  const [inputCache, setInputCache] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'history'>('chat');
  const [insertedMessageIds, setInsertedMessageIds] = useState<Record<string, boolean>>({});
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportScope, setExportScope] = useState<NotebookScope>('personal');
  const [exportDirectory, setExportDirectory] = useState('');
  const [exportFileName, setExportFileName] = useState('');
  const [exportMessageId, setExportMessageId] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const editorRef = useRef<RichTextEditorHandle>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const pendingHistoryScrollAdjustRef = useRef<{ prevScrollHeight: number; prevScrollTop: number } | null>(null);
  const previousActiveSessionIdRef = useRef<string | null>(null);
  const lastAutoTaskIdRef = useRef<string | null>(null);
  const lastRequestRef = useRef<LastRequest | null>(null);
  const pendingSendRef = useRef<LastRequest | null>(null);
  const restoredEngineModelRef = useRef(false);
  const modelStorageKey = `${sessionStorageKey}-model`;
  const engineStorageKey = `${sessionStorageKey}-engine`;

  const contextText = context.trim();
  const hasContext = contextText.length > 0;

  const extractResultContent = useCallback((raw: string): string | null => {
    const text = String(raw || '');
    const match = text.match(/<result>([\s\S]*?)<\/result>/i);
    if (!match?.[1]) return null;
    const value = match[1].trim();
    return value.length > 0 ? value : null;
  }, []);

  const formatResultForDisplay = useCallback((text: string, forceCodeBlock: boolean): string => {
    const value = (text || '').trim();
    if (!value) return value;
    if (!forceCodeBlock) return value;
    if (/```[\s\S]*```/.test(value)) return value;
    return `\`\`\`\n${value}\n\`\`\``;
  }, []);

  const shouldTreatAsCodeResult = useCallback((displayText: string): boolean => {
    const label = (displayText || '').trim();
    if (!label) return false;
    return ['解决错误', '添加注释'].some((keyword) => label.includes(keyword));
  }, []);

  const isSheetSessionActive = !!sheetSessionId && activeSessionId === sheetSessionId;
  const sessionMessages = isSheetSessionActive ? (activeSession?.messages || []) : [];

  const isStreamingCurrentSession = isSheetSessionActive && !!streamingMessageId;
  const isLoadingCurrentSession = isStreamingCurrentSession || (isSheetSessionActive && loading);

  const ensureSheetSession = useCallback(() => {
    if (sheetSessionId) {
      setActiveSessionId(sheetSessionId);
      return sheetSessionId;
    }

    let nextSessionId: string | null = null;
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(sessionStorageKey);
      if (stored && sessions.some((session) => session.id === stored)) {
        nextSessionId = stored;
      }
    }

    if (!nextSessionId) {
      nextSessionId = createSession();
      renameSession(nextSessionId, sessionTitle);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(sessionStorageKey, nextSessionId);
      }
    }

    setSheetSessionId(nextSessionId);
    setActiveSessionId(nextSessionId);
    return nextSessionId;
  }, [createSession, renameSession, sessionStorageKey, sessionTitle, sessions, setActiveSessionId, sheetSessionId]);

  const buildPrompt = useCallback((userText: string) => {
    if (!hasContext) return userText;
    return [
      '你正在协助编辑内容，请基于当前上下文回答。',
      '',
      `${contextLabel}：`,
      '```',
      contextText,
      '```',
      '',
      '用户问题：',
      userText,
    ].join('\n');
  }, [contextLabel, contextText, hasContext]);

  const sendWithPrompt = useCallback(async (prompt: string, displayText: string) => {
    if (isLoadingCurrentSession) return;
    const sid = ensureSheetSession();
    if (!sid) return;
    if (!isSheetSessionActive || activeSessionId !== sid) {
      pendingSendRef.current = { prompt, displayText };
      setActiveSessionId(sid);
      return;
    }
    lastRequestRef.current = { prompt, displayText };
    await sendMessage(prompt, { displayText });
  }, [activeSessionId, ensureSheetSession, isLoadingCurrentSession, isSheetSessionActive, sendMessage]);

  const send = useCallback(async (rawText?: string) => {
    const userText = (rawText?.trim() || editorRef.current?.getMarkdown().trim() || inputCache.trim());
    if (!userText || isLoadingCurrentSession) return;

    const prompt = buildPrompt(userText);
    editorRef.current?.clear();
    setInputCache('');
    await sendWithPrompt(prompt, userText);
  }, [buildPrompt, inputCache, isLoadingCurrentSession, sendWithPrompt]);

  const normalizeNotebookFileName = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return trimmed.endsWith('.cj.md') ? trimmed : `${trimmed}.cj.md`;
  }, []);

  const openExportDialog = useCallback((messageId: string) => {
    setExportMessageId(messageId);
    setExportScope('personal');
    setExportDirectory('');
    setExportFileName(createDefaultNotebookFileName().replace(/\.cj\.md$/i, ''));
    setExportDialogOpen(true);
  }, []);

  const handleConfirmExport = useCallback(async () => {
    if (!exportMessageId || !activeSession) return;
    const message = activeSession.messages.find((item) => item.id === exportMessageId && item.role === 'assistant');
    if (!message) return;
    const extracted = extractResultContent(message.content);
    const exportMessage = extracted ? { ...message, content: extracted, rawContent: extracted } : message;
    const notebookContent = buildNotebookFromAssistantMessage(exportMessage);
    const normalizedFileName = normalizeNotebookFileName(exportFileName) || normalizeNotebookFileName(createDefaultNotebookFileName());
    if (!normalizedFileName) return;
    const normalizedDir = exportDirectory.replace(/^\/+|\/+$/g, '');
    const finalFilePath = normalizedDir ? `${normalizedDir}/${normalizedFileName}` : normalizedFileName;
    try {
      setExporting(true);
      await workspaceApi.manageNotebook('create-file', { path: finalFilePath }, { scope: exportScope });
      await workspaceApi.saveNotebookFile(finalFilePath, notebookContent, { scope: exportScope });
      setExportDialogOpen(false);
      setExportMessageId(null);
      toast('success', `已导入到 Notebook：${finalFilePath}`);
    } catch (error: any) {
      toast('error', error?.message || '导入 Notebook 失败');
    } finally {
      setExporting(false);
    }
  }, [activeSession, exportDirectory, exportFileName, exportMessageId, exportScope, extractResultContent, normalizeNotebookFileName, toast]);

  const regenerate = useCallback(async () => {
    const lastRequest = lastRequestRef.current;
    if (!lastRequest || isLoadingCurrentSession) return;
    await sendWithPrompt(lastRequest.prompt, `${lastRequest.displayText}（重新生成）`);
  }, [isLoadingCurrentSession, sendWithPrompt]);

  useEffect(() => {
    if (!open) return;
    if (!sheetSessionId) {
      previousActiveSessionIdRef.current = activeSessionId;
      if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(sessionStorageKey);
        if (stored && sessions.some((session) => session.id === stored)) {
          setSheetSessionId(stored);
          setActiveSessionId(stored);
        }
      }
      return;
    }
    if (activeSessionId !== sheetSessionId) {
      setActiveSessionId(sheetSessionId);
    }
  }, [activeSessionId, open, sessionStorageKey, sessions, setActiveSessionId, sheetSessionId]);

  useEffect(() => {
    if (!open) {
      lastAutoTaskIdRef.current = null;
      setActiveTab('chat');
      const previous = previousActiveSessionIdRef.current;
      if (previous && previous !== sheetSessionId && sessions.some((session) => session.id === previous)) {
        setActiveSessionId(previous);
      }
      previousActiveSessionIdRef.current = null;
      return;
    }

    const timer = window.setTimeout(() => editorRef.current?.focus(), 120);
    return () => window.clearTimeout(timer);
  }, [open, sessions, setActiveSessionId, sheetSessionId]);

  useEffect(() => {
    if (!open || !autoTask) return;
    if (lastAutoTaskIdRef.current === autoTask.id) return;
    lastAutoTaskIdRef.current = autoTask.id;
    void sendWithPrompt(autoTask.prompt, autoTask.displayText);
  }, [autoTask, open, sendWithPrompt]);

  useEffect(() => {
    if (!open || !sheetSessionId || activeSessionId !== sheetSessionId) return;
    const pending = pendingSendRef.current;
    if (!pending) return;
    pendingSendRef.current = null;
    lastRequestRef.current = pending;
    void sendMessage(pending.prompt, { displayText: pending.displayText });
  }, [activeSessionId, open, sendMessage, sheetSessionId]);

  useEffect(() => {
    if (!open) {
      restoredEngineModelRef.current = false;
      return;
    }
    if (restoredEngineModelRef.current) return;
    restoredEngineModelRef.current = true;
    if (typeof window === 'undefined') return;
    const savedModel = window.localStorage.getItem(modelStorageKey);
    const savedEngine = window.localStorage.getItem(engineStorageKey);
    if (savedModel && savedModel !== model) {
      setModel(savedModel);
    }
    if (savedEngine !== null && savedEngine !== engine) {
      setEngine(savedEngine);
    }
  }, [open, modelStorageKey, engineStorageKey, model, engine, setModel, setEngine]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(modelStorageKey, model || '');
  }, [modelStorageKey, model]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(engineStorageKey, engine || '');
  }, [engineStorageKey, engine]);

  useEffect(() => {
    if (!open || activeTab !== 'chat') return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeTab, open, sessionMessages, isLoadingCurrentSession]);

  const clearSessionMessages = useCallback(() => {
    if (!sessionMessages.length || isLoadingCurrentSession) return;
    for (const message of [...sessionMessages]) {
      deleteMessage(message.id);
    }
  }, [deleteMessage, isLoadingCurrentSession, sessionMessages]);

  useEffect(() => {
    setInsertedMessageIds({});
  }, [sheetSessionId]);

  useEffect(() => {
    setHistoryExpanded(false);
  }, [sheetSessionId]);

  const renderedSessionMessages = useMemo(() => {
    return sessionMessages.map((message, messageIndex) => {
      const resultContent = message.role === 'assistant' ? extractResultContent(message.content) : null;
      let forceCodeBlock = false;
      if (message.role === 'assistant') {
        for (let i = messageIndex - 1; i >= 0; i -= 1) {
          const prev = sessionMessages[i];
          if (prev?.role !== 'user') continue;
          const displayCandidate = String((prev as any).displayText || prev.content || '');
          forceCodeBlock = shouldTreatAsCodeResult(displayCandidate);
          break;
        }
      }
      const displayMessage = resultContent
        ? { ...message, content: formatResultForDisplay(resultContent, forceCodeBlock) }
        : message;

      return (
        <div key={message.id}>
          <ChatMessage
            message={displayMessage}
            isStreaming={streamingMessageId === message.id}
            onConfirmAction={(actionId) => confirmAction(message.id, actionId)}
            onRejectAction={(actionId) => rejectAction(message.id, actionId)}
            onUndoAction={(actionId) => undoActionById(message.id, actionId)}
            onRetryAction={(actionId) => retryAction(message.id, actionId)}
            onAction={(prompt) => { void send(prompt); }}
            onDelete={deleteMessage}
            onRetryFromMessage={retryFromMessage}
            onContinue={continueFromMessage}
            onSaveAsNotebook={(messageId) => openExportDialog(messageId)}
          />
          {onInsertResult && message.role === 'assistant' && resultContent && (
            <div className="mb-3 -mt-3 ml-10 flex justify-start">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!!insertedMessageIds[message.id]}
                onClick={() => {
                  onInsertResult(resultContent);
                  setInsertedMessageIds((prev) => ({ ...prev, [message.id]: true }));
                }}
              >
                {insertedMessageIds[message.id] ? '已插入' : insertButtonLabel}
              </Button>
            </div>
          )}
        </div>
      );
    });
  }, [
    confirmAction,
    continueFromMessage,
    deleteMessage,
    extractResultContent,
    formatResultForDisplay,
    insertedMessageIds,
    insertButtonLabel,
    onInsertResult,
    openExportDialog,
    rejectAction,
    retryAction,
    retryFromMessage,
    send,
    sessionMessages,
    shouldTreatAsCodeResult,
    streamingMessageId,
    undoActionById,
  ]);

  const recentWindowSize = useMemo(() => computeAdaptiveRecentWindow(sessionMessages as any[], {
    streamingMessageId,
  }), [sessionMessages, streamingMessageId]);
  const hiddenMessageCount = Math.max(0, renderedSessionMessages.length - recentWindowSize);
  const historicalMessageItems = hiddenMessageCount > 0
    ? sessionMessages.slice(0, hiddenMessageCount).map((message, index) => ({
        key: message.id,
        node: renderedSessionMessages[index],
      }))
    : [];
  const recentMessageItems = hiddenMessageCount > 0
    ? sessionMessages.slice(-recentWindowSize).map((message, index) => ({
        key: message.id,
        node: renderedSessionMessages[hiddenMessageCount + index],
      }))
    : sessionMessages.map((message, index) => ({
        key: message.id,
        node: renderedSessionMessages[index],
      }));
  const historicalMessages = hiddenMessageCount > 0 ? renderedSessionMessages.slice(0, hiddenMessageCount) : [];

  useEffect(() => {
    const scroller = chatScrollRef.current;
    const pending = pendingHistoryScrollAdjustRef.current;
    if (!scroller || !pending) return;
    pendingHistoryScrollAdjustRef.current = null;
    const nextScrollHeight = scroller.scrollHeight;
    const delta = nextScrollHeight - pending.prevScrollHeight;
    if (Math.abs(delta) < 1) return;
    scroller.scrollTop = Math.max(0, pending.prevScrollTop + delta);
  }, [historyExpanded, hiddenMessageCount]);

  const handleCreateSession = useCallback(() => {
    const nextId = createSession();
    renameSession(nextId, sessionTitle);
    setSheetSessionId(nextId);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(sessionStorageKey, nextId);
    }
    setActiveSessionId(nextId);
  }, [createSession, renameSession, sessionStorageKey, sessionTitle, setActiveSessionId]);

  const handleDeleteSession = useCallback((id: string) => {
    deleteSession(id);
    if (id === sheetSessionId) {
      setSheetSessionId(null);
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(sessionStorageKey);
      }
    }
  }, [deleteSession, sessionStorageKey, sheetSessionId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="z-[90] w-[94vw] sm:max-w-[760px] h-[100dvh] max-h-[100dvh] p-0 overflow-hidden gap-0 flex flex-col">
        <ComboboxPortalProvider>
          <SheetHeader className="shrink-0 border-b px-5 py-4 pr-12">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-base">{title}</SheetTitle>
              </div>
              <div className="w-[260px]">
                <EngineModelSelect
                  engine={engine}
                  model={model}
                  onEngineChange={setEngine}
                  onModelChange={setModel}
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-muted/20">
            {hasContext && (
              <div className="mx-4 mt-4 rounded-md border bg-background p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">{contextLabel}</div>
                <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-words text-xs text-foreground/90">{contextText}</pre>
              </div>
            )}

            <div className="mx-4 mt-4 min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as 'chat' | 'history')} className="flex h-full min-h-0 flex-col">
                <div className="border-b px-3 py-2">
                  <TabsList className="h-8">
                    <TabsTrigger value="chat" className="text-xs">对话</TabsTrigger>
                    <TabsTrigger value="history" className="text-xs">记录</TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="chat" className="mt-0 min-h-0 flex-1 overflow-hidden p-0 data-[state=inactive]:hidden">
                  <div ref={chatScrollRef} className="h-full overflow-y-auto px-3 py-3">
                    {sessionMessages.length === 0 && !isLoadingCurrentSession && (
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">输入问题开始对话</div>
                    )}
                    <MessageHistoryCollapse
                      hiddenCount={hiddenMessageCount}
                      recentCount={recentWindowSize}
                      open={historyExpanded}
                      onOpenChange={(open) => {
                        const scroller = chatScrollRef.current;
                        pendingHistoryScrollAdjustRef.current = scroller
                          ? { prevScrollHeight: scroller.scrollHeight, prevScrollTop: scroller.scrollTop }
                          : null;
                        setHistoryExpanded(open);
                      }}
                      hiddenContent={
                        historyExpanded
                          ? <VirtualMessageList items={historicalMessageItems} scrollContainerRef={chatScrollRef} />
                          : historicalMessages
                      }
                      recentContent={<VirtualMessageList items={recentMessageItems} scrollContainerRef={chatScrollRef} />}
                    />
                    {isLoadingCurrentSession && !streamingMessageId && (
                      <div className="text-sm text-muted-foreground px-2 py-1">AI 思考中...</div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                </TabsContent>

                <TabsContent value="history" className="mt-0 min-h-0 flex-1 overflow-hidden p-0 data-[state=inactive]:hidden">
                  <div className="flex h-full flex-col">
                    <div className="flex items-center justify-between border-b px-3 py-2">
                      <div className="text-xs text-muted-foreground">可追踪会话历史</div>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={handleCreateSession}>新建会话</Button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto p-2">
                      {sessions.length === 0 ? (
                        <div className="px-2 py-3 text-xs text-muted-foreground">暂无会话</div>
                      ) : (
                        sessions.map((session) => (
                          <div key={session.id} className={`mb-2 rounded border p-2 ${activeSessionId === session.id ? 'border-primary/50 bg-primary/5' : 'border-border'}`}>
                            <button
                              type="button"
                              className="w-full text-left"
                              onClick={() => {
                                setActiveSessionId(session.id);
                                setSheetSessionId(session.id);
                                if (typeof window !== 'undefined') {
                                  window.localStorage.setItem(sessionStorageKey, session.id);
                                }
                                setActiveTab('chat');
                              }}
                            >
                              <div className="truncate text-sm font-medium">{session.title}</div>
                              <div className="mt-1 text-[11px] text-muted-foreground">{session.messageCount} 条 · {new Date(session.updatedAt).toLocaleString()}</div>
                            </button>
                            <div className="mt-2 flex items-center justify-end">
                              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] text-destructive hover:text-destructive" onClick={() => handleDeleteSession(session.id)}>
                                删除
                              </Button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="mx-4 my-4 rounded-md border bg-background p-3">
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <RichTextEditor
                    ref={editorRef}
                    onEnter={(text) => {
                      void send(text);
                    }}
                    onChange={setInputCache}
                    placeholder={inputPlaceholder}
                    minHeight={44}
                    maxHeight={140}
                    disabled={isLoadingCurrentSession}
                    showToolbar={false}
                  />
                </div>
                <Button size="sm" variant="outline" onClick={clearSessionMessages} disabled={isLoadingCurrentSession || sessionMessages.length === 0}>
                  清空
                </Button>
                {isStreamingCurrentSession ? (
                  <Button size="sm" variant="destructive" onClick={stopStreaming}>停止</Button>
                ) : (
                  <>
                    <Button size="sm" variant="outline" onClick={regenerate} disabled={isLoadingCurrentSession || !lastRequestRef.current || !isSheetSessionActive}>
                      重新生成
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        void send();
                      }}
                      disabled={isLoadingCurrentSession || !((editorRef.current?.getMarkdown().trim()) || inputCache.trim())}
                    >
                      发送
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </ComboboxPortalProvider>
      </SheetContent>
      <NotebookSaveDialog
        open={exportDialogOpen}
        onOpenChange={(open) => {
          if (!exporting) setExportDialogOpen(open);
        }}
        scope={exportScope}
        onScopeChange={setExportScope}
        directory={exportDirectory}
        onDirectoryChange={setExportDirectory}
        directories={[]}
        loadingDirectories={false}
        saving={exporting}
        title="导入到 Notebook"
        confirmLabel="导入"
        contentClassName="z-[130]"
        onConfirm={() => { void handleConfirmExport(); }}
        extraContent={(
          <div>
            <div className="mb-1 text-xs text-muted-foreground">文件名</div>
            <input
              value={exportFileName}
              onChange={(event) => setExportFileName(event.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              placeholder="例如：ai-response"
            />
          </div>
        )}
      />
    </Sheet>
  );
}

export default AiAssistantSheet;
