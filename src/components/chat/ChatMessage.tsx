'use client';

import { ActionState, getStreamingResultDisplay, parseActions, stripMachineResultBlocks } from '@/lib/chat/actions';
import Markdown from '@/components/Markdown';
import ActionCard from './ActionCard';
import UniversalCard from './cards/UniversalCard';
import { memo, useEffect, useMemo, useState } from 'react';
import { getEngineDisplayName } from '@/lib/core/engine-metadata';
import SpriteAvatar from '@/components/SpriteAvatar';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { getWerewolfRoleSpriteStyle } from '@/plugins/werewolf/role-assets';
import { copyText } from '@/lib/core/clipboard';
import { useToast } from '@/components/ui/toast';
import { Shimmer } from '@/components/ai-elements/shimmer';
import { Message, MessageContent, MessageActions, MessageAction } from '@/components/ai-elements/message';
import { Tool, ToolHeader, ToolContent } from '@/components/ai-elements/tool';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai-elements/reasoning';
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai-elements/task';
import { Queue, QueueList, QueueItem, QueueItemContent, QueueItemDescription, QueueItemIndicator } from '@/components/ai-elements/queue';
import { Terminal, TerminalContent } from '@/components/ai-elements/terminal';
import { Artifact, ArtifactActions, ArtifactContent, ArtifactCopyButton, ArtifactHeader, ArtifactTitle } from '@/components/ai-elements/artifact';
import { CodeBlock } from '@/components/ai-elements/code-block';
import { BookOpenIcon, ChevronDownIcon, MessageSquareQuote, WrenchIcon } from 'lucide-react';
import {
  extractAceProcessBlocks,
  type AceProcessBlock,
  type AceSubtaskResultPayload,
  type AceSubtaskStartPayload,
  type AceToolCallPayload,
  type AceToolResultPayload,
} from '@/lib/chat/ai-process-blocks';
import { workspaceApi } from '@/lib/core/api';
import type { BundledLanguage } from 'shiki';

