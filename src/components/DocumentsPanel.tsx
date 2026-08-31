'use client';

import { useState, useEffect, useMemo, useCallback, useRef, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  runsApi,
  workspaceApi,
  type NotebookScope,
  type RunDocumentReference,
  type RunDocumentSource,
  type TreeNode,
} from '@/lib/core/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import ConfirmDialog from '@/components/ConfirmDialog';
import Markdown from '@/components/Markdown';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { VirtualList } from '@/client/virtual/VirtualList';
import { useTranslations } from '@/hooks/useTranslations';
import { useToast } from '@/components/ui/toast';
import styles from '@/client/pages/workbench/page.module.css';
import {
  useDeleteDocumentsMutation,
  useDocumentContentQuery,
  useRenameDocumentMutation,
  useRunDocumentsQuery,
} from '@/client/query/documents';
import { queryKeys } from '@/client/query/query-keys';
import {
  syncDocumentsMetadataToDb,
  useDocumentMetadataRows,
  useSyncDocumentsMetadataToDb,
  type DocumentMetadataRow,
} from '@/client/db/collections';
import { DocumentSourceTabs } from '@/components/documents/DocumentSourceTabs';

export interface DocFile {
  filename: string;
  relativePath?: string;
  documentKey?: string;
  documentSource: RunDocumentSource;
  documentSourceLabel?: string;
  documentDirectory?: string;
  stepName: string;
  baseName: string;
  logicalName?: string;
  iteration: number | null;
  agent: string;
  phaseName: string;
  role: string;
  documentKind?: 'conclusion' | 'detail';
  groupKey?: string;
  groupLabel?: string;
  detailCount?: number;
  sourceRunId?: string;
  sourceConfigFile?: string;
  sourceLabel?: string;
  parentRunId?: string | null;
  rootRunId?: string | null;
  size: number;
  modifiedTime: string;
}

interface DocTreeGroup {
  key: string;
  name: string;
  summary: DocFile | null;
  details: DocFile[];
  detailCount: number;
  latestTime: number;
}

interface DocFolderGroup {
  key: string;
  label: string;
  rawLabel: string;
  order: number;
  files: DocFile[];
}

type DocTreeRow =
  | { type: 'summary'; key: string; group: DocTreeGroup; file: DocFile }
  | { type: 'group'; key: string; group: DocTreeGroup }
  | { type: 'detail'; key: string; group: DocTreeGroup; file: DocFile };

interface DocumentsPanelProps {
  runId: string | null;
  openLatestTimestampedRequest?: number;
  focusRequest?: { requestId: number; stepName: string; filename?: string } | null;
  documentSource?: RunDocumentSource | 'all';
  lockedDocumentSource?: RunDocumentSource;
  onDocumentSourceChange?: (source: RunDocumentSource | 'all') => void;
  onOpenWorkspaceDirectory?: (path: string) => void;
  previewPresentation?: 'inline' | 'drawer';
  lightweightTasklistLayout?: boolean;
  phaseDefinitions?: Array<{ name: string; label?: string; order: number }>;
}

type SortField = 'name' | 'time' | 'size';
type SortOrder = 'asc' | 'desc';
type DocFilter = 'all' | 'conclusion' | 'detail';
type DocumentSourceFilter = RunDocumentSource | 'all';

export type DocumentHighlightKind = 'conclusion' | 'risk' | 'action' | 'evidence' | 'summary';

export interface DocumentHighlight {
  kind: DocumentHighlightKind;
  heading: string;
  points: string[];
}

export interface TransitionContractReceipt {
  version: 1;
  state: string;
  verdict: 'pass' | 'conditional_pass' | 'fail';
  completionCriteria: string[];
  selfLoop?: {
    maxAttempts: number;
    progressCriteria: string[];
  };
  report: {
    completed: string[];
    remaining: string[];
    evidence: Array<{ criterion: string; reference: string }>;
    progress: Array<{ criterion: string; value: string }>;
  };
  generatedAt?: string;
}

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

const DOCUMENT_PHASE_LABELS: Record<string, string> = {
  evidence_intake: '证据接收与核验',
  metric_calc: '指标计算',
  contradiction_analysis: '矛盾与风险分析',
  advocacy: '正反论证',
  report_checkpoint: '最终汇总与检查',
};

const DOCUMENT_PHASE_TOKEN_LABELS: Record<string, string> = {
  evidence: '证据', intake: '接收', metric: '指标', calc: '计算', calculation: '计算',
  contradiction: '矛盾', analysis: '分析', advocacy: '论证', report: '报告', checkpoint: '检查点',
  review: '审查', summary: '汇总', validation: '验证', verify: '核验', risk: '风险', final: '最终',
};

export function formatDocumentPhaseLabel(name: string, configuredLabel?: string): string {
  const raw = normalizeDocumentFolderLabel(name);
  const configured = normalizeDocumentFolderLabel(configuredLabel || '');
  if (configured && configured !== raw) return configured;
  const key = normalizeDocumentFolderKey(raw);
  if (DOCUMENT_PHASE_LABELS[key]) return DOCUMENT_PHASE_LABELS[key];
  const tokens = raw.split(/[\s_-]+/).filter(Boolean);
  const translated = tokens.map((token) => DOCUMENT_PHASE_TOKEN_LABELS[token.toLowerCase()] || token);
  return translated.join(' · ') || raw || '其他阶段';
}

function hasTimestamp(filename: string): boolean {
  return TIMESTAMP_RE.test(filename);
}

function stripTimestampPrefix(filename: string): string {
  return filename.replace(TIMESTAMP_RE, '');
}

const HIGHLIGHT_RULES: Array<{ kind: DocumentHighlightKind; pattern: RegExp }> = [
  { kind: 'conclusion', pattern: /结论|裁决|决策|审批意见|核心发现|关键发现|verdict|decision|conclusion/i },
  { kind: 'risk', pattern: /风险|阻塞|问题|矛盾|异常|缺口|risk|blocker|issue|conflict/i },
  { kind: 'action', pattern: /建议|行动|下一步|待办|跟进|整改|措施|recommendation|action|next\s*step|todo/i },
  { kind: 'evidence', pattern: /证据|依据|数据|指标|核验|evidence|metric|verification/i },
  { kind: 'summary', pattern: /摘要|概览|总结|要点|summary|overview|highlights/i },
];

function cleanHighlightPoint(value: string): string {
  const cleaned = value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 220 ? `${cleaned.slice(0, 217).trimEnd()}...` : cleaned;
}

const TRANSITION_CONTRACT_RECEIPT_RE = /<!--\s*transition-contract-receipt\s*([\s\S]*?)-->/i;

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function asReceiptItems(value: unknown, field: 'reference' | 'value'): Array<{ criterion: string; [key: string]: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const criterion = String((item as Record<string, unknown>).criterion || '').trim();
    const detail = String((item as Record<string, unknown>)[field] || '').trim();
    return criterion && detail ? [{ criterion, [field]: detail }] : [];
  });
}

/** Reads the system-generated receipt without treating narrative Markdown as state. */
export function extractTransitionContractReceipt(content: string): TransitionContractReceipt | null {
  const match = String(content || '').match(TRANSITION_CONTRACT_RECEIPT_RE);
  if (!match) return null;
  try {
    const raw = JSON.parse(match[1]);
    const verdict = raw?.verdict;
    if (raw?.version !== 1 || !String(raw?.state || '').trim() || !['pass', 'conditional_pass', 'fail'].includes(verdict)) {
      return null;
    }
    const selfLoop = raw?.selfLoop && Number.isInteger(raw.selfLoop.maxAttempts)
      ? {
        maxAttempts: raw.selfLoop.maxAttempts,
        progressCriteria: asStringList(raw.selfLoop.progressCriteria),
      }
      : undefined;
    return {
      version: 1,
      state: String(raw.state).trim(),
      verdict,
      completionCriteria: asStringList(raw.completionCriteria),
      selfLoop,
      report: {
        completed: asStringList(raw?.report?.completed),
        remaining: asStringList(raw?.report?.remaining),
        evidence: asReceiptItems(raw?.report?.evidence, 'reference') as Array<{ criterion: string; reference: string }>,
        progress: asReceiptItems(raw?.report?.progress, 'value') as Array<{ criterion: string; value: string }>,
      },
      generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    };
  } catch {
    return null;
  }
}

