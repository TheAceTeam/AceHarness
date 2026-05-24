'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEventHandler, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { ArrowDown, ChevronDown, Copy, FilePlus2, MessageSquareQuote, RotateCcw, SendHorizontal, Square, Trash2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ThinkingBot, WrapperProcessBlocks } from '@/components/chat/ChatMessage';
import Markdown from '@/components/Markdown';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { useToast } from '@/components/ui/toast';
import { getStreamingResultDisplay, stripMachineResultBlocks } from '@/lib/chat/actions';
import { copyText } from '@/lib/core/clipboard';
import { createDefaultNotebookFileName } from '@/lib/chat/notebook';
import { workspaceApi, type NotebookScope } from '@/lib/core/api';
import { cn } from '@/lib/core/utils';
import type { CollaborationChatroomMode, CollaborationRoomMessage } from '@/lib/core/home-sidebar-state';

function formatStreamingResultBody(text: string): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return '';
  const fenceMatch = trimmed.match(/^(```|~~~)(?:json|card)?\s*([\s\S]*?)(?:\1)?$/i);
  const body = (fenceMatch ? fenceMatch[2] : trimmed).trim();
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function PendingStreamingResultPanel({
  rawContent,
  speakerName,
}: {
  rawContent: string;
  speakerName?: string;
}) {
  const result = getStreamingResultDisplay(rawContent);
  const body = formatStreamingResultBody(result?.text || '');
  const [expanded, setExpanded] = useState(false);
  if (!result || !body) return null;
  const title = `${speakerName || '嘉宾'}正在组织最后的发言…`;

  return (
    <div
      className="overflow-hidden rounded-xl border border-border/70 bg-background/70 shadow-sm"
      data-testid="agora-streaming-result-panel"
    >
      <div className="border-b border-border/60 bg-muted/30 px-3 py-2">
        <div className="text-sm font-medium text-foreground">{title}</div>
      </div>
      <div className="space-y-3 px-3 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          <span>正在整理结构化结果</span>
        </div>
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="h-8 gap-1.5 rounded-md px-2 text-xs">
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
              <span>{expanded ? '收起草稿' : '展开查看草稿'}</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1">
            <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/35 px-3 py-2 font-mono text-[12px] leading-5 text-foreground">
              {body}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function CompletedStructuredResultContent({
  content,
}: {
  content: string;
}) {
  const finalContent = String(content || '').trim();
  if (!finalContent) return null;

  return (
    <div className="prose-sm max-w-none text-sm dark:prose-invert [&_p]:my-1" data-testid="agora-final-result-content">
      <Markdown>{finalContent}</Markdown>
    </div>
  );
}

function CompletedStructuredProcessPanel({
  rawContent,
}: {
  rawContent: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = useMemo(
    () => stripMachineResultBlocks(String(rawContent || '')).replace(/<!--\s*chunk-boundary\s*-->/gi, '').trim(),
    [rawContent]
  );
  if (!content) return null;

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" className="h-8 gap-1.5 rounded-md px-2 text-xs">
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          <span>{expanded ? '收起完整内容' : '查看完整内容'}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-1" forceMount>
        <div data-testid="agora-complete-raw-panel">
          <WrapperProcessBlocks content={content} isStreaming={false} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function renderRoomMessageContent(message: CollaborationRoomMessage) {
  const rawContent = String(message.rawContent || message.content || '').trim();
  const finalContent = String(message.content || '').trim();
  if (message.status === 'pending') {
    if (rawContent && rawContent !== '发言中') {
      return (
        <div className="space-y-2">
          <WrapperProcessBlocks content={rawContent} isStreaming />
          <PendingStreamingResultPanel rawContent={rawContent} speakerName={message.speakerName} />
          <div className="inline-flex items-center rounded-2xl border border-border/70 bg-muted/45 px-3 py-1.5 shadow-sm">
            <ThinkingBot />
          </div>
        </div>
      );
    }
    return (
      <div className="inline-flex items-center rounded-2xl border border-border/70 bg-muted/45 px-3 py-1.5 shadow-sm">
        <ThinkingBot />
      </div>
    );
  }
  const shouldShowCompletedResult = rawContent.toLowerCase().includes('<result>');
  if (shouldShowCompletedResult) {
    return (
      <div className="space-y-2">
        <CompletedStructuredResultContent content={finalContent} />
        <CompletedStructuredProcessPanel rawContent={rawContent} />
      </div>
    );
  }
  const content = rawContent || finalContent;
  if (!content) return null;
  return <WrapperProcessBlocks content={content} isStreaming={false} />;
}

function getRoomMessageText(message: CollaborationRoomMessage) {
  return String(message.rawContent || message.content || '').trim();
}

function escapeMentionAttribute(value: string) {
  return value
    .split('&').join('&amp;')
    .split('"').join('&quot;')
    .split('<').join('&lt;')
    .split('>').join('&gt;');
}

function buildMentionMarkup(name: string) {
  const safeName = escapeMentionAttribute(name);
  return `<mention id="${safeName}" label="${safeName}" />`;
}

function getMentionSearch(text: string, cursor: number) {
  const prefix = text.slice(0, cursor);
  const atIndex = prefix.lastIndexOf('@');
  if (atIndex < 0) return null;
  const token = prefix.slice(atIndex + 1);
  if (/[\s\n\r,，。.!！?？;；:：]/.test(token)) return null;
  return {
    start: atIndex,
    end: cursor,
    query: token.trim().toLowerCase(),
  };
}

function buildQuotedRoomMessage(message: CollaborationRoomMessage, mentionMode: 'plain' | 'tag' = 'plain') {
  const content = getRoomMessageText(message);
  if (!content) return '';
  const quotedText = content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .slice(0, 30)
    .map((line) => `> ${line}`)
    .join('\n');
  const mentionPrefix = mentionMode === 'tag'
    ? `${buildMentionMarkup(message.speakerName)}\n\n`
    : `@${message.speakerName}\n\n`;
  return `${mentionPrefix}> **${message.speakerName}：**\n${quotedText}\n\n`;
}

function normalizeNotebookFileName(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.endsWith('.cj.md') ? trimmed : `${trimmed}.cj.md`;
}

function padTimestampPart(value: number) {
  return String(value).padStart(2, '0');
}

function formatNotebookTimestamp(timestamp: number) {
  const date = new Date(timestamp);
  return [
    date.getFullYear(),
    '-',
    padTimestampPart(date.getMonth() + 1),
    '-',
    padTimestampPart(date.getDate()),
    ' ',
    padTimestampPart(date.getHours()),
    ':',
    padTimestampPart(date.getMinutes()),
    ':',
    padTimestampPart(date.getSeconds()),
  ].join('');
}

function buildRoomMessageNotebook(message: CollaborationRoomMessage) {
  const content = String(message.rawContent || message.content || '').trim();
  return [
    '# 议场发言',
    '',
    `- 嘉宾: ${message.speakerName}`,
    `- 时间: ${formatNotebookTimestamp(message.createdAt)}`,
    message.engine ? `- 引擎: ${message.engine}` : null,
    message.model ? `- 模型: ${message.model}` : null,
    '',
    content || '暂无内容。',
    '',
  ].filter(Boolean).join('\n');
}

interface CollaborationRoomSurfaceProps {
  messages: CollaborationRoomMessage[];
  hideMessages?: boolean;
  hideComposer?: boolean;
  composerMode?: CollaborationChatroomMode;
  onComposerModeChange?: (value: CollaborationChatroomMode) => void;
  autoSummarize?: boolean;
  onAutoSummarizeChange?: (checked: boolean) => void;
  draft: string;
  onDraftChange: (value: string) => void;
  onSubmit: (overrideText?: string) => void | Promise<void>;
  submitLabel: string;
  submitDisabled?: boolean;
  placeholder: string;
  mentionTargets: string[];
  onInsertMention: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  onRegisterScrollToBottomHandler?: (handler: (() => void) | null) => void;
  emptyText?: string;
  helperText?: ReactNode;
  customControls?: ReactNode;
  inlineContent?: ReactNode;
  inlineContentSpeakerName?: string;
  composerOverlay?: ReactNode;
  onTextareaKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  renderMessage?: (message: CollaborationRoomMessage) => ReactNode;
  onDeleteMessage?: (message: CollaborationRoomMessage) => void;
  onQuoteMessage?: (value: string, message: CollaborationRoomMessage) => void;
  onRetryMessage?: (message: CollaborationRoomMessage) => void | Promise<void>;
  canRetryMessage?: (message: CollaborationRoomMessage) => boolean;
  onStopMessage?: (message: CollaborationRoomMessage) => void;
  canStopMessage?: (message: CollaborationRoomMessage) => boolean;
  quoteMentionMode?: 'plain' | 'tag';
  getSpeakerAvatarSrc: (name: string, kind: 'agent' | 'host' | 'system') => string | undefined;
  getInitials: (name: string) => string;
  getMessageKindLabel: (message: CollaborationRoomMessage) => string;
  containerClassName?: string;
  messagesClassName?: string;
  composerClassName?: string;
  variant?: 'panel' | 'channel';
}

export function CollaborationRoomSurface({
  messages,
  hideMessages = false,
  hideComposer = false,
  composerMode,
  onComposerModeChange,
  autoSummarize,
  onAutoSummarizeChange,
  draft,
  onDraftChange,
  onSubmit,
  submitLabel,
  submitDisabled,
  placeholder,
  mentionTargets,
  onInsertMention,
  inputRef,
  bottomRef,
  onRegisterScrollToBottomHandler,
  emptyText = '',
  helperText,
  customControls,
  inlineContent,
  inlineContentSpeakerName,
  composerOverlay,
  onTextareaKeyDown,
  renderMessage,
  onDeleteMessage,
  onQuoteMessage,
  onRetryMessage,
  canRetryMessage,
  onStopMessage,
  canStopMessage,
  quoteMentionMode = 'plain',
  getSpeakerAvatarSrc,
  getInitials,
  getMessageKindLabel,
  containerClassName,
  messagesClassName,
  composerClassName,
  variant = 'panel',
}: CollaborationRoomSurfaceProps) {
  const isChannel = variant === 'channel';
  const { toast } = useToast();
  const [notebookDialogOpen, setNotebookDialogOpen] = useState(false);
  const [notebookSaving, setNotebookSaving] = useState(false);
  const [notebookScope, setNotebookScope] = useState<NotebookScope>('personal');
  const [notebookDirectory, setNotebookDirectory] = useState('');
  const [notebookFileName, setNotebookFileName] = useState('');
  const [notebookMessageId, setNotebookMessageId] = useState<string | null>(null);
  const [mentionSearch, setMentionSearch] = useState<{ start: number; end: number; query: string } | null>(null);
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollLockedRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const notebookMessage = useMemo(
    () => messages.find((message) => message.id === notebookMessageId) || null,
    [messages, notebookMessageId]
  );
  const mentionOptions = useMemo(() => {
    const unique = Array.from(new Set(['全员', ...mentionTargets].map((name) => String(name || '').trim()).filter(Boolean)));
    const query = mentionSearch?.query || '';
    const filtered = query
      ? unique.filter((name) => name.toLowerCase().includes(query))
      : unique;
    return filtered.slice(0, 8);
  }, [mentionSearch?.query, mentionTargets]);
  const showMentionMenu = Boolean(mentionSearch && mentionOptions.length);
  const hasMessageLikeContent = messages.length > 0 || Boolean(inlineContent);
  const latestMessageScrollKey = useMemo(() => {
    const lastMessage = messages[messages.length - 1];
    const lastBody = String(lastMessage?.rawContent || lastMessage?.content || '');
    return [
      messages.length,
      lastMessage?.id || '',
      lastMessage?.status || '',
      lastBody.length,
      inlineContent ? 'inline' : '',
    ].join(':');
  }, [inlineContent, messages]);

  const updateMentionSearchFromText = useCallback((text: string, cursor: number) => {
    const next = getMentionSearch(text, cursor);
    setMentionSearch(next);
    setActiveMentionIndex(0);
  }, []);

  const updateAutoScrollLockState = useCallback(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
    autoScrollLockedRef.current = !nearBottom;
    setShowScrollBtn(!nearBottom && hasMessageLikeContent);
  }, [hasMessageLikeContent]);

  const unlockAutoScroll = useCallback(() => {
    autoScrollLockedRef.current = false;
    setShowScrollBtn(false);
  }, []);

  const performProgrammaticScroll = useCallback(() => {
    isProgrammaticScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
      updateAutoScrollLockState();
    }, 500);
  }, [bottomRef, updateAutoScrollLockState]);

  const scrollToBottom = useCallback(() => {
    unlockAutoScroll();
    performProgrammaticScroll();
  }, [performProgrammaticScroll, unlockAutoScroll]);

  useEffect(() => {
    if (!onRegisterScrollToBottomHandler) return;
    onRegisterScrollToBottomHandler(scrollToBottom);
    return () => {
      onRegisterScrollToBottomHandler(null);
    };
  }, [onRegisterScrollToBottomHandler, scrollToBottom]);

  useEffect(() => {
    const scroller = scrollContainerRef.current;
    if (!scroller) return;
    const handleScroll = () => {
      if (isProgrammaticScrollRef.current) return;
      updateAutoScrollLockState();
    };
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => {
      scroller.removeEventListener('scroll', handleScroll);
    };
  }, [updateAutoScrollLockState]);

  useEffect(() => {
    if (hideMessages || !hasMessageLikeContent) return;
    if (!autoScrollLockedRef.current) {
      performProgrammaticScroll();
    }
  }, [hasMessageLikeContent, hideMessages, latestMessageScrollKey, performProgrammaticScroll]);

  const insertMentionName = useCallback((name: string) => {
    if (!mentionSearch) {
      onInsertMention(`@${name} `);
      return;
    }
    const next = `${draft.slice(0, mentionSearch.start)}@${name} ${draft.slice(mentionSearch.end)}`;
    const cursor = mentionSearch.start + name.length + 2;
    onDraftChange(next);
    setMentionSearch(null);
    window.requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(cursor, cursor);
    });
  }, [draft, inputRef, mentionSearch, onDraftChange, onInsertMention]);

  const handleMentionOptionPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, name: string) => {
    event.preventDefault();
    event.stopPropagation();
    insertMentionName(name);
  }, [insertMentionName]);

  const handleMentionOptionClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>, name: string) => {
    if (event.detail !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    insertMentionName(name);
  }, [insertMentionName]);

  const handleDraftChange = useCallback((event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = event.target.value;
    const cursor = event.target.selectionStart ?? nextValue.length;
    onDraftChange(nextValue);
    updateMentionSearchFromText(nextValue, cursor);
  }, [onDraftChange, updateMentionSearchFromText]);

  const openNotebookDialog = useCallback((message: CollaborationRoomMessage) => {
    setNotebookMessageId(message.id);
    setNotebookScope('personal');
    setNotebookDirectory('');
    setNotebookFileName(createDefaultNotebookFileName(message.createdAt).replace(/\.cj\.md$/i, ''));
    setNotebookDialogOpen(true);
  }, []);

  const handleSaveNotebookMessage = useCallback(async () => {
    if (!notebookMessage) return;
    const normalizedName = normalizeNotebookFileName(notebookFileName) || createDefaultNotebookFileName(notebookMessage.createdAt);
    const normalizedDirectory = notebookDirectory.replace(/^\/+|\/+$/g, '');
    const finalPath = normalizedDirectory ? `${normalizedDirectory}/${normalizedName}` : normalizedName;
    try {
      setNotebookSaving(true);
      await workspaceApi.manageNotebook('create-file', { path: finalPath }, { scope: notebookScope });
      await workspaceApi.saveNotebookFile(finalPath, buildRoomMessageNotebook(notebookMessage), { scope: notebookScope });
      setNotebookDialogOpen(false);
      setNotebookMessageId(null);
      toast('success', `已导入到 Notebook：${finalPath}`);
    } catch (error: any) {
      toast('error', error?.message || '导入 Notebook 失败');
    } finally {
      setNotebookSaving(false);
    }
  }, [notebookDirectory, notebookFileName, notebookMessage, notebookScope, toast]);

  const renderMessageActions = (message: CollaborationRoomMessage) => {
    const content = getRoomMessageText(message);
    const isPending = message.status === 'pending';
    const hasContent = Boolean(content);
    const canStop = Boolean(onStopMessage) && (canStopMessage ? canStopMessage(message) : (isPending && message.speakerType !== 'human'));
    const canReply = hasContent && !isPending && message.speakerType !== 'system';
    const canRetry = Boolean(onRetryMessage) && (
      canRetryMessage
        ? canRetryMessage(message)
        : (hasContent && !isPending && message.status === 'error')
    );
    const canDelete = !isPending && Boolean(onDeleteMessage);
    if (!hasContent && !canStop && !canRetry) return null;

    const quotedText = canReply ? buildQuotedRoomMessage(message, quoteMentionMode) : '';
    const wrapperClassName = cn(
      'mt-2 flex w-full flex-wrap items-center gap-1.5 text-muted-foreground',
      message.speakerType === 'system'
        ? 'justify-center'
        : message.speakerType === 'human'
          ? isChannel
            ? 'justify-start pl-12'
            : 'justify-start pl-11'
          : isChannel
            ? 'pl-12'
            : 'pl-11'
    );

    return (
      <div className={wrapperClassName}>
        {hasContent && !isPending ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md"
            title="复制"
            aria-label="复制"
            onClick={() => { void copyText(content); }}
          >
            <Copy className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {canStop ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md text-destructive hover:text-destructive"
            title="停止"
            aria-label="停止"
            onClick={() => { onStopMessage?.(message); }}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        ) : null}
        {canReply ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md"
            title="回复"
            aria-label="回复"
            onClick={() => {
              if (onQuoteMessage) {
                onQuoteMessage(quotedText, message);
                return;
              }
              const nextDraft = String(draft || '').trimEnd();
              const mergedDraft = nextDraft ? `${nextDraft}\n\n${quotedText}` : quotedText;
              onDraftChange(mergedDraft);
              inputRef.current?.focus();
            }}
          >
            <MessageSquareQuote className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {hasContent && !isPending ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md"
            title="导入到 Notebook"
            aria-label="导入到 Notebook"
            onClick={() => openNotebookDialog(message)}
          >
            <FilePlus2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {canRetry ? (
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1.5 rounded-md px-2 text-xs"
            title="重试"
            aria-label="重试"
            onClick={() => { void onRetryMessage?.(message); }}
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>重试</span>
          </Button>
        ) : null}
        {canDelete ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 rounded-md text-destructive hover:text-destructive"
            title="删除"
            aria-label="删除"
            onClick={() => { onDeleteMessage?.(message); }}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    );
  };

  return (
    <section className={cn(isChannel ? 'flex min-h-0 min-w-0 flex-col bg-background' : 'min-w-0 rounded-xl border bg-background', containerClassName)}>
      {!hideMessages ? (
        <div className={cn('relative', isChannel && 'flex min-h-0 flex-1 flex-col')}>
          <div
            ref={scrollContainerRef}
            className={cn(isChannel ? 'min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5' : 'max-h-[640px] space-y-3 overflow-y-auto px-4 py-4', messagesClassName)}
          >
          {messages.length === 0 ? (
            isChannel || !emptyText ? <div className="min-h-[160px]" /> : (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                {emptyText}
              </div>
            )
          ) : messages.map((message) => {
            if (renderMessage) {
              return (
                <div key={message.id} className="group space-y-2">
                  {renderMessage(message)}
                  {renderMessageActions(message)}
                </div>
              );
            }
            const isHost = message.chatroom?.kind === 'host';
            const isSummary = message.chatroom?.kind === 'summary';
            const isSystem = message.speakerType === 'system';
            const isHuman = message.speakerType === 'human';
            const isVote = ['vote', 'vote-result'].includes(message.chatroom?.kind || '');
            if (isHuman) {
              if (isChannel) {
                return (
                  <div key={message.id} className="group space-y-2">
                    <div className="flex items-start gap-3">
                      <Avatar className="mt-0.5 h-9 w-9 ring-1 ring-primary/25">
                        <AvatarImage
                          src={getSpeakerAvatarSrc(message.speakerName, 'host')}
                          alt={message.speakerName}
                          className="object-cover"
                        />
                        <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                          {getInitials(message.speakerName)}
                        </AvatarFallback>
                      </Avatar>
                      <article className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold text-foreground">{message.speakerName}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <Badge variant="outline" className="h-5 text-[10px]">{getMessageKindLabel(message)}</Badge>
                        </div>
                        <div className="mt-1 max-w-[min(84%,860px)] rounded-lg border border-primary/15 bg-primary/5 px-3 py-2 text-sm leading-6 text-foreground">
                          {renderRoomMessageContent(message) || (message.status === 'pending' ? '正在生成...' : '无内容')}
                        </div>
                        {message.chatroom?.mentions?.length ? (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.chatroom.mentions.map((name) => (
                              <Badge key={`${message.id}-${name}`} variant="outline" className="h-5 text-[10px]">
                                @{name}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    </div>
                    {renderMessageActions(message)}
                  </div>
                );
              }
              return (
                <div key={message.id} className="group space-y-2">
                  <div className="flex justify-start">
                    <article className="max-w-[86%] rounded-xl border border-primary/15 bg-primary/5 p-3 shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="truncate text-sm font-semibold text-foreground">{message.speakerName}</span>
                        <Badge variant="outline" className="text-[10px]">{getMessageKindLabel(message)}</Badge>
                      </div>
                      <div className="mt-2 text-left text-sm leading-6 text-foreground">
                        {renderRoomMessageContent(message) || (message.status === 'pending' ? '正在生成...' : '无内容')}
                      </div>
                      {message.chatroom?.mentions?.length ? (
                        <div className="mt-3 flex flex-wrap justify-start gap-1">
                          {message.chatroom.mentions.map((name) => (
                            <Badge key={`${message.id}-${name}`} variant="outline" className="text-[10px]">
                              @{name}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  </div>
                  {renderMessageActions(message)}
                </div>
              );
            }
            if (isChannel) {
              if (isSystem) {
                const hasBody = Boolean(String(message.rawContent || message.content || '').trim()) || message.status === 'pending';
                return (
                  <div key={message.id} className="group space-y-2">
                    <div className="flex justify-center">
                      {hasBody ? (
                        <div className="max-w-[72%] rounded-md bg-muted px-3 py-1.5 text-left text-xs leading-5 text-muted-foreground">
                          {renderRoomMessageContent(message)}
                        </div>
                      ) : null}
                    </div>
                    {renderMessageActions(message)}
                  </div>
                );
              }

              return (
                <div key={message.id} className="group space-y-2">
                  <div className="flex items-start gap-3">
                    <Avatar className={cn('mt-0.5 h-9 w-9 ring-1', isHost ? 'ring-slate-900/20' : isHuman ? 'ring-primary/25' : 'ring-border/70')}>
                      <AvatarImage
                        src={getSpeakerAvatarSrc(message.speakerName, isHost || isHuman ? 'host' : 'agent')}
                        alt={message.speakerName}
                        className="object-cover"
                      />
                      <AvatarFallback className={cn('text-[10px] font-semibold', isHost ? 'bg-slate-950 text-slate-100' : isHuman ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                        {getInitials(message.speakerName)}
                      </AvatarFallback>
                    </Avatar>
                    <article className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-foreground">{message.speakerName}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {(isSummary || isVote || message.status === 'error') ? (
                          <Badge variant="outline" className="h-5 text-[10px]">
                            {getMessageKindLabel(message)}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="mt-1 max-w-[min(84%,860px)] text-sm leading-6 text-foreground">
                        {renderRoomMessageContent(message)}
                      </div>
                      {message.chatroom?.mentions?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {message.chatroom.mentions.map((name) => (
                            <Badge key={`${message.id}-${name}`} variant="outline" className="h-5 text-[10px]">
                              @{name}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                    </article>
                  </div>
                  {renderMessageActions(message)}
                </div>
              );
            }
            return (
              <div key={message.id} className="group space-y-2">
                <div
                  className={cn(
                    'flex',
                    isSystem ? 'justify-center' : 'justify-start'
                  )}
                >
                  <article
                    className={cn(
                      'w-full rounded-xl border p-3 shadow-sm',
                      !isSystem && 'max-w-[86%]',
                      isHuman && 'border-primary/15 bg-primary/5',
                      isSummary && 'border-emerald-500/25 bg-emerald-500/5',
                      isHost && 'border-slate-900 bg-slate-950 text-slate-50',
                      isSystem && !isSummary && 'max-w-[72%] border-slate-300/60 bg-slate-50',
                      isVote && 'border-amber-500/25 bg-amber-500/5',
                      message.status === 'error' && 'border-rose-500/35 bg-rose-500/5'
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {!isSystem ? (
                          <Avatar className={cn('h-8 w-8 ring-1', isHost ? 'ring-white/15' : isHuman ? 'ring-primary/20' : 'ring-border/70')}>
                            <AvatarImage
                              src={getSpeakerAvatarSrc(message.speakerName, isHost || isHuman ? 'host' : 'agent')}
                              alt={message.speakerName}
                              className="object-cover"
                            />
                            <AvatarFallback className={cn('text-[10px] font-semibold', isHost ? 'bg-white/10 text-slate-100' : isHuman ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary')}>
                              {getInitials(message.speakerName)}
                            </AvatarFallback>
                          </Avatar>
                        ) : null}
                        <span className={cn('truncate text-sm font-semibold', isHost ? 'text-white' : 'text-foreground')}>{message.speakerName}</span>
                        <Badge variant="outline" className={cn('text-[10px]', isHost && 'border-white/20 bg-white/10 text-slate-100')}>
                          {getMessageKindLabel(message)}
                        </Badge>
                      </div>
                      <div className={cn('text-[11px]', isHost ? 'text-slate-300' : 'text-muted-foreground')}>
                        {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className={cn('mt-2 text-sm leading-6', isHost ? 'text-slate-100' : 'text-foreground')}>
                      {renderRoomMessageContent(message) || (message.status === 'pending' ? '正在生成...' : '无内容')}
                    </div>
                    {message.chatroom?.mentions?.length ? (
                      <div className="mt-3 flex flex-wrap justify-start gap-1">
                        {message.chatroom.mentions.map((name) => (
                          <Badge
                            key={`${message.id}-${name}`}
                            variant="outline"
                            className={cn('text-[10px]', isHost && 'border-white/20 bg-white/10 text-slate-100')}
                          >
                            @{name}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </article>
                </div>
                {renderMessageActions(message)}
              </div>
            );
          })}
          {inlineContent ? (
            <div className="group space-y-2">
              <div className={cn(isChannel ? 'flex items-start gap-3' : 'flex justify-start')}>
                {isChannel ? (
                  <Avatar className="mt-0.5 h-9 w-9 ring-1 ring-border/70">
                    <AvatarImage
                      src={getSpeakerAvatarSrc(inlineContentSpeakerName || 'Supervisor', 'agent')}
                      alt={inlineContentSpeakerName || 'Supervisor'}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                      {getInitials(inlineContentSpeakerName || 'Supervisor')}
                    </AvatarFallback>
                  </Avatar>
                ) : null}
                <article className="min-w-0 flex-1">
                  {isChannel ? (
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-foreground">{inlineContentSpeakerName || 'Supervisor'}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <Badge variant="outline" className="h-5 text-[10px]">人工审查</Badge>
                    </div>
                  ) : null}
                  <div className={cn(
                    isChannel
                      ? 'max-w-[min(92%,980px)] rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/20'
                      : 'rounded-xl border border-amber-300/60 bg-amber-50/70 p-3 shadow-sm dark:border-amber-500/30 dark:bg-amber-950/20'
                  )}>
                    {inlineContent}
                  </div>
                </article>
              </div>
            </div>
          ) : null}
          <div ref={(node) => { (bottomRef as any).current = node; }} />
          </div>
          {showScrollBtn ? (
            <Button
              type="button"
              size="icon"
              className="absolute bottom-4 right-4 z-20 h-10 w-10 rounded-full shadow-lg"
              onClick={scrollToBottom}
              title="滚动到底部"
              aria-label="滚动到底部"
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      ) : null}

      {!hideComposer ? (
        <div className={cn(isChannel ? 'shrink-0 border-t bg-background px-5 py-3' : 'border-t px-4 py-4', composerClassName)}>
          <div className={cn(isChannel ? 'space-y-2' : 'grid gap-3')}>
          {customControls ?? (composerMode && onComposerModeChange && typeof autoSummarize === 'boolean' && onAutoSummarizeChange ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={composerMode} onValueChange={(value: CollaborationChatroomMode) => onComposerModeChange(value)}>
                <SelectTrigger className="h-9 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facilitated">群聊</SelectItem>
                  <SelectItem value="mention-driven">点名接话</SelectItem>
                  <SelectItem value="broadcast">全员回应</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                <Switch checked={autoSummarize} onCheckedChange={onAutoSummarizeChange} />
                <span>本轮结束后自动总结</span>
              </div>
            </div>
          ) : null)}

          {!isChannel && mentionTargets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="ghost" className={cn(isChannel ? 'h-6 rounded-md px-2 text-[11px]' : 'h-7 px-2 text-[11px]')} onClick={() => insertMentionName('全员')}>
                @全员
              </Button>
              {mentionTargets.map((name) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="ghost"
                  className={cn(isChannel ? 'h-6 rounded-md px-2 text-[11px]' : 'h-7 px-2 text-[11px]')}
                  onClick={() => insertMentionName(name)}
                >
                  @{name}
                </Button>
              ))}
            </div>
          ) : null}

          <div className={cn(
            'relative',
            isChannel
              ? 'overflow-visible rounded-[28px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]'
              : ''
          )}>
            <Textarea
              ref={(node) => { (inputRef as any).current = node; }}
              value={draft}
              onChange={handleDraftChange}
              placeholder={placeholder}
              rows={isChannel ? 4 : 4}
              className={cn(
                'resize-none text-sm',
                isChannel
                  ? 'min-h-[116px] border-0 bg-transparent px-6 pb-2 pt-4 text-[15px] leading-6 shadow-none focus-visible:ring-0'
                  : 'min-h-[120px]'
              )}
              onKeyDown={(event) => {
                if (showMentionMenu) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    setActiveMentionIndex((index) => (index + 1) % mentionOptions.length);
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    setActiveMentionIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length);
                    return;
                  }
                  if (event.key === 'Enter' || event.key === 'Tab') {
                    event.preventDefault();
                    insertMentionName(mentionOptions[activeMentionIndex] || mentionOptions[0]);
                    return;
                  }
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    setMentionSearch(null);
                    return;
                  }
                }
                onTextareaKeyDown?.(event);
                if (event.defaultPrevented) return;
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
            />
            {composerOverlay}
            {showMentionMenu ? (
              <div className="absolute bottom-[calc(100%+8px)] left-6 z-[120] w-64 overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl">
                {mentionOptions.map((name, index) => (
                  <button
                    key={name}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                      index === activeMentionIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/70'
                    )}
                    onPointerDown={(event) => handleMentionOptionPointerDown(event, name)}
                    onClick={(event) => handleMentionOptionClick(event, name)}
                  >
                    <Avatar className="h-6 w-6 ring-1 ring-border/60">
                      <AvatarImage src={getSpeakerAvatarSrc(name, name === '全员' ? 'system' : 'agent')} alt={name} className="object-cover" />
                      <AvatarFallback className="bg-primary/10 text-[9px] font-semibold text-primary">
                        {getInitials(name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1 truncate">{name === '全员' ? '@全员' : `@${name}`}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {isChannel ? (
              <div className="flex items-center justify-between gap-2 border-t border-border/60 px-6 pb-3 pt-3">
                <span className="text-[10px] text-muted-foreground">Shift+Enter 换行</span>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground">{draft.length}/10000</span>
                  <Button
                    size="icon"
                    className="h-11 w-11 rounded-2xl bg-[#1f6fff] px-0 shadow-sm transition-colors duration-150 hover:bg-[#1a61de]"
                    onClick={() => void onSubmit()}
                    disabled={submitDisabled}
                    aria-label={submitLabel}
                    title={submitLabel}
                  >
                    <SendHorizontal className="h-5 w-5 text-white" />
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          {!isChannel ? (
            <div className="flex items-center justify-between gap-3">
              {helperText ? <p className="text-xs leading-5 text-muted-foreground">{helperText}</p> : <span />}
              <Button onClick={() => void onSubmit()} disabled={submitDisabled}>
                {submitLabel}
              </Button>
            </div>
          ) : null}
          </div>
        </div>
      ) : null}
      <NotebookSaveDialog
        open={notebookDialogOpen}
        onOpenChange={(open) => {
          if (!notebookSaving) setNotebookDialogOpen(open);
        }}
        scope={notebookScope}
        onScopeChange={setNotebookScope}
        directory={notebookDirectory}
        onDirectoryChange={setNotebookDirectory}
        directories={[]}
        loadingDirectories={false}
        saving={notebookSaving}
        title="导入到 Notebook"
        confirmLabel="导入"
        contentClassName="z-[160]"
        onConfirm={() => { void handleSaveNotebookMessage(); }}
        extraContent={(
          <div>
            <div className="mb-1 text-xs text-muted-foreground">文件名</div>
            <Input
              value={notebookFileName}
              onChange={(event) => setNotebookFileName(event.target.value)}
              className="h-8 text-sm"
              placeholder="例如：议场发言"
            />
          </div>
        )}
      />
    </section>
  );
}
