'use client';

import { Badge } from '@/components/ui/badge';
import Markdown from '@/components/Markdown';
import { WrapperProcessBlocks } from '@/components/chat/ChatMessage';
import { cn } from '@/lib/core/utils';

export function getCollaborationSpeakerAvatarSrc() {
  return undefined;
}

export function getCollaborationInitials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

export function getCollaborationMessageKindLabel(message: any) {
  return message.speakerType === 'human'
    ? '人工'
    : message.speakerType === 'supervisor'
      ? 'Supervisor'
      : message.speakerType === 'system'
        ? '系统'
        : '协作 Agent';
}

export function handleCollaborationMentionKeyDown({
  event,
  mentionSuggestions,
  activeMentionIndex,
  setActiveMentionIndex,
  insertMention,
  setDraft,
}: {
  event: any;
  mentionSuggestions: string[];
  activeMentionIndex: number;
  setActiveMentionIndex: (updater: (prev: number) => number) => void;
  insertMention: (value: string) => void;
  setDraft: (updater: (prev: string) => string) => void;
}) {
  if (mentionSuggestions.length === 0) return;

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
    insertMention(mentionSuggestions[activeMentionIndex] || mentionSuggestions[0]);
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    setDraft((prev) => `${prev} `);
  }
}

export function getVisibleWerewolfMessages({
  collaborationMessages,
  shouldHideWerewolfMessageFromChat,
  canSeeWerewolfMessage,
  werewolfState,
  werewolfViewMode,
  effectiveWerewolfNightViewer,
}: {
  collaborationMessages: any[];
  shouldHideWerewolfMessageFromChat: (message: any) => boolean;
  canSeeWerewolfMessage: (input: any) => boolean;
  werewolfState: any;
  werewolfViewMode: any;
  effectiveWerewolfNightViewer: any;
}) {
  return [...collaborationMessages]
    .filter((message) => !shouldHideWerewolfMessageFromChat(message))
    .filter((message) => canSeeWerewolfMessage({
      message,
      state: werewolfState,
      viewMode: werewolfViewMode,
      viewer: effectiveWerewolfNightViewer,
    }))
    .slice(-10);
}

export function shouldShowWerewolfSummaryCard({
  lastSummary,
  visibleWerewolfMessages,
  prepareWerewolfMessageForChat,
}: {
  lastSummary?: string;
  visibleWerewolfMessages: any[];
  prepareWerewolfMessageForChat: (message: any) => any;
}) {
  return Boolean(
    lastSummary
    && !visibleWerewolfMessages.some((message) => prepareWerewolfMessageForChat(message).content === lastSummary)
  );
}

export function renderWerewolfSurfaceMessage({
  message,
  werewolfState,
  prepareWerewolfMessageForChat,
  getWerewolfSpeakerVisual,
  getWerewolfSpeakerInitial,
  formatWerewolfRole,
  formatWerewolfActionLabel,
}: {
  message: any;
  werewolfState: any;
  prepareWerewolfMessageForChat: (message: any) => any;
  getWerewolfSpeakerVisual: (name: string, players: any) => any;
  getWerewolfSpeakerInitial: (name: string) => string;
  formatWerewolfRole: (role: any) => string;
  formatWerewolfActionLabel: (action: any) => string;
}) {
  const displayMessage = prepareWerewolfMessageForChat(message);
  const werewolfVisual = getWerewolfSpeakerVisual(message.speakerName, werewolfState?.players);
  const werewolfPlayer = werewolfState?.players?.find((item: any) => item.agentName === message.speakerName);
  const isStreamingPlaceholder = message.status === 'pending' && !displayMessage.content.trim();
  const visibleContent = displayMessage.content || '';
  const hasProcessContent = visibleContent.includes('<ace-process>');
  const tone =
    werewolfVisual
      ? `${werewolfVisual.card} shadow-[0_14px_30px_rgba(0,0,0,0.28)]`
      : message.speakerType === 'human'
        ? 'border-primary/30 bg-primary/5'
        : message.speakerType === 'supervisor'
          ? 'border-amber-500/30 bg-amber-500/5'
          : message.speakerType === 'system'
            ? 'border-muted bg-muted/30'
            : 'border-sky-500/25 bg-sky-500/5';

  return (
    <div key={message.id} className={`relative overflow-hidden rounded-[24px] border p-3 text-xs ${tone}`}>
      <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
      {werewolfVisual ? <span className="pointer-events-none absolute -left-1 top-7 h-3.5 w-3.5 rotate-45 border-b border-l border-current/10 bg-inherit" /> : null}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold shadow-[0_8px_18px_rgba(0,0,0,0.24)]',
            werewolfVisual
              ? `${werewolfVisual.avatar} ${message.status === 'pending' ? 'animate-pulse shadow-[0_0_0_4px_rgba(251,191,36,0.08)]' : ''}`
              : message.speakerType === 'supervisor'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : message.speakerType === 'system'
                  ? 'border-muted bg-muted/60 text-muted-foreground'
                  : 'border-primary/30 bg-primary/10 text-primary'
          )}>
            {message.speakerType === 'system' ? '系' : getWerewolfSpeakerInitial(message.speakerName)}
          </span>
          <div className="min-w-0">
            <div className={`truncate font-semibold ${werewolfVisual?.name || 'text-foreground'}`}>{message.speakerName}</div>
            {werewolfVisual ? (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                <span className="rounded-full border border-white/10 bg-black/15 px-1.5 py-0.5 text-[9px] text-current/80">
                  {werewolfPlayer ? formatWerewolfRole(werewolfPlayer.role) : '玩家'}
                </span>
                {message.werewolf?.visibility && message.werewolf.visibility !== 'public' ? (
                  <span className="rounded-full border border-white/10 bg-black/15 px-1.5 py-0.5 text-[9px] text-current/80">
                    {message.werewolf.visibility === 'werewolves' ? '狼队可见' : message.werewolf.visibility === 'private' ? '私聊' : '上帝'}
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {message.werewolf?.action ? (
            <Badge variant="secondary" className="border-white/10 bg-background/25 text-[9px] text-current/85">
              {formatWerewolfActionLabel(message.werewolf.action)}
            </Badge>
          ) : null}
          <Badge variant={message.status === 'error' ? 'destructive' : 'outline'} className="text-[9px]">
            {getCollaborationMessageKindLabel(message)}
          </Badge>
          <span className="text-[10px] text-muted-foreground">
            {new Date(message.createdAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
      <div className={cn('mt-2 whitespace-pre-wrap break-words leading-6 text-muted-foreground', isStreamingPlaceholder && 'flex min-h-[56px] items-center justify-center')}>
        {message.status === 'pending' ? (
          <div className="mb-2 flex items-center text-[11px] text-muted-foreground/80">
            <span className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              正在发言
            </span>
          </div>
        ) : null}
        {!isStreamingPlaceholder ? (
          hasProcessContent
            ? <WrapperProcessBlocks content={visibleContent} isStreaming={message.status === 'pending'} />
            : <Markdown>{visibleContent}</Markdown>
        ) : null}
      </div>
    </div>
  );
}