/** Extract a compact, deterministic overview without changing the original run document. */
export function extractDocumentHighlights(content: string): DocumentHighlight[] {
  const lines = String(content || '').split(/\r?\n/);
  const sections: Array<{ heading: string; body: string[] }> = [];
  let current: { heading: string; body: string[] } | null = null;

  for (const line of lines) {
    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headingMatch) {
      if (current) sections.push(current);
      current = { heading: cleanHighlightPoint(headingMatch[1]), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);

  const highlights = sections.flatMap<DocumentHighlight>((section) => {
    const rule = HIGHLIGHT_RULES.find((candidate) => candidate.pattern.test(section.heading));
    if (!rule) return [];
    const points = section.body
      .filter((line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*|[^#\s].{8,})/.test(line))
      .map(cleanHighlightPoint)
      .filter((point) => point.length >= 6 && !/^[-|:]+$/.test(point))
      .slice(0, 3);
    return points.length > 0 ? [{ kind: rule.kind, heading: section.heading, points }] : [];
  });

  if (highlights.length > 0) return highlights.slice(0, 6);

  const fallbackPoints = lines
    .filter((line) => /^\s*(?:[-*+]\s+|\d+[.)]\s+|>\s*)/.test(line))
    .map(cleanHighlightPoint)
    .filter((point) => point.length >= 8)
    .slice(0, 5);
  return fallbackPoints.length >= 2
    ? [{ kind: 'summary', heading: '重点摘要', points: fallbackPoints }]
    : [];
}

function normalizeWorkspacePath(path: string): string {
  let decoded = String(path || '');
  try { decoded = decodeURIComponent(decoded); } catch {}
  return decoded.replace(/\\/g, '/').split(/[?#]/, 1)[0].replace(/\/+$/, '');
}

export function getDocumentsPanelLayout(input: {
  lightweightTasklistLayout?: boolean;
  previewPresentation?: 'inline' | 'drawer';
}): 'two-column' | 'three-column' {
  return input.lightweightTasklistLayout && input.previewPresentation === 'inline'
    ? 'two-column'
    : 'three-column';
}

function getWorkspacePathFilename(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

export function findRunDocumentByWorkspacePath(files: DocFile[], path: string): DocFile | null {
  const normalizedPath = normalizeWorkspacePath(path);
  const rootedMatches = files.filter((file) => {
    if (!file.documentDirectory) return false;
    const root = normalizeWorkspacePath(file.documentDirectory);
    const relativePath = file.relativePath || file.filename;
    return normalizedPath === `${root}/${relativePath}`;
  });
  if (rootedMatches.length === 1) return rootedMatches[0];

  const filename = getWorkspacePathFilename(path);
  if (!filename) return null;
  const filenameMatches = files.filter((file) => file.filename === filename || file.baseName === filename);
  return filenameMatches.length === 1 ? filenameMatches[0] : null;
}

const HIGHLIGHT_PRESENTATION: Record<DocumentHighlightKind, { label: string; icon: string; className: string }> = {
  conclusion: { label: '关键结论', icon: 'gavel', className: 'border-emerald-500/25 bg-emerald-500/[0.06]' },
  risk: { label: '风险与问题', icon: 'warning', className: 'border-amber-500/25 bg-amber-500/[0.06]' },
  action: { label: '后续行动', icon: 'task_alt', className: 'border-blue-500/25 bg-blue-500/[0.06]' },
  evidence: { label: '关键证据', icon: 'fact_check', className: 'border-violet-500/25 bg-violet-500/[0.06]' },
  summary: { label: '重点摘要', icon: 'summarize', className: 'border-border bg-muted/35' },
};

function DocumentHighlightsView({ highlights }: { highlights: DocumentHighlight[] }) {
  if (highlights.length === 0) return null;
  const primaryHighlights = highlights.slice(0, 3).map((highlight) => ({
    ...highlight,
    points: highlight.points.slice(0, 1),
  }));
  return (
    <section className="mb-4 rounded-xl border border-border/70 bg-muted/15 p-3" aria-label="文档重点速览">
      <div className="mb-2 flex items-center gap-2">
        <span className="material-symbols-outlined text-base text-primary">filter_alt</span>
        <div>
          <div className="text-sm font-semibold">文档速览</div>
          <div className="text-[11px] text-muted-foreground">从原文抽取，不能替代上方的结构化流转回执</div>
        </div>
      </div>
      <div className="grid gap-2">
        {primaryHighlights.map((highlight, index) => {
          const presentation = HIGHLIGHT_PRESENTATION[highlight.kind];
          return (
            <article key={`${highlight.heading}-${index}`} className={`rounded-lg border p-3 ${presentation.className}`}>
              <div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold">
                <span className="material-symbols-outlined text-sm">{presentation.icon}</span>
                <span>{presentation.label}</span>
                {highlight.heading !== presentation.label ? (
                  <span className="truncate font-normal text-muted-foreground">· {highlight.heading}</span>
                ) : null}
              </div>
              <ul className="space-y-1 text-xs leading-5 text-foreground/85">
                {highlight.points.map((point, pointIndex) => (
                  <li key={`${point}-${pointIndex}`} className="flex gap-2">
                    <span className="mt-[8px] h-1 w-1 shrink-0 rounded-full bg-current opacity-50" />
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      {highlights.length > primaryHighlights.length ? (
        <details className="mt-2 rounded-md border border-border/60 bg-background/40 px-2.5 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground">查看其余 {highlights.length - primaryHighlights.length} 项原文提取</summary>
          <div className="mt-2 grid gap-2">
            {highlights.slice(primaryHighlights.length).map((highlight, index) => {
              const presentation = HIGHLIGHT_PRESENTATION[highlight.kind];
              return (
                <div key={`${highlight.heading}-${index}`} className={`rounded-md border p-2 ${presentation.className}`}>
                  <div className="mb-1 text-[11px] font-semibold">{presentation.label} · {highlight.heading}</div>
                  <ul className="space-y-1 text-[11px] leading-4 text-foreground/80">
                    {highlight.points.map((point, pointIndex) => <li key={`${point}-${pointIndex}`}>· {point}</li>)}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function TransitionContractView({
  receipt,
  isRuntimeOutput,
}: {
  receipt: TransitionContractReceipt | null;
  isRuntimeOutput: boolean;
}) {
  if (!receipt && !isRuntimeOutput) return null;
  if (!receipt) {
    return (
      <section className="mb-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3" aria-label="流转契约状态">
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-base text-amber-600">rule</span>
          <div>
            <div className="text-sm font-semibold">流转契约：旧运行未留回执</div>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">这份步骤文档没有“完成条件 / 缺失项 / 新进展 / 证据”的机器可读回执，因此系统不能从长文推断是否可流转或继续重试。</p>
          </div>
        </div>
      </section>
    );
  }

  const completed = new Set(receipt.report.completed);
  const evidenceByCriterion = new Map(receipt.report.evidence.map((item) => [item.criterion, item.reference]));
  const missing = Array.from(new Set([
    ...receipt.report.remaining,
    ...receipt.completionCriteria.filter((criterion) => !completed.has(criterion)),
  ]));
  const allComplete = missing.length === 0 && receipt.completionCriteria.length > 0;
  const verdictLabel = receipt.verdict === 'pass' ? '可沿 pass 路径流转' : receipt.verdict === 'conditional_pass' ? '条件未闭合' : '当前裁决失败';
  const tone = allComplete && receipt.verdict === 'pass'
    ? 'border-emerald-500/30 bg-emerald-500/[0.07]'
    : 'border-amber-500/30 bg-amber-500/[0.06]';

  return (
    <section className={`mb-4 rounded-xl border p-3 ${tone}`} aria-label="流转契约回执">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="material-symbols-outlined text-base text-primary">fact_check</span>
        <span className="text-sm font-semibold">流转契约回执</span>
        <Badge variant="outline" className="h-5 border-current/20 bg-background/50 px-1.5 text-[10px]">{receipt.state}</Badge>
        <Badge variant={allComplete && receipt.verdict === 'pass' ? 'default' : 'outline'} className="h-5 px-1.5 text-[10px]">{verdictLabel}</Badge>
        <span className="ml-auto text-[11px] text-muted-foreground">完成 {completed.size}/{receipt.completionCriteria.length} · 缺失 {missing.length}</span>
      </div>
      <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <div className="mb-1 font-medium">完成条件</div>
          <ul className="space-y-1 text-muted-foreground">
            {receipt.completionCriteria.map((criterion) => (
              <li key={criterion} className="flex gap-1.5">
                <span className={`material-symbols-outlined text-sm ${completed.has(criterion) ? 'text-emerald-600' : 'text-amber-600'}`}>{completed.has(criterion) ? 'check_circle' : 'radio_button_unchecked'}</span>
                <span className="min-w-0">{criterion}{evidenceByCriterion.has(criterion) ? <span className="block truncate text-[10px] opacity-80">证据：{evidenceByCriterion.get(criterion)}</span> : null}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-md border border-border/60 bg-background/45 p-2">
          <div className="mb-1 font-medium">仍缺 / 本轮进展</div>
          {missing.length > 0 ? <div className="text-amber-700 dark:text-amber-400">仍缺：{missing.join('；')}</div> : <div className="text-emerald-700 dark:text-emerald-400">所有声明的完成条件已闭合</div>}
          {receipt.report.progress.length > 0 ? (
            <ul className="mt-1.5 space-y-1 text-muted-foreground">
              {receipt.report.progress.map((item) => <li key={`${item.criterion}:${item.value}`}><span className="font-medium">{item.criterion}</span>：{item.value}</li>)}
            </ul>
          ) : receipt.selfLoop ? <div className="mt-1.5 text-[11px] text-muted-foreground">本轮没有可用于重试的新进展；声明的重试上限为 {receipt.selfLoop.maxAttempts} 次。</div> : null}
        </div>
      </div>
      {receipt.report.evidence.length > 0 ? (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium">查看全部 {receipt.report.evidence.length} 条证据引用</summary>
          <ul className="mt-1.5 space-y-1">{receipt.report.evidence.map((item) => <li key={`${item.criterion}:${item.reference}`}>· {item.criterion}：{item.reference}</li>)}</ul>
        </details>
      ) : null}
    </section>
  );
}

function getDisplayFileName(file: DocFile): string {
  if (/transition-contract/i.test(file.baseName || file.filename)) {
    return file.phaseName ? `${file.phaseName} · 流转契约回执` : '状态流转契约回执';
  }
  return stripTimestampPrefix(file.baseName || file.filename);
}

function getDocumentIcon(file: DocFile): string {
  if (/transition-contract/i.test(file.baseName || file.filename)) return 'fact_check';
  return hasTimestamp(file.filename) ? 'article' : 'fact_check';
}

function getDocumentIconClass(file: DocFile): string {
  return hasTimestamp(file.filename)
    ? 'text-blue-500'
    : 'text-emerald-600 dark:text-emerald-400';
}

/** Parse timestamp prefix: "2026-03-30T11-06-14-" → "03-30 11:06" */
function parseTimestamp(filename: string): string {
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-/);
  if (!m) return '';
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

const roleBadge: Record<string, string> = {
  attacker: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  defender: 'bg-red-500/15 text-red-600 dark:text-red-400',
  judge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};
const roleIcon: Record<string, string> = { attacker: 'swords', defender: 'shield', judge: 'gavel' };
const roleLabel: Record<string, string> = { attacker: '攻击方', defender: '防守方', judge: '裁判' };

function normalizeDocumentFolderLabel(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

function normalizeDocumentFolderKey(value: string): string {
  return normalizeDocumentFolderLabel(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'other';
}

function getFallbackFileGroupLabel(filename: string): string {
  const base = filename.replace(/\.(md|txt)$/i, '');
  // Strip ISO timestamp prefix like "2026-03-20T14-30-00-" from conclusion files
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '');
  const idx = stripped.indexOf('-');
  const raw = idx > 0 ? stripped.substring(0, idx) : stripped;
  return normalizeDocumentFolderLabel(raw) || '其他';
}

function getDocumentSourceLabel(file: Pick<DocFile, 'documentSource' | 'documentSourceLabel'>): string {
  return file.documentSourceLabel || (file.documentSource === 'tasklist' ? '任务文档' : '运行输出');
}

function getSourceRunLabel(file: Pick<DocFile, 'sourceLabel'>): string {
  return file.sourceLabel && file.sourceLabel !== '父工作流' ? file.sourceLabel : '';
}

export function getDocumentFolderGroup(
  file: Pick<DocFile, 'filename' | 'phaseName' | 'documentSource' | 'documentSourceLabel' | 'sourceRunId' | 'sourceLabel'>,
): { key: string; label: string; phaseKey: string; phaseLabel: string; sourcePrefix: string } {
  const phaseLabel = normalizeDocumentFolderLabel(file.phaseName) || getFallbackFileGroupLabel(file.filename);
  const phaseKey = normalizeDocumentFolderKey(phaseLabel);
  const sourcePrefix = [getDocumentSourceLabel(file), getSourceRunLabel(file)].filter(Boolean).join(' / ');
  return {
    key: JSON.stringify([file.documentSource, file.sourceRunId || 'root', phaseKey]),
    label: `${sourcePrefix} / ${phaseLabel}`,
    phaseKey,
    phaseLabel,
    sourcePrefix,
  };
}

function getTreeLinkName(file: DocFile): string {
  const base = file.groupLabel || file.logicalName || stripTimestampPrefix(file.baseName || file.filename);
  return [getDocumentSourceLabel(file), getSourceRunLabel(file), base].filter(Boolean).join(' / ');
}

function getDocKey(file: Pick<DocFile, 'filename' | 'relativePath' | 'documentKey' | 'documentSource' | 'sourceRunId'>): string {
  return file.documentKey || JSON.stringify([
    file.sourceRunId || 'root',
    file.documentSource,
    file.relativePath || file.filename,
  ]);
}

function isRootRunFile(file: DocFile, runId: string | null): boolean {
  return Boolean(runId && file.sourceRunId === runId);
}

function toDocumentReference(file: Pick<DocFile, 'documentSource' | 'sourceRunId' | 'relativePath' | 'filename'>): RunDocumentReference {
  return {
    source: file.documentSource,
    sourceRunId: file.sourceRunId,
    file: file.relativePath || file.filename,
  };
}

function getTreeGroupKey(file: DocFile): string {
  if (file.groupKey) return file.groupKey;
  const logical = file.logicalName || stripTimestampPrefix(file.baseName || file.filename);
  return JSON.stringify([
    file.sourceRunId || 'root',
    file.documentSource,
    logical.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_'),
  ]);
}

function sortDocFiles(files: DocFile[], sortField: SortField, sortOrder: SortOrder): DocFile[] {
  const next = [...files];
  next.sort((a, b) => {
    let c = 0;
    if (sortField === 'name') c = a.baseName.localeCompare(b.baseName);
    else if (sortField === 'time') c = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
    else if (sortField === 'size') c = a.size - b.size;
    return sortOrder === 'asc' ? c : -c;
  });
  return next;
}

function documentMetadataRowToDocFile(row: DocumentMetadataRow): DocFile {
  const filename = row.filename || row.name;
  return {
    filename,
    relativePath: row.relativePath || filename,
    documentKey: row.documentKey,
    documentSource: row.documentSource,
    documentSourceLabel: row.documentSourceLabel,
    documentDirectory: row.documentDirectory,
    stepName: row.stepName || '',
    baseName: row.baseName || filename,
    logicalName: row.logicalName,
    iteration: row.iteration ?? null,
    agent: row.agent || '',
    phaseName: row.phaseName || '',
    role: row.role || '',
    documentKind: row.documentKind === 'detail' || row.documentKind === 'conclusion' ? row.documentKind : undefined,
    groupKey: row.groupKey,
    groupLabel: row.groupLabel,
    detailCount: row.detailCount,
    sourceRunId: row.sourceRunId,
    sourceConfigFile: row.sourceConfigFile,
    sourceLabel: row.sourceLabel,
    parentRunId: row.parentRunId,
    rootRunId: row.rootRunId,
    size: row.size || 0,
    modifiedTime: row.modifiedTime || row.updatedAt || '',
  };
}

function buildTreeGroups(files: DocFile[], sortField: SortField, sortOrder: SortOrder): DocTreeGroup[] {
  const map = new Map<string, { name: string; summary: DocFile | null; details: DocFile[]; detailCount: number }>();

  files.forEach((file) => {
    const key = getTreeGroupKey(file);
    const existing = map.get(key) || { name: getTreeLinkName(file), summary: null, details: [], detailCount: 0 };
    existing.name ||= getTreeLinkName(file);
    existing.detailCount = Math.max(existing.detailCount, file.detailCount || 0);
    if (file.documentKind === 'detail' || hasTimestamp(file.filename)) {
      existing.details.push(file);
    } else if (!existing.summary) {
      existing.summary = file;
    } else {
      existing.details.push(file);
    }
    map.set(key, existing);
  });

  return Array.from(map.entries())
    .map(([key, value]) => {
      const sortedDetails = sortDocFiles(value.details, sortField, sortOrder);
      const latestSource = value.summary
        ? [value.summary, ...sortedDetails]
        : sortedDetails;
      const latestTime = latestSource.reduce((max, item) => {
        const time = new Date(item.modifiedTime).getTime();
        return Number.isFinite(time) ? Math.max(max, time) : max;
      }, 0);
      return {
        key,
        name: value.name,
        summary: value.summary,
        details: sortedDetails,
        detailCount: Math.max(value.detailCount, sortedDetails.length),
        latestTime,
      };
    })
    .sort((a, b) => {
      let c = 0;
      if (sortField === 'name') c = a.name.localeCompare(b.name);
      else if (sortField === 'size') {
        const sizeA = (a.summary?.size || 0) + a.details.reduce((sum, item) => sum + item.size, 0);
        const sizeB = (b.summary?.size || 0) + b.details.reduce((sum, item) => sum + item.size, 0);
        c = sizeA - sizeB;
      } else {
        c = a.latestTime - b.latestTime;
      }
      return sortOrder === 'asc' ? c : -c;
    });
}

export default function DocumentsPanel({
  runId,
  openLatestTimestampedRequest = 0,
  focusRequest,
  documentSource,
  lockedDocumentSource,
  onDocumentSourceChange,
  onOpenWorkspaceDirectory,
  previewPresentation = 'inline',
  lightweightTasklistLayout = false,
  phaseDefinitions = [],
}: DocumentsPanelProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<DocFile[]>([]);
  const [docPage, setDocPage] = useState(1);
  const [docPagination, setDocPagination] = useState<{ total: number; totalPages?: number; page?: number; pageSize?: number; offset?: number; limit?: number; nextOffset?: number | null } | null>(null);
  const [documentDirectory, setDocumentDirectory] = useState<string | null>(null);
  const [documentRoots, setDocumentRoots] = useState<Partial<Record<RunDocumentSource, string>>>({});
  const [manualLoading, setManualLoading] = useState(false);
  const [loadingGroups, setLoadingGroups] = useState<Set<string>>(new Set());
  const [loadedGroups, setLoadedGroups] = useState<Set<string>>(new Set());

  // Sorting / filtering
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null); // null = all
  const [docFilter, setDocFilter] = useState<DocFilter>('all');
  const [internalDocumentSource, setInternalDocumentSource] = useState<DocumentSourceFilter>(documentSource || 'all');
  const activeDocumentSource = lockedDocumentSource || documentSource || internalDocumentSource;

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Preview
  const [previewFile, setPreviewFile] = useState<DocFile | null>(null);
  const [previewContent, setPreviewContent] = useState('');

  // Rename
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<DocFile[] | null>(null);
  const [savingNotebookFile, setSavingNotebookFile] = useState<string | null>(null);
  const [saveNotebookDialogOpen, setSaveNotebookDialogOpen] = useState(false);
  const [saveNotebookTarget, setSaveNotebookTarget] = useState<DocFile | null>(null);
  const [saveNotebookScope, setSaveNotebookScope] = useState<NotebookScope>('personal');
  const [saveNotebookDirectory, setSaveNotebookDirectory] = useState('');
  const [saveNotebookDirs, setSaveNotebookDirs] = useState<Array<{ path: string; label: string }>>([]);
  const [saveNotebookDirsLoading, setSaveNotebookDirsLoading] = useState(false);

  // Embedded explorer sidebar controls
  const FOLDER_TREE_WIDTH_KEY = 'doc-folder-tree-width';
  const FILE_LIST_WIDTH_KEY = 'doc-file-list-width';
  const FOLDER_TREE_VISIBLE_KEY = 'doc-folder-tree-visible';
  const FILE_LIST_VISIBLE_KEY = 'doc-file-list-visible';
  const FOLDER_TREE_DEFAULT = 192;
  const FOLDER_TREE_MIN = 120;
  const FOLDER_TREE_MAX = 320;
  const FILE_LIST_DEFAULT = 360;
  const FILE_LIST_MIN = 180;
  const FILE_LIST_MAX = 760;

  const [folderTreeVisible, setFolderTreeVisible] = useState(true);
  const [fileListVisible, setFileListVisible] = useState(true);
  const effectiveFileListVisible = lightweightTasklistLayout || fileListVisible;
  const [folderTreeWidth, setFolderTreeWidth] = useState(FOLDER_TREE_DEFAULT);
  const [fileListWidth, setFileListWidth] = useState(FILE_LIST_DEFAULT);
  const resizingPanel = useRef<'folderTree' | 'fileList' | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const lastOpenLatestRequestRef = useRef(0);
  const documentsQueryParams = useMemo(() => ({
    page: docPage,
    pageSize: 50,
    sortDirection: 'asc' as const,
    scope: 'root' as const,
    source: activeDocumentSource === 'all' ? undefined : activeDocumentSource,
    summaryOnly: docFilter === 'all',
    documentKind: docFilter === 'all' ? undefined : docFilter,
  }), [activeDocumentSource, docFilter, docPage]);
  const documentsQuery = useRunDocumentsQuery(runId, documentsQueryParams);
  useSyncDocumentsMetadataToDb(runId || undefined, documentsQuery.data?.files || []);
  const dbDocumentRows = useDocumentMetadataRows(runId || undefined);
  const dbFiles = useMemo(() => dbDocumentRows.map(documentMetadataRowToDocFile), [dbDocumentRows]);
  const previewContentQuery = useDocumentContentQuery(
    runId,
    previewFile ? toDocumentReference(previewFile) : null,
  );
  const renameDocumentMutation = useRenameDocumentMutation(runId);
  const deleteDocumentsMutation = useDeleteDocumentsMutation(runId);
  const loading = manualLoading || documentsQuery.isLoading;
  const loadingPreview = previewContentQuery.isLoading;

  const selectedRootFiles = useMemo(() => {
    return files
      .filter((file) => isRootRunFile(file, runId) && selected.has(getDocKey(file)))
      .map((file) => file);
  }, [files, runId, selected]);

  const getDocumentDirectory = useCallback((file?: DocFile | null) => {
    if (file?.documentDirectory) return file.documentDirectory;
    if (file) return documentRoots[file.documentSource] || null;
    return documentDirectory;
  }, [documentDirectory, documentRoots]);

  const previewDocumentDirectory = getDocumentDirectory(previewFile);
  const activeDocumentDirectory = previewDocumentDirectory || documentDirectory;

  // Load persisted sidebar state
  useEffect(() => {
    try {
      const ftw = localStorage.getItem(FOLDER_TREE_WIDTH_KEY);
      const flw = localStorage.getItem(FILE_LIST_WIDTH_KEY);
      const ftv = localStorage.getItem(FOLDER_TREE_VISIBLE_KEY);
      const flv = localStorage.getItem(FILE_LIST_VISIBLE_KEY);
      if (ftw) setFolderTreeWidth(Math.max(FOLDER_TREE_MIN, Math.min(FOLDER_TREE_MAX, Number(ftw))));
      if (flw) setFileListWidth(Math.max(FILE_LIST_MIN, Math.min(FILE_LIST_MAX, Number(flw))));
      if (ftv !== null) setFolderTreeVisible(ftv !== 'false');
      if (flv !== null) setFileListVisible(flv !== 'false');
    } catch {}
  }, []);

  const toggleFolderTreeVisible = useCallback(() => {
    setFolderTreeVisible(v => {
      const next = !v;
      try { localStorage.setItem(FOLDER_TREE_VISIBLE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleFileListVisible = useCallback(() => {
    setFileListVisible(v => {
      const next = !v;
      try { localStorage.setItem(FILE_LIST_VISIBLE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const onResizeStart = useCallback((panel: 'folderTree' | 'fileList', e: React.MouseEvent) => {
    e.preventDefault();
    resizingPanel.current = panel;
    startX.current = e.clientX;
    startWidth.current = panel === 'folderTree' ? folderTreeWidth : fileListWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current;
      const newWidth = startWidth.current + delta;
      if (resizingPanel.current === 'folderTree') {
        setFolderTreeWidth(Math.max(FOLDER_TREE_MIN, Math.min(FOLDER_TREE_MAX, newWidth)));
      } else {
        setFileListWidth(Math.max(FILE_LIST_MIN, Math.min(FILE_LIST_MAX, newWidth)));
      }
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (resizingPanel.current === 'folderTree') {
        setFolderTreeWidth(w => { try { localStorage.setItem(FOLDER_TREE_WIDTH_KEY, String(w)); } catch {} return w; });
      } else {
        setFileListWidth(w => { try { localStorage.setItem(FILE_LIST_WIDTH_KEY, String(w)); } catch {} return w; });
      }
      resizingPanel.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [folderTreeWidth, fileListWidth]);

  const loadFiles = useCallback(async () => {
    if (!runId) return;
    await documentsQuery.refetch();
  }, [documentsQuery, runId]);

  useEffect(() => {
    setDocPage(1);
    setActiveGroup(null);
    setExpandedGroups(new Set());
    setSelected(new Set());
    setPreviewFile(null);
    setPreviewContent('');
  }, [activeDocumentSource, docFilter, runId]);

  useEffect(() => {
    const data = documentsQuery.data;
    if (!data) return;
    setDocPagination(data.pagination || null);
    setDocumentDirectory(data.documentDirectory || null);
    setDocumentRoots(data.documentRoots || {});
    setLoadedGroups(new Set());
  }, [documentsQuery.data]);

  useEffect(() => {
    if (!documentsQuery.data && dbFiles.length === 0) return;
    setFiles(dbFiles);
  }, [dbFiles, documentsQuery.data]);

  useEffect(() => {
    if (!documentsQuery.isError) return;
    setFiles([]);
    setDocPagination(null);
    setDocumentDirectory(null);
    setDocumentRoots({});
    setLoadedGroups(new Set());
  }, [documentsQuery.isError]);

  // Filter files by doc type
  const tabFiles = useMemo(() => {
    const sourceFiles = activeDocumentSource === 'all'
      ? files
      : files.filter((file) => file.documentSource === activeDocumentSource);
    if (docFilter === 'conclusion') return sourceFiles.filter(f => !hasTimestamp(f.filename));
    if (docFilter === 'detail') return sourceFiles.filter(f => hasTimestamp(f.filename));
    return sourceFiles;
  }, [activeDocumentSource, files, docFilter]);

  // Build left folder groups from workflow metadata first, with filename fallback.
  const phaseDefinitionMap = useMemo(() => new Map(
    phaseDefinitions.map((phase) => [normalizeDocumentFolderKey(phase.name), phase]),
  ), [phaseDefinitions]);

  const folderGroups = useMemo<DocFolderGroup[]>(() => {
    const map = new Map<string, DocFolderGroup>();
    tabFiles.forEach(f => {
      const group = getDocumentFolderGroup(f);
      const definition = phaseDefinitionMap.get(group.phaseKey);
      const displayLabel = `${group.sourcePrefix} / ${formatDocumentPhaseLabel(group.phaseLabel, definition?.label)}`;
      const existing = map.get(group.key) || {
        key: group.key,
        label: displayLabel,
        rawLabel: group.label,
        order: definition?.order ?? Number.MAX_SAFE_INTEGER,
        files: [],
      };
      existing.files.push(f);
      map.set(group.key, existing);
    });
    return Array.from(map.values()).sort((a, b) => (
      a.order - b.order || a.label.localeCompare(b.label, 'zh-CN')
    ));
  }, [phaseDefinitionMap, tabFiles]);

  const priorityGroup = useMemo(() => {
    if (folderGroups.length === 0) return null;
    const ordered = folderGroups.filter((group) => Number.isFinite(group.order) && group.order < Number.MAX_SAFE_INTEGER);
    return ordered.length > 0 ? ordered[ordered.length - 1] : folderGroups[folderGroups.length - 1];
  }, [folderGroups]);

  const recommendedFile = useMemo(() => {
    const candidates = priorityGroup?.files || [];
    return [...candidates].sort((a, b) => {
      const score = (file: DocFile) => /transition-contract/i.test(file.filename) ? 2 : /汇总|总结|执行摘要|summary|report|checkpoint/i.test(file.filename) ? 1 : 0;
      return score(b) - score(a) || new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime();
    })[0] || null;
  }, [priorityGroup]);

  // Filtered + sorted files
  const scopedFiles = useMemo(() => {
    return activeGroup ? (folderGroups.find(group => group.key === activeGroup)?.files || []) : [...tabFiles];
  }, [activeGroup, folderGroups, tabFiles]);

  const processedFiles = useMemo(() => {
    let filtered = [...scopedFiles];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.filename.toLowerCase().includes(q) || f.baseName.toLowerCase().includes(q));
    }
    return sortDocFiles(filtered, sortField, sortOrder);
  }, [scopedFiles, searchQuery, sortField, sortOrder]);

  const treeGroups = useMemo(() => {
    const grouped = buildTreeGroups(scopedFiles, sortField, sortOrder);
    if (!searchQuery.trim()) return grouped;
    const q = searchQuery.toLowerCase();
    return grouped
      .map((group) => {
        const summaryMatches = Boolean(group.summary && (
          group.summary.filename.toLowerCase().includes(q) || group.summary.baseName.toLowerCase().includes(q)
        ));
        const detailMatches = group.details.filter((file) => (
          file.filename.toLowerCase().includes(q) || file.baseName.toLowerCase().includes(q)
        ));
        if (summaryMatches) {
          return { ...group };
        }
        if (detailMatches.length > 0) {
          return { ...group, details: detailMatches };
        }
        return null;
      })
      .filter(Boolean) as DocTreeGroup[];
  }, [scopedFiles, searchQuery, sortField, sortOrder]);

  const treeRows = useMemo<DocTreeRow[]>(() => {
    const rows: DocTreeRow[] = [];
    treeGroups.forEach((group) => {
      if (group.summary) {
        rows.push({ type: 'summary', key: `summary:${group.key}`, group, file: group.summary });
      } else {
        rows.push({ type: 'group', key: `group:${group.key}`, group });
      }
      if (expandedGroups.has(group.key)) {
        group.details.forEach((file) => {
          rows.push({ type: 'detail', key: `detail:${group.key}:${getDocKey(file)}`, group, file });
        });
      }
    });
    return rows;
  }, [expandedGroups, treeGroups]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const selectFile = useCallback(async (file: DocFile) => {
    if (!runId) return;
    setPreviewFile(file);
  }, [runId]);

  const previewHighlights = useMemo(
    () => extractDocumentHighlights(previewContent),
    [previewContent],
  );
  const previewTransitionContractReceipt = useMemo(
    () => extractTransitionContractReceipt(previewContent),
    [previewContent],
  );
  const openLinkedRunDocument = useCallback(async (absolutePath: string) => {
    const currentMatch = findRunDocumentByWorkspacePath(
      previewFile ? [previewFile, ...files] : files,
      absolutePath,
    );
    if (currentMatch) {
      await selectFile(currentMatch);
      return;
    }
    if (!runId) return;

    try {
      const [rootDocuments, childDocuments] = await Promise.all([
        runsApi.listDocuments(runId, { scope: 'root', documentKind: 'detail', pageSize: 500 }),
        runsApi.listDocuments(runId, { scope: 'children', documentKind: 'detail', pageSize: 500 }),
      ]);
      const discoveredFiles = [...(rootDocuments.files || []), ...(childDocuments.files || [])];
      syncDocumentsMetadataToDb(runId, discoveredFiles);
      const linkedDocument = findRunDocumentByWorkspacePath(discoveredFiles, absolutePath);
      if (!linkedDocument) {
        toast('error', `未找到运行产物：${getWorkspacePathFilename(absolutePath)}`);
        return;
      }
      setFiles((previous) => {
        const existing = new Set(previous.map(getDocKey));
        return [...previous, ...discoveredFiles.filter((file) => !existing.has(getDocKey(file)))];
      });
      await selectFile(linkedDocument);
    } catch {
      toast('error', '打开运行产物失败');
    }
  }, [files, previewFile, runId, selectFile, toast]);

  const handlePreviewLinkCapture = useCallback((event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    const workspaceLink = target?.closest<HTMLElement>('[data-workspace-absolute-path]');
    const absolutePath = workspaceLink?.dataset.workspaceAbsolutePath;
    if (!absolutePath) return;

    const linkedDocument = findRunDocumentByWorkspacePath(
      previewFile ? [previewFile, ...files] : files,
      absolutePath,
    );
    const linkedFilename = getWorkspacePathFilename(absolutePath);
    if (!linkedDocument && !hasTimestamp(linkedFilename)) return;

    // Run artifacts live in the run document store, not necessarily in the project workspace.
    // Stop the generic workspace handler and keep document-to-document navigation in this panel.
    event.preventDefault();
    event.stopPropagation();
    void openLinkedRunDocument(absolutePath);
  }, [files, openLinkedRunDocument, previewFile]);

  useEffect(() => {
    if (!previewFile) return;
    if (previewContentQuery.isError) {
      setPreviewContent('(无法加载)');
      return;
    }
    if (previewContentQuery.data) {
      setPreviewContent(previewContentQuery.data.content);
    }
  }, [previewContentQuery.data, previewContentQuery.isError, previewFile]);

  const loadGroupDetails = useCallback(async (groupKey: string) => {
    if (!runId || loadedGroups.has(groupKey) || loadingGroups.has(groupKey)) return;
    setLoadingGroups((prev) => new Set(prev).add(groupKey));
    try {
      const params = {
        scope: 'children',
        groupKey,
        source: activeDocumentSource === 'all' ? undefined : activeDocumentSource,
        documentKind: 'detail',
        pageSize: 500,
        sortDirection: sortOrder,
      } as const;
      const data = await queryClient.fetchQuery({
        queryKey: queryKeys.documentGroupDetails(runId, groupKey, params),
        queryFn: () => runsApi.listDocuments(runId, params),
        staleTime: 30_000,
      });
      const detailFiles = data.files || [];
      syncDocumentsMetadataToDb(runId, detailFiles);
      setFiles((prev) => {
        const existing = new Set(prev.map(getDocKey));
        const additions = detailFiles.filter((file) => !existing.has(getDocKey(file)));
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });
      setLoadedGroups((prev) => new Set(prev).add(groupKey));
    } catch {
      toast('error', '加载文档详情失败');
    } finally {
      setLoadingGroups((prev) => {
        const next = new Set(prev);
        next.delete(groupKey);
        return next;
      });
    }
  }, [activeDocumentSource, loadedGroups, loadingGroups, queryClient, runId, sortOrder, toast]);

  const toggleExpandedGroup = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) {
        next.delete(groupKey);
      } else {
        next.add(groupKey);
        void loadGroupDetails(groupKey);
      }
      return next;
    });
  }, [loadGroupDetails]);

  useEffect(() => {
    if (!previewFile) return;
    const key = getTreeGroupKey(previewFile);
    setExpandedGroups((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      void loadGroupDetails(key);
      return next;
    });
  }, [loadGroupDetails, previewFile]);

  const openLatestTimestampedFile = useCallback(async () => {
    if (!runId) return;
    setManualLoading(true);
    try {
      const rootParams = {
        page: 1,
        pageSize: 1,
        sortDirection: 'desc' as const,
        documentKind: 'detail' as const,
        scope: 'root' as const,
        source: activeDocumentSource === 'all' ? undefined : activeDocumentSource,
      };
      const rootData = await queryClient.fetchQuery({
        queryKey: queryKeys.documentLatestDetail(runId, rootParams),
        queryFn: () => runsApi.listDocuments(runId, rootParams),
        staleTime: 30_000,
      });
      let nextFiles = rootData.files || [];
      let nextPagination = rootData.pagination || null;
      let latestFile = nextFiles
        .filter(file => hasTimestamp(file.filename))
        .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())[0];

      if (!latestFile) {
        const childParams = {
          scope: 'children' as const,
          page: 1,
          pageSize: 1,
          documentKind: 'detail' as const,
          sortDirection: 'desc' as const,
          source: activeDocumentSource === 'all' ? undefined : activeDocumentSource,
        };
        const childData = await queryClient.fetchQuery({
          queryKey: queryKeys.documentLatestDetail(runId, childParams),
          queryFn: () => runsApi.listDocuments(runId, childParams),
          staleTime: 30_000,
        });
        nextFiles = childData.files || [];
        nextPagination = childData.pagination || null;
        latestFile = nextFiles
          .filter(file => hasTimestamp(file.filename))
          .sort((a, b) => new Date(b.modifiedTime).getTime() - new Date(a.modifiedTime).getTime())[0];
      }

      syncDocumentsMetadataToDb(runId, nextFiles);
      setFiles(nextFiles);
      setDocPagination(nextPagination);

      if (!latestFile) {
        toast('error', '未找到 AI 最新结论文档');
        return;
      }

      await selectFile(latestFile);
    } catch {
      toast('error', '打开最新 AI 结论文档失败');
    } finally {
      setManualLoading(false);
    }
  }, [activeDocumentSource, queryClient, runId, selectFile, toast]);

  useEffect(() => {
    if (!openLatestTimestampedRequest || openLatestTimestampedRequest === lastOpenLatestRequestRef.current) {
      return;
    }
    lastOpenLatestRequestRef.current = openLatestTimestampedRequest;
    void openLatestTimestampedFile();
  }, [openLatestTimestampedFile, openLatestTimestampedRequest]);

  useEffect(() => {
    if (!focusRequest?.requestId || files.length === 0) return;
    const requestedStep = focusRequest.stepName.trim();
    const requestedFilename = String(focusRequest.filename || '').trim();
    const candidates = [...files].sort((a, b) => {
      const aTime = new Date(a.modifiedTime).getTime() || 0;
      const bTime = new Date(b.modifiedTime).getTime() || 0;
      return bTime - aTime;
    });
    const matched = candidates.find((file) => requestedFilename && file.filename === requestedFilename)
      || candidates.find((file) => file.stepName === requestedStep)
      || candidates.find((file) => requestedStep.endsWith(`-${file.stepName}`) || file.stepName.endsWith(`-${requestedStep}`))
      || candidates.find((file) => {
        const name = stripTimestampPrefix(file.baseName || file.filename).replace(/\.(md|txt)$/i, '');
        return name === requestedStep || requestedStep.endsWith(`-${name}`) || name.endsWith(`-${requestedStep}`);
      });
    if (!matched) return;
    const group = getDocumentFolderGroup(matched);
    setActiveGroup(group.key);
    void selectFile(matched);
  }, [files, focusRequest, selectFile]);

  const toggleSelect = (docKey: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(docKey) ? next.delete(docKey) : next.add(docKey);
      return next;
    });
  };
  const toggleSelectAll = () => {
    const visibleFiles = docFilter === 'all'
      ? treeGroups.flatMap(group => group.summary ? [group.summary, ...group.details] : group.details)
      : processedFiles;
    const editableFiles = visibleFiles.filter(f => isRootRunFile(f, runId));
    if (selected.size === editableFiles.length) setSelected(new Set());
    else setSelected(new Set(editableFiles.map(f => getDocKey(f))));
  };

  const handleRename = async (file: DocFile) => {
    if (!runId || !renameValue.trim()) return;
    try {
      await renameDocumentMutation.mutateAsync({ ...toDocumentReference(file), newName: renameValue.trim() });
      setRenamingFile(null);
      await loadFiles();
    } catch { /* toast? */ }
  };

  const handleDelete = async (targetFiles: DocFile[]) => {
    if (!runId) return;
    try {
      const references = targetFiles.map(toDocumentReference);
      await deleteDocumentsMutation.mutateAsync(references);
      setDeleteTarget(null);
      setSelected(prev => {
        const next = new Set(prev);
        targetFiles.forEach((file) => next.delete(getDocKey(file)));
        return next;
      });
      if (previewFile && targetFiles.some((file) => getDocKey(file) === getDocKey(previewFile))) {
        setPreviewFile(null);
        setPreviewContent('');
      }
      await loadFiles();
    } catch { /* toast? */ }
  };

  const downloadFile = (file: DocFile) => {
    const blob = new Blob([previewContent || ''], { type: 'text/markdown;charset=utf-8' });
    if (!previewContent || !previewFile || getDocKey(previewFile) !== getDocKey(file)) {
      runsApi.getDocumentContent(runId!, toDocumentReference(file)).then(({ content }) => {
        const b = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        triggerDownload(b, file.filename);
      });
    } else {
      triggerDownload(blob, file.filename);
    }
  };

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const sanitizeNotebookName = (name: string) => {
    return name
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const collectNotebookDirectories = useCallback((tree: TreeNode[]): Array<{ path: string; label: string }> => {
    const dirs = new Set<string>(['']);
    const walk = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        if (node.type === 'directory') {
          dirs.add(node.path || '');
          if (node.children && node.children.length > 0) walk(node.children);
        }
      });
    };
    walk(tree);
    return Array.from(dirs)
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({ path, label: path || '根目录 /' }));
  }, []);

  const loadNotebookDirectories = useCallback(async (scope: NotebookScope) => {
    setSaveNotebookDirsLoading(true);
    try {
      const result = await workspaceApi.getNotebookTree(8, { scope });
      const dirs = collectNotebookDirectories(result.tree || []);
      setSaveNotebookDirs(dirs.length > 0 ? dirs : [{ path: '', label: '根目录 /' }]);
      setSaveNotebookDirectory((prev) => {
        if (prev && dirs.some((item) => item.path === prev)) return prev;
        return dirs[0]?.path ?? '';
      });
    } catch {
      setSaveNotebookDirs([{ path: '', label: '根目录 /' }]);
      setSaveNotebookDirectory('');
    } finally {
      setSaveNotebookDirsLoading(false);
    }
  }, [collectNotebookDirectories]);

  const openSaveNotebookDialog = useCallback((file: DocFile) => {
    setSaveNotebookTarget(file);
    setSaveNotebookScope('personal');
    setSaveNotebookDirectory('');
    setSaveNotebookDialogOpen(true);
    void loadNotebookDirectories('personal');
  }, [loadNotebookDirectories]);

  const saveDocToNotebook = useCallback(async (file: DocFile, scope: NotebookScope = 'personal', directory = '') => {
    if (!runId) return;
    const fileKey = getDocKey(file);
    setSavingNotebookFile(fileKey);
    try {
      const content = (previewFile && getDocKey(previewFile) === getDocKey(file) && previewContent)
        ? previewContent
        : (await runsApi.getDocumentContent(runId, toDocumentReference(file))).content;
      const base = sanitizeNotebookName(file.baseName.replace(/\.md$/i, '') || 'workflow-doc');
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
      const fileName = `${base}-${stamp}.cj.md`;
      const normalizedDir = (directory || '').replace(/^\/+|\/+$/g, '');
      const notebookPath = normalizedDir ? `${normalizedDir}/${fileName}` : fileName;
      await workspaceApi.manageNotebook('create-file', { path: notebookPath }, { scope });
      await workspaceApi.saveNotebookFile(notebookPath, content, { scope });
      toast('success', `已保存到 Notebook：${notebookPath}`);
    } catch (error: any) {
      toast('error', error?.message || '保存到 Notebook 失败');
    } finally {
      setSavingNotebookFile((prev) => (prev === fileKey ? null : prev));
    }
  }, [previewContent, previewFile, runId, toast]);

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <span className="material-symbols-outlined text-5xl mb-4">description</span>
        <p>启动工作流后查看产出文档</p>
      </div>
    );
  }

  // --- Left sidebar: folder tree ---
  const folderTree = () => (
    <div className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-muted/20">
      <div className="px-3 py-2 border-b border-border/50">
        <div className="text-xs font-semibold text-muted-foreground">
          {activeDocumentSource === 'tasklist' ? '任务清单文档' : '按执行阶段'}
        </div>
        <div className="mt-0.5 text-[10px] text-muted-foreground/80">
          {activeDocumentSource === 'tasklist' ? '按任务清单目录归类' : '从上到下为工作流执行顺序'}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 ${activeGroup === null ? 'bg-accent text-accent-foreground font-medium' : ''}`}
          onClick={() => setActiveGroup(null)}
        >
          <span className="material-symbols-outlined text-sm">folder</span>
          <span className="flex-1">全部文件</span>
          <span className="text-[10px] text-muted-foreground">{tabFiles.length}</span>
        </div>
        {folderGroups.map((group, index) => (
          <div
            key={group.key}
            className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors hover:bg-muted/50 ${activeGroup === group.key ? 'bg-accent text-accent-foreground font-medium' : ''}`}
            onClick={() => setActiveGroup(group.key)}
            title={`${index + 1}. ${group.label} (${group.rawLabel})`}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1 truncate font-medium">
                {group.label}
                {priorityGroup?.key === group.key ? (
                  <Badge className="h-4 shrink-0 px-1 text-[9px]">先看</Badge>
                ) : null}
              </span>
              {group.rawLabel !== group.label ? (
                <span className="block truncate text-[9px] font-normal text-muted-foreground">{group.rawLabel}</span>
              ) : null}
            </span>
            <span className="text-[10px] text-muted-foreground">{group.files.length}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const documentSourceOptions = useMemo(() => {
    const hasTasklist = Boolean(documentRoots.tasklist)
      || activeDocumentSource === 'tasklist'
      || files.some((file) => file.documentSource === 'tasklist');
    return [
      { value: 'all' as const, label: '全部', count: files.length },
      {
        value: 'runtime-output' as const,
        label: '步骤文档',
        count: files.filter((file) => file.documentSource === 'runtime-output').length,
      },
      ...(hasTasklist ? [{
        value: 'tasklist' as const,
        label: '任务清单',
        count: files.filter((file) => file.documentSource === 'tasklist').length,
      }] : []),
    ];
  }, [activeDocumentSource, documentRoots.tasklist, files]);

  const selectDocumentSource = useCallback((nextSource: DocumentSourceFilter) => {
    if (lockedDocumentSource || nextSource === activeDocumentSource) return;
    if (documentSource === undefined) setInternalDocumentSource(nextSource);
    onDocumentSourceChange?.(nextSource);
  }, [activeDocumentSource, documentSource, lockedDocumentSource, onDocumentSourceChange]);

  // --- Toolbar ---
  const toolbar = () => (
    <div className="flex flex-wrap items-center gap-2 p-3">
      <DocumentSourceTabs
        activeSource={activeDocumentSource}
        lockedSource={lockedDocumentSource}
        options={documentSourceOptions}
        onSourceChange={selectDocumentSource}
      />
      {(
        <Input
          placeholder="搜索文件..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-7 text-xs w-40"
        />
      )}
      {(
        <Select value={sortField} onValueChange={v => { setSortField(v as SortField); }}>
          <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">按名称</SelectItem>
            <SelectItem value="time">按时间</SelectItem>
            <SelectItem value="size">按大小</SelectItem>
          </SelectContent>
        </Select>
      )}
      {(
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} title={sortOrder === 'asc' ? '升序' : '降序'}>
          <span className="material-symbols-outlined text-sm">{sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
        </Button>
      )}
      {(
        <div className="flex items-center gap-1 ml-1">
          {([['all', '全部'], ['conclusion', '结论'], ['detail', '详情']] as const).map(([key, label]) => (
            <Badge
              key={key}
              variant={docFilter === key ? 'default' : 'outline'}
              className={`cursor-pointer text-[10px] h-5 px-1.5 select-none transition-colors ${docFilter === key ? '' : 'hover:bg-muted'}`}
              onClick={() => setDocFilter(key)}
            >
              {label}
              <span className="ml-0.5 text-[9px] opacity-70">
                {key === 'all' ? files.length : key === 'conclusion' ? files.filter(f => !hasTimestamp(f.filename)).length : files.filter(f => hasTimestamp(f.filename)).length}
              </span>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex-1" />
      {docPagination && (docPagination.totalPages || 1) > 1 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={loading || (docPagination.page || 1) <= 1}
            onClick={() => setDocPage((page) => Math.max(1, page - 1))}
            title="上一页"
          >
            <span className="material-symbols-outlined text-sm">chevron_left</span>
          </Button>
          <span className="min-w-16 text-center">{docPagination.page || 1}/{docPagination.totalPages || 1}</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={loading || (docPagination.page || 1) >= (docPagination.totalPages || 1)}
            onClick={() => setDocPage((page) => Math.min(docPagination.totalPages || 1, page + 1))}
            title="下一页"
          >
            <span className="material-symbols-outlined text-sm">chevron_right</span>
          </Button>
        </div>
      )}
      {activeDocumentDirectory && onOpenWorkspaceDirectory && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onOpenWorkspaceDirectory(activeDocumentDirectory)}
          title="使用工作区查看文档目录"
        >
          <span className="material-symbols-outlined text-sm mr-1">folder_open</span>
          工作区查看目录
        </Button>
      )}
      {selectedRootFiles.length > 0 && (
        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => setDeleteTarget(selectedRootFiles)}>
          <span className="material-symbols-outlined text-sm mr-1">delete</span>删除 ({selectedRootFiles.length})
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadFiles} disabled={loading}>
        <span className="material-symbols-outlined text-sm">refresh</span>
      </Button>
      {!lightweightTasklistLayout ? (
        <>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleFolderTreeVisible}
            title={folderTreeVisible ? '隐藏文件夹' : '显示文件夹'}>
            <span className="material-symbols-outlined text-sm">side_navigation</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleFileListVisible}
            title={fileListVisible ? '隐藏文件列表' : '显示文件列表'}>
            <span className="material-symbols-outlined text-sm">view_sidebar</span>
          </Button>
        </>
      ) : null}
    </div>
  );

  // --- File row ---
  const fileRow = (
    file: DocFile,
    options?: { indent?: number; prefix?: ReactNode; muted?: boolean }
  ) => {
    const docKey = getDocKey(file);
    const editable = isRootRunFile(file, runId);
    const isRenaming = renamingFile === docKey;
    const isSelected = selected.has(docKey);
    const isActive = previewFile && getDocKey(previewFile) === docKey;
    const rowStyle = options?.indent ? { paddingLeft: `${12 + options.indent}px` } : undefined;

    return (
      <div
        key={docKey}
        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/30 ${isActive ? 'bg-accent' : ''}`}
        style={rowStyle}
        onClick={() => !isRenaming && selectFile(file)}
      >
        <Checkbox checked={isSelected} disabled={!editable} onCheckedChange={() => toggleSelect(docKey)} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5" />
        {options?.prefix}
        <span className={`material-symbols-outlined text-sm shrink-0 ${getDocumentIconClass(file)}`}>{getDocumentIcon(file)}</span>
        {isRenaming ? (
          <Input
            autoFocus
            className="h-6 text-xs flex-1 min-w-0"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(file); if (e.key === 'Escape') setRenamingFile(null); }}
            onBlur={() => setRenamingFile(null)}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 min-w-0" title={file.filename}>{getDisplayFileName(file)}</span>
        )}
        {file.role && (
          <Badge variant="secondary" className={`text-[9px] h-4 px-1 shrink-0 ${roleBadge[file.role] || ''}`}>
            <span className="material-symbols-outlined text-[9px] mr-0.5">{roleIcon[file.role]}</span>
            {roleLabel[file.role]}
          </Badge>
        )}
        {file.sourceLabel && file.sourceLabel !== '父工作流' && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0">
            子流程
          </Badge>
        )}
        <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 text-muted-foreground">
          {getDocumentSourceLabel(file)}
        </Badge>
        {recommendedFile && getDocKey(recommendedFile) === docKey ? (
          <Badge className="h-4 shrink-0 px-1 text-[9px]">推荐</Badge>
        ) : null}
        {hasTimestamp(file.filename) && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 text-muted-foreground">
            {parseTimestamp(file.filename)}
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">{(file.size / 1024).toFixed(1)}K</span>
        <span className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">{new Date(file.modifiedTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0"><span className="material-symbols-outlined text-sm">more_vert</span></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem disabled={!editable} onClick={e => { e.stopPropagation(); if (!editable) return; setRenamingFile(docKey); setRenameValue(file.baseName); }}>
              <span className="material-symbols-outlined text-sm mr-2">edit</span>重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); downloadFile(file); }}>
              <span className="material-symbols-outlined text-sm mr-2">download</span>下载
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={e => { e.stopPropagation(); openSaveNotebookDialog(file); }}
              disabled={savingNotebookFile === getDocKey(file)}
            >
              <span className="material-symbols-outlined text-sm mr-2">save</span>保存到 Notebook…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!editable} className="text-destructive" onClick={e => { e.stopPropagation(); if (!editable) return; setDeleteTarget([file]); }}>
              <span className="material-symbols-outlined text-sm mr-2">delete</span>删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const treeChevron = (group: DocTreeGroup) => (
    <button
      type="button"
      className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
      onClick={(e) => {
        e.stopPropagation();
        toggleExpandedGroup(group.key);
      }}
      title={expandedGroups.has(group.key) ? '收起详情' : '展开详情'}
    >
      <span className="material-symbols-outlined text-[12px]">
        {loadingGroups.has(group.key) ? 'progress_activity' : expandedGroups.has(group.key) ? 'expand_more' : 'chevron_right'}
      </span>
    </button>
  );

  const renderTreeList = () => {
    if (loading) {
      return <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>;
    }
    if (treeGroups.length === 0) {
      return <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>;
    }

    return (
      <>
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b border-border/30 bg-muted/20">
          <Checkbox
            checked={
              (() => {
                const editableFiles = treeGroups
                  .flatMap(group => group.summary ? [group.summary, ...group.details] : group.details)
                  .filter(file => isRootRunFile(file, runId));
                return editableFiles.length > 0 && editableFiles.every(file => selected.has(getDocKey(file)));
              })()
            }
            onCheckedChange={toggleSelectAll}
            className="h-3 w-3"
          />
          <span className="flex-1">总结 / 详情</span>
          <span className="w-14 text-right">大小</span>
          <span className="w-20 text-right">时间</span>
          <span className="w-5" />
        </div>
        <VirtualList
          items={treeRows}
          estimateSize={34}
          height="calc(100% - 29px)"
          className="min-h-0"
          testId="documents-tree-virtual-list"
          maxRenderedItems={80}
          getKey={(row) => row.key}
          renderItem={(row) => {
            if (row.type === 'summary') {
              return fileRow(row.file, {
                prefix: row.group.detailCount > 0 ? treeChevron(row.group) : <span className="w-4 shrink-0" />,
              });
            }
            if (row.type === 'detail') {
              return fileRow(row.file, {
                indent: 22,
                prefix: <span className="material-symbols-outlined text-[12px] text-muted-foreground shrink-0">subdirectory_arrow_right</span>,
                muted: true,
              });
            }
            return (
              <div
                className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border/30 bg-muted/20"
                style={{ paddingLeft: '12px' }}
              >
                {row.group.detailCount > 0 ? treeChevron(row.group) : <span className="w-4 shrink-0" />}
                <span className="material-symbols-outlined text-sm text-amber-600 shrink-0">topic</span>
                <span className="flex-1 truncate font-medium">{row.group.name}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{row.group.detailCount} 条详情</span>
              </div>
            );
          }}
        />
      </>
    );
  };

  // --- File list ---
  const fileList = () => (
    <div className="flex-1 overflow-y-auto">
      {docFilter === 'all' ? renderTreeList() : (
        <>
      {loading && <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>}
      {!loading && processedFiles.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
      )}
      {!loading && processedFiles.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b border-border/30 bg-muted/20">
          <Checkbox
            checked={(() => {
              const editableFiles = processedFiles.filter(file => isRootRunFile(file, runId));
              return editableFiles.length > 0 && editableFiles.every(file => selected.has(getDocKey(file)));
            })()}
            onCheckedChange={toggleSelectAll}
            className="h-3 w-3"
          />
          <span className="flex-1 cursor-pointer" onClick={() => toggleSort('name')}>
            文件名 {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-14 text-right cursor-pointer" onClick={() => toggleSort('size')}>
            大小 {sortField === 'size' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-20 text-right cursor-pointer" onClick={() => toggleSort('time')}>
            时间 {sortField === 'time' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-5" />
        </div>
      )}
      {!loading && processedFiles.length > 0 && (
        <VirtualList
          items={processedFiles}
          estimateSize={34}
          height="calc(100% - 29px)"
          className="min-h-0"
          testId="documents-file-virtual-list"
          maxRenderedItems={80}
          getKey={(file) => getDocKey(file)}
          renderItem={(file) => fileRow(file)}
        />
      )}
        </>
      )}
    </div>
  );

  // --- Preview pane ---
  const previewPane = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      {previewFile ? (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20 shrink-0">
            <span className={`material-symbols-outlined text-sm ${getDocumentIconClass(previewFile)}`}>{getDocumentIcon(previewFile)}</span>
            <span className="text-xs font-medium truncate flex-1" title={previewFile.filename}>{getDisplayFileName(previewFile)}</span>
            <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] text-muted-foreground">
              {getDocumentSourceLabel(previewFile)}
            </Badge>
            {previewDocumentDirectory && onOpenWorkspaceDirectory && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => onOpenWorkspaceDirectory(previewDocumentDirectory)}
                title="使用工作区查看文档目录"
              >
                <span className="material-symbols-outlined text-sm mr-1">folder_open</span>
                目录
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => downloadFile(previewFile)}>
              <span className="material-symbols-outlined text-sm">download</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="保存到Notebook"
                  disabled={savingNotebookFile === getDocKey(previewFile)}
                >
                  <span className="material-symbols-outlined text-sm">note_add</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => void saveDocToNotebook(previewFile, 'personal')}>
                  <span className="material-symbols-outlined text-sm mr-2">person</span>保存到 Notebook（个人）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void saveDocToNotebook(previewFile, 'global')}>
                  <span className="material-symbols-outlined text-sm mr-2">groups</span>保存到 Notebook（团队）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setPreviewFile(null); setPreviewContent(''); }}>
              <span className="material-symbols-outlined text-sm">close</span>
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loadingPreview ? (
              <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>
            ) : (
              <div onClickCapture={handlePreviewLinkCapture}>
                <TransitionContractView
                  receipt={previewTransitionContractReceipt}
                  isRuntimeOutput={previewFile.documentSource === 'runtime-output'}
                />
                <DocumentHighlightsView highlights={previewHighlights} />
                {(previewHighlights.length > 0 || previewTransitionContractReceipt) ? (
                  <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    原始步骤文档
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                <div className={styles.markdownBody}>
                  <Markdown>{previewContent}</Markdown>
                </div>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex h-full flex-col items-center justify-start gap-2 pt-10 text-muted-foreground">
          <span className="material-symbols-outlined text-4xl">preview</span>
          <p className="text-xs">点击文件预览内容</p>
        </div>
      )}
    </div>
  );

  const closePreview = () => {
    setPreviewFile(null);
    setPreviewContent('');
  };

  const previewDrawer = () => (
    <DetailDrawer open={Boolean(previewFile)} onOpenChange={(open) => { if (!open) closePreview(); }}>
      <DetailDrawerContent widthClassName="w-[min(640px,calc(100vw-1rem))]">
        {previewFile ? (
          <>
            <DetailDrawerHeader>
              <DetailDrawerTitle>{getDisplayFileName(previewFile)}</DetailDrawerTitle>
              <DetailDrawerDescription>
                {[getDocumentSourceLabel(previewFile), previewFile.phaseName || previewFile.stepName || '运行文档'].filter(Boolean).join(' / ')}
              </DetailDrawerDescription>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {previewDocumentDirectory && onOpenWorkspaceDirectory ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => onOpenWorkspaceDirectory(previewDocumentDirectory)}
                  >
                    <span className="material-symbols-outlined mr-1 text-sm">folder_open</span>
                    目录
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => downloadFile(previewFile)}>
                  <span className="material-symbols-outlined mr-1 text-sm">download</span>
                  下载
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      disabled={savingNotebookFile === getDocKey(previewFile)}
                    >
                      <span className="material-symbols-outlined mr-1 text-sm">note_add</span>
                      保存到 Notebook
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem onClick={() => void saveDocToNotebook(previewFile, 'personal')}>
                      <span className="material-symbols-outlined mr-2 text-sm">person</span>个人 Notebook
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void saveDocToNotebook(previewFile, 'global')}>
                      <span className="material-symbols-outlined mr-2 text-sm">groups</span>团队 Notebook
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </DetailDrawerHeader>
            <DetailDrawerBody className="p-5">
              {loadingPreview ? (
                <div className="py-10 text-center text-xs text-muted-foreground">加载中...</div>
              ) : (
                <div onClickCapture={handlePreviewLinkCapture}>
                  <TransitionContractView
                    receipt={previewTransitionContractReceipt}
                    isRuntimeOutput={previewFile.documentSource === 'runtime-output'}
                  />
                  <DocumentHighlightsView highlights={previewHighlights} />
                  {(previewHighlights.length > 0 || previewTransitionContractReceipt) ? (
                    <div className="mb-3 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      原始步骤文档
                      <span className="h-px flex-1 bg-border" />
                    </div>
                  ) : null}
                  <div className={styles.markdownBody}>
                    <Markdown>{previewContent}</Markdown>
                  </div>
                </div>
              )}
            </DetailDrawerBody>
          </>
        ) : null}
      </DetailDrawerContent>
    </DetailDrawer>
  );

  return (
    <>
      <div
        className="flex h-full min-h-0 flex-col overflow-hidden bg-background"
        data-testid="documents-panel-layout"
        data-layout={getDocumentsPanelLayout({ lightweightTasklistLayout, previewPresentation })}
      >
        <div className="shrink-0 border-b border-border">{toolbar()}</div>
        {recommendedFile && priorityGroup ? (
          <button
            type="button"
            className="mx-3 mt-3 flex shrink-0 items-center gap-3 rounded-lg border border-primary/25 bg-primary/[0.05] px-3 py-2 text-left transition-colors hover:bg-primary/[0.09]"
            onClick={() => {
              setActiveGroup(priorityGroup.key);
              void selectFile(recommendedFile);
            }}
          >
            <span className="material-symbols-outlined text-lg text-primary">recommend</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] font-semibold text-primary">建议优先查看</span>
              <span className="block truncate text-xs font-medium">{getDisplayFileName(recommendedFile)}</span>
              <span className="block truncate text-[10px] text-muted-foreground">
                {activeDocumentSource === 'tasklist'
                  ? `任务清单：${priorityGroup.label} · 点击直接打开文档`
                  : `最终阶段：${priorityGroup.label} · 点击直接打开结论`}
              </span>
            </span>
            <span className="material-symbols-outlined text-base text-muted-foreground">arrow_forward</span>
          </button>
        ) : null}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {folderTreeVisible && !lightweightTasklistLayout ? (
            <>
              <div style={{ width: folderTreeWidth }} className="shrink-0 overflow-hidden">{folderTree()}</div>
              <div
                className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary"
                onMouseDown={e => onResizeStart('folderTree', e)}
              />
            </>
          ) : null}
          {effectiveFileListVisible ? (
            <>
              <div
                style={previewPresentation === 'inline' ? { width: fileListWidth } : undefined}
                className={previewPresentation === 'inline'
                  ? 'flex shrink-0 flex-col overflow-hidden border-r border-border'
                  : 'flex min-w-0 flex-1 flex-col overflow-hidden'}
              >
                {fileList()}
              </div>
              {previewPresentation === 'inline' ? (
                <div
                  className="w-1 shrink-0 cursor-col-resize bg-border transition-colors hover:bg-primary"
                  onMouseDown={e => onResizeStart('fileList', e)}
                />
              ) : null}
            </>
          ) : null}
          {previewPresentation === 'inline' ? previewPane() : null}
        </div>
      </div>

      {previewPresentation === 'drawer' ? previewDrawer() : null}

      <NotebookSaveDialog
        open={saveNotebookDialogOpen}
        onOpenChange={setSaveNotebookDialogOpen}
        scope={saveNotebookScope}
        onScopeChange={(scope) => {
          setSaveNotebookScope(scope);
          setSaveNotebookDirectory('');
          void loadNotebookDirectories(scope);
        }}
        directory={saveNotebookDirectory}
        onDirectoryChange={setSaveNotebookDirectory}
        directories={saveNotebookDirs}
        loadingDirectories={saveNotebookDirsLoading}
        saving={Boolean(saveNotebookTarget && savingNotebookFile === getDocKey(saveNotebookTarget))}
        previewText={saveNotebookTarget
          ? `将保存：${saveNotebookDirectory ? `${saveNotebookDirectory}/` : ''}${sanitizeNotebookName(saveNotebookTarget.baseName.replace(/\.md$/i, '') || 'workflow-doc')}-YYYYMMDD-HHMMSS.cj.md`
          : '请选择文档'}
        onConfirm={async () => {
          if (!saveNotebookTarget) return;
          await saveDocToNotebook(saveNotebookTarget, saveNotebookScope, saveNotebookDirectory);
          setSaveNotebookDialogOpen(false);
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={deleteTarget?.length === 1 ? `确定要删除 "${deleteTarget[0].filename}" 吗？` : `确定要删除选中的 ${deleteTarget?.length || 0} 个文件吗？`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