let modelLabelCache: Map<string, string> | null = null;
let modelLabelPromise: Promise<Map<string, string>> | null = null;
const WEREWOLF_CHAT_COLORS = [
  { avatar: 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300', name: 'text-rose-700 dark:text-rose-300', bubble: 'border-rose-500/30 bg-rose-50 text-rose-950 dark:bg-rose-950/75 dark:text-rose-100' },
  { avatar: 'border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300', name: 'text-sky-700 dark:text-sky-300', bubble: 'border-sky-500/30 bg-sky-50 text-sky-950 dark:bg-sky-950/75 dark:text-sky-100' },
  { avatar: 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', name: 'text-emerald-700 dark:text-emerald-300', bubble: 'border-emerald-500/30 bg-emerald-50 text-emerald-950 dark:bg-emerald-950/75 dark:text-emerald-100' },
  { avatar: 'border-violet-500/30 bg-violet-500/15 text-violet-700 dark:text-violet-300', name: 'text-violet-700 dark:text-violet-300', bubble: 'border-violet-500/30 bg-violet-50 text-violet-950 dark:bg-violet-950/75 dark:text-violet-100' },
  { avatar: 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300', name: 'text-amber-700 dark:text-amber-300', bubble: 'border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-950/75 dark:text-amber-100' },
  { avatar: 'border-cyan-500/30 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300', name: 'text-cyan-700 dark:text-cyan-300', bubble: 'border-cyan-500/30 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/75 dark:text-cyan-100' },
  { avatar: 'border-lime-500/30 bg-lime-500/15 text-lime-700 dark:text-lime-300', name: 'text-lime-700 dark:text-lime-300', bubble: 'border-lime-500/30 bg-lime-50 text-lime-950 dark:bg-lime-950/75 dark:text-lime-100' },
  { avatar: 'border-fuchsia-500/30 bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300', name: 'text-fuchsia-700 dark:text-fuchsia-300', bubble: 'border-fuchsia-500/30 bg-fuchsia-50 text-fuchsia-950 dark:bg-fuchsia-950/75 dark:text-fuchsia-100' },
] as const;
const CHUNK_BOUNDARY_PATTERN = /<!--\s*chunk-boundary\s*-->/gi;
const VISIBLE_SESSION_TAG_SEPARATOR = ' · ';
const VISIBLE_SESSION_TAGS = {
  '创建工作流': {
    kind: 'workflow',
    icon: 'account_tree',
    className: 'border-orange-500/25 bg-orange-500/8 text-orange-700 dark:text-orange-300',
  },
  '创建 Agent': {
    kind: 'agent',
    icon: 'smart_toy',
    className: 'border-violet-500/25 bg-violet-500/8 text-violet-700 dark:text-violet-300',
  },
  '上下文压缩': {
    kind: 'compact',
    icon: 'compress',
    className: 'border-sky-500/25 bg-sky-500/8 text-sky-700 dark:text-sky-300',
  },
} as const;
const quoteActionIcon = <MessageSquareQuote className="h-3.5 w-3.5" />;

function parseVisibleSessionTag(content: string): null | {
  type: keyof typeof VISIBLE_SESSION_TAGS;
  label: string;
  icon: string;
  className: string;
} {
  const text = String(content || '').trim();
  const separatorIndex = text.indexOf(VISIBLE_SESSION_TAG_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const type = text.slice(0, separatorIndex).trim() as keyof typeof VISIBLE_SESSION_TAGS;
  const label = text.slice(separatorIndex + VISIBLE_SESSION_TAG_SEPARATOR.length).trim();
  const config = VISIBLE_SESSION_TAGS[type];
  if (!config || !label) return null;
  return {
    type,
    label,
    icon: config.icon,
    className: config.className,
  };
}

type SubtaskProcessEntry = {
  kind: 'subtask';
  title: string;
  description: string;
  internalText: string;
  agent: string;
  prompt: string;
  toolId: string;
  sessionId: string;
  sessionFingerprint: string;
  result: string;
  startBlockEnd: number;
  resultBlockStart: number | null;
  state: 'input-available' | 'output-available';
  anchorStart: number;
  anchorEnd: number;
  blockStarts: number[];
};

type ToolProcessEntry = {
  kind: 'tool';
  title: string;
  toolName: string;
  toolId: string;
  toolFingerprint: string;
  request: string;
  result: string;
  requestMeta: AceToolCallPayload | null;
  resultMeta: AceToolResultPayload | null;
  state: 'input-available' | 'output-available';
  anchorStart: number;
  anchorEnd: number;
  blockStarts: number[];
};

type ProcessEntryState = ToolProcessEntry['state'];
type TimelineItem =
  | { kind: 'text'; key: string; start: number; end: number; text: string }
  | { kind: 'reasoning'; key: string; start: number; end: number; text: string }
  | { kind: 'tool-entry'; key: string; start: number; end: number; entry: ToolProcessEntry }
  | { kind: 'subtask-entry'; key: string; start: number; end: number; entry: SubtaskProcessEntry };
type RenderItem =
  | TimelineItem
  | { kind: 'tool-group'; key: string; start: number; end: number; entries: Array<{ key: string; entry: ToolProcessEntry }> };
type ProcessTimelineState = {
  timelineItems: TimelineItem[];
  hasPendingActivity: boolean;
};

const ASSISTANT_MARKDOWN_CLASS = 'text-sm prose-sm prose-neutral dark:prose-invert max-w-none [&_pre]:bg-background [&_pre]:border-0 [&_pre]:shadow-none [&_pre]:rounded [&_pre]:p-0 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_code]:bg-background/50 [&_code]:text-foreground [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-[360px] [&_img]:rounded-md [&_img]:border [&_img]:border-border [&_img]:object-contain';
const STANDARD_CHAT_BUBBLE_WIDTH_CLASS = 'max-w-[52rem] min-w-0';

function normalizeProcessBody(body: string): string {
  return String(body || '')
    .replace(/^\*\*[^*]+\*\*\s*/u, '')
    .trim();
}

function mergeProcessText(base: string, fragment: string): string {
  const left = String(base || '');
  const right = String(fragment || '');
  if (!left) return right.trim();
  if (!right) return left.trim();
  if (/^\s/.test(right) || /\s$/.test(left)) return `${left}${right}`.trim();
  if (/^[,.;:!?)}\]]/.test(right)) return `${left}${right}`.trim();
  if (/\n/.test(left) || /\n/.test(right)) return `${left}\n${right}`.trim();
  return `${left} ${right}`.trim();
}

function preferMoreCompleteText(current: string, next: string): string {
  const left = String(current || '').trim();
  const right = String(next || '').trim();
  if (!left) return right;
  if (!right) return left;
  return right.length >= left.length ? right : left;
}

function looksLikeEscapedProtocolDump(text: string): boolean {
  const sample = String(text || '');
  if (sample.length < 180) return false;
  const protocolHits = [
    sample.includes('{"kind":"card"'),
    sample.includes('{"kind":"home_sidebar"'),
    sample.includes('{"kind":"clarification_form"'),
    sample.includes('{"type":"config.'),
    sample.includes('<result>'),
    sample.includes('validate-card.mjs'),
    sample.includes('Card Schema'),
    sample.includes('payload 本体必须先通过校验脚本'),
  ].filter(Boolean).length;
  return protocolHits >= 2;
}

function sanitizeTimelineText(text: string, isStreaming: boolean): string {
  const cleaned = parseActions(text).text.replace(/\n{3,}/g, '\n\n').trim();
  if (!cleaned) return '';
  if (isStreaming && looksLikeEscapedProtocolDump(cleaned)) return '';
  return cleaned;
}

function mergeAdjacentReasoningItems(items: TimelineItem[]): TimelineItem[] {
  const merged: TimelineItem[] = [];

  for (const item of items) {
    const previous = merged[merged.length - 1];
    if (item.kind === 'reasoning' && previous?.kind === 'reasoning') {
      merged[merged.length - 1] = {
        ...previous,
        end: item.end,
        text: `${previous.text}${item.text}`,
      };
      continue;
    }
    merged.push(item);
  }

  return merged;
}

function mergeReasoningLeadInText(items: TimelineItem[]): TimelineItem[] {
  const merged = [...items];

  for (let index = 1; index < merged.length; index += 1) {
    const item = merged[index];
    const previous = merged[index - 1];
    if (item?.kind !== 'reasoning' || previous?.kind !== 'text') continue;
    if (!/^\s+\S/u.test(item.text)) continue;

    const leadInMatch = previous.text.match(/^(.*?)([.!?。！？]\s*)([^\n.!?。！？]{1,32})$/su);
    if (!leadInMatch) continue;

    const tail = String(leadInMatch[3] || '').trim();
    if (!tail) continue;
    if (tail.split(/\s+/u).length > 4) continue;
    if (!/^[\p{L}\p{N}"'`({\[]/u.test(tail)) continue;

    const visibleText = `${leadInMatch[1]}${leadInMatch[2]}`.trimEnd();
    if (!visibleText) continue;

    merged[index - 1] = {
      ...previous,
      end: Math.max(previous.start, item.start),
      text: visibleText,
    };
    merged[index] = {
      ...item,
      text: `${tail}${item.text}`,
    };
  }

  return merged.filter((item) => item.kind !== 'text' || Boolean(item.text.trim()));
}

function normalizeToolIdentityValue(value: unknown): string {
  return String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function formatSubtaskTitle(title: string): string {
  const normalized = String(title || '').trim() || '子任务';
  return normalized.startsWith('🤖') ? normalized : `🤖 ${normalized}`;
}

function extractReadPath(meta: Partial<AceToolCallPayload | AceToolResultPayload> | null | undefined, fallbackText = ''): string {
  if (!meta) return '';
  return asString((meta as any).filePath)
    || asString((meta as any).path)
    || extractTaggedValue(asString((meta as any).content), 'path')
    || extractTaggedValue(asString((meta as any).output), 'path')
    || extractTaggedValue(fallbackText, 'path')
    || '';
}

function extractReadPayloadContent(meta: Partial<AceToolResultPayload> | null | undefined, fallbackText = ''): string {
  if (!meta) return '';
  return extractTaggedValue(asString(meta.content), 'content')
    || extractTaggedValue(asString(meta.output), 'content')
    || asString(meta.content)
    || asString(meta.output)
    || fallbackText
    || '';
}

function buildToolFingerprint(
  toolName: string,
  meta: AceToolCallPayload | AceToolResultPayload | null | undefined,
  fallbackText = '',
): string {
  if (!meta) return '';
  const normalizedTool = normalizeToolIdentityValue(toolName);
  const get = (key: string) => normalizeToolIdentityValue((meta as any)?.[key]);

  switch (normalizedTool) {
    case 'read': {
      const filePath = normalizeToolIdentityValue(extractReadPath(meta, fallbackText));
      const bodyPath = !filePath ? normalizeToolIdentityValue(fallbackText) : '';
      return filePath
        ? `${normalizedTool}|${filePath}`
        : bodyPath
          ? `${normalizedTool}|${bodyPath}`
          : '';
    }
    case 'glob':
    case 'grep': {
      const pattern = get('pattern');
      const include = get('include');
      const path = get('path') || get('filePath');
      return pattern || include || path
        ? `${normalizedTool}|${pattern}|${include}|${path}`
        : '';
    }
    case 'ls': {
      const path = get('path') || get('filePath');
      const command = get('command');
      return path || command ? `${normalizedTool}|${path || command}` : '';
    }
    case 'bash':
    case 'cmd':
    case 'powershell': {
      const command = get('command');
      return command ? `${normalizedTool}|${command}` : '';
    }
    case 'webfetch': {
      const url = get('url');
      return url ? `${normalizedTool}|${url}` : '';
    }
    case 'websearch': {
      const query = get('query');
      return query ? `${normalizedTool}|${query}` : '';
    }
    default:
      return '';
  }
}

function findUniquePendingToolIndex(entries: ToolProcessEntry[], toolName: string): number {
  const matches = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.toolName === toolName && entry.state !== 'output-available');
  return matches.length === 1 ? matches[0].index : -1;
}

function findFirstPendingToolIndex(entries: ToolProcessEntry[], toolName: string): number {
  return entries.findIndex((entry) => entry.toolName === toolName && entry.state !== 'output-available');
}

function buildSubtaskEntries(blocks: AceProcessBlock[]): SubtaskProcessEntry[] {
  const entries: SubtaskProcessEntry[] = [];
  const entryIndexesByToolId = new Map<string, number>();
  const entryIndexesBySessionId = new Map<string, number>();
  const entryIndexesByFingerprint = new Map<string, number>();

  const buildSubtaskFingerprint = (value: {
    title?: string;
    description?: string;
    agent?: string;
    prompt?: string;
  }) => [
    normalizeToolIdentityValue(value.title),
    normalizeToolIdentityValue(value.description),
    normalizeToolIdentityValue(value.agent),
    normalizeToolIdentityValue(value.prompt),
  ].filter(Boolean).join('|');

  const bindSubtaskIdentity = (
    index: number,
    toolId: string,
    sessionId: string,
    sessionFingerprint: string,
    state: SubtaskProcessEntry['state'],
  ) => {
    if (toolId) entryIndexesByToolId.set(toolId, index);
    if (sessionId) entryIndexesBySessionId.set(sessionId, index);
    if (sessionFingerprint && state !== 'output-available') entryIndexesByFingerprint.set(sessionFingerprint, index);
  };

  for (const block of blocks) {
    if (block.kind === 'subtask-start') {
      const meta = block.meta as AceSubtaskStartPayload;
      const toolId = String(meta.toolId || '').trim();
      const sessionId = String(meta.sessionId || '').trim();
      const title = formatSubtaskTitle(String(meta.title || '').trim() || '子任务');
      const description = String(meta.description || '').trim() || normalizeProcessBody(block.body);
      const agent = String(meta.agent || '').trim();
      const prompt = String(meta.prompt || '').trim();
      const sessionFingerprint = buildSubtaskFingerprint({ title, description, agent, prompt });
      const duplicatePendingIndex = !toolId && !sessionId && sessionFingerprint && entryIndexesByFingerprint.has(sessionFingerprint)
        ? entryIndexesByFingerprint.get(sessionFingerprint)!
        : -1;
      if (duplicatePendingIndex >= 0) {
        const existing = entries[duplicatePendingIndex];
        existing.anchorEnd = Math.max(existing.anchorEnd, block.end);
        existing.blockStarts.push(block.start);
        bindSubtaskIdentity(duplicatePendingIndex, existing.toolId, existing.sessionId, existing.sessionFingerprint, existing.state);
        continue;
      }
      const nextIndex = entries.length;
      entries.push({
        kind: 'subtask',
        title,
        description,
        internalText: '',
        agent,
        prompt,
        toolId,
        sessionId,
        sessionFingerprint,
        result: '',
        startBlockEnd: block.end,
        resultBlockStart: null,
        state: 'input-available',
        anchorStart: block.start,
        anchorEnd: block.end,
        blockStarts: [block.start],
      });
      bindSubtaskIdentity(nextIndex, toolId, sessionId, sessionFingerprint, 'input-available');
      continue;
    }

    if (block.kind !== 'subtask-result') continue;

    const meta = block.meta as AceSubtaskResultPayload;
    const resultBody = String(meta.resultText || '').trim() || normalizeProcessBody(block.body);
    const sessionId = String(meta.sessionId || '').trim();
    const toolId = String(meta.toolId || '').trim();
    const uniquePendingIndex = entries.filter((entry) => entry.state !== 'output-available').length === 1
      ? entries.findIndex((entry) => entry.state !== 'output-available')
      : -1;
    const targetIndex = sessionId && entryIndexesBySessionId.has(sessionId)
      ? entryIndexesBySessionId.get(sessionId)!
      : toolId && entryIndexesByToolId.has(toolId)
        ? entryIndexesByToolId.get(toolId)!
        : uniquePendingIndex;

    const target = targetIndex >= 0 ? entries[targetIndex] : null;
    if (target) {
      target.result = mergeProcessText(target.result, resultBody);
      target.toolId = target.toolId || toolId;
      target.sessionId = target.sessionId || sessionId;
      target.state = 'output-available';
      target.resultBlockStart = block.start;
      target.anchorEnd = Math.max(target.anchorEnd, block.end);
      target.blockStarts.push(block.start);
      bindSubtaskIdentity(targetIndex, target.toolId, target.sessionId, target.sessionFingerprint, target.state);
    } else {
      const nextIndex = entries.length;
      entries.push({
        kind: 'subtask',
        title: formatSubtaskTitle('子任务结果'),
        description: '',
        internalText: '',
        agent: '',
        prompt: '',
        toolId,
        sessionId,
        sessionFingerprint: '',
        result: resultBody,
        startBlockEnd: block.start,
        resultBlockStart: block.start,
        state: 'output-available',
        anchorStart: block.start,
        anchorEnd: block.end,
        blockStarts: [block.start],
      });
      bindSubtaskIdentity(nextIndex, toolId, sessionId, '', 'output-available');
    }
  }

  return entries;
}

function buildToolEntries(blocks: AceProcessBlock[]): ToolProcessEntry[] {
  const entries: ToolProcessEntry[] = [];
  const entryIndexesByToolId = new Map<string, number>();
  const pendingEntryIndexesByFingerprint = new Map<string, number>();

  const bindPendingToolIdentity = (index: number, entry: ToolProcessEntry) => {
    if (entry.state === 'output-available') return;
    if (entry.toolId) entryIndexesByToolId.set(entry.toolId, index);
    if (entry.toolFingerprint) pendingEntryIndexesByFingerprint.set(entry.toolFingerprint, index);
  };

  const clearPendingToolIdentity = (index: number, entry: ToolProcessEntry) => {
    if (entry.toolId && entryIndexesByToolId.get(entry.toolId) === index) {
      entryIndexesByToolId.delete(entry.toolId);
    }
    if (entry.toolFingerprint && pendingEntryIndexesByFingerprint.get(entry.toolFingerprint) === index) {
      pendingEntryIndexesByFingerprint.delete(entry.toolFingerprint);
    }
  };

  for (const block of blocks) {
    if (block.kind === 'tool-call') {
      const meta = block.meta as AceToolCallPayload;
      const toolId = String(meta.toolId || '').trim();
      const toolName = String(meta.toolName || '').trim() || 'tool';
      const request = normalizeProcessBody(block.body);
      const toolFingerprint = buildToolFingerprint(toolName, meta, request);
      const duplicateToolIdIndex = toolId && entryIndexesByToolId.has(toolId)
        ? entryIndexesByToolId.get(toolId)!
        : -1;
      const duplicatePendingIndex = !toolId && toolFingerprint && pendingEntryIndexesByFingerprint.has(toolFingerprint)
        ? pendingEntryIndexesByFingerprint.get(toolFingerprint)!
        : -1;

      if (duplicateToolIdIndex >= 0 || duplicatePendingIndex >= 0) {
        const targetIndex = duplicateToolIdIndex >= 0 ? duplicateToolIdIndex : duplicatePendingIndex;
        const existing = entries[targetIndex];
        const previousRequestLength = String(existing.request || '').trim().length;
        const nextRequestLength = request.length;
        existing.title = preferMoreCompleteText(existing.title, String(meta.title || '').trim()) || existing.title;
        existing.toolName = existing.toolName || toolName;
        existing.toolId = existing.toolId || toolId;
        existing.toolFingerprint = existing.toolFingerprint || toolFingerprint;
        existing.request = preferMoreCompleteText(existing.request, request);
        existing.requestMeta = nextRequestLength >= previousRequestLength ? meta : (existing.requestMeta || meta);
        existing.anchorEnd = Math.max(existing.anchorEnd, block.end);
        existing.blockStarts.push(block.start);
        bindPendingToolIdentity(targetIndex, existing);
        continue;
      }

      const nextIndex = entries.length;
      const nextEntry: ToolProcessEntry = {
        kind: 'tool',
        title: String(meta.title || '').trim() || '工具调用',
        toolName,
        toolId,
        toolFingerprint,
        request,
        result: '',
        requestMeta: meta,
        resultMeta: null,
        state: 'input-available',
        anchorStart: block.start,
        anchorEnd: block.end,
        blockStarts: [block.start],
      };
      entries.push(nextEntry);
      bindPendingToolIdentity(nextIndex, nextEntry);
      continue;
    }

    if (block.kind !== 'tool-result') continue;

    const meta = block.meta as AceToolResultPayload;
    const toolName = String(meta.toolName || '').trim() || 'tool';
    const toolId = String(meta.toolId || '').trim();
    const resultBody = normalizeProcessBody(block.body);
    const toolFingerprint = buildToolFingerprint(toolName, meta, resultBody);
    const targetIndex = toolId && entryIndexesByToolId.has(toolId)
      ? entryIndexesByToolId.get(toolId)!
      : toolFingerprint && pendingEntryIndexesByFingerprint.has(toolFingerprint)
        ? pendingEntryIndexesByFingerprint.get(toolFingerprint)!
        : (() => {
          const uniquePending = findUniquePendingToolIndex(entries, toolName);
          return uniquePending >= 0 ? uniquePending : findFirstPendingToolIndex(entries, toolName);
        })();

    if (targetIndex >= 0) {
      const target = entries[targetIndex];
      clearPendingToolIdentity(targetIndex, target);
      target.result = mergeProcessText(target.result, resultBody);
      target.toolId = target.toolId || toolId;
      target.toolFingerprint = target.toolFingerprint || toolFingerprint;
      target.resultMeta = meta;
      target.state = 'output-available';
      target.anchorEnd = Math.max(target.anchorEnd, block.end);
      target.blockStarts.push(block.start);
    } else {
      entries.push({
        kind: 'tool',
        title: String(meta.title || '').trim() || '工具结果',
        toolName,
        toolId,
        toolFingerprint,
        request: '',
        result: resultBody,
        requestMeta: null,
        resultMeta: meta,
        state: 'output-available',
        anchorStart: block.start,
        anchorEnd: block.end,
        blockStarts: [block.start],
      });
    }
  }

  return entries;
}

function isProcessEntryRunning(state: ProcessEntryState, isStreaming: boolean): boolean {
  return isStreaming && state !== 'output-available';
}

function isCollapsedByDefaultTool(entry: ToolProcessEntry): boolean {
  return ['bash', 'cmd', 'powershell', 'read', 'glob', 'grep', 'ls', 'skill'].includes(entry.toolName);
}

function shouldOpenProcessCard({
  isStreaming,
  state,
  hasRequest,
  hasResult,
  defaultCollapsed = false,
}: {
  isStreaming: boolean;
  state: ProcessEntryState;
  hasRequest: boolean;
  hasResult: boolean;
  defaultCollapsed?: boolean;
}): boolean {
  if (defaultCollapsed) return false;
  if (isProcessEntryRunning(state, isStreaming)) return true;
  return hasRequest || hasResult;
}

function toSingleLinePreview(text: string): string {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normalizePreviewPath(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed === '.') return '';
  return trimmed;
}

function stripQuotedShellToken(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractPathFromCommand(command: string, toolName: 'ls' | 'read'): string {
  const text = String(command || '').trim().replace(/\\"/g, '"');
  if (!text) return '';

  const normalizedFromParam = text.match(/(?:-LiteralPath|-Path)\s+("[^"]+"|'[^']+'|[^\s]+)/i);
  if (normalizedFromParam?.[1]) {
    return normalizePreviewPath(stripQuotedShellToken(normalizedFromParam[1]));
  }

  const commandPattern = toolName === 'read'
    ? /\b(?:Get-Content|cat|type|head|tail|less)\b\s+((?:"[^"]+"|'[^']+'|[^\s-][^\s]*))/i
    : /\b(?:Get-ChildItem|ls|dir|tree|find)\b\s+((?:"[^"]+"|'[^']+'|[^\s-][^\s]*))/i;
  const commandMatch = text.match(commandPattern);
  if (commandMatch?.[1]) {
    return normalizePreviewPath(stripQuotedShellToken(commandMatch[1]));
  }

  return '';
}

function getSubtaskPreview(entry: SubtaskProcessEntry): string {
  return toSingleLinePreview(entry.description || entry.prompt || entry.result);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function countLines(text: string): number {
  return text ? text.split('\n').length : 0;
}

function inferCodeLanguage(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext || ext === filePath.toLowerCase()) return undefined;
  const map: Record<string, string> = {
    ts: 'ts',
    tsx: 'tsx',
    js: 'js',
    jsx: 'jsx',
    json: 'json',
    md: 'md',
    yaml: 'yaml',
    yml: 'yaml',
    css: 'css',
    html: 'html',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    py: 'python',
    xml: 'xml',
    toml: 'toml',
  };
  return map[ext] || ext;
}

function buildUnifiedDiff(oldText: string, newText: string): string {
  const removed = oldText
    ? oldText.split('\n').map((line) => `- ${line}`).join('\n') + '\n'
    : '';
  const added = newText
    ? newText.split('\n').map((line) => `+ ${line}`).join('\n') + '\n'
    : '';
  return `${removed}${added}`.trimEnd();
}

function describeLineChange(oldText: string, newText: string): string {
  const oldLines = countLines(oldText);
  const newLines = countLines(newText);
  const added = Math.max(0, newLines - oldLines);
  const removed = Math.max(0, oldLines - newLines);
  let stats = `${Math.min(oldLines, newLines)} 行修改`;
  if (added > 0) stats += `, +${added} 行`;
  if (removed > 0) stats += `, -${removed} 行`;
  return stats;
}

function renderJsonCode(value: unknown, language?: string) {
  if (value == null) return null;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return <Markdown>{`\`\`\`${language || 'json'}\n${text}\n\`\`\``}</Markdown>;
}

function extractTaggedValue(text: string, tag: string): string {
  if (!text) return '';
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return String(match?.[1] || '').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSkillName(entry: ToolProcessEntry): string {
  const requestMeta = entry.requestMeta as Record<string, unknown> | null;
  const resultMeta = entry.resultMeta as Record<string, unknown> | null;
  const requestInput = requestMeta?.input && typeof requestMeta.input === 'object'
    ? requestMeta.input as Record<string, unknown>
    : null;
  const rawSkillContent = asString(resultMeta?.output) || asString(resultMeta?.content) || entry.result;
  const taggedName = rawSkillContent.match(/<skill_content\b[^>]*\bname=(["'])(.*?)\1[^>]*>/i)?.[2] || '';

  return asString(requestMeta?.name)
    || asString(requestInput?.name)
    || asString(requestInput?.skill)
    || asString(requestInput?.id)
    || asString(resultMeta?.name)
    || taggedName;
}

function extractSkillDocument(entry: ToolProcessEntry): null | { name: string; body: string } {
  const meta = entry.resultMeta as Record<string, unknown> | null;
  const source = asString(meta?.output) || asString(meta?.content) || entry.result;
  if (!source) return null;

  const match = source.match(/<skill_content\b[^>]*>([\s\S]*?)<\/skill_content>/i);
  const name = extractSkillName(entry);
  let body = (match?.[1] || source).replace(/^\uFEFF/, '').trimStart();

  if (name) {
    body = body.replace(new RegExp(`^#\\s*Skill:\\s*${escapeRegExp(name)}\\s*(?:\\r?\\n)+`, 'i'), '');
  } else {
    body = body.replace(/^#\s*Skill:\s*[^\n]+\s*(?:\r?\n)+/i, '');
  }

  body = body.trim();
  if (!body) return null;
  return { name, body };
}

function getReadFilePath(entry: ToolProcessEntry): string {
  return normalizePreviewPath(extractReadPath(entry.requestMeta, entry.request))
    || extractReadPath(entry.resultMeta, entry.result)
    || extractPathFromCommand(asString(entry.requestMeta?.command), 'read')
    || '';
}

function getReadResultContent(entry: ToolProcessEntry): string {
  return extractReadPayloadContent(entry.resultMeta, entry.result)
    || entry.result
    || '';
}

function getToolPreview(entry: ToolProcessEntry): string {
  switch (entry.toolName) {
    case 'bash':
    case 'cmd':
    case 'powershell':
      return toSingleLinePreview(asString(entry.requestMeta?.command) || entry.request);
    case 'read':
      return getReadFilePath(entry)
        || extractPathFromCommand(asString(entry.requestMeta?.command), 'read')
        || toSingleLinePreview(asString(entry.requestMeta?.command) || entry.request);
    case 'glob':
    case 'grep': {
      const pattern = asString(entry.requestMeta?.pattern);
      const path = asString((entry.requestMeta as any)?.path) || asString((entry.requestMeta as any)?.filePath);
      return [pattern, path].filter(Boolean).join(' · ');
    }
    case 'ls':
      return normalizePreviewPath(asString((entry.requestMeta as any)?.path) || asString((entry.requestMeta as any)?.filePath))
        || extractPathFromCommand(asString((entry.requestMeta as any)?.command), 'ls')
        || toSingleLinePreview(asString((entry.requestMeta as any)?.command) || entry.request);
    case 'webfetch':
      return asString((entry.requestMeta as any)?.url);
    case 'websearch':
      return asString((entry.requestMeta as any)?.query);
    case 'skill':
      return extractSkillName(entry);
    default:
      return '';
  }
}

function renderPathPreview(pathText: string) {
  const value = String(pathText || '').trim();
  if (!value) return null;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">path</span>
      <div className="tool-path-scroll min-w-0 overflow-x-auto">
        <code className="block whitespace-nowrap rounded bg-background/70 px-1.5 py-0.5 font-mono text-[12px] text-foreground">{value}</code>
      </div>
    </div>
  );
}

function buildProcessTimelineState(content: string, isStreaming: boolean): ProcessTimelineState {
  const source = stripResultBlocks(content);
  const { blocks } = extractAceProcessBlocks(source);
  const toolEntries = buildToolEntries(blocks).map((entry) => (!isStreaming && entry.state !== 'output-available'
    ? { ...entry, state: 'output-available' as const }
    : entry));
  const subtaskEntries = buildSubtaskEntries(blocks).map((entry) => (!isStreaming && entry.state !== 'output-available'
    ? { ...entry, state: 'output-available' as const }
    : entry));

  const items: TimelineItem[] = [];
  const renderedKeys = new Set<string>();
  const toolEntriesByBlockStart = new Map<number, { key: string; entry: ToolProcessEntry }>();
  const subtaskEntriesByBlockStart = new Map<number, { key: string; entry: SubtaskProcessEntry }>();
  const subtaskTextRanges = subtaskEntries
    .map((entry) => ({
      entry,
      start: entry.startBlockEnd,
      end: entry.resultBlockStart ?? ((entry.toolId || entry.sessionId) ? source.length : entry.startBlockEnd),
    }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start);

  toolEntries.forEach((entry, index) => {
    const key = entry.toolId || `${entry.toolName}-${entry.anchorStart}-${index}`;
    entry.blockStarts.forEach((start) => toolEntriesByBlockStart.set(start, { key, entry }));
  });
  subtaskEntries.forEach((entry, index) => {
    const key = entry.toolId || entry.sessionId || `subtask-${entry.anchorStart}-${index}`;
    entry.blockStarts.forEach((start) => subtaskEntriesByBlockStart.set(start, { key, entry }));
  });

  for (const range of subtaskTextRanges) {
    range.entry.internalText = sanitizeTimelineText(source.slice(range.start, range.end), isStreaming);
  }

  let cursor = 0;
  for (const [index, block] of blocks.entries()) {
    const enclosingSubtaskRange = subtaskTextRanges.find((range) => block.start >= range.start && block.end <= range.end);
    if (enclosingSubtaskRange) {
      cursor = Math.max(cursor, block.end);
      continue;
    }

    if (block.start > cursor) {
      const nextTextStart = block.start;
      for (const range of subtaskTextRanges) {
        if (range.end <= cursor || range.start >= nextTextStart) continue;
        const textBeforeSubtask = sanitizeTimelineText(source.slice(cursor, range.start), isStreaming);
        if (textBeforeSubtask) {
          items.push({
            kind: 'text',
            key: `text-${cursor}-${range.start}`,
            start: cursor,
            end: range.start,
            text: textBeforeSubtask,
          });
        }
        cursor = Math.max(cursor, range.end);
      }
      const text = cursor < nextTextStart
        ? sanitizeTimelineText(source.slice(cursor, nextTextStart), isStreaming)
        : '';
      if (text) {
        items.push({
          kind: 'text',
          key: `text-${cursor}-${block.start}`,
          start: cursor,
          end: block.start,
          text,
        });
      }
    }

    if (block.kind === 'reasoning') {
      const text = String(block.body || '');
      if (text.trim()) {
        items.push({
          kind: 'reasoning',
          key: `reasoning-${block.start}-${index}`,
          start: block.start,
          end: block.end,
          text,
        });
      }
    } else if (block.kind === 'tool-call' || block.kind === 'tool-result') {
      const mapped = toolEntriesByBlockStart.get(block.start);
      if (mapped && !renderedKeys.has(mapped.key)) {
        renderedKeys.add(mapped.key);
        items.push({
          kind: 'tool-entry',
          key: mapped.key,
          start: block.start,
          end: block.end,
          entry: mapped.entry,
        });
      }
    } else if (block.kind === 'subtask-start' || block.kind === 'subtask-result') {
      const mapped = subtaskEntriesByBlockStart.get(block.start);
      if (mapped && !renderedKeys.has(mapped.key)) {
        renderedKeys.add(mapped.key);
        items.push({
          kind: 'subtask-entry',
          key: mapped.key,
          start: block.start,
          end: block.end,
          entry: mapped.entry,
        });
      }
    }

    cursor = Math.max(cursor, block.end);
  }

  if (cursor < source.length) {
    let trailingCursor = cursor;
    for (const range of subtaskTextRanges) {
      if (range.end <= trailingCursor) continue;
      const textBeforeSubtask = sanitizeTimelineText(source.slice(trailingCursor, range.start), isStreaming);
      if (textBeforeSubtask) {
        items.push({
          kind: 'text',
          key: `text-${trailingCursor}-${range.start}`,
          start: trailingCursor,
          end: range.start,
          text: textBeforeSubtask,
        });
      }
      trailingCursor = Math.max(trailingCursor, range.end);
    }
    if (trailingCursor < source.length) {
      const text = sanitizeTimelineText(source.slice(trailingCursor), isStreaming);
      if (text) {
        items.push({
          kind: 'text',
          key: `text-${trailingCursor}-${source.length}`,
          start: trailingCursor,
          end: source.length,
          text,
        });
      }
    }
  }

  const hasPendingTool = toolEntries.some((entry) => entry.state !== 'output-available');
  const hasPendingSubtask = subtaskEntries.some((entry) => entry.state !== 'output-available');
  const lastBlock = blocks[blocks.length - 1];
  const hasTrailingReasoning = isStreaming && lastBlock?.kind === 'reasoning';
  const mergedItems = mergeReasoningLeadInText(mergeAdjacentReasoningItems(items));

  return {
    timelineItems: mergedItems,
    hasPendingActivity: Boolean(isStreaming && (hasPendingTool || hasPendingSubtask || hasTrailingReasoning)),
  };
}

function ProcessCodeBlock({
  text,
  language,
  singleLine = false,
}: {
  text: string;
  language?: string;
  singleLine?: boolean;
}) {
  const { toast } = useToast();
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<{ stdout?: string; stderr?: string; exitCode?: number } | null>(null);

  if (!text) return null;

  const handleLegacyCopy = async () => {
    const ok = await copyText(text);
    toast(ok ? 'success' : 'error', ok ? '已复制代码' : '复制失败');
  };

  const handleArtifactCopied = () => {
    toast('success', '已复制代码');
  };

  const normalizedLanguage = (() => {
    const raw = String(language || '').trim().toLowerCase();
    if (!raw) return 'text';
    if (raw === 'cj') return 'cangjie';
    if (raw === 'md') return 'markdown';
    if (raw === 'yml') return 'yaml';
    if (raw === 'js') return 'javascript';
    if (raw === 'ts') return 'typescript';
    if (raw === 'py') return 'python';
    if (raw === 'sh') return 'bash';
    return raw;
  })();
  const canRunCangjie = normalizedLanguage === 'cangjie';

  const handleRun = async () => {
    if (!canRunCangjie || running) return;
    setRunning(true);
    try {
      const result = await workspaceApi.runCangjie(text, 'snippet.cj', 'markdown');
      setRunResult({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode ?? undefined,
      });
    } catch (error: any) {
      toast('error', error?.message || '运行失败');
    } finally {
      setRunning(false);
    }
  };

  return (
    singleLine ? (
      <div className="relative overflow-hidden rounded-md border bg-background/80">
        <button
          type="button"
          onClick={() => { void handleLegacyCopy(); }}
          className="absolute right-2 top-2 z-10 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="复制代码"
        >
          <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
        </button>
        <div className="tool-path-scroll overflow-x-auto px-3 py-2 pr-10">
          <code className="block whitespace-pre font-mono text-[12px] text-foreground">{text}</code>
        </div>
      </div>
    ) : (
      <Artifact value={text} className="bg-background/80">
        <ArtifactHeader>
          <ArtifactTitle>{normalizedLanguage}</ArtifactTitle>
          <ArtifactActions>
            {canRunCangjie ? (
              <button
                type="button"
                onClick={() => { void handleRun(); }}
                disabled={running}
                className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                title="运行仓颉代码"
              >
                <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>
                  {running ? 'progress_activity' : 'play_arrow'}
                </span>
                <span>{running ? '运行中' : '运行'}</span>
              </button>
            ) : null}
            <ArtifactCopyButton
              onCopy={handleArtifactCopied}
              title="复制代码"
            />
          </ArtifactActions>
        </ArtifactHeader>
        <ArtifactContent>
          <div className="max-h-80 overflow-auto">
            <CodeBlock
              code={text}
              language={normalizedLanguage as BundledLanguage}
              className="rounded-none border-0 bg-transparent"
            />
          </div>
        </ArtifactContent>
        {canRunCangjie && (running || runResult) ? (
          <div className="border-t px-3 py-3 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-medium text-foreground">运行结果</span>
              {runResult?.exitCode != null ? <span className="text-xs text-muted-foreground">exit code: {runResult.exitCode}</span> : null}
            </div>
            {running ? (
              <div className="text-muted-foreground">运行中...</div>
            ) : (
              <div className="space-y-2">
                {runResult?.stdout ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">stdout</div>
                    <ProcessTerminalBlock text={runResult.stdout} />
                  </div>
                ) : null}
                {runResult?.stderr ? (
                  <div>
                    <div className="mb-1 text-xs text-muted-foreground">stderr</div>
                    <ProcessTerminalBlock text={runResult.stderr} />
                  </div>
                ) : null}
                {!runResult?.stdout && !runResult?.stderr ? <div className="text-muted-foreground">无输出</div> : null}
              </div>
            )}
          </div>
        ) : null}
      </Artifact>
    )
  );
}

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

function StreamingResultPanel({ result }: { result: { text: string; complete: boolean } }) {
  const body = formatStreamingResultBody(result.text);
  if (!body) return null;
  const state = result.complete ? 'output-available' : 'input-available';
  return (
    <Tool
      defaultOpen
      className="overflow-hidden rounded-xl border-border/70 bg-background/70 shadow-sm"
      data-testid="ace-result-generation-panel"
    >
      <ToolHeader
        type="dynamic-tool"
        toolName="result"
        title={result.complete ? '结构化结果已生成' : '结构化结果生成中'}
        state={state}
        hideDefaultIcon
        className="bg-muted/30"
      />
      <ToolContent className="space-y-3">
        <div className="text-xs leading-5 text-muted-foreground">
          系统正在接收机器可读结果；完成后会自动渲染为卡片或执行对应的结构化处理。
        </div>
        <ProcessCodeBlock text={body} language="json" />
      </ToolContent>
    </Tool>
  );
}

function ProcessTerminalBlock({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const { toast } = useToast();

  if (!text) return null;

  const handleCopy = async () => {
    const ok = await copyText(text);
    toast(ok ? 'success' : 'error', ok ? '已复制终端输出' : '复制失败');
  };

  return (
    <div className="relative overflow-hidden rounded-md border bg-zinc-950 text-zinc-100" data-testid="ace-terminal-block">
      <button
        type="button"
        onClick={() => { void handleCopy(); }}
        className="absolute right-2 top-2 z-10 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
        title="复制终端输出"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
      </button>
      <Terminal output={text} isStreaming={isStreaming} className="rounded-md border-0 bg-transparent shadow-none">
        <TerminalContent data-testid="ace-terminal-content" className="max-h-80 overflow-auto px-3 py-2 pr-10 font-mono text-[12px] leading-5 text-zinc-100" />
      </Terminal>
    </div>
  );
}

function containsAnsiEscape(text: string): boolean {
  if (!text) return false;
  return /\u001b\[[0-9;?]*[ -/]*[@-~]/.test(text);
}

function ProcessTodoQueue({ todos }: { todos: any[] }) {
  if (!todos.length) return <div className="text-sm text-muted-foreground">任务列表更新中...</div>;

  return (
    <Queue className="rounded-lg border-border/70 bg-background/60 px-2 py-2 shadow-none" data-testid="ace-todo-queue">
      <QueueList className="mt-0">
        {todos.map((todo, index) => {
          const status = String(todo?.status || 'pending');
          const completed = status === 'completed' || status === 'done';
          const description = String(todo?.description || todo?.details || '').trim();
          return (
            <QueueItem key={`todo-${index}`} className="gap-0.5 px-2 py-1.5 hover:bg-muted/40">
              <div className="flex items-start gap-2">
                <QueueItemIndicator completed={completed} />
                <QueueItemContent completed={completed}>{String(todo?.content || todo?.title || '')}</QueueItemContent>
              </div>
              {description ? (
                <QueueItemDescription completed={completed}>{description}</QueueItemDescription>
              ) : null}
            </QueueItem>
          );
        })}
      </QueueList>
    </Queue>
  );
}

function renderStructuredToolRequest(entry: ToolProcessEntry) {
  const meta = entry.requestMeta;
  if (!meta) return entry.request ? <Markdown>{entry.request}</Markdown> : null;

  switch (entry.toolName) {
    case 'bash': {
      const command = asString(meta.command);
      if (!command) return null;
      return <ProcessCodeBlock text={command} language="bash" singleLine />;
    }
    case 'cmd':
    case 'powershell': {
      const command = asString(meta.command);
      if (!command) return null;
      return <ProcessCodeBlock text={command} language={entry.toolName} singleLine />;
    }
    case 'write': {
      const filePath = asString(meta.filePath);
      const content = asString(meta.content);
      const language = inferCodeLanguage(filePath);
      return (
        <div className="space-y-2">
          {filePath ? <div className="text-xs text-muted-foreground">{`${filePath}${content ? ` · ${countLines(content)} 行` : ''}`}</div> : null}
          {content ? <Markdown>{`\`\`\`${language || ''}\n${content}\n\`\`\``}</Markdown> : null}
        </div>
      );
    }
    case 'edit':
    case 'multiedit':
    case 'patch': {
      const filePath = asString(meta.filePath);
      const oldText = asString(meta.oldString);
      const newText = asString(meta.newString);
      const diff = buildUnifiedDiff(oldText, newText);
      const stats = describeLineChange(oldText, newText);
      return (
        <div className="space-y-2">
          {(filePath || stats) ? <div className="text-xs text-muted-foreground">{[filePath, stats].filter(Boolean).join(' · ')}</div> : null}
          {diff ? <Markdown>{`\`\`\`diff\n${diff}\n\`\`\``}</Markdown> : null}
        </div>
      );
    }
    case 'read':
      if (asString(meta.command)) return <ProcessCodeBlock text={asString(meta.command)} singleLine />;
      return getReadFilePath(entry) ? renderPathPreview(getReadFilePath(entry)) : null;
    case 'glob':
    case 'grep':
      if (asString(meta.command)) return <ProcessCodeBlock text={asString(meta.command)} singleLine />;
      return (
        <div className="space-y-1 text-sm">
          {asString(meta.pattern) ? <div>pattern: {asString(meta.pattern)}</div> : null}
          {asString((meta as any).include) ? <div>include: {asString((meta as any).include)}</div> : null}
          {asString((meta as any).path) || asString((meta as any).filePath) ? renderPathPreview(asString((meta as any).path) || asString((meta as any).filePath) || '') : null}
        </div>
      );
    case 'ls':
      if (asString(meta.command)) return <ProcessCodeBlock text={asString(meta.command)} singleLine />;
      return renderPathPreview(
        normalizePreviewPath(asString(meta.path) || asString((meta as any).filePath))
        || extractPathFromCommand(asString(meta.command), 'ls')
      );
    case 'webfetch':
      return asString(meta.url) ? <div className="text-sm break-all">{asString(meta.url)}</div> : null;
    case 'websearch':
      return asString(meta.query) ? <div className="text-sm">{asString(meta.query)}</div> : null;
    case 'skill': {
      const skillName = extractSkillName(entry);
      if (!skillName) return null;
      return (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">技能</span>
          <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[12px] text-foreground">{skillName}</code>
        </div>
      );
    }
    case 'todo':
    case 'todowrite':
    case 'plan': {
      const todos = asArray(meta.todos);
      return <ProcessTodoQueue todos={todos} />;
    }
    default:
      if (meta.input != null) return renderJsonCode(meta.input);
      return entry.request ? <Markdown>{entry.request}</Markdown> : null;
  }
}

function renderStructuredToolResult(entry: ToolProcessEntry) {
  const meta = entry.resultMeta;
  if (!meta) return entry.result ? <Markdown>{entry.result}</Markdown> : null;
  const error = Boolean(meta.error);
  const isTerminalTool = entry.toolName === 'bash' || entry.toolName === 'cmd' || entry.toolName === 'powershell' || entry.toolName === 'ls';

  switch (entry.toolName) {
    case 'bash': {
      const output = asString(meta.output);
      const exitCode = meta.exitCode;
      if (!output && (exitCode == null || exitCode === 0)) return entry.result ? <Markdown>{entry.result}</Markdown> : null;
      return (
        <div className="space-y-2">
          {output ? <ProcessTerminalBlock text={output} /> : null}
          {exitCode != null ? <div className={`text-xs ${Number(exitCode) === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>exit code: {String(exitCode)}</div> : null}
        </div>
      );
    }
    case 'cmd':
    case 'powershell': {
      const output = asString(meta.output);
      const exitCode = meta.exitCode;
      if (!output && (exitCode == null || exitCode === 0)) return entry.result ? <Markdown>{entry.result}</Markdown> : null;
      return (
        <div className="space-y-2">
          {output ? <ProcessTerminalBlock text={output} /> : null}
          {exitCode != null ? <div className={`text-xs ${Number(exitCode) === 0 ? 'text-muted-foreground' : 'text-destructive'}`}>exit code: {String(exitCode)}</div> : null}
        </div>
      );
    }
    case 'read': {
      const text = getReadResultContent(entry);
      const language = inferCodeLanguage(getReadFilePath(entry));
      return text ? <ProcessCodeBlock text={text} language={language} /> : (entry.result ? <Markdown>{entry.result}</Markdown> : null);
    }
    case 'edit':
    case 'multiedit':
    case 'patch':
    case 'write': {
      const changes = asArray(meta.changes);
      if (changes.length > 0) {
        return (
          <div className="space-y-3">
            {changes.map((change, index) => {
              const filePath = String(change?.filePath || '');
              const oldText = String(change?.oldString || '');
              const newText = String(change?.newString || '');
              const stats = oldText || newText ? describeLineChange(oldText, newText) : '';
              const diff = String(change?.diff || '') || buildUnifiedDiff(oldText, newText);
              const content = String(change?.content || '');
              const language = diff ? 'diff' : inferCodeLanguage(filePath);
              return (
                <div key={`change-${index}`} className="space-y-2">
                  {(filePath || stats) ? <div className="text-xs text-muted-foreground">{[filePath, stats].filter(Boolean).join(' · ')}</div> : null}
                  {diff ? <ProcessCodeBlock text={diff} language={language || 'diff'} /> : null}
                  {!diff && content ? <ProcessCodeBlock text={content} language={language || undefined} /> : null}
                </div>
              );
            })}
          </div>
        );
      }
      const output = asString(meta.output);
      const oldText = asString((meta as any).oldString);
      const newText = asString((meta as any).newString);
      const diff = (oldText || newText) ? buildUnifiedDiff(oldText, newText) : '';
      const language = diff ? 'diff' : inferCodeLanguage(asString((meta as any).filePath));
      if (diff) return <ProcessCodeBlock text={diff} language={language || ''} />;
      if (output) return <ProcessCodeBlock text={output} />;
      return entry.result ? <Markdown>{entry.result}</Markdown> : null;
    }
    case 'glob':
    case 'grep':
    case 'ls':
    case 'webfetch':
    case 'websearch':
    case 'skill':
    case 'todo':
    case 'todowrite':
    case 'plan': {
      if (entry.toolName === 'skill') {
        const skillDoc = extractSkillDocument(entry);
        if (skillDoc) {
          return (
            <div className="space-y-3">
              {skillDoc.name ? (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <BookOpenIcon className="size-3.5 text-violet-600" />
                  <span>技能文档</span>
                  <code className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{skillDoc.name}</code>
                </div>
              ) : null}
              <div className="prose-sm max-w-none text-sm dark:prose-invert [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_blockquote]:my-2">
                <Markdown>{skillDoc.body}</Markdown>
              </div>
            </div>
          );
        }
      }
      const todos = asArray(meta.todos);
      if (todos.length > 0) return <ProcessTodoQueue todos={todos} />;
      const output = asString(meta.output);
      return output
        ? ((isTerminalTool || containsAnsiEscape(output)) ? <ProcessTerminalBlock text={output} /> : <ProcessCodeBlock text={output} />)
        : (entry.result ? <Markdown>{entry.result}</Markdown> : null);
    }
    default: {
      const output = asString(meta.output) || asString(meta.content) || asString(meta.message);
      if (output) return containsAnsiEscape(output) ? <ProcessTerminalBlock text={output} /> : <ProcessCodeBlock text={output} />;
      if (error) {
        const errorText = asString(meta.errorText) || asString(meta.errorMessage) || asString(meta.error);
        if (errorText) return containsAnsiEscape(errorText) ? <ProcessTerminalBlock text={errorText} /> : <ProcessCodeBlock text={errorText} />;
      }
      return entry.result ? <Markdown>{entry.result}</Markdown> : null;
    }
  }
}

function groupTimelineItems(items: TimelineItem[]): RenderItem[] {
  const grouped: RenderItem[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind !== 'tool-entry') {
      grouped.push(item);
      continue;
    }

    const entries: Array<{ key: string; entry: ToolProcessEntry }> = [{ key: item.key, entry: item.entry }];
    let end = item.end;
    let cursor = index + 1;
    while (cursor < items.length && items[cursor].kind === 'tool-entry') {
      const nextItem = items[cursor] as Extract<TimelineItem, { kind: 'tool-entry' }>;
      entries.push({ key: nextItem.key, entry: nextItem.entry });
      end = nextItem.end;
      cursor += 1;
    }

    if (entries.length >= 2) {
      grouped.push({
        kind: 'tool-group',
        key: `tool-group-${item.start}-${end}`,
        start: item.start,
        end,
        entries,
      });
    } else {
      grouped.push(item);
    }

    index = cursor - 1;
  }

  return grouped;
}

function renderToolEntryCard(
  entry: ToolProcessEntry,
  key: string,
  isStreaming: boolean,
) {
  const preview = getToolPreview(entry);
  const suppressRequestDetails = Boolean(preview) && ['bash', 'cmd', 'powershell', 'skill'].includes(entry.toolName);
  const requestContent = suppressRequestDetails
    ? null
    : (renderStructuredToolRequest(entry) || (entry.request ? <Markdown>{entry.request}</Markdown> : null));
  const resultContent = entry.state === 'output-available'
    ? (renderStructuredToolResult(entry) || (entry.result ? <Markdown>{entry.result}</Markdown> : null))
    : null;
  const headerTitle = entry.toolName === 'skill' ? '技能文档' : entry.title;
  const headerIcon = entry.toolName === 'skill' ? <BookOpenIcon className="size-4 text-violet-600" /> : undefined;
  const shouldOpen = shouldOpenProcessCard({
    isStreaming,
    state: entry.state,
    hasRequest: Boolean(requestContent),
    hasResult: Boolean(resultContent),
    defaultCollapsed: isCollapsedByDefaultTool(entry),
  });

  return (
    <Tool
      key={key}
      className="overflow-hidden rounded-xl border-border/70 bg-background/70 shadow-sm"
      defaultOpen={shouldOpen}
      data-testid="ace-tool-card"
      data-tool-name={entry.toolName || 'tool'}
      data-tool-id={entry.toolId || ''}
      data-tool-state={entry.state}
    >
      <ToolHeader
        type="dynamic-tool"
        toolName={entry.toolName || 'tool'}
        title={headerTitle}
        state={entry.state}
        hideDefaultIcon
        icon={headerIcon}
        className="bg-muted/30"
      />
      {preview ? (
        <div className="border-t border-border/50 px-4 py-2 text-sm text-muted-foreground">
          {entry.toolName === 'skill' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">技能</span>
              <span className="min-w-0 truncate text-sm font-medium text-foreground">{preview}</span>
            </div>
          ) : (
            <div className="tool-path-scroll overflow-x-auto whitespace-nowrap font-mono text-[12px]">{preview}</div>
          )}
        </div>
      ) : null}
      <ToolContent className="space-y-3">
        {requestContent ? (
          <div className="max-w-none text-sm">
            {requestContent}
          </div>
        ) : null}
        {resultContent ? (
          <div className="max-w-none text-sm">
            {resultContent}
          </div>
        ) : null}
      </ToolContent>
    </Tool>
  );
}

export function WrapperProcessBlocks({ content, isStreaming = false }: { content: string; isStreaming?: boolean }) {
  const { timelineItems } = useMemo(() => buildProcessTimelineState(content, isStreaming), [content, isStreaming]);
  const renderItems = useMemo(() => groupTimelineItems(timelineItems), [timelineItems]);
  const lastReasoningIndex = useMemo(
    () => renderItems.reduce((lastIndex, item, index) => (item.kind === 'reasoning' ? index : lastIndex), -1),
    [renderItems],
  );

  if (!renderItems.length) return null;

  return (
    <div className="space-y-2">
      {renderItems.map((item, index) => {
        if (item.kind === 'text') {
          return (
            <div key={item.key} className={ASSISTANT_MARKDOWN_CLASS} data-testid="ace-timeline-text">
              <Markdown>{item.text}</Markdown>
            </div>
          );
        }

        if (item.kind === 'reasoning') {
          return (
            <Reasoning
              key={item.key}
              isStreaming={isStreaming && index === lastReasoningIndex}
              className="rounded-xl border border-border/70 bg-background/60 px-3 py-2"
              data-testid="ace-reasoning"
            >
              <ReasoningTrigger />
              <ReasoningContent data-testid="ace-reasoning-content">{item.text}</ReasoningContent>
            </Reasoning>
          );
        }

        if (item.kind === 'tool-entry') {
          return renderToolEntryCard(item.entry, item.key, isStreaming);
        }

        if (item.kind === 'tool-group') {
          const pendingCount = item.entries.filter(({ entry }) => entry.state !== 'output-available').length;
          const groupTitle = pendingCount > 0 && isStreaming ? '工具调用中' : '工具调用已完成';
          const groupSummary = `${item.entries.length} 个步骤${pendingCount > 0 && isStreaming ? ` · 进行中 ${pendingCount}` : ''}`;
          return (
            <Task
              key={`${item.key}-${pendingCount > 0 && isStreaming ? 'pending' : 'done'}`}
              defaultOpen={pendingCount > 0}
              className="rounded-xl border border-border/70 bg-background/60 px-3 py-3 shadow-sm"
              data-testid="ace-tool-group"
            >
              <TaskTrigger title={groupTitle}>
                <div className="group flex w-full cursor-pointer items-start gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
                  <WrenchIcon className="mt-0.5 size-4 shrink-0 text-blue-500" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">{groupTitle}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{groupSummary}</div>
                  </div>
                  <ChevronDownIcon className="mt-0.5 size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
                </div>
              </TaskTrigger>
              <TaskContent className="mt-3 data-[state=closed]:hidden data-[state=open]:block" forceMount>
                <div className="space-y-2 border-l-0 pl-0">
                  {item.entries.map(({ key, entry }) => (
                    <TaskItem key={key} className="text-sm">
                      {renderToolEntryCard(entry, key, isStreaming)}
                    </TaskItem>
                  ))}
                </div>
              </TaskContent>
            </Task>
          );
        }

        const entry = item.entry;
        const title = entry.title || '子任务';
        const preview = getSubtaskPreview(entry);
        const shouldOpen = shouldOpenProcessCard({
          isStreaming,
          state: entry.state,
          hasRequest: Boolean(entry.description || entry.internalText || entry.prompt || entry.agent || entry.sessionId),
          hasResult: Boolean(entry.result),
          defaultCollapsed: true,
        });
        return (
          <Tool
            key={item.key}
            className="overflow-hidden rounded-xl border-border/70 bg-background/70 shadow-sm"
            defaultOpen={shouldOpen}
            data-testid="ace-subtask-card"
            data-tool-id={entry.toolId || ''}
            data-session-id={entry.sessionId || ''}
            data-subtask-state={entry.state}
          >
            <ToolHeader
              type="dynamic-tool"
              toolName="subtask"
              title={title}
              state={entry.state}
              hideDefaultIcon
              className="bg-muted/30"
            />
            {preview ? (
              <div className="border-t border-border/50 px-4 py-2 text-sm text-muted-foreground">
                <div className="whitespace-pre-wrap break-words">{preview}</div>
              </div>
            ) : null}
            <ToolContent className="space-y-3">
              {entry.description ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">请求</div>
                  <div className="prose-sm max-w-none text-sm dark:prose-invert [&_p]:my-1">
                    <Markdown>{entry.description}</Markdown>
                  </div>
                </div>
              ) : null}
              {entry.internalText ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">过程</div>
                  <WrapperProcessBlocks content={entry.internalText} isStreaming={isStreaming && entry.state !== 'output-available'} />
                </div>
              ) : null}
              {(entry.agent || entry.sessionId) ? (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {entry.agent ? (
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                      Agent: {entry.agent}
                    </span>
                  ) : null}
                  {entry.sessionId ? (
                    <span className="inline-flex items-center rounded-full border px-2 py-0.5">
                      会话: {entry.sessionId}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {entry.prompt ? (
                <details className="rounded-md border bg-muted/20">
                  <summary className="cursor-pointer px-3 py-2 text-xs text-muted-foreground">查看提示词</summary>
                  <div className="px-3 pb-3 text-sm">
                    <Markdown>{`\`\`\`\n${entry.prompt}\n\`\`\``}</Markdown>
                  </div>
                </details>
              ) : null}
              {entry.result ? (
                <div className="space-y-1">
                  <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">结果</div>
                  <div className="prose-sm max-w-none text-sm dark:prose-invert [&_p]:my-1">
                    <Markdown>{entry.result}</Markdown>
                  </div>
                </div>
              ) : null}
            </ToolContent>
          </Tool>
        );
      })}
    </div>
  );
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
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    timestamp?: number;
  };
  isStreaming?: boolean;
  onConfirmAction: (actionId: string) => void;
  onRejectAction: (actionId: string) => void;
  onUndoAction: (actionId: string) => void;
  onRetryAction: (actionId: string) => void;
  onReloadActionResult?: (actionId: string) => void;
  onAction?: (prompt: string) => void;
  onDelete?: (messageId: string) => void;
  onRetryFromMessage?: (messageId: string) => void;
  onEditMessage?: (messageId: string) => void;
  onContinue?: (messageId: string) => void; // For timeout recovery
  onSaveAsNotebook?: (messageId: string) => void;
  onQuoteMessage?: (messageId: string) => void;
  werewolfView?: {
    mode: 'god' | 'night';
    viewer?: string;
    viewerRole?: 'werewolf' | 'seer' | 'witch' | 'hunter' | 'idiot' | 'guard' | 'villager';
  };
  currentUser?: {
    username?: string;
    avatar?: string;
  } | null;
}

export function ThinkingBot() {
  return (
    <div className="inline-flex items-center gap-2 px-1 py-1 text-muted-foreground">
      <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
      <Shimmer as="span" className="text-[13px]">思考中...</Shimmer>
    </div>
  );
}

function AssistantAvatar() {
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-background/90 backdrop-blur-sm">
      <RobotLogo size={24} className="animate-none" />
    </div>
  );
}

function UserAvatar({ user }: { user?: ChatMessageProps['currentUser'] }) {
  const username = user?.username?.trim() || '用户';
  const initials = username.slice(0, 2).toUpperCase();

  return (
    <SpriteAvatar
      avatar={user?.avatar}
      seed={username}
      category="user-default"
      alt={username}
      fallback={initials}
      className="h-8 w-8 shrink-0 border border-primary/25"
      fallbackClassName="bg-primary text-[11px] font-semibold text-primary-foreground"
    />
  );
}

function getWerewolfCard(message: ChatMessageProps['message']) {
  return (message.cards || []).find((card) => card?.type === 'werewolf_speech') || null;
}

function getWerewolfExtraCards(message: ChatMessageProps['message']) {
  return (message.cards || []).filter((card) => card?.type !== 'werewolf_speech');
}

function getCollaborationCard(message: ChatMessageProps['message']) {
  return (message.cards || []).find((card) => card?.type === 'collaboration_speech') || null;
}

function getCollaborationExtraCards(message: ChatMessageProps['message']) {
  return (message.cards || []).filter((card) => card?.type !== 'collaboration_speech');
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
  if (card.visibility === 'werewolves') {
    if (view.viewerRole === 'werewolf') return true;
    return Array.isArray(card.audience) && card.audience.includes(view.viewer);
  }
  return true;
}

function formatHiddenWerewolfContent(card: any): string {
  return '当前视角不可见。切换到上帝视角或绑定相关玩家后可查看。';
}

function stripResultBlocks(content: string): string {
  const input = String(content || '');
  return stripMachineResultBlocks(input).replace(CHUNK_BOUNDARY_PATTERN, '').trim();
}

function formatMessageTime(timestamp?: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTokenUsage(usage?: ChatMessageProps['message']['usage']): string {
  if (!usage) return 'Token 未返回';
  const input = Number.isFinite(usage.input_tokens) ? usage.input_tokens : undefined;
  const output = Number.isFinite(usage.output_tokens) ? usage.output_tokens : undefined;
  const cacheRead = Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : undefined;
  const cacheWrite = Number.isFinite(usage.cache_creation_input_tokens) ? usage.cache_creation_input_tokens : undefined;
  const values = [input, output, cacheRead, cacheWrite].filter((value): value is number => value !== undefined);
  if (values.length === 0 || values.every((value) => value === 0)) {
    return 'Token 未返回';
  }
  const parts = [
    input !== undefined ? `${input.toLocaleString()} 输入` : '',
    output !== undefined ? `${output.toLocaleString()} 输出` : '',
    cacheRead ? `${cacheRead.toLocaleString()} 缓存读` : '',
    cacheWrite ? `${cacheWrite.toLocaleString()} 缓存写` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function MetadataPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="home-chat-meta-pill inline-flex min-h-[20px] items-center rounded-full px-1.5 py-0.5 leading-none">
      {children}
    </span>
  );
}

function WolfPaw({ className = '', delayMs = 0 }: { className?: string; delayMs?: number }) {
  return (
    <svg
      viewBox="0 0 1106 1024"
      aria-hidden="true"
      className={className}
      style={{ animation: `werewolfPawPulse 1.2s ease-in-out ${delayMs}ms infinite` }}
      fill="currentColor"
    >
      <path d="M492.264146 893.926726H402.634679c-17.279934 0-31.289314 7.814687-31.289314 17.442952 0 9.633359 14.00938 17.442952 31.289314 17.442952h4.172248c17.279934 0 31.289314 7.809593 31.289314 17.442952s-14.00938 17.442952-31.289314 17.442952H214.129554c-17.279934 0-31.284219 7.804498-31.284219 17.442951 0 9.633359 14.004286 17.442952 31.284219 17.442952H918.954204c17.279934 0 31.289314-7.809593 31.289313-17.442952 0-9.638454-14.00938-17.442952-31.289313-17.442951h-53.475078c-17.279934 0-31.289314-7.809593-31.289313-17.442952s14.00938-17.442952 31.289313-17.442952h210.023533c17.279934 0 31.289314-7.809593 31.289313-17.442952 0-9.628265-14.00938-17.442952-31.289313-17.442952h-15.680317H492.264146zM31.116107 1019.440584c-12.628819 0-22.863308-7.498839-22.863309-16.74503 0-9.236002 10.234489-16.729747 22.863309-16.729747h70.072372c12.628819 0 22.868403 7.493745 22.868403 16.729747 0 9.246191-10.239583 16.74503-22.868403 16.74503H31.116107z" />
      <path d="M487.404164 354.820308c-208.469765 0-364.294826 214.959928-364.294826 407.138058 0 61.315236 15.568242 103.460546 47.46378 128.906674 33.729493 26.954047 80.902897 30.382525 118.193319 30.382525 26.872538 0 56.124124-2.047917 87.138345-4.223192 71.483499-4.982245 151.596776-4.982245 223.03952 0 31.009126 2.175275 60.311655 4.223191 87.097589 4.223192 81.947232 0 165.652005-18.920305 165.652005-159.289199 0-192.178129-155.779213-407.138058-364.289732-407.138058zM189.029839 473.762492c24.732924-10.122414 43.612474-30.214412 53.113381-56.496009 12.552405-34.697414 8.120346-76.588008-12.180519-114.92786-35.283261-66.628612-113.042962-103.786582-169.630669-80.520823-24.778773 10.127508-43.612474 30.260261-53.159229 56.582613C-5.379602 313.051978-0.942449 354.947666 19.358416 393.323179c27.83027 52.568289 80.61252 87.892304 131.290816 87.892303 13.479571 0 26.414049-2.5115 38.380607-7.45299zM389.802087 347.999013a82.884587 82.884587 0 0 0 16.322201-1.630182C469.951024 333.312089 508.41314 247.768267 493.761876 151.633353 479.15646 55.661458 415.370479-11.425643 351.380725 1.626005c-63.872585 13.021082-102.288852 98.529244-87.642682 194.704912 13.392967 87.887209 66.37899 151.668096 126.064044 151.668096zM967.671186 278.400413c-9.500907-26.276503-28.416117-46.455104-53.154135-56.582613-56.709971-23.352363-134.347408 13.892211-169.630669 80.520823-20.300865 38.380607-24.732924 80.276295-12.180519 114.92786 9.495813 26.281597 28.380457 46.332841 53.113381 56.496009 11.966558 4.900736 24.901036 7.412236 38.416267 7.412236h0.045849c50.642636 0 103.333188-35.318921 131.168553-87.851549 20.295771-38.329664 24.773678-80.230446 12.221273-114.922766zM611.624064 346.368831a82.782701 82.782701 0 0 0 16.281447 1.630182h0.040755c59.59845 0 112.625227-63.780887 126.064043-151.668096 14.64617-96.175668-23.856701-181.68383-87.642682-194.704912-64.076357-13.051648-127.81649 54.035453-142.386245 150.007348-14.727679 96.134914 23.775192 181.678736 87.642682 194.735478z" />
    </svg>
  );
}

function WerewolfSpeakingIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <>
      <style>{`
        @keyframes werewolfPawPulse {
          0%, 80%, 100% { opacity: 0.28; transform: translateY(0) scale(0.92); }
          40% { opacity: 1; transform: translateY(-1px) scale(1); }
        }
      `}</style>
      <div className={`inline-flex items-center gap-2 ${compact ? 'text-[11px]' : 'text-sm'} opacity-90`}>
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
          <WolfPaw className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} delayMs={0} />
          <WolfPaw className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} delayMs={140} />
          <WolfPaw className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} delayMs={280} />
        </span>
        <span>选手正在发言中</span>
      </div>
    </>
  );
}

function WerewolfChatBubble({ card, message, view, isStreaming = false }: { card: any; message: ChatMessageProps['message']; view?: ChatMessageProps['werewolfView']; isStreaming?: boolean }) {
  const sentAt = formatMessageTime(message.timestamp);
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
    ? 'border-amber-500/30 bg-amber-50 text-amber-950 dark:bg-amber-950/75 dark:text-amber-100'
    : isSystem
      ? 'border-border bg-background text-foreground dark:bg-muted/85 dark:text-foreground'
      : visible
        ? color.bubble
        : 'border-border bg-background text-foreground dark:bg-muted/85 dark:text-foreground';
  const nameClass = isSupervisor
    ? 'text-amber-700 dark:text-amber-300'
    : isSystem
      ? 'text-muted-foreground'
      : visible
        ? color.name
        : 'text-muted-foreground';
  const displayName = visible ? (card.speakerName || 'Agent') : '隐藏行动';
  const displayActionLabel = visible ? card.actionLabel : '黑夜记录';
  const isPending = isStreaming || message.content?.includes('正在推进') || message.content?.includes('处理中');
  const visibleContent = visible ? (message.rawContent || message.content || '') : formatHiddenWerewolfContent(card);
  const hasVisibleContent = Boolean(visibleContent.trim());
  const roleBadgeText = visible
    ? (card.roleLabel || (isSupervisor ? '法官' : isSystem ? '系统' : '玩家'))
    : '夜间行动';
  const visibilityLabel = visible && card.visibility && card.visibility !== 'public'
    ? (card.visibility === 'werewolves' ? '狼队可见' : card.visibility === 'private' ? '私聊' : '上帝')
    : null;
  const bubbleShellClass = isSupervisor
    ? 'border-amber-400/35 bg-[linear-gradient(145deg,rgba(66,42,17,0.96),rgba(33,24,16,0.96))] text-amber-50'
    : isSystem
      ? 'border-slate-400/20 bg-[linear-gradient(145deg,rgba(32,38,54,0.95),rgba(20,24,37,0.95))] text-slate-100'
      : visible
        ? bubbleClass
        : 'border-border bg-[linear-gradient(145deg,rgba(40,44,56,0.95),rgba(25,27,35,0.95))] text-foreground';
  const roleBadgeClass = isSupervisor
    ? 'border-amber-400/30 bg-amber-400/12 text-amber-100'
    : isSystem
      ? 'border-slate-300/15 bg-slate-300/10 text-slate-100'
      : visible
        ? 'border-amber-300/20 bg-black/20 text-amber-50'
        : 'border-slate-300/15 bg-slate-300/10 text-slate-100';
  const avatarShellClass = spriteStyle
    ? 'border-amber-300/45'
    : avatarClass;
  return (
    <div className="group flex items-start gap-3">
      {spriteStyle ? (
        <div
          className={`mt-1 h-14 w-10 shrink-0 rounded-[20px] border bg-cover ${avatarShellClass} ${isPending ? 'animate-pulse' : ''}`}
          style={spriteStyle}
          title={visible ? (card.roleLabel || card.speakerName) : undefined}
        />
      ) : (
        <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${avatarShellClass} ${isPending ? 'animate-pulse' : ''}`}>
          {visible ? (isSystem ? '系' : getWerewolfInitial(card.speakerName || 'A')) : '隐'}
        </div>
      )}
      <div className={`${STANDARD_CHAT_BUBBLE_WIDTH_CLASS} space-y-1`}>
        <div className={`relative overflow-hidden rounded-[28px] rounded-tl-[16px] border px-4 py-3 text-sm ${bubbleShellClass}`}>
          <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <span className="pointer-events-none absolute -left-1 top-8 h-4 w-4 rotate-45 border-b border-l border-current/10 bg-inherit" />
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`font-semibold tracking-[0.02em] ${nameClass}`}>{displayName}</span>
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${roleBadgeClass}`}>
              <span className="text-[11px]">{isSupervisor ? '✦' : isSystem ? '•' : visible ? '☽' : '◌'}</span>
              <span>{roleBadgeText}</span>
            </span>
            {displayActionLabel ? (
              <span className="rounded-full border border-white/10 bg-background/25 px-2 py-0.5 text-[10px] text-current/80">
                {displayActionLabel}
              </span>
            ) : null}
            {isPending ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/15 bg-amber-300/10 px-2 py-0.5 text-[10px] text-amber-100">
                <span className="inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                推进中
              </span>
            ) : null}
            {visibilityLabel ? (
              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-current/80">
                {visibilityLabel}
              </span>
            ) : null}
          </div>
          {isStreaming && !hasVisibleContent ? (
            <div className="flex min-h-[56px] items-center">
              <WerewolfSpeakingIndicator />
            </div>
          ) : (
            <div className="prose-sm prose-neutral max-w-none leading-6 text-current/95 dark:prose-invert [&_p]:my-1">
              <WrapperProcessBlocks content={visibleContent} isStreaming={isStreaming} />
              {isStreaming ? (
                <div className="mt-3 inline-flex rounded-full border border-current/15 bg-background/30 px-2 py-1 opacity-85">
                  <WerewolfSpeakingIndicator compact />
                </div>
              ) : null}
            </div>
          )}
        </div>
        {sentAt ? (
          <div className="px-1 text-[11px] text-muted-foreground opacity-70">
            {sentAt}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CollaborationChatBubble({ card, message, isStreaming = false }: { card: any; message: ChatMessageProps['message']; isStreaming?: boolean }) {
  const sentAt = formatMessageTime(message.timestamp);
  const speakerType = card?.speakerType || 'agent';
  const isSupervisor = speakerType === 'supervisor';
  const isSystem = speakerType === 'system';
  const avatarClass = isSupervisor
    ? 'border-sky-400/30 bg-sky-500/15 text-sky-700 dark:text-sky-300'
    : isSystem
      ? 'border-slate-400/20 bg-slate-500/10 text-slate-600 dark:text-slate-300'
      : 'border-violet-400/25 bg-violet-500/12 text-violet-700 dark:text-violet-300';
  const bubbleClass = isSupervisor
    ? 'border-sky-400/25 bg-sky-50 text-sky-950 dark:bg-sky-950/45 dark:text-sky-50'
    : isSystem
      ? 'border-border bg-muted/60 text-foreground dark:bg-muted/70'
      : 'border-violet-400/20 bg-violet-50 text-violet-950 dark:bg-violet-950/35 dark:text-violet-50';
  const nameClass = isSupervisor
    ? 'text-sky-700 dark:text-sky-300'
    : isSystem
      ? 'text-muted-foreground'
      : 'text-violet-700 dark:text-violet-300';
  const initial = String(card?.speakerName || 'A').replace(/\s+/g, '').slice(0, 1) || 'A';
  const content = message.rawContent || message.content || '';
  return (
    <div className="group flex items-start gap-3">
      <div className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${avatarClass}`}>
        {isSystem ? '系' : initial}
      </div>
      <div className={`${STANDARD_CHAT_BUBBLE_WIDTH_CLASS} space-y-1`}>
        <div className={`rounded-[24px] rounded-tl-[14px] border px-4 py-3 ${bubbleClass}`}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className={`font-semibold ${nameClass}`}>{card?.speakerName || 'Agent'}</span>
            {card?.actionLabel ? (
              <span className="rounded-full border border-current/15 bg-background/50 px-2 py-0.5 text-[10px] text-current/80">
                {card.actionLabel}
              </span>
            ) : null}
          </div>
          <div className="prose-sm prose-neutral max-w-none leading-6 text-current dark:prose-invert [&_p]:my-1">
            <WrapperProcessBlocks content={content} isStreaming={isStreaming} />
          </div>
          {isStreaming ? <div className="mt-2 text-[11px] opacity-70">发言中...</div> : null}
        </div>
        {sentAt ? (
          <div className="px-1 text-[11px] text-muted-foreground opacity-70">{sentAt}</div>
        ) : null}
      </div>
    </div>
  );
}

export default memo(function ChatMessage({ message, isStreaming, onConfirmAction, onRejectAction, onUndoAction, onRetryAction, onReloadActionResult, onAction, onDelete, onRetryFromMessage, onEditMessage, onContinue, onSaveAsNotebook, onQuoteMessage, werewolfView, currentUser }: ChatMessageProps) {
  const { toast } = useToast();
  const rawMessageContent = message.rawContent || message.content || '';
  const processSource = stripResultBlocks(rawMessageContent);
  const streamingResult = isStreaming ? getStreamingResultDisplay(rawMessageContent) : null;
  const [modelLabel, setModelLabel] = useState(message.model || '');
  const visibleSessionTag = message.role === 'user' ? parseVisibleSessionTag(message.content || '') : null;
  const werewolfCard = getWerewolfCard(message);
  const collaborationCard = getCollaborationCard(message);
  const sourceLabel = message.source?.label?.trim() || (message.source?.type === 'wechat' ? '微信' : '');

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

  const processTimelineState = useMemo(
    () => buildProcessTimelineState(processSource, isStreaming ?? false),
    [processSource, isStreaming],
  );
  const sentAt = formatMessageTime(message.timestamp);
  const copyMessageContent = async () => {
    const text = (message.rawContent || message.content || '').trim();
    if (!text) {
      toast('warning', '当前消息没有可复制的内容');
      return;
    }
    const ok = await copyText(text);
    toast(ok ? 'success' : 'error', ok ? '已复制消息内容' : '复制失败');
  };
  const actionBarClass = 'h-7 opacity-0 transition-opacity duration-150 flex items-center gap-0.5 group-hover:opacity-100 group-focus-within:opacity-100';
  const actionButtonClass = 'p-1 rounded-md text-muted-foreground transition-colors duration-150 hover:bg-background/80 hover:text-foreground';
  const destructiveActionButtonClass = 'p-1 rounded-md text-muted-foreground transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive';

  if (message.role === 'user') {
    if (collaborationCard) {
      const extraCards = getCollaborationExtraCards(message);
      return (
        <div className="group">
          <CollaborationChatBubble card={collaborationCard} message={message} isStreaming={isStreaming} />
          {!isStreaming ? (
            <div className={`ml-10 ${actionBarClass}`}>
              <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
                <span className="material-symbols-outlined text-sm">content_copy</span>
              </button>
              {onQuoteMessage && (
                <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="回复">
                  {quoteActionIcon}
                </button>
              )}
              {onEditMessage && (
                <button onClick={() => onEditMessage(message.id)} className={actionButtonClass} title="编辑">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </button>
              )}
              {onRetryFromMessage && (
                <button onClick={() => onRetryFromMessage(message.id)} className={actionButtonClass} title="重试">
                  <span className="material-symbols-outlined text-sm">refresh</span>
                </button>
              )}
              {onSaveAsNotebook && (
                <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
                  <span className="material-symbols-outlined text-sm">note_add</span>
                </button>
              )}
              {onDelete && (
                <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              )}
            </div>
          ) : null}
          {extraCards.length ? (
            <div className="ml-10 max-w-[85%] space-y-2">
              {extraCards.map((card, index) => (
                <UniversalCard key={index} card={card} onAction={onAction} />
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (visibleSessionTag) {
      return (
        <div className="group flex justify-center">
          <div className="flex flex-col items-center gap-1">
            <div className={`home-chat-surface flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs ${visibleSessionTag.className}`}>
              <span className="material-symbols-outlined" style={{ fontSize: '14px' }}>{visibleSessionTag.icon}</span>
              <span className="whitespace-normal break-all">{message.content}</span>
            </div>
            {sentAt ? <div className="text-[11px] text-muted-foreground opacity-70">{sentAt}</div> : null}
            <div className={`${actionBarClass} justify-center`}>
              <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
              </button>
              {onQuoteMessage && (
                <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="引用">
                  {quoteActionIcon}
                </button>
              )}
              {onDelete && (
                <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }
    return (
      <Message from="user" className="items-start gap-2">
        <MessageContent className={`${STANDARD_CHAT_BUBBLE_WIDTH_CLASS} space-y-1`}>
          {sourceLabel ? (
            <div className="flex justify-end">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 backdrop-blur-sm dark:text-emerald-300">
                {sourceLabel}
              </span>
            </div>
          ) : null}
          <div className="home-chat-bubble home-chat-bubble-user rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-primary-foreground">
            <div className="[&_a]:text-white [&_a]:underline [&_a:hover]:text-blue-200 [&_img]:my-2 [&_img]:max-h-64 [&_img]:max-w-[320px] [&_img]:rounded-md [&_img]:border [&_img]:border-white/25 [&_img]:object-contain">
              <Markdown>{message.content}</Markdown>
            </div>
          </div>
          {sentAt ? (
            <div className="flex justify-end px-1 text-[11px] text-muted-foreground opacity-70">
              {sentAt}
            </div>
          ) : null}
          <MessageActions className="justify-end">
            <MessageAction label="复制" onClick={() => { void copyMessageContent(); }}>
              <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>content_copy</span>
            </MessageAction>
            {onQuoteMessage && (
              <MessageAction label="引用" onClick={() => onQuoteMessage(message.id)}>
                {quoteActionIcon}
              </MessageAction>
            )}
            {onEditMessage && (
              <MessageAction label="编辑" onClick={() => onEditMessage(message.id)}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>edit</span>
              </MessageAction>
            )}
            {onRetryFromMessage && (
              <MessageAction label="重试" onClick={() => onRetryFromMessage(message.id)}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>refresh</span>
              </MessageAction>
            )}
            {onDelete && (
              <MessageAction label="删除" variant="danger" onClick={() => onDelete(message.id)}>
                <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
              </MessageAction>
            )}
          </MessageActions>
        </MessageContent>
        <UserAvatar user={currentUser} />
      </Message>
    );
  }

  if (message.role === 'error') {
    const isTimeout = message.content.includes('超时') || message.content.includes('timeout');
    if (werewolfCard) {
      const visibleExtraCards = getWerewolfExtraCards(message).filter((card) => canSeeWerewolfCard(card, werewolfView));
      return (
        <div className="group">
          <WerewolfChatBubble card={werewolfCard} message={message} view={werewolfView} isStreaming={isStreaming} />
          {!isStreaming ? (
            <div className={`ml-10 ${actionBarClass}`}>
              <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
                <span className="material-symbols-outlined text-sm">content_copy</span>
              </button>
              {onQuoteMessage && (
                <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="引用">
                  {quoteActionIcon}
                </button>
              )}
              {isTimeout && onContinue && (
                <button onClick={() => onContinue(message.id)} className={actionButtonClass} title="继续">
                  <span className="material-symbols-outlined text-sm">play_arrow</span>
                </button>
              )}
              {onSaveAsNotebook && (
                <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
                  <span className="material-symbols-outlined text-sm">note_add</span>
                </button>
              )}
              {onDelete && (
                <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              )}
            </div>
          ) : null}
          {visibleExtraCards.length ? (
            <div className="ml-10 max-w-[85%] space-y-2">
              {visibleExtraCards.map((card, index) => (
                <UniversalCard key={index} card={card} onAction={onAction} />
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    if (collaborationCard) {
      const extraCards = getCollaborationExtraCards(message);
      return (
        <div className="group">
          <CollaborationChatBubble card={collaborationCard} message={message} isStreaming={isStreaming} />
          {!isStreaming ? (
            <div className={`ml-10 ${actionBarClass}`}>
              <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
                <span className="material-symbols-outlined text-sm">content_copy</span>
              </button>
              {onQuoteMessage && (
                <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="回复">
                  {quoteActionIcon}
                </button>
              )}
              {isTimeout && onContinue && (
                <button onClick={() => onContinue(message.id)} className={actionButtonClass} title="继续">
                  <span className="material-symbols-outlined text-sm">play_arrow</span>
                </button>
              )}
              {onSaveAsNotebook && (
                <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
                  <span className="material-symbols-outlined text-sm">note_add</span>
                </button>
              )}
              {onDelete && (
                <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                  <span className="material-symbols-outlined text-sm">delete</span>
                </button>
              )}
            </div>
          ) : null}
          {extraCards.length ? (
            <div className="ml-10 max-w-[85%] space-y-2">
              {extraCards.map((card, index) => (
                <UniversalCard key={index} card={card} onAction={onAction} />
              ))}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div className="group flex items-start gap-2">
        <div className={`${STANDARD_CHAT_BUBBLE_WIDTH_CLASS} space-y-1`}>
          <div className="home-chat-bubble home-chat-bubble-error rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-destructive">
            <span className="material-symbols-outlined text-sm mr-1 align-middle">{isTimeout ? 'schedule' : 'error'}</span>
            {message.content}
            {isTimeout && onContinue && (
              <button
                onClick={() => onContinue(message.id)}
                className="ml-2 rounded bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-600 hover:bg-yellow-500/30"
              >
                继续
              </button>
            )}
            {sentAt ? (
              <div className="mt-1 text-[11px] text-muted-foreground opacity-70">
                {sentAt}
              </div>
            ) : null}
          </div>
          <div className={`${actionBarClass} justify-start px-1`}>
            <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
              <span className="material-symbols-outlined text-sm">content_copy</span>
            </button>
            {onQuoteMessage && (
              <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="引用">
                {quoteActionIcon}
              </button>
            )}
            {!isStreaming && onSaveAsNotebook && (
              <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
                <span className="material-symbols-outlined text-sm">note_add</span>
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (werewolfCard) {
    const visibleExtraCards = getWerewolfExtraCards(message).filter((card) => canSeeWerewolfCard(card, werewolfView));
    return (
      <div className="group">
        <WerewolfChatBubble card={werewolfCard} message={message} view={werewolfView} isStreaming={isStreaming} />
        {!isStreaming ? (
          <div className={`ml-10 ${actionBarClass}`}>
            <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
              <span className="material-symbols-outlined text-sm">content_copy</span>
            </button>
            {onQuoteMessage && (
              <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="引用">
                {quoteActionIcon}
              </button>
            )}
            {onSaveAsNotebook && (
              <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
                <span className="material-symbols-outlined text-sm">note_add</span>
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
        ) : null}
        {visibleExtraCards.length ? (
          <div className="ml-10 max-w-[85%] space-y-2">
            {visibleExtraCards.map((card, index) => (
              <UniversalCard key={index} card={card} onAction={onAction} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  if (collaborationCard) {
    const extraCards = getCollaborationExtraCards(message);
    return (
      <div className="group">
        <CollaborationChatBubble card={collaborationCard} message={message} isStreaming={isStreaming} />
        <div className={`ml-10 ${actionBarClass}`}>
          <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
            <span className="material-symbols-outlined text-sm">content_copy</span>
          </button>
          {onQuoteMessage && (
            <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="引用">
              {quoteActionIcon}
            </button>
          )}
          {!isStreaming && onSaveAsNotebook && (
            <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
              <span className="material-symbols-outlined text-sm">note_add</span>
            </button>
          )}
          {onDelete && (
            <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
              <span className="material-symbols-outlined text-sm">delete</span>
            </button>
          )}
        </div>
        {extraCards.length ? (
          <div className="ml-10 max-w-[85%] space-y-2">
            {extraCards.map((card, index) => (
              <UniversalCard key={index} card={card} onAction={onAction} />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  // Assistant message
  const hasAssistantBubbleContent = Boolean(
    processTimelineState.timelineItems.length
    || streamingResult
    || isStreaming
  );

  return (
    <div className="group flex items-start gap-2">
      <AssistantAvatar />
      <div className={`${STANDARD_CHAT_BUBBLE_WIDTH_CLASS} space-y-1`}>
        {sourceLabel ? (
          <div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-700 backdrop-blur-sm dark:text-emerald-300">
              {sourceLabel}
            </span>
          </div>
        ) : null}
        {hasAssistantBubbleContent && (
          <div className="home-chat-bubble home-chat-bubble-assistant rounded-2xl rounded-tl-sm px-4 py-2.5">
            <div className="space-y-3">
              {processTimelineState.timelineItems.length ? (
                <WrapperProcessBlocks content={processSource} isStreaming={isStreaming} />
              ) : null}
              {streamingResult ? (
                <StreamingResultPanel result={streamingResult} />
              ) : null}
              {isStreaming && !streamingResult && (
                <div className="pt-1">
                  <ThinkingBot />
                </div>
              )}
            </div>
          </div>
        )}
        {message.actions?.map(action => (
          <ActionCard
            key={action.id}
            action={action}
            onConfirm={() => onConfirmAction(action.id)}
            onReject={() => onRejectAction(action.id)}
            onUndo={() => onUndoAction(action.id)}
            onRetry={() => onRetryAction(action.id)}
            onReloadResult={onReloadActionResult ? () => onReloadActionResult(action.id) : undefined}
            onAction={onAction}
          />
        ))}
        {message.cards?.map((card, i) => (
          <UniversalCard key={i} card={card} onAction={onAction} />
        ))}
        {(sentAt || message.engine || message.model || message.usage || message.costUsd !== undefined || message.durationMs !== undefined) && (
          <div className="flex flex-wrap items-center gap-1 px-1 text-[11px] text-muted-foreground opacity-70">
            {sentAt && <span>{sentAt}</span>}
            {message.engine && (
              <MetadataPill>
                {getEngineDisplayName(message.engine)}
              </MetadataPill>
            )}
            {message.model && (
              <MetadataPill>
                {modelLabel}
              </MetadataPill>
            )}
            <span>{formatTokenUsage(message.usage)}</span>
            {message.costUsd !== undefined && <span>· ${message.costUsd.toFixed(4)}</span>}
            {message.durationMs !== undefined && <span>· {(message.durationMs / 1000).toFixed(1)}s</span>}
          </div>
        )}
        {!isStreaming && (
          <div className={`${actionBarClass} justify-start`}>
            <button onClick={() => { void copyMessageContent(); }} className={actionButtonClass} title="复制">
              <span className="material-symbols-outlined text-sm">content_copy</span>
            </button>
            {onQuoteMessage && (
              <button onClick={() => onQuoteMessage(message.id)} className={actionButtonClass} title="引用">
                {quoteActionIcon}
              </button>
            )}
            {onSaveAsNotebook && (
              <button onClick={() => onSaveAsNotebook(message.id)} className={actionButtonClass} title="另存为 Notebook">
                <span className="material-symbols-outlined text-sm">note_add</span>
              </button>
            )}
            {onDelete && (
              <button onClick={() => onDelete(message.id)} className={destructiveActionButtonClass} title="删除">
                <span className="material-symbols-outlined text-sm">delete</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
