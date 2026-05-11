'use client';

import { ActionState } from '@/lib/chat-actions';
import Markdown from '@/components/Markdown';
import ActionCard from './ActionCard';
import UniversalCard from './cards/UniversalCard';
import { memo, useEffect, useState } from 'react';
import { getEngineDisplayName } from '@/lib/engine-metadata';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getWerewolfRoleSpriteStyle } from '@/lib/werewolf-role-assets';

let modelLabelCache: Map<string, string> | null = null;
let modelLabelPromise: Promise<Map<string, string>> | null = null;
const ACTION_TAG_PATTERN = /^(创建工作流|创建 Agent)\s·\s/;
const WORKFLOW_EVENT_PATTERN = /^<workflow-event\s+([^>]*)>\s*([\s\S]*?)\s*<\/workflow-event>$/;
const WEREWOLF_CHAT_COLORS = [
  { avatar: 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300', name: 'text-rose-700 dark:text-rose-300', bubble: 'border-rose-500/25 bg-rose-500/8' },
  { avatar: 'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300', name: 'text-sky-700 dark:text-sky-300', bubble: 'border-sky-500/25 bg-sky-500/8' },
  { avatar: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', name: 'text-emerald-700 dark:text-emerald-300', bubble: 'border-emerald-500/25 bg-emerald-500/8' },
  { avatar: 'border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300', name: 'text-violet-700 dark:text-violet-300', bubble: 'border-violet-500/25 bg-violet-500/8' },
  { avatar: 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300', name: 'text-amber-700 dark:text-amber-300', bubble: 'border-amber-500/25 bg-amber-500/8' },
  { avatar: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300', name: 'text-cyan-700 dark:text-cyan-300', bubble: 'border-cyan-500/25 bg-cyan-500/8' },
  { avatar: 'border-lime-500/30 bg-lime-500/15 text-lime-700 dark:text-lime-300', name: 'text-lime-700 dark:text-lime-300', bubble: 'border-lime-500/25 bg-lime-500/8' },
  { avatar: 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300', name: 'text-fuchsia-700 dark:text-fuchsia-300', bubble: 'border-fuchsia-500/25 bg-fuchsia-500/8' },
] as const;

function parseWorkflowEvent(content: string) {
  const match = content.trim().match(WORKFLOW_EVENT_PATTERN);
  if (!match) return null;

  const attrs = new Map<string, string>();
  match[1].replace(/([a-zA-Z0-9_-]+)="([^"]*)"/g, (_, key: string, value: string) => {
    attrs.set(key, value);
    return '';
  });

  const bodyLines = match[2].split('\n').map((line) => line.trim()).filter(Boolean);
  const title = bodyLines[0] || 'Workflow 事件';
  const body = bodyLines.slice(1).join('\n');
  return {
    type: attrs.get('type') || 'event',
    tags: (attrs.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean),
    title,
    body,
  };
}

function getWorkflowEventIcon(type: string) {
  if (type.includes('human') || type.includes('approval')) return 'person_alert';
  if (type.includes('failed')) return 'error';
  if (type.includes('complete')) return 'task_alt';
  if (type.includes('step')) return 'footprint';
  if (type.includes('review')) return 'rate_review';
  return 'account_tree';
}

async function loadModelLabels(): Promise<Map<string, string>> {
  if (modelLabelCache) return modelLabelCache;
  if (!modelLabelPromise) {
    modelLabelPromise = fetch('/api/models')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load models: ${res.status}`);
        const data = await res.json();
        const labels = new Map<string, string>();
        for (const model of data.models || []) {
          if (model?.value) {
            labels.set(model.value, model.label || model.value);
          }
        }
        modelLabelCache = labels;
        return labels;
      })
      .catch(() => {
        modelLabelPromise = null;
        return new Map<string, string>();
      });
  }
  return modelLabelPromise;
}

interface ChatMessageProps {
  message: {
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    rawContent?: string;
    source?: {
      type: 'wechat';
      label?: string;
      direction?: 'inbound' | 'outbound';
    };
    actions?: ActionState[];
    cards?: any[];
    engine?: string;
    model?: string;
    costUsd?: number;
    durationMs?: number;
    usage?: { input_tokens: number; output_tokens: number };
    timestamp?: number;
  };
  isStreaming?: boolean;
  onConfirmAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onUndoAction: (actionId: string) => void;
  onRetryAction: (actionId: string) => void;
  onAction?: (prompt: string) => void;
  onDelete?: (messageId: string) => void;
  onRetryFromMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string) => void;
  onContinue?: (messageId: string) => void; // For timeout recovery
  onSaveAsNotebook?: (messageId: string) => void;
  werewolfView?: {
    mode: 'god' | 'night';
    viewer?: string;
  };
  currentUser?: {
    username?: string;
    avatar?: string;
  } | null;
}

export function ThinkingBot() {
  return (
    <div className="flex items-center gap-1.5 py-1.5">
      <svg className="shrink-0 animate-[botBounce_1.2s_ease-in-out_infinite]" width="28" height="28" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cbBody" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#6C8EF2" />
            <stop offset="100%" stopColor="#4A6CF7" />
          </linearGradient>
          <linearGradient id="cbFace" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#E8F0FE" />
            <stop offset="100%" stopColor="#C5D8F9" />
          </linearGradient>
        </defs>
        <g transform="translate(0,800) scale(0.1,-0.1)" stroke="none">
          <path fill="url(#cbBody)" d="M4552 6155 c-67 -19 -85 -29 -136 -74 -30 -27 -60 -42 -111 -55 -332 -85 -548 -304 -619 -627 l-17 -75 -67 -12 c-140 -24 -291 -88 -355 -150 -42 -40 -87 -123 -87 -159 0 -14 -6 -23 -16 -23 -25 0 -186 -67 -325 -136 -137 -67 -286 -164 -381 -247 -94 -82 -217 -242 -279 -363 -30 -58 -58 -108 -64 -109 -92 -25 -102 -30 -155 -84 -67 -66 -128 -183 -161 -307 -32 -121 -38 -325 -11 -429 28 -112 67 -188 131 -258 61 -65 116 -96 172 -97 33 0 37 -3 48 -40 18 -60 103 -180 179 -251 200 -190 486 -332 852 -425 408 -104 751 -110 1225 -23 290 54 481 113 670 209 257 130 410 270 525 483 37 69 60 94 60 68 0 -16 86 -24 122 -12 159 52 236 422 168 803 -40 221 -177 406 -286 385 -22 -4 -28 2 -51 47 -96 190 -259 360 -505 527 -130 88 -335 191 -465 234 -54 17 -83 32 -83 41 0 20 -27 71 -59 112 -36 46 -143 115 -235 152 -74 30 -248 70 -302 70 -25 0 -26 2 -20 38 4 20 25 75 47 121 68 138 167 224 333 286 l66 25 15 -29 c21 -42 90 -98 143 -115 58 -20 157 -20 212 -1 58 20 115 68 148 123 22 39 27 58 26 112 -1 111 -54 199 -148 245 -66 32 -136 39 -204 20z" />
          <path fill="url(#cbFace)" d="M3640 4394 c-194 -14 -558 -57 -625 -74 -224 -57 -381 -189 -480 -403 -56 -121 -76 -219 -82 -402 -6 -197 14 -311 77 -443 108 -225 363 -358 801 -418 179 -25 751 -25 1014 0 331 31 463 65 601 158 133 89 235 248 291 453 26 93 27 113 27 295 0 185 -2 199 -28 280 -43 131 -82 196 -171 286 -68 68 -97 89 -185 133 -215 105 -383 132 -845 136 -187 1 -365 1 -395 -1z" />
          <path fill="#2D3748" d="M3163 3865 c-156 -43 -257 -181 -257 -350 0 -144 60 -254 171 -312 78 -40 140 -50 218 -34 103 22 178 79 226 174 87 171 73 314 -42 429 -90 90 -205 124 -316 93z">
            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
          </path>
          <path fill="#2D3748" d="M4373 3856 c-100 -32 -195 -114 -236 -204 -17 -37 -22 -66 -22 -137 0 -82 3 -97 33 -157 37 -77 90 -128 172 -167 47 -22 69 -26 145 -26 78 0 98 4 153 29 212 98 257 390 86 560 -92 92 -231 135 -331 102z">
            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
          </path>
        </g>
      </svg>
      <span className="text-[13px] text-muted-foreground">思考中</span>
      <span className="inline-flex gap-px text-lg font-bold text-muted-foreground">
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite]">.</span>
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite_0.2s]">.</span>
        <span className="animate-[dotFade_1.4s_ease-in-out_infinite_0.4s]">.</span>
      </span>
    </div>
  );
}

// Robot Logo component for app icons
export function RobotLogo({ size = 32, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`animate-robotGlow ${className}`}
      width={size}
      height={size}
      viewBox="0 0 800 800"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="robotLogoBody" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#818CF8" />
          <stop offset="50%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#4F46E5" />
        </linearGradient>
        <linearGradient id="robotLogoInner" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#A5B4FC" />
          <stop offset="100%" stopColor="#818CF8" />
        </linearGradient>
        <linearGradient id="robotLogoRing" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#C7D2FE" />
          <stop offset="100%" stopColor="#A5B4FC" />
        </linearGradient>
      </defs>

      {/* Outer ring */}
      <circle cx="400" cy="400" r="380" fill="url(#robotLogoRing)" opacity="0.3">
        <animate attributeName="r" values="380;390;380" dur="4s" repeatCount="indefinite" />
      </circle>
      <circle cx="400" cy="400" r="350" fill="none" stroke="url(#robotLogoRing)" strokeWidth="12" opacity="0.5">
        <animate attributeName="opacity" values="0.5;0.3;0.5" dur="3s" repeatCount="indefinite" />
      </circle>

      {/* Robot body */}
      <circle cx="400" cy="400" r="280" fill="url(#robotLogoBody)">
        <animate attributeName="r" values="280;285;280" dur="4s" repeatCount="indefinite" />
      </circle>

      {/* Inner face area */}
      <circle cx="400" cy="400" r="200" fill="url(#robotLogoInner)" />

      {/* Left eye */}
      <ellipse cx="320" cy="360" rx="45" ry="50" fill="#1E1B4B">
        <animate attributeName="ry" values="50;5;50" dur="3s" repeatCount="indefinite" keyTimes="0;0.45;0.5;1" />
      </ellipse>
      <ellipse cx="310" cy="345" rx="15" ry="15" fill="white" opacity="0.6">
        <animate attributeName="ry" values="15;3;15" dur="3s" repeatCount="indefinite" keyTimes="0;0.45;0.5;1" />
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="3s" repeatCount="indefinite" keyTimes="0;0.45;0.5;1" />
      </ellipse>

      {/* Right eye */}
      <ellipse cx="480" cy="360" rx="45" ry="50" fill="#1E1B4B">
        <animate attributeName="ry" values="50;5;50" dur="3s" repeatCount="indefinite" keyTimes="0;0.45;0.5;1" />
      </ellipse>
      <ellipse cx="470" cy="345" rx="15" ry="15" fill="white" opacity="0.6">
        <animate attributeName="ry" values="15;3;15" dur="3s" repeatCount="indefinite" keyTimes="0;0.45;0.5;1" />
        <animate attributeName="opacity" values="0.6;0.2;0.6" dur="3s" repeatCount="indefinite" keyTimes="0;0.45;0.5;1" />
      </ellipse>

      {/* Mouth - slightly changes expression */}
      <path d="M 320 440 Q 400 500 480 440" fill="none" stroke="#1E1B4B" strokeWidth="8" strokeLinecap="round" />

      {/* Antenna */}
      <line x1="400" y1="120" x2="400" y2="160" stroke="#4F46E5" strokeWidth="8" strokeLinecap="round" />
      <circle cx="400" cy="110" r="20" fill="#818CF8">
        <animate attributeName="r" values="20;25;20" dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="fill" values="#818CF8;#A78BFA;#818CF8" dur="1.5s" repeatCount="indefinite" />
      </circle>

      {/* Ear Left */}
      <rect x="130" y="360" width="30" height="60" rx="8" fill="#6366F1">
        <animate attributeName="opacity" values="1;0.7;1" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="140" y="370" width="10" height="40" rx="4" fill="#A5B4FC" />

      {/* Ear Right */}
      <rect x="640" y="360" width="30" height="60" rx="8" fill="#6366F1">
        <animate attributeName="opacity" values="1;0.7;1" dur="2s" repeatCount="indefinite" />
      </rect>
      <rect x="650" y="370" width="10" height="40" rx="4" fill="#A5B4FC" />

      {/* Chest decoration */}
      <circle cx="400" cy="520" r="30" fill="#4F46E5" opacity="0.6">
        <animate attributeName="opacity" values="0.6;1;0.6" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* Side bolts */}
      <circle cx="170" cy="400" r="15" fill="#818CF8">
        <animate attributeName="r" values="15;17;15" dur="3s" repeatCount="indefinite" />
      </circle>
      <circle cx="630" cy="400" r="15" fill="#818CF8">
        <animate attributeName="r" values="15;17;15" dur="3s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function AssistantAvatar() {
  return (
    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background shadow-sm">
      <RobotLogo size={24} className="animate-none" />
    </div>
  );
}

function UserAvatar({ user }: { user?: ChatMessageProps['currentUser'] }) {
  const username = user?.username?.trim() || '用户';
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <Avatar className="mt-0.5 h-8 w-8 shrink-0 border border-primary/25 shadow-sm">
      {user?.avatar ? <AvatarImage src={`/avatar/${user.avatar}`} alt={username} /> : null}
      <AvatarFallback className="bg-primary text-[11px] font-semibold text-primary-foreground">
        {initials}
      </AvatarFallback>
    </Avatar>
  );
}

function getWerewolfCard(message: ChatMessageProps['message']) {
  return (message.cards || []).find((card) => card?.type === 'werewolf_speech') || null;
}

function getWerewolfInitial(name: string): string {
  return name.replace(/\s+/g, '').slice(0, 1) || '?';
}

function canSeeWerewolfCard(card: any, view?: ChatMessageProps['werewolfView']): boolean {
  if (!card?.visibility || card.visibility === 'public') return true;
  if (view?.mode === 'god') return true;
  if (card.visibility === 'god') return false;
  if (!view?.viewer) return false;
  if (card.visibility === 'private') return Array.isArray(card.audience) && card.audience.includes(view.viewer);
  if (card.visibility === 'werewolves') return Array.isArray(card.audience) && card.audience.includes(view.viewer);
  return true;
}

function formatHiddenWerewolfContent(card: any): string {
  return '当前视角不可见。切换到上帝视角或绑定相关玩家后可查看。';
}

function WerewolfChatBubble({ card, message, view }: { card: any; message: ChatMessageProps['message']; view?: ChatMessageProps['werewolfView'] }) {
  const color = WEREWOLF_CHAT_COLORS[Math.max(0, Number(card.colorIndex || 0)) % WEREWOLF_CHAT_COLORS.length];
  const isSupervisor = card.speakerType === 'supervisor';
  const isSystem = card.speakerType === 'system';
  const visible = canSeeWerewolfCard(card, view);
  const spriteStyle = visible && !isSupervisor && !isSystem ? getWerewolfRoleSpriteStyle(card.role) : null;
  const avatarClass = isSupervisor
    ? 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300'
    : isSystem
      ? 'border-muted bg-muted/70 text-muted-foreground'
      : visible
        ? color.avatar
        : 'border-muted bg-muted/70 text-muted-foreground';
  const bubbleClass = isSupervisor
    ? 'border-amber-500/25 bg-amber-500/8'
    : isSystem
      ? 'border-muted bg-muted/40'
      : visible
        ? color.bubble
        : 'border-muted bg-muted/30';
  const nameClass = isSupervisor
    ? 'text-amber-700 dark:text-amber-300'
    : isSystem
      ? 'text-muted-foreground'
      : visible
        ? color.name
        : 'text-muted-foreground';
  const displayName = visible ? (card.speakerName || 'Agent') : '隐藏行动';
  const displayActionLabel = visible ? card.actionLabel : '黑夜记录';
  return (
    <div className="group mb-4 flex items-start gap-2">
      {spriteStyle ? (
        <div
          className="mt-0.5 h-12 w-8 shrink-0 rounded-md border border-amber-500/35 bg-cover shadow-sm"
          style={spriteStyle}
          title={visible ? (card.roleLabel || card.speakerName) : undefined}
        />
      ) : (
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${avatarClass}`}>
          {visible ? (isSystem ? '系' : getWerewolfInitial(card.speakerName || 'A')) : '隐'}
        </div>
      )}
      <div className="max-w-[85%] space-y-1">
        <div className={`rounded-2xl rounded-bl-sm border px-4 py-2.5 text-sm ${bubbleClass}`}>
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`font-medium ${nameClass}`}>{displayName}</span>
            {displayActionLabel ? (
              <span className="rounded-full border bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {displayActionLabel}
              </span>
            ) : null}
            {visible && card.visibility && card.visibility !== 'public' ? (
              <span className="rounded-full border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                {card.visibility === 'werewolves' ? '狼队可见' : card.visibility === 'private' ? '私聊' : '上帝'}
              </span>
            ) : null}
          </div>
          <div className="prose-sm prose-neutral max-w-none text-muted-foreground dark:prose-invert [&_p]:my-1">
            <Markdown>{visible ? (message.rawContent || message.content) : formatHiddenWerewolfContent(card)}</Markdown>
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(function ChatMessage({ message, isStreaming, onConfirmAction, onRejectAction, onUndoAction, onRetryAction, onAction, onDelete, onRetryFromMessage, onEditMessage, onContinue, onSaveAsNotebook, werewolfView, currentUser }: ChatMessageProps) {
  const [modelLabel, setModelLabel] = useState(message.model || '');
  const isActionTagMessage = message.role === 'user' && ACTION_TAG_PATTERN.test((message.content || '').trim());
  const workflowEvent = message.role === 'assistant' ? parseWorkflowEvent(message.content || '') : null;
  const werewolfCard = message.role === 'assistant' ? getWerewolfCard(message) : null;
  const sourceLabel = message.source?.label?.trim() || (message.source?.type === 'wechat' ? '微信' : '');
  const isWorkflowActionTag = isActionTagMessage && (message.content || '').trim().startsWith('创建工作流 ·');
  const actionTagClassName = isWorkflowActionTag
    ? 'border-orange-500/25 bg-orange-500/8 text-orange-700 dark:text-orange-300'
    : 'border-violet-500/25 bg-violet-500/8 text-violet-700 dark:text-violet-300';
  const actionTagIcon = isWorkflowActionTag ? 'account_tree' : 'smart_toy';

  useEffect(() => {
    let cancelled = false;

    if (!message.model) {
      setModelLabel('');
      return;
    }

    setModelLabel(message.model);

    loadModelLabels().then((labels) => {
      if (!cancelled) {
        setModelLabel(labels.get(message.model!) || message.model!);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [message.model]);

  if (message.role === 'user') {
    if (isActionTagMessage) {
      return (
        <div className="group mb-4 flex justify-center">
          <div className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs ${actionTagClassName}`}>
            <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{actionTagIcon}</span>
            <span className="whitespace-normal break-all">{message.content}</span>
          </div>
          <div className="ml-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            {onDelete && (
              <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
              </button>
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="group flex justify-end mb-4 items-start gap-2">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1">
          {onEditMessage && (
            <button onClick={() => onEditMessage(message.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="编辑">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
            </button>
          )}
          {onRetryFromMessage && (
            <button onClick={() => onRetryFromMessage(message.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="重试">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
            </button>
          )}
        </div>
        <div className="max-w-[78%] space-y-1">
          {sourceLabel ? (
            <div className="flex justify-end">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
                {sourceLabel}
              </span>
            </div>
          ) : null}
          <div className="rounded-2xl rounded-br-sm px-4 py-2.5 bg-primary text-primary-foreground text-sm">
          <div className="[&_a]:text-white [&_a]:underline [&_a:hover]:text-blue-200 [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-[320px] [&_img]:rounded-md [&_img]:border [&_img]:border-white/25 [&_img]:object-contain">
            <Markdown>{message.content}</Markdown>
          </div>
        </div>
        </div>
        <UserAvatar user={currentUser} />
      </div>
    );
  }

  if (workflowEvent) {
    return (
      <div className="group mb-4 flex justify-center">
        <div className="max-w-[86%] rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-xs text-amber-900 shadow-sm dark:text-amber-100">
          <div className="flex flex-wrap items-center gap-2">
            <span className="material-symbols-outlined text-amber-500" style={{ fontSize: '17px' }}>
              {getWorkflowEventIcon(workflowEvent.type)}
            </span>
            <span className="font-medium">{workflowEvent.title}</span>
            <span className="rounded-full border border-amber-500/25 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
              {workflowEvent.type}
            </span>
            {workflowEvent.tags.slice(0, 4).map((tag, index) => (
              <span key={`${message.id}-workflow-tag-${tag}-${index}`} className="rounded-full bg-background/70 px-2 py-0.5 text-[10px] text-muted-foreground">
                {tag}
              </span>
            ))}
          </div>
          {workflowEvent.body ? (
            <div className="mt-2 whitespace-pre-line leading-5 text-muted-foreground">
              {workflowEvent.body}
            </div>
          ) : null}
        </div>
        <div className="ml-2 flex items-start gap-0.5 pt-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="删除">
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'error') {
    const isTimeout = message.content.includes('超时') || message.content.includes('timeout');
    return (
      <div className="group flex mb-4 items-start gap-1">
        <div className="max-w-[80%] rounded-2xl rounded-bl-sm px-4 py-2.5 bg-destructive/10 text-destructive text-sm">
          <span className="material-symbols-outlined text-sm mr-1 align-middle">{isTimeout ? 'schedule' : 'error'}</span>
          {message.content}
          {isTimeout && onContinue && (
            <button
              onClick={() => onContinue(message.id)}
              className="ml-2 px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-600 hover:bg-yellow-500/30 text-xs"
            >
              继续
            </button>
          )}
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1">
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  if (werewolfCard) {
    return <WerewolfChatBubble card={werewolfCard} message={message} view={werewolfView} />;
  }

  // Assistant message
  return (
    <div className="group flex mb-4 items-start gap-2">
      <AssistantAvatar />
      <div className="max-w-[85%] space-y-1">
        {sourceLabel ? (
          <div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              {sourceLabel}
            </span>
          </div>
        ) : null}
        {isStreaming && !message.content && <ThinkingBot />}
        {message.content && (
          <div className="rounded-2xl rounded-bl-sm px-4 py-2.5 bg-muted text-sm prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:text-foreground [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-[360px] [&_img]:rounded-md [&_img]:border [&_img]:border-border [&_img]:object-contain">
            <Markdown>{message.content}</Markdown>
            {isStreaming && <ThinkingBot />}
          </div>
        )}
        {message.rawContent && (
          <details className="mt-1 rounded-xl border border-border bg-muted/50 text-xs">
            <summary className="cursor-pointer px-3 py-1.5 text-muted-foreground select-none flex items-center gap-1">
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>unfold_more</span>
              查看完整内容
            </summary>
            <div className="px-3 py-2 prose-sm prose-neutral dark:prose-invert max-w-none [&_p]:my-1 [&_pre]:bg-background [&_pre]:border [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:text-foreground [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-[360px] [&_img]:rounded-md [&_img]:border [&_img]:border-border [&_img]:object-contain">
              <Markdown>{message.rawContent}</Markdown>
            </div>
          </details>
        )}
        {message.actions?.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onConfirm={() => onConfirmAction(action.id)}
            onReject={() => onRejectAction(action.id)}
            onUndo={() => onUndoAction(action.id)}
            onRetry={() => onRetryAction(action.id)}
            onAction={onAction}
          />
        ))}
        {message.cards?.map((card, i) => (
          <UniversalCard key={i} card={card} onAction={onAction} />
        ))}
        {(message.engine || message.model || message.usage || message.costUsd !== undefined || message.durationMs !== undefined) && (
          <div className="text-xs text-muted-foreground px-1 opacity-60 flex items-center gap-1 flex-wrap">
            {message.engine && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted/80 font-medium">
                {getEngineDisplayName(message.engine)}
              </span>
            )}
            {message.model && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-muted/80">
                {modelLabel}
              </span>
            )}
            {message.usage && <span>{message.usage.input_tokens}↓ {message.usage.output_tokens}↑</span>}
            {message.costUsd !== undefined && <span>· ${message.costUsd.toFixed(4)}</span>}
            {message.durationMs !== undefined && <span>· {(message.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        )}
      </div>
      {!isStreaming && (
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pt-1">
          {onSaveAsNotebook && (
            <button onClick={() => onSaveAsNotebook(message.id)} className="p-1 rounded hover:bg-muted text-muted-foreground" title="另存为 Notebook">
              <span className="material-symbols-outlined text-sm">note_add</span>
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive" title="删除">
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});
