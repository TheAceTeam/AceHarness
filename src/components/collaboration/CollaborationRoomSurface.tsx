'use client';

import type { KeyboardEventHandler, ReactNode, RefObject } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/core/utils';
import type { CollaborationChatroomMode, CollaborationRoomMessage } from '@/lib/core/home-sidebar-state';

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
  onSubmit: () => void | Promise<void>;
  submitLabel: string;
  submitDisabled?: boolean;
  placeholder: string;
  mentionTargets: string[];
  onInsertMention: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  bottomRef: RefObject<HTMLDivElement | null>;
  emptyText?: string;
  helperText?: ReactNode;
  customControls?: ReactNode;
  composerOverlay?: ReactNode;
  onTextareaKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
  renderMessage?: (message: CollaborationRoomMessage) => ReactNode;
  getSpeakerAvatarSrc: (name: string, kind: 'agent' | 'host' | 'system') => string | undefined;
  getInitials: (name: string) => string;
  getMessageKindLabel: (message: CollaborationRoomMessage) => string;
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
  emptyText = '还没有消息。',
  helperText,
  customControls,
  composerOverlay,
  onTextareaKeyDown,
  renderMessage,
  getSpeakerAvatarSrc,
  getInitials,
  getMessageKindLabel,
}: CollaborationRoomSurfaceProps) {
  return (
    <section className="min-w-0 rounded-xl border bg-background">
      {!hideMessages ? (
        <div className="max-h-[640px] space-y-3 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : messages.map((message) => {
            if (renderMessage) {
              return renderMessage(message);
            }
            const isHost = message.chatroom?.kind === 'host';
            const isSummary = message.chatroom?.kind === 'summary';
            const isSystem = message.speakerType === 'system';
            const isVote = ['vote', 'vote-result'].includes(message.chatroom?.kind || '');
            return (
              <article
                key={message.id}
                className={cn(
                  'rounded-xl border p-3 shadow-sm',
                  isSummary && 'border-emerald-500/25 bg-emerald-500/5',
                  isHost && 'border-slate-900 bg-slate-950 text-slate-50',
                  isSystem && !isSummary && 'border-slate-300/60 bg-slate-50',
                  isVote && 'border-amber-500/25 bg-amber-500/5',
                  message.status === 'error' && 'border-rose-500/35 bg-rose-500/5'
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Avatar className={cn('h-8 w-8 ring-1', isHost ? 'ring-white/15' : 'ring-border/70')}>
                      <AvatarImage
                        src={getSpeakerAvatarSrc(message.speakerName, isHost ? 'host' : isSystem ? 'system' : 'agent')}
                        alt={message.speakerName}
                        className="object-cover"
                      />
                      <AvatarFallback className={cn('text-[10px] font-semibold', isHost ? 'bg-white/10 text-slate-100' : 'bg-primary/10 text-primary')}>
                        {getInitials(message.speakerName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className={cn('truncate text-sm font-semibold', isHost ? 'text-white' : 'text-foreground')}>{message.speakerName}</span>
                    <Badge variant="outline" className={cn('text-[10px]', isHost && 'border-white/20 bg-white/10 text-slate-100')}>
                      {getMessageKindLabel(message)}
                    </Badge>
                  </div>
                  <div className={cn('text-[11px]', isHost ? 'text-slate-300' : 'text-muted-foreground')}>
                    {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
                <div className={cn('mt-2 whitespace-pre-wrap text-sm leading-6', isHost ? 'text-slate-100' : 'text-foreground')}>
                  {message.content || (message.status === 'pending' ? '正在生成...' : '无内容')}
                </div>
                {message.status === 'pending' ? <Progress className="mt-3 h-1.5" value={68} /> : null}
                {message.chatroom?.mentions?.length ? (
                  <div className="mt-3 flex flex-wrap gap-1">
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
            );
          })}
          <div ref={(node) => { (bottomRef as any).current = node; }} />
        </div>
      ) : null}

      {!hideComposer ? (
        <div className="border-t px-4 py-4">
          <div className="grid gap-3">
          {customControls ?? (composerMode && onComposerModeChange && typeof autoSummarize === 'boolean' && onAutoSummarizeChange ? (
            <div className="flex flex-wrap items-center gap-2">
              <Select value={composerMode} onValueChange={(value: CollaborationChatroomMode) => onComposerModeChange(value)}>
                <SelectTrigger className="h-9 w-[170px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="facilitated">百灵鸟控场</SelectItem>
                  <SelectItem value="mention-driven">点名接话</SelectItem>
                  <SelectItem value="broadcast">广播讨论</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs">
                <Switch checked={autoSummarize} onCheckedChange={onAutoSummarizeChange} />
                <span>本轮结束后自动总结</span>
              </div>
            </div>
          ) : null)}

          <div className="relative">
            <Textarea
              ref={(node) => { (inputRef as any).current = node; }}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={placeholder}
              rows={4}
              className="min-h-[120px] resize-none text-sm"
              onKeyDown={(event) => {
                onTextareaKeyDown?.(event);
                if (event.defaultPrevented) return;
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void onSubmit();
                }
              }}
            />
            {composerOverlay}
          </div>

          {mentionTargets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-[11px]" onClick={() => onInsertMention('@全员 ')}>
                @全员
              </Button>
              {mentionTargets.map((name) => (
                <Button
                  key={name}
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={() => onInsertMention(`@${name} `)}
                >
                  @{name}
                </Button>
              ))}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs leading-5 text-muted-foreground">{helperText}</p>
            <Button onClick={() => void onSubmit()} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
