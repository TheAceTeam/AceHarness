'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';
import Ansi from 'ansi-to-react';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math as streamdownMath } from '@streamdown/math';
import { mermaid as streamdownMermaid } from '@streamdown/mermaid';
import {
  Activity,
  ArrowDown,
  BarChart3,
  Bird,
  Boxes,
  Braces,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Code2,
  Copy,
  Download,
  FileJson2,
  Gauge,
  GitBranch,
  Loader2,
  Lock,
  LockOpen,
  Play,
  RotateCcw,
  ShieldCheck,
  Sigma,
  Sparkles,
  TimerReset,
  XCircle,
} from 'lucide-react';
import { Streamdown } from 'streamdown';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import {
  Test,
  TestDuration,
  TestError,
  TestErrorMessage,
  TestName,
  TestResults,
  TestResultsContent,
  TestResultsDuration,
  TestResultsHeader,
  TestResultsProgress,
  TestResultsSummary,
  TestStatus as TestStatusIndicator,
  TestSuite,
  TestSuiteContent,
  TestSuiteName,
  TestSuiteStats,
  type TestStatus as AiTestStatus,
} from '@/components/ai-elements/test-results';
import { VirtualMessageList } from '@/components/chat/VirtualMessageList';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { EngineModelSelect } from '@/components/EngineModelSelect';
import { cn } from '@/lib/core/utils';
import { syncModelDiagnosticsResultToDb, useModelDiagnosticsRows } from '@/client/db/collections';
import type {
  DiagnosticDriver,
  DiagnosticLogEntry,
  DiagnosticPromptRun,
  DiagnosticRunStatus,
  ModelCapabilityScore,
  ModelDiagnosticsResponse,
} from '@/lib/models/diagnostic-types';

interface ManagedModelReference {
  id: string;
  name: string;
  modelRouteId?: string | null;
  modelId?: string;
  agentId?: string | null;
  providerModel?: string | null;
  runtime?: string | null;
  isDefault?: boolean;
  endpoints: string[];
  engines: string[];
}

const PIPELINE = [
  { id: 'probe', label: 'Probe 集合', icon: Boxes, detail: '引擎链路、JSON、代码、骑车鹈鹕、数学、推理、结构化、一致性' },
  { id: 'normalize', label: '响应标准化', icon: Braces, detail: '统一事件、输出、耗时和错误形态' },
  { id: 'features', label: '特征提取', icon: Sigma, detail: '首字延迟、吞吐、JSON 可解析性、SVG 特征、数学精确度' },
  { id: 'score', label: '评分引擎', icon: Gauge, detail: '按能力维度生成分数与证据' },
  { id: 'evidence', label: '证据链', icon: GitBranch, detail: '保存每次 probe 的预览、事件计数和关键结论' },
];

const CAPABILITY_ICONS: Record<string, typeof Gauge> = {
  output_speed: TimerReset,
  json_output: FileJson2,
  code_generation: Code2,
  drawing_pelican: Bird,
  math: Calculator,
  reasoning: Sigma,
  structured_output: ClipboardCheck,
  consistency: ShieldCheck,
};

const LOCAL_RESULT_STORAGE_KEY = 'ace-model-diagnostics:last-result';
const LOCAL_ACTIVE_RUN_STORAGE_KEY = 'ace-model-diagnostics:active-run';
const DEFAULT_TIMEOUT_MS = 180_000;
const streamdownPlugins = { cjk, code, math: streamdownMath, mermaid: streamdownMermaid };
const MODEL_CAPABILITY_OPTIONS = [
  { id: 'json_output', label: 'JSON', description: '嵌套 JSON / 类型 / checksum' },
  { id: 'code_generation', label: '代码', description: 'TypeScript relay 审计函数' },
  { id: 'drawing_pelican', label: '鹈鹕', description: 'SVG 骑车鹈鹕' },
  { id: 'math', label: '数学', description: 'AMC 难题 / 组合 / 几何 / 数论' },
  { id: 'reasoning', label: '推理', description: 'AMC 推理 / 枚举 / 变换' },
  { id: 'structured_output', label: '结构化', description: '复杂 schema / 交叉引用 / rollout' },
  { id: 'consistency', label: '一致性', description: '同题复测稳定性' },
];
const DEFAULT_MODEL_CAPABILITY_IDS = MODEL_CAPABILITY_OPTIONS.map((item) => item.id);

type DiagnosticStreamRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';

interface ActiveDiagnosticRunStorage {
  runId: string;
  requestBody: ModelDiagnosticsRequestBody;
  startedAt: string;
}

interface ModelDiagnosticsRequestBody {
  engine: string;
  driver: DiagnosticDriver;
  model: string;
  timeoutMs: number;
  includeEngineDebug: boolean;
  includeModelScore: boolean;
  modelCapabilityIds: string[];
}

type DiagnosticStreamPayload =
  | {
      type: 'run';
      runId: string;
      status: DiagnosticStreamRunStatus;
      run?: {
        id: string;
        request?: Partial<ModelDiagnosticsRequestBody>;
        status: DiagnosticStreamRunStatus;
        startedAt?: string;
        updatedAt?: string;
        finishedAt?: string;
        error?: string;
      };
    }
  | { type: 'log'; runId?: string; log: DiagnosticLogEntry }
  | { type: 'progress'; runId?: string; result: ModelDiagnosticsResponse }
  | { type: 'result'; runId?: string; result: ModelDiagnosticsResponse }
  | { type: 'error'; runId?: string; error: string };

const RUN_EVIDENCE_META: Record<string, { title: string; goal: string; checks: string[] }> = {
  'engine-single-turn': {
    title: '单轮对话',
    goal: '验证当前引擎能否完成一次最小对话调用，并在会话里注入一个记忆验证码。',
    checks: ['返回 ACE_OK', '首事件与首文本耗时', '注入 ACE_MEMORY_7319 供第二轮回忆'],
  },
  'engine-multi-turn': {
    title: '多轮记忆',
    goal: '验证 wrapper 是否返回 sessionId，并能在第二轮回忆上一轮要求记住的验证码。',
    checks: ['session 复用', '回复 MEMORY=ACE_MEMORY_7319', '上下文记忆没有丢失'],
  },
  'cap-json': {
    title: 'JSON 输出',
    goal: '要求模型只返回嵌套 JSON 对象，检测数组、布尔、聚合字段、矩阵和 checksum。',
    checks: ['可直接解析 JSON', 'profile/items/totals 精确命中', '布尔与矩阵类型正确', '没有 Markdown 包裹'],
  },
  'cap-code': {
    title: '代码生成',
    goal: '要求生成 TypeScript relay 事件审计函数，检测去重、三类风险识别、排序和 provider 聚合。',
    checks: ['函数名 auditRelayEvents', 'RelayEvent/AuditFinding 类型', '识别 3 类风险', 'severity 排序与 provider 聚合'],
  },
  'cap-drawing-pelican': {
    title: '骑车鹈鹕绘图',
    goal: '要求只输出一张可直接渲染的 SVG，主体必须是正在骑自行车的鹈鹕。',
    checks: ['SVG 闭合且 viewBox=0 0 360 240', 'title 同时提到 pelican 和 bicycle', '长喙、喉囊、身体、翅膀、腿有明确标记', '前后车轮、车架、把手、车座、踏板齐全'],
  },
  'cap-math': {
    title: '数学能力',
    goal: '7 道题均改写自 2022 AMC 10A，要求只用 JSON 返回精确数值和计算步骤。',
    checks: ['JSON 可解析且无 Markdown', '7 个答案字段精确命中', 'steps 至少 8 条', '覆盖组合、几何、数论与极值'],
  },
  'cap-reasoning': {
    title: '推理能力',
    goal: '5 道题均改写自 2022 AMC 10A，检测真假话、枚举、计数、几何比例和复合变换。',
    checks: ['真假话 5 字段全部命中', 'repeatingIntegers 13 个整数完整', 'twoPassOrderings=8178', 'trapezoidRatio=1/3 且 returnStep=359'],
  },
  'cap-structured': {
    title: '结构化输出',
    goal: '要求按 relay_audit schema 输出 risks、controls、matrix、verification，并保持交叉引用自洽。',
    checks: ['title=relay_audit, version=4', '至少 5 risks / 5 controls / 4 matrix', 'summary.safeToProxy=false 且 blockers>=2', 'controls/matrix 引用已有 risk/control id'],
  },
  'cap-consistency': {
    title: '一致性首轮',
    goal: '第一次求解同一道等腰梯形比例题，记录标准化答案作为对照。',
    checks: ['输出 BC_OVER_AD=1/3', '首轮格式稳定', '用于和复测比对'],
  },
  'cap-consistency-repeat': {
    title: '一致性复测',
    goal: '第二次重复求解同一道等腰梯形比例题，检查归一化结果是否漂移。',
    checks: ['输出 BC_OVER_AD=1/3', '与首轮归一化后一致', '重复结果稳定'],
  },
};

const RUN_TO_CAPABILITY_ID: Record<string, string> = {
  'cap-json': 'json_output',
  'cap-code': 'code_generation',
  'cap-drawing-pelican': 'drawing_pelican',
  'cap-math': 'math',
  'cap-reasoning': 'reasoning',
  'cap-structured': 'structured_output',
  'cap-consistency': 'consistency',
  'cap-consistency-repeat': 'consistency',
};

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const headers = { ...getAuthHeaders(), ...(init?.headers || {}) };
  return fetch(input, { ...init, headers });
}

function formatMs(value?: number | null): string {
  if (value == null) return '--';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

function formatScore(value?: number | null): string {
  if (value == null) return '--';
  return `${Math.round(value)}`;
}

function statusLabel(status: DiagnosticRunStatus): string {
  if (status === 'passed') return '通过';
  if (status === 'warning') return '注意';
  if (status === 'skipped') return '跳过';
  return '失败';
}

function testStatus(status: DiagnosticRunStatus): AiTestStatus {
  if (status === 'passed' || status === 'warning' || status === 'failed' || status === 'skipped') return status;
  return 'failed';
}

function statusClass(status: DiagnosticRunStatus): string {
  if (status === 'passed') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  if (status === 'warning') return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (status === 'skipped') return 'border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300';
  return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300';
}

function scoreTone(score: number): string {
  if (score >= 80) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 55) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBackground(score: number): string {
  if (score >= 80) return 'from-emerald-500/15 via-background to-background';
  if (score >= 55) return 'from-amber-500/15 via-background to-background';
  return 'from-red-500/15 via-background to-background';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getRouteId(model: ManagedModelReference | null | undefined): string {
  return String(model?.modelRouteId || '').trim();
}

function routeDisplayName(model: ManagedModelReference | null | undefined): string {
  if (!model) return '默认模型';
  return model.name || model.modelId || model.id;
}

function capabilitySummary(capability: ModelCapabilityScore) {
  return capability.evidence.length > 0 ? capability.evidence.slice(0, 2).join('；') : capability.summary;
}

function createClientLog(message: string, detail?: string): DiagnosticLogEntry {
  return {
    id: `client-log-${Date.now()}`,
    at: new Date().toISOString(),
    elapsedMs: 0,
    level: 'info',
    message,
    detail,
  };
}

function normalizeRequestBody(value: Partial<ModelDiagnosticsRequestBody> | undefined): ModelDiagnosticsRequestBody | null {
  if (!value) return null;
  const engine = String(value.engine || '').trim();
  if (!engine) return null;
  return {
    engine,
    driver: value.driver === 'sdk' || value.driver === 'stdio' ? value.driver : 'auto',
    model: String(value.model || ''),
    timeoutMs: Number.isFinite(value.timeoutMs) ? Number(value.timeoutMs) : DEFAULT_TIMEOUT_MS,
    includeEngineDebug: value.includeEngineDebug !== false,
    includeModelScore: value.includeModelScore !== false,
    modelCapabilityIds: Array.isArray(value.modelCapabilityIds) ? value.modelCapabilityIds.map(String) : [],
  };
}

function readActiveDiagnosticRun(): ActiveDiagnosticRunStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_ACTIVE_RUN_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveDiagnosticRunStorage>;
    const runId = String(parsed.runId || '').trim();
    const requestBody = normalizeRequestBody(parsed.requestBody);
    if (!runId || !requestBody) return null;
    return {
      runId,
      requestBody,
      startedAt: String(parsed.startedAt || new Date().toISOString()),
    };
  } catch {
    localStorage.removeItem(LOCAL_ACTIVE_RUN_STORAGE_KEY);
    return null;
  }
}

function saveActiveDiagnosticRun(input: ActiveDiagnosticRunStorage) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCAL_ACTIVE_RUN_STORAGE_KEY, JSON.stringify(input));
}

function clearActiveDiagnosticRun(runId?: string) {
  if (typeof window === 'undefined') return;
  if (!runId) {
    localStorage.removeItem(LOCAL_ACTIVE_RUN_STORAGE_KEY);
    return;
  }
  const active = readActiveDiagnosticRun();
  if (!active || active.runId === runId) {
    localStorage.removeItem(LOCAL_ACTIVE_RUN_STORAGE_KEY);
  }
}

const ANSI = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
  magenta: '\u001b[35m',
};

function ansiByLogLevel(level: DiagnosticLogEntry['level']): string {
  if (level === 'success') return ANSI.green;
  if (level === 'warning') return ANSI.yellow;
  if (level === 'error') return ANSI.red;
  return ANSI.cyan;
}

function ansiByStatus(status: DiagnosticRunStatus): string {
  if (status === 'passed') return ANSI.green;
  if (status === 'warning' || status === 'skipped') return ANSI.yellow;
  return ANSI.red;
}

function indentLines(value: string, prefix = '    '): string[] {
  return String(value || '')
    .split('\n')
    .map((line) => `${prefix}${line}`);
}

function decodeSvgText(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function extractSvg(output?: string): string | null {
  const text = String(output || '').trim();
  if (!text) return null;
  const fenced = text.match(/```(?:svg|xml)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const source = decodeSvgText(fenced || text);
  const svg = source.match(/<svg[\s\S]*<\/svg>/i)?.[0]?.trim();
  return svg || null;
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function formatPromptText(prompt?: string): string {
  return String(prompt || '').trim() || '此 run 没有记录题目';
}

function compactOutput(value?: string, maxLength = 720): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '无输出预览';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function looksLikeJsonDocument(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || !/^[\[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function detectProbeContentLanguage(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^<svg[\s\S]*<\/svg>$/i.test(trimmed)) return 'svg';
  if (/^(?:<\?xml|<[a-z][\w:-]*[\s>])/i.test(trimmed)) return 'xml';
  if (looksLikeJsonDocument(trimmed)) return 'json';
  if (/(^|\n)\s*(export\s+)?(async\s+)?function\s+\w+|(^|\n)\s*(type|interface)\s+\w+|(^|\n)\s*const\s+\w+\s*[:=]/.test(trimmed)) return 'ts';
  if (/(^|\n)\s*(def\s+\w+\(|class\s+\w+|import\s+\w+)/.test(trimmed)) return 'python';
  if (/(^|\n)\s*(SELECT|WITH|INSERT|UPDATE|DELETE)\b/i.test(trimmed)) return 'sql';
  return null;
}

function toRenderableProbeMarkdown(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '无内容';
  if (/```|~~~/.test(text)) return text;
  const language = detectProbeContentLanguage(text);
  if (language) return `\`\`\`${language}\n${text}\n\`\`\``;
  return text;
}

function DiagnosticRichBlock({ content, className }: { content?: string; className?: string }) {
  return (
    <div className={cn('mt-2 w-full overflow-auto rounded-md border border-border/60 bg-background px-3 py-2 text-sm', className)}>
      <Streamdown plugins={streamdownPlugins}>
        {toRenderableProbeMarkdown(content)}
      </Streamdown>
    </div>
  );
}

function localSavedLabel(value: string | null): string {
  if (!value) return '未保存';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '已保存';
  return `已保存 ${new Date(timestamp).toLocaleString()}`;
}

function sanitizeLogFilenamePart(value?: string): string {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'default';
}

function trimStoredText(value?: string, maxLength = 8_000): string | undefined {
  if (!value) return value;
  return value.length > maxLength ? `${value.slice(0, maxLength)}\n...[stored truncated ${value.length - maxLength} chars]` : value;
}

function prepareStoredDiagnosticResult(result: ModelDiagnosticsResponse): ModelDiagnosticsResponse {
  const compactLogs = (result.logs || []).map((log) => ({
    ...log,
    detail: trimStoredText(log.detail, 2_000),
    fullDetail: log.verbose ? undefined : trimStoredText(log.fullDetail, 8_000),
  }));

  return {
    ...result,
    logs: compactLogs,
    engineDebug: result.engineDebug ? {
      ...result.engineDebug,
      runs: result.engineDebug.runs.map((run) => ({
        ...run,
        outputPreview: trimStoredText(run.outputPreview, 12_000),
        eventSamples: run.eventSamples.slice(0, 20).map((sample) => ({
          ...sample,
          content: trimStoredText(sample.content, 4_000),
          contentPreview: trimStoredText(sample.contentPreview, 1_000),
        })),
      })),
    } : result.engineDebug,
    modelEvaluation: result.modelEvaluation ? {
      ...result.modelEvaluation,
      runs: result.modelEvaluation.runs.map((run) => ({
        ...run,
        outputPreview: trimStoredText(run.outputPreview, run.id === 'cap-drawing-pelican' ? 40_000 : 16_000),
        eventSamples: run.eventSamples.slice(0, 20).map((sample) => ({
          ...sample,
          content: trimStoredText(sample.content, 4_000),
          contentPreview: trimStoredText(sample.contentPreview, 1_000),
        })),
      })),
    } : result.modelEvaluation,
  };
}

function capabilityRuns(capabilityId: string, runs: DiagnosticPromptRun[]): DiagnosticPromptRun[] {
  if (capabilityId === 'output_speed') return [];
  return runs.filter((run) => RUN_TO_CAPABILITY_ID[run.id] === capabilityId);
}

function formatJsonBlock(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatMetricValue(value: string | number | boolean | null): string {
  if (value == null) return '未返回';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return value;
}

function formatEventCounts(run: DiagnosticPromptRun): string {
  const entries = Object.entries(run.eventCounts);
  if (entries.length === 0) return 'no events';
  return entries.map(([type, count]) => `${type}:${count}`).join(' / ');
}

function capabilityResultSummary(capability: ModelCapabilityScore, runs: DiagnosticPromptRun[]) {
  const statuses = runs.length > 0 ? runs.map((run) => run.status) : [capability.status];
  return {
    passed: statuses.filter((status) => status === 'passed').length,
    failed: statuses.filter((status) => status === 'failed').length,
    skipped: statuses.filter((status) => status === 'skipped').length,
    warning: statuses.filter((status) => status === 'warning').length,
    total: statuses.length,
    duration: runs.length > 0 ? runs.reduce((sum, run) => sum + run.durationMs, 0) : undefined,
  };
}

function failedCapabilityIdsFromResult(result: ModelDiagnosticsResponse | null): string[] {
  const capabilities = result?.modelEvaluation?.capabilities || [];
  return DEFAULT_MODEL_CAPABILITY_IDS.filter((id) => {
    const capability = capabilities.find((item) => item.id === id);
    if (!capability) return false;
    return capability.status === 'failed' || capability.status === 'warning' || capability.score < 80;
  });
}

function remainingRequestBodyFromLogs(
  requestBody: ModelDiagnosticsRequestBody,
  logs: DiagnosticLogEntry[],
): ModelDiagnosticsRequestBody | null {
  const text = logs.map((log) => log.message).join('\n');
  const completedCapabilities = new Set<string>();
  if (text.includes('JSON 输出 probe 完成')) completedCapabilities.add('json_output');
  if (text.includes('代码生成 probe 完成')) completedCapabilities.add('code_generation');
  if (text.includes('骑车鹈鹕绘图 probe 完成')) completedCapabilities.add('drawing_pelican');
  if (text.includes('数学能力 probe 完成')) completedCapabilities.add('math');
  if (text.includes('推理能力 probe 完成')) completedCapabilities.add('reasoning');
  if (text.includes('结构化输出 probe 完成')) completedCapabilities.add('structured_output');
  if (text.includes('一致性首轮 probe 完成') && text.includes('一致性复测 probe 完成')) {
    completedCapabilities.add('consistency');
  }

  const engineDebugComplete = text.includes('多轮记忆 probe 完成') || text.includes('多轮记忆 probe 跳过');
  const remainingCapabilityIds = requestBody.modelCapabilityIds.filter((id) => !completedCapabilities.has(id));
  const includeEngineDebug = requestBody.includeEngineDebug && !engineDebugComplete;
  const includeModelScore = requestBody.includeModelScore && remainingCapabilityIds.length > 0;
  if (!includeEngineDebug && !includeModelScore) return null;
  return {
    ...requestBody,
    includeEngineDebug,
    includeModelScore,
    modelCapabilityIds: includeModelScore ? remainingCapabilityIds : [],
  };
}

function scoreStatusCount(status: DiagnosticRunStatus) {
  return {
    passed: status === 'passed' ? 1 : 0,
    failed: status === 'failed' ? 1 : 0,
    skipped: status === 'skipped' ? 1 : 0,
    warning: status === 'warning' ? 1 : 0,
  };
}

function buildDiagnosticTerminalOutput(
  logs: DiagnosticLogEntry[],
  result: ModelDiagnosticsResponse | null,
  running: boolean,
  detailed: boolean,
): string {
  const visibleLogs = detailed ? logs : logs.filter((item) => !item.verbose);
  const verboseCount = logs.length - visibleLogs.length;
  const lines: string[] = [
    `${ANSI.cyan}$ ace diagnostics ${detailed ? '--full-log' : '--summary'}${ANSI.reset}`,
    `${ANSI.dim}stream=${running ? 'open' : 'closed'} mode=${detailed ? 'full' : 'summary'} logs=${visibleLogs.length}${verboseCount > 0 && !detailed ? ` hidden_verbose=${verboseCount}` : ''} result=${result ? 'ready' : 'pending'}${ANSI.reset}`,
    '',
  ];

  if (visibleLogs.length === 0) {
    lines.push(`${ANSI.dim}waiting for diagnostic logs...${ANSI.reset}`);
  } else {
    for (const item of visibleLogs) {
      const color = ansiByLogLevel(item.level);
      lines.push(`${ANSI.dim}+${formatMs(item.elapsedMs).padStart(7)}${ANSI.reset} ${color}${item.level.toUpperCase().padEnd(7)}${ANSI.reset} ${item.verbose ? '[verbose] ' : ''}${item.message}`);
      if (item.detail) lines.push(...indentLines(`${ANSI.dim}${item.detail}${ANSI.reset}`, '          '));
      if (detailed) {
        if (item.fullDetail && item.fullDetail !== item.detail) {
          lines.push(...indentLines(`${ANSI.dim}fullDetail:${ANSI.reset}`, '          '));
          lines.push(...indentLines(item.fullDetail, '            '));
        }
        lines.push(...indentLines(`${ANSI.dim}id=${item.id} at=${item.at} verbose=${Boolean(item.verbose)}${ANSI.reset}`, '          '));
      }
    }
  }

  if (result?.engineDebug?.stages?.length) {
    lines.push('', `${ANSI.magenta}# stages${ANSI.reset}`);
    for (const stage of result.engineDebug.stages) {
      const color = ansiByStatus(stage.status);
      lines.push(`${color}${stage.status.padEnd(7)}${ANSI.reset} ${stage.label.padEnd(16)} ${formatMs(stage.durationMs).padStart(8)}  ${stage.detail || ''}`);
      if (detailed) {
        lines.push(...indentLines(`${ANSI.dim}id=${stage.id} started=${stage.startedAt} finished=${stage.finishedAt}${ANSI.reset}`, '          '));
      }
    }
  }

  const allResultRuns = [
    ...(result?.engineDebug?.runs || []),
    ...(result?.modelEvaluation?.runs || []),
  ];
  if (allResultRuns.length > 0) {
    lines.push('', `${ANSI.magenta}# probe runs${ANSI.reset}`);
    for (const run of allResultRuns) {
      const color = ansiByStatus(run.status);
      const events = Object.entries(run.eventCounts)
        .map(([type, count]) => `${type}:${count}`)
        .join(', ') || 'no-events';
      lines.push(`${color}${run.status.padEnd(7)}${ANSI.reset} ${run.label.padEnd(12)} duration=${formatMs(run.durationMs)} firstText=${formatMs(run.firstTextMs)} cps=${run.charsPerSecond ?? '--'} events=[${events}]`);
      if (run.prompt) {
        lines.push(...indentLines(`${ANSI.dim}prompt:${ANSI.reset}`, '          '));
        lines.push(...indentLines(detailed ? run.prompt : compactOutput(run.prompt, 260), '            '));
      }
      if (detailed) {
        lines.push(...indentLines(`${ANSI.dim}run metadata:${ANSI.reset}`, '          '));
        lines.push(...indentLines(formatJsonBlock({
          id: run.id,
          category: run.category,
          sessionId: run.sessionId,
          stopReason: run.stopReason,
          outputChars: run.outputChars,
          firstEventMs: run.firstEventMs,
          firstTextMs: run.firstTextMs,
          charsPerSecond: run.charsPerSecond,
          eventCounts: run.eventCounts,
        }), '            '));
        if (run.eventSamples.length > 0) {
          lines.push(...indentLines(`${ANSI.dim}event samples:${ANSI.reset}`, '          '));
          lines.push(...indentLines(formatJsonBlock(run.eventSamples), '            '));
        }
      }
      if (run.error) lines.push(...indentLines(`${ANSI.red}${run.error}${ANSI.reset}`, '          '));
      if (run.outputPreview) {
        lines.push(...indentLines(`${ANSI.dim}output:${ANSI.reset}`, '          '));
        lines.push(...indentLines(detailed ? run.outputPreview : compactOutput(run.outputPreview, 520), '            '));
      }
    }
  }

  if (result?.modelEvaluation?.capabilities?.length) {
    lines.push('', `${ANSI.magenta}# capability scores${ANSI.reset}`);
    for (const capability of result.modelEvaluation.capabilities) {
      const color = ansiByStatus(capability.status);
      lines.push(`${color}${String(capability.score).padStart(3)}/100${ANSI.reset} ${capability.label} - ${capability.summary}`);
      for (const evidence of capability.evidence.slice(0, 4)) {
        lines.push(`${ANSI.dim}          - ${evidence}${ANSI.reset}`);
      }
      if (detailed) {
        lines.push(...indentLines(`${ANSI.dim}metrics:${ANSI.reset}`, '          '));
        lines.push(...indentLines(formatJsonBlock(capability.metrics), '            '));
      }
    }
  }

  if (running) {
    lines.push('', `${ANSI.dim}listening for next diagnostic event...${ANSI.reset}`);
  }

  return lines.join('\n');
}

const SUMMARY_TERMINAL_LOG_LIMIT = 220;

type TerminalDisplayTone = 'default' | 'dim' | 'success' | 'warning' | 'error' | 'accent';

interface TerminalDisplayLine {
  key: string;
  text: string;
  tone: TerminalDisplayTone;
}

function terminalToneClass(tone: TerminalDisplayTone): string {
  if (tone === 'success') return 'text-emerald-300';
  if (tone === 'warning') return 'text-amber-300';
  if (tone === 'error') return 'text-rose-300';
  if (tone === 'accent') return 'text-cyan-300';
  if (tone === 'dim') return 'text-zinc-500';
  return 'text-zinc-100';
}

function terminalToneByLogLevel(level: DiagnosticLogEntry['level']): TerminalDisplayTone {
  if (level === 'success') return 'success';
  if (level === 'warning') return 'warning';
  if (level === 'error') return 'error';
  return 'accent';
}

function terminalToneByStatus(status: DiagnosticRunStatus): TerminalDisplayTone {
  if (status === 'passed') return 'success';
  if (status === 'warning' || status === 'skipped') return 'warning';
  return 'error';
}

function buildSummaryTerminalLines(
  logs: DiagnosticLogEntry[],
  result: ModelDiagnosticsResponse | null,
  running: boolean,
): TerminalDisplayLine[] {
  const visibleLogs = logs.filter((item) => !item.verbose);
  const hiddenVerboseCount = logs.length - visibleLogs.length;
  const hiddenOlderCount = Math.max(0, visibleLogs.length - SUMMARY_TERMINAL_LOG_LIMIT);
  const tailLogs = hiddenOlderCount > 0 ? visibleLogs.slice(-SUMMARY_TERMINAL_LOG_LIMIT) : visibleLogs;
  const lines: TerminalDisplayLine[] = [
    { key: 'header-command', text: '$ ace diagnostics --summary', tone: 'accent' },
    {
      key: 'header-state',
      text: `stream=${running ? 'open' : 'closed'} logs=${tailLogs.length}${hiddenVerboseCount > 0 ? ` hidden_verbose=${hiddenVerboseCount}` : ''} result=${result ? 'ready' : 'pending'}${hiddenOlderCount > 0 ? ` older_hidden=${hiddenOlderCount}` : ''}`,
      tone: 'dim',
    },
    { key: 'header-gap', text: '', tone: 'default' },
  ];

  if (hiddenOlderCount > 0) {
    lines.push({
      key: 'older-hidden',
      text: `... 已折叠 ${hiddenOlderCount} 条更早日志；下载日志可查看完整内容`,
      tone: 'dim',
    });
  }

  if (tailLogs.length === 0) {
    lines.push({ key: 'waiting', text: 'waiting for diagnostic logs...', tone: 'dim' });
  } else {
    for (const item of tailLogs) {
      lines.push({
        key: `${item.id}-main`,
        text: `+${formatMs(item.elapsedMs).padStart(7)} ${item.level.toUpperCase().padEnd(7)} ${item.message}`,
        tone: terminalToneByLogLevel(item.level),
      });
      if (item.detail && item.level !== 'info') {
        lines.push({
          key: `${item.id}-detail`,
          text: `          ${compactOutput(item.detail, 180)}`,
          tone: 'dim',
        });
      }
    }
  }

  if (result?.engineDebug?.stages?.length) {
    lines.push(
      { key: 'stages-gap', text: '', tone: 'default' },
      { key: 'stages-header', text: '# stages', tone: 'accent' },
    );
    for (const stage of result.engineDebug.stages) {
      lines.push({
        key: `stage-${stage.id}`,
        text: `${stage.status.padEnd(7)} ${stage.label.padEnd(16)} ${formatMs(stage.durationMs).padStart(8)}  ${stage.detail || ''}`.trimEnd(),
        tone: terminalToneByStatus(stage.status),
      });
    }
  }

  if (result?.modelEvaluation?.capabilities?.length) {
    lines.push(
      { key: 'cap-gap', text: '', tone: 'default' },
      { key: 'cap-header', text: '# capability scores', tone: 'accent' },
    );
    for (const capability of result.modelEvaluation.capabilities) {
      lines.push({
        key: `cap-${capability.id}`,
        text: `${String(capability.score).padStart(3)}/100 ${capability.label} - ${capability.summary}`,
        tone: terminalToneByStatus(capability.status),
      });
    }
  }

  if (running) {
    lines.push(
      { key: 'running-gap', text: '', tone: 'default' },
      { key: 'running-next', text: 'listening for next diagnostic event...', tone: 'dim' },
    );
  }

  return lines;
}

export default function ModelDiagnosticsWorkbench({ managedModels }: { managedModels: ManagedModelReference[] }) {
  const { toast, updateToast, dismissToast } = useToast();
  const [engine, setEngine] = useState('claude-code');
  const [model, setModel] = useState('');
  const [timeoutMs, setTimeoutMs] = useState(String(DEFAULT_TIMEOUT_MS));
  const [includeEngineDebug, setIncludeEngineDebug] = useState(true);
  const [includeModelScore, setIncludeModelScore] = useState(true);
  const [selectedModelCapabilityIds, setSelectedModelCapabilityIds] = useState<string[]>(DEFAULT_MODEL_CAPABILITY_IDS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ModelDiagnosticsResponse | null>(null);
  const [logs, setLogs] = useState<DiagnosticLogEntry[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [detailedLogs, setDetailedLogs] = useState(false);
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null);
  const [logScrollLocked, setLogScrollLocked] = useState(false);
  const [showLogScrollBtn, setShowLogScrollBtn] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [lastInterruptedRun, setLastInterruptedRun] = useState<ActiveDiagnosticRunStorage | null>(null);
  const logScrollRef = useRef<HTMLDivElement | null>(null);
  const logProgrammaticScrollRef = useRef(false);
  const logScrollResetTimerRef = useRef<number | null>(null);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const restoredRunRef = useRef(false);
  const streamToastIdRef = useRef<number | null>(null);
  const diagnosticsRows = useModelDiagnosticsRows();
  const latestDiagnosticsRow = diagnosticsRows[0] || null;

  const selectedModel = useMemo(() => (
    managedModels.find((item) => (getRouteId(item) || item.modelId || item.id) === model) || null
  ), [managedModels, model]);
  const selectedModelLabel = selectedModel ? routeDisplayName(selectedModel) : (model || '默认模型');
  const selectedModelCapabilitySet = useMemo(() => new Set(selectedModelCapabilityIds), [selectedModelCapabilityIds]);
  const selectedModelCapabilityLabel = useMemo(() => {
    if (selectedModelCapabilityIds.length === DEFAULT_MODEL_CAPABILITY_IDS.length) return '全部能力';
    return MODEL_CAPABILITY_OPTIONS
      .filter((item) => selectedModelCapabilitySet.has(item.id))
      .map((item) => item.label)
      .join('、') || '未选择';
  }, [selectedModelCapabilityIds.length, selectedModelCapabilitySet]);

  const toggleModelCapability = (capabilityId: string, checked: boolean) => {
    setSelectedModelCapabilityIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(capabilityId);
      else next.delete(capabilityId);
      return DEFAULT_MODEL_CAPABILITY_IDS.filter((id) => next.has(id));
    });
  };

  const applyRequestBodyToControls = useCallback((requestBody: ModelDiagnosticsRequestBody) => {
    setEngine(requestBody.engine);
    setModel(requestBody.model);
    setTimeoutMs(String(requestBody.timeoutMs || DEFAULT_TIMEOUT_MS));
    setIncludeEngineDebug(requestBody.includeEngineDebug);
    setIncludeModelScore(requestBody.includeModelScore);
    setSelectedModelCapabilityIds(
      requestBody.includeModelScore
        ? DEFAULT_MODEL_CAPABILITY_IDS.filter((id) => requestBody.modelCapabilityIds.includes(id))
        : DEFAULT_MODEL_CAPABILITY_IDS,
    );
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(LOCAL_RESULT_STORAGE_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as {
        result?: ModelDiagnosticsResponse;
        logs?: DiagnosticLogEntry[];
        savedAt?: string;
      };
      if (stored.result) {
        syncModelDiagnosticsResultToDb(stored.result, stored.savedAt || stored.result.finishedAt || new Date().toISOString());
        setResult(stored.result);
        setLogs(stored.logs || stored.result.logs || []);
        setSavedAt(stored.savedAt || stored.result.finishedAt || null);
      }
    } catch {
      localStorage.removeItem(LOCAL_RESULT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (running || result || !latestDiagnosticsRow) return;
    setResult(latestDiagnosticsRow.result);
    setLogs(latestDiagnosticsRow.result.logs || []);
    setSavedAt(latestDiagnosticsRow.savedAt || latestDiagnosticsRow.result.finishedAt || null);
  }, [latestDiagnosticsRow, result, running]);

  useEffect(() => () => {
    if (logScrollResetTimerRef.current !== null) {
      window.clearTimeout(logScrollResetTimerRef.current);
    }
  }, []);

  const saveDiagnosticResult = (nextResult: ModelDiagnosticsResponse) => {
    if (typeof window === 'undefined') return;
    const nextSavedAt = new Date().toISOString();
    try {
      const storedResult = prepareStoredDiagnosticResult(nextResult);
      localStorage.setItem(LOCAL_RESULT_STORAGE_KEY, JSON.stringify({
        result: storedResult,
        logs: storedResult.logs || [],
        savedAt: nextSavedAt,
      }));
      syncModelDiagnosticsResultToDb(storedResult, nextSavedAt);
      setSavedAt(nextSavedAt);
    } catch {
      toast('warning', '诊断结果较大，本地保存失败');
    }
  };

  const clearLogScrollResetTimer = useCallback(() => {
    if (logScrollResetTimerRef.current !== null) {
      window.clearTimeout(logScrollResetTimerRef.current);
      logScrollResetTimerRef.current = null;
    }
  }, []);

  const clearStreamToast = useCallback(() => {
    if (streamToastIdRef.current == null) return;
    dismissToast(streamToastIdRef.current);
    streamToastIdRef.current = null;
  }, [dismissToast]);

  const releaseProgrammaticLogScroll = useCallback(() => {
    clearLogScrollResetTimer();
    logScrollResetTimerRef.current = window.setTimeout(() => {
      logProgrammaticScrollRef.current = false;
      logScrollResetTimerRef.current = null;
    }, 500);
  }, [clearLogScrollResetTimer]);

  const unlockLogScroll = useCallback((behavior: ScrollBehavior = 'smooth') => {
    setLogScrollLocked(false);
    setShowLogScrollBtn(false);
    logProgrammaticScrollRef.current = true;
    const container = logScrollRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior });
    }
    releaseProgrammaticLogScroll();
  }, [releaseProgrammaticLogScroll]);

  const handleLogScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (logProgrammaticScrollRef.current) return;
    const container = event.currentTarget;
    const threshold = 80;
    const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
    setLogScrollLocked(!nearBottom);
    setShowLogScrollBtn(!nearBottom && (running || logs.length > 0));
  }, [logs.length, running]);

  const toggleLogScrollLock = useCallback(() => {
    if (logScrollLocked) {
      unlockLogScroll();
      return;
    }
    setLogScrollLocked(true);
    setShowLogScrollBtn(running || logs.length > 0);
  }, [logScrollLocked, logs.length, running, unlockLogScroll]);

  const consumeDiagnosticStream = useCallback(async (
    requestBody: ModelDiagnosticsRequestBody,
    options: {
      action: 'start' | 'resume';
      runId?: string;
      initialLogs?: DiagnosticLogEntry[];
      toastMessage?: string;
      restored?: boolean;
    },
  ) => {
    streamAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    streamAbortControllerRef.current = abortController;

    setRunning(true);
    setResult(null);
    setActiveRunId(options.runId || null);
    applyRequestBodyToControls(requestBody);
    clearLogScrollResetTimer();
    logProgrammaticScrollRef.current = false;
    setLogScrollLocked(false);
    setShowLogScrollBtn(false);
    if (options.initialLogs) setLogs(options.initialLogs);

    clearStreamToast();
    const toastId = options.toastMessage ? toast('loading', options.toastMessage) : null;
    streamToastIdRef.current = toastId;
    let streamRunId = options.runId || '';
    let finalResult: ModelDiagnosticsResponse | null = null;

    try {
      const response = await authFetch('/api/models/diagnostics/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(options.action === 'resume' ? {} : requestBody),
          action: options.action,
          ...(options.runId ? { runId: options.runId } : {}),
        }),
        signal: abortController.signal,
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error || (options.action === 'resume' ? '诊断任务无法恢复' : '模型诊断与能力打分失败'));
      }
      if (!response.body) {
        throw new Error('当前环境不支持诊断日志流');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line) as DiagnosticStreamPayload;

          if (payload.type === 'run') {
            streamRunId = payload.runId;
            setActiveRunId(payload.runId);
            saveActiveDiagnosticRun({
              runId: payload.runId,
              requestBody: normalizeRequestBody(payload.run?.request) || requestBody,
              startedAt: payload.run?.startedAt || new Date().toISOString(),
            });
            setLastInterruptedRun(null);
          } else if (payload.type === 'log') {
            setLogs((prev) => {
              if (prev.some((item) => item.id === payload.log.id)) return prev;
              return [...prev, payload.log];
            });
          } else if (payload.type === 'progress') {
            syncModelDiagnosticsResultToDb(payload.result);
            setResult(payload.result);
            if (payload.result.logs?.length) setLogs(payload.result.logs);
          } else if (payload.type === 'result') {
            finalResult = payload.result;
            syncModelDiagnosticsResultToDb(payload.result);
            setResult(payload.result);
            if (payload.result.logs?.length) setLogs(payload.result.logs);
            clearActiveDiagnosticRun(payload.runId || streamRunId);
            if (payload.result.error?.includes('停止')) {
              setLastInterruptedRun({ runId: payload.runId || streamRunId, requestBody, startedAt: new Date().toISOString() });
            } else {
              saveDiagnosticResult(payload.result);
              setLastInterruptedRun(null);
            }
          } else if (payload.type === 'error') {
            clearActiveDiagnosticRun(payload.runId || streamRunId);
            setLastInterruptedRun({ runId: payload.runId || streamRunId, requestBody, startedAt: new Date().toISOString() });
            throw new Error(payload.error || '模型诊断与能力打分失败');
          }
        }

        if (done) break;
      }

      if (!finalResult) {
        throw new Error('模型诊断与能力打分没有返回结果');
      }
      if (toastId != null) {
        updateToast(
          toastId,
          finalResult.error?.includes('停止') ? 'warning' : finalResult.ok ? 'success' : 'warning',
          finalResult.error?.includes('停止') ? '诊断任务已停止' : finalResult.ok ? '模型诊断与能力打分完成' : '诊断完成，但存在风险项',
        );
        streamToastIdRef.current = null;
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        clearStreamToast();
        return;
      }
      clearActiveDiagnosticRun(streamRunId || options.runId);
      setLastInterruptedRun({ runId: streamRunId || options.runId || `local-${Date.now()}`, requestBody, startedAt: new Date().toISOString() });
      setLogs((prev) => [
        ...prev,
        {
          id: `client-error-${Date.now()}`,
          at: new Date().toISOString(),
          elapsedMs: prev[prev.length - 1]?.elapsedMs || 0,
          level: error instanceof Error && error.message.includes('停止') ? 'warning' : 'error',
          message: error instanceof Error && error.message.includes('停止') ? '诊断任务已停止' : '诊断请求失败',
          detail: error instanceof Error ? error.message : '模型诊断与能力打分失败',
        },
      ]);
      if (toastId != null) {
        updateToast(
          toastId,
          error instanceof Error && error.message.includes('停止') ? 'warning' : 'error',
          error instanceof Error ? error.message : '模型诊断与能力打分失败',
        );
        streamToastIdRef.current = null;
      } else if (options.restored) {
        toast('warning', error instanceof Error ? error.message : '诊断任务无法恢复');
      }
    } finally {
      if (streamAbortControllerRef.current === abortController) {
        streamAbortControllerRef.current = null;
      }
      setRunning(false);
      setActiveRunId(null);
    }
  }, [applyRequestBodyToControls, clearLogScrollResetTimer, clearStreamToast, saveDiagnosticResult, toast, updateToast]);

  useEffect(() => {
    if (restoredRunRef.current) return;
    restoredRunRef.current = true;
    const active = readActiveDiagnosticRun();
    if (!active) return;
    void consumeDiagnosticStream(active.requestBody, {
      action: 'resume',
      runId: active.runId,
      restored: true,
      initialLogs: [
        createClientLog(
          '已恢复诊断任务',
          `模型=${active.requestBody.model || '默认模型'}`,
        ),
      ],
    });
  }, [consumeDiagnosticStream]);

  useEffect(() => () => {
    clearStreamToast();
    streamAbortControllerRef.current?.abort();
  }, [clearStreamToast]);

  const runDiagnostics = async () => {
    if (includeModelScore && !model) {
      toast('warning', '请选择要评测的模型');
      return;
    }
    if (includeModelScore && selectedModelCapabilityIds.length === 0) {
      toast('warning', '请至少选择一个模型能力 probe');
      return;
    }

    const requestBody = {
      engine,
      driver: 'auto' as DiagnosticDriver,
      model,
      timeoutMs: Number.parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
      includeEngineDebug,
      includeModelScore,
      modelCapabilityIds: includeModelScore ? selectedModelCapabilityIds : [],
    };

    setResult(null);
    await consumeDiagnosticStream(requestBody, {
      action: 'start',
      toastMessage: '正在运行模型诊断与能力打分...',
      initialLogs: [
        createClientLog(
          '已提交诊断任务',
          `模型=${selectedModelLabel}, capabilities=${includeModelScore ? selectedModelCapabilityLabel : '跳过模型评分'}`,
        ),
      ],
    });
  };

  const stopDiagnostics = useCallback(async () => {
    const runId = activeRunId || readActiveDiagnosticRun()?.runId;
    if (!runId) {
      streamAbortControllerRef.current?.abort();
      clearStreamToast();
      setRunning(false);
      return;
    }
    try {
      await authFetch('/api/models/diagnostics/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', runId }),
      });
      const active = readActiveDiagnosticRun();
      clearActiveDiagnosticRun(runId);
      setLastInterruptedRun(active || {
        runId,
        requestBody: {
          engine,
          driver: 'auto',
          model,
          timeoutMs: Number.parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
          includeEngineDebug,
          includeModelScore,
          modelCapabilityIds: includeModelScore ? selectedModelCapabilityIds : [],
        },
        startedAt: new Date().toISOString(),
      });
      streamAbortControllerRef.current?.abort();
      setLogs((prev) => [
        ...prev,
        {
          id: `client-stop-${Date.now()}`,
          at: new Date().toISOString(),
          elapsedMs: prev[prev.length - 1]?.elapsedMs || 0,
          level: 'warning',
          message: '已请求停止诊断任务',
          detail: '诊断任务正在停止',
        },
      ]);
      clearStreamToast();
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '停止诊断失败');
    } finally {
      setRunning(false);
      setActiveRunId(null);
    }
  }, [activeRunId, clearStreamToast, engine, includeEngineDebug, includeModelScore, model, selectedModelCapabilityIds, timeoutMs, toast]);

  const failedCapabilityIds = useMemo(() => failedCapabilityIdsFromResult(result), [result]);

  const retryFailedDiagnostics = useCallback(async () => {
    if (!result) return;
    const retryCapabilityIds = failedCapabilityIds.length > 0 ? failedCapabilityIds : selectedModelCapabilityIds;
    const shouldRetryEngineDebug = !result.engineDebug?.available
      || (result.engineDebug?.stages || []).some((stage) => stage.status === 'failed' || stage.status === 'warning');
    const requestBody: ModelDiagnosticsRequestBody = {
      engine: result.engine || engine,
      driver: 'auto',
      model: result.model || model,
      timeoutMs: Number.parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
      includeEngineDebug: shouldRetryEngineDebug,
      includeModelScore: retryCapabilityIds.length > 0,
      modelCapabilityIds: retryCapabilityIds,
    };
    await consumeDiagnosticStream(requestBody, {
      action: 'start',
      toastMessage: '正在重试失败环节...',
      initialLogs: [
        createClientLog(
          '已提交失败环节重试',
          [
            shouldRetryEngineDebug ? 'engine-debug=retry' : 'engine-debug=skip',
            retryCapabilityIds.length > 0 ? `capabilities=${retryCapabilityIds.join(',')}` : 'capabilities=skip',
          ].join(', '),
        ),
      ],
    });
  }, [consumeDiagnosticStream, engine, failedCapabilityIds, model, result, selectedModelCapabilityIds, timeoutMs]);

  const retrySingleCapability = useCallback(async (capabilityId: string) => {
    if (!result || capabilityId === 'output_speed') return;
    const capabilityMeta = MODEL_CAPABILITY_OPTIONS.find((item) => item.id === capabilityId);
    setSelectedCapabilityId(capabilityId);
    await consumeDiagnosticStream({
      engine: result.engine || engine,
      driver: 'auto',
      model: result.model || model,
      timeoutMs: Number.parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
      includeEngineDebug: false,
      includeModelScore: true,
      modelCapabilityIds: [capabilityId],
    }, {
      action: 'start',
      toastMessage: `正在重试 ${capabilityMeta?.label || capabilityId}...`,
      initialLogs: [
        createClientLog(
          '已提交单项重试',
          `capability=${capabilityId}`,
        ),
      ],
    });
  }, [consumeDiagnosticStream, engine, model, result, timeoutMs]);

  const continueInterruptedDiagnostics = useCallback(async () => {
    const interrupted = lastInterruptedRun;
    if (!interrupted) return;
    const requestBody = remainingRequestBodyFromLogs(interrupted.requestBody, logs);
    if (!requestBody) {
      toast('warning', '没有可继续的未完成环节');
      setLastInterruptedRun(null);
      return;
    }
    await consumeDiagnosticStream(requestBody, {
      action: 'start',
      toastMessage: '正在继续未完成诊断...',
      initialLogs: [
        ...logs,
        createClientLog(
          '已继续未完成诊断',
          [
            requestBody.includeEngineDebug ? 'engine-debug=continue' : 'engine-debug=skip',
            requestBody.includeModelScore ? `capabilities=${requestBody.modelCapabilityIds.join(',')}` : 'capabilities=skip',
          ].join(', '),
        ),
      ],
    });
  }, [consumeDiagnosticStream, lastInterruptedRun, logs, toast]);

  const allRuns = useMemo(() => {
    const runs: DiagnosticPromptRun[] = [];
    if (result?.engineDebug?.runs) runs.push(...result.engineDebug.runs);
    if (result?.modelEvaluation?.runs) runs.push(...result.modelEvaluation.runs);
    return runs;
  }, [result]);
  const drawingRun = useMemo(
    () => result?.modelEvaluation?.runs.find((run) => run.id === 'cap-drawing-pelican') || null,
    [result],
  );
  const drawingSvg = useMemo(() => extractSvg(drawingRun?.outputPreview), [drawingRun]);
  const drawingSvgDataUri = useMemo(() => drawingSvg ? svgToDataUri(drawingSvg) : null, [drawingSvg]);
  const selectedCapability = useMemo(() => {
    const capabilities = result?.modelEvaluation?.capabilities || [];
    if (capabilities.length === 0) return null;
    return capabilities.find((item) => item.id === selectedCapabilityId) || capabilities[0];
  }, [result, selectedCapabilityId]);
  const selectedCapabilityRuns = useMemo(
    () => selectedCapability ? capabilityRuns(selectedCapability.id, result?.modelEvaluation?.runs || []) : [],
    [result, selectedCapability],
  );
  const selectedCapabilitySummary = useMemo(
    () => selectedCapability ? capabilityResultSummary(selectedCapability, selectedCapabilityRuns) : undefined,
    [selectedCapability, selectedCapabilityRuns],
  );

  useEffect(() => {
    const capabilities = result?.modelEvaluation?.capabilities || [];
    if (capabilities.length > 0 && !capabilities.some((item) => item.id === selectedCapabilityId)) {
      setSelectedCapabilityId(capabilities[0].id);
    }
  }, [result, selectedCapabilityId]);

  const totalEvents = useMemo(
    () => allRuns.reduce((sum, run) => sum + Object.values(run.eventCounts).reduce((inner, value) => inner + value, 0), 0),
    [allRuns],
  );
  const terminalLineItems = useMemo(
    () => {
      if (detailedLogs) {
        return buildDiagnosticTerminalOutput(logs, result, running, true)
          .split('\n')
          .map((line, index) => ({
            key: `diagnostic-line-detailed-${index}`,
            node: (
              <pre className="m-0 whitespace-pre-wrap break-words text-zinc-100">
                <Ansi>{line || ' '}</Ansi>
              </pre>
            ),
          }));
      }
      return buildSummaryTerminalLines(logs, result, running).map((line) => ({
        key: line.key,
        node: (
          <pre className={cn('m-0 whitespace-pre-wrap break-words', terminalToneClass(line.tone))}>
            {line.text || ' '}
          </pre>
        ),
      }));
    },
    [detailedLogs, logs, result, running],
  );

  useEffect(() => {
    if (logScrollLocked) return;
    const container = logScrollRef.current;
    if (!container) return;
    logProgrammaticScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    releaseProgrammaticLogScroll();
  }, [detailedLogs, logScrollLocked, releaseProgrammaticLogScroll, terminalLineItems.length]);

  const downloadDiagnosticLogs = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = [
        'diagnostic-log',
        sanitizeLogFilenamePart(engine),
        sanitizeLogFilenamePart(model || 'default-model'),
        detailedLogs ? 'full' : 'summary',
        stamp,
      ].join('.') + '.log';
      const terminalOutput = buildDiagnosticTerminalOutput(logs, result, running, detailedLogs);
      const blob = new Blob([terminalOutput], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
      toast('success', '诊断日志已开始下载');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '下载诊断日志失败');
    }
  }, [detailedLogs, engine, logs, model, result, running, toast]);

  const copyDiagnosticLogs = useCallback(async () => {
    if (typeof window === 'undefined' || !navigator?.clipboard?.writeText) {
      toast('error', '当前环境不支持剪贴板复制');
      return;
    }
    try {
      await navigator.clipboard.writeText(buildDiagnosticTerminalOutput(logs, result, running, detailedLogs));
      toast('success', '诊断日志已复制');
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '复制诊断日志失败');
    }
  }, [detailedLogs, logs, result, running, toast]);

  const overallScore = result?.modelEvaluation?.overallScore ?? null;
  const ringScore = overallScore ?? 0;

  return (
    <div className="min-h-0 overflow-y-auto px-6 py-6">
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-6">
        <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
            <div className="border-b border-border/70 p-6 lg:border-b-0 lg:border-r">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300">
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                  模型诊断与能力打分
                </Badge>
                <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Probe to Evidence
                </Badge>
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">模型诊断与能力打分</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                一次运行可覆盖环境可用性、单轮/多轮对话、流式事件，以及按需选择的 JSON、代码、骑车鹈鹕、数学、推理、结构化输出和一致性检查。
                所有结论都保留原始输出预览与事件统计，方便复盘。
              </p>

              <div className="mt-6 grid gap-3">
                <label className="space-y-2">
                  <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                    <span>引擎与模型</span>
                  </span>
                  <EngineModelSelect
                    engine={engine}
                    model={model}
                    onEngineChange={setEngine}
                    onModelChange={setModel}
                    className="h-10"
                  />
                </label>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">基础单项超时</span>
                  <Input
                    value={timeoutMs}
                    onChange={(event) => setTimeoutMs(event.target.value)}
                    inputMode="numeric"
                    className="h-10"
                  />
                  <span className="block text-[11px] text-muted-foreground">数学/推理/结构化会自动放大超时</span>
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">运行调试</div>
                      <div className="text-xs text-muted-foreground">可用性、耗时、流式事件、多轮</div>
                    </div>
                    <Switch checked={includeEngineDebug} onCheckedChange={setIncludeEngineDebug} />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-4 py-3">
                    <div>
                      <div className="text-sm font-medium">模型能力打分</div>
                      <div className="text-xs text-muted-foreground">速度、JSON、代码、骑车鹈鹕、数学、推理、结构化、一致性</div>
                    </div>
                    <Switch checked={includeModelScore} onCheckedChange={setIncludeModelScore} />
                  </div>
                </div>
              </div>

              {includeModelScore ? (
                <div className="mt-4 rounded-lg border border-border/70 bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">能力范围</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        已选 {selectedModelCapabilityIds.length}/{DEFAULT_MODEL_CAPABILITY_IDS.length} 项，输出速度会基于已选 probe 自动计算
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedModelCapabilityIds(DEFAULT_MODEL_CAPABILITY_IDS)}
                        disabled={running || selectedModelCapabilityIds.length === DEFAULT_MODEL_CAPABILITY_IDS.length}
                      >
                        全选
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedModelCapabilityIds(['math'])}
                        disabled={running}
                      >
                        仅数学
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {MODEL_CAPABILITY_OPTIONS.map((item) => {
                      const Icon = CAPABILITY_ICONS[item.id] || Gauge;
                      const checked = selectedModelCapabilitySet.has(item.id);
                      return (
                        <label
                          key={item.id}
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-md border border-border/60 px-3 py-3 transition-colors hover:bg-muted/50',
                            checked && 'border-primary/30 bg-primary/5'
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(value) => toggleModelCapability(item.id, Boolean(value))}
                            disabled={running}
                            className="mt-0.5"
                          />
                          <div className="flex min-w-0 gap-2">
                            <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium">{item.label}</div>
                              <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{item.description}</div>
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button onClick={runDiagnostics} disabled={running} className="min-w-[144px]">
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
                  {running ? '运行中' : '开始评测'}
                </Button>
                {running ? (
                  <Button variant="destructive" onClick={stopDiagnostics} className="min-w-[112px]">
                    <XCircle className="mr-2 h-4 w-4" />
                    停止诊断
                  </Button>
                ) : null}
                {!running && result && (!result.ok || failedCapabilityIds.length > 0) ? (
                  <Button variant="outline" onClick={retryFailedDiagnostics} className="min-w-[132px]">
                    <RotateCcw className="mr-2 h-4 w-4" />
                    重试失败环节
                  </Button>
                ) : null}
                {!running && lastInterruptedRun ? (
                  <Button variant="outline" onClick={continueInterruptedDiagnostics} className="min-w-[132px]">
                    <Play className="mr-2 h-4 w-4" />
                    继续未完成
                  </Button>
                ) : null}
                <Button
                  variant="destructive"
                  onClick={() => {
                    streamAbortControllerRef.current?.abort();
                    setResult(null);
                    setLogs([]);
                    setSavedAt(null);
                    setActiveRunId(null);
                    clearLogScrollResetTimer();
                    logProgrammaticScrollRef.current = false;
                    setLogScrollLocked(false);
                    setShowLogScrollBtn(false);
                    if (typeof window !== 'undefined') {
                      localStorage.removeItem(LOCAL_RESULT_STORAGE_KEY);
                      localStorage.removeItem(LOCAL_ACTIVE_RUN_STORAGE_KEY);
                    }
                  }}
                  disabled={running || (!result && logs.length === 0)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  清空结果
                </Button>
                {model ? (
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    <Badge variant="secondary" className="rounded-md">
                      {selectedModelLabel}
                    </Badge>
                  </div>
                ) : null}
                <Badge variant="outline" className="rounded-md text-xs">
                  {localSavedLabel(savedAt)}
                </Badge>
              </div>
            </div>

            <div className={cn('p-6 bg-gradient-to-br', scoreBackground(ringScore))}>
              <div className="flex h-full flex-col justify-between gap-6">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">Quality Score</div>
                  <div className="mt-5 flex items-center gap-5">
                    <div
                      className="grid h-36 w-36 shrink-0 place-items-center rounded-full"
                      style={{
                        background: `conic-gradient(hsl(var(--primary)) ${ringScore * 3.6}deg, hsl(var(--muted)) 0deg)`,
                      }}
                    >
                      <div className="grid h-28 w-28 place-items-center rounded-full bg-background shadow-sm">
                        <div className="text-center">
                          <div className={cn('text-4xl font-semibold', overallScore == null ? 'text-muted-foreground' : scoreTone(ringScore))}>{formatScore(overallScore)}</div>
                          <div className="text-xs text-muted-foreground">/100</div>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="text-2xl font-semibold">
                        {result?.modelEvaluation?.tierLabel ? `${result.modelEvaluation.tierLabel} 级` : '等待运行'}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {result
                          ? `${selectedModelLabel || result.model || '默认模型'}`
                          : '选择模型后，运行一次诊断即可生成分数、耗时和证据链。'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock3 className="h-3.5 w-3.5" />
                      总耗时
                    </div>
                    <div className="mt-2 text-xl font-semibold">{formatMs(result?.totalDurationMs)}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Activity className="h-3.5 w-3.5" />
                      流事件
                    </div>
                    <div className="mt-2 text-xl font-semibold">{totalEvents || '--'}</div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-background/80 p-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <BarChart3 className="h-3.5 w-3.5" />
                      能力项
                    </div>
                    <div className="mt-2 text-xl font-semibold">{result?.modelEvaluation?.capabilities.length || '--'}</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 lg:grid-cols-5">
          {PIPELINE.map((item, index) => {
            const Icon = item.icon;
            return (
              <article key={item.id} className="rounded-lg border border-border/70 bg-card p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-semibold text-muted-foreground">{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className="mt-4 text-sm font-semibold">{item.label}</div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.detail}</p>
              </article>
            );
          })}
        </section>

        {(running || logs.length > 0) ? (
          <section className="rounded-lg border border-border/70 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">运行日志</h3>
                <p className="mt-1 text-sm text-muted-foreground">诊断日志会逐步刷新；详细模式会显示每个 stream event、fullDetail、prompt、event samples、metrics 和完整输出预览。</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
                  <span className="text-xs font-medium text-muted-foreground">详细模式</span>
                  <Switch checked={detailedLogs} onCheckedChange={setDetailedLogs} />
                </div>
                <Badge variant={running ? 'outline' : 'secondary'} className="rounded-md">
                  {running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  {running ? '运行中' : `${logs.length} 条`}
                </Badge>
                <Button
                  variant={logScrollLocked ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={toggleLogScrollLock}
                  className="gap-2"
                  title={logScrollLocked ? '解除滚动锁并跳到底部' : '锁定当前滚动位置'}
                >
                  {logScrollLocked ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
                  {logScrollLocked ? '滚动已锁定' : '跟随滚动'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadDiagnosticLogs}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  下载日志
                </Button>
              </div>
            </div>

            <div className="mt-4">
              <Terminal
                output=""
                isStreaming={running}
                autoScroll={false}
                className="border-border/70 shadow-sm"
              >
                <TerminalHeader className="border-zinc-800/80 bg-zinc-950/95">
                  <TerminalTitle>诊断日志</TerminalTitle>
                  <div className="flex items-center gap-2">
                    <TerminalStatus>streaming</TerminalStatus>
                    <TerminalActions>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="复制日志"
                        title="复制日志"
                        onClick={() => { void copyDiagnosticLogs(); }}
                        className="size-7 shrink-0 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </TerminalActions>
                  </div>
                </TerminalHeader>
                <div className="relative">
                  <TerminalContent
                    ref={logScrollRef}
                    onScroll={handleLogScroll}
                    className="max-h-[560px] text-[12px] leading-5"
                  >
                    <div data-testid="diagnostic-log-virtual-list">
                      <VirtualMessageList
                        items={terminalLineItems}
                        estimatedItemHeight={20}
                        itemGap={0}
                        scrollContainerRef={logScrollRef}
                      />
                    </div>
                  </TerminalContent>
                  {showLogScrollBtn ? (
                    <button
                      type="button"
                      onClick={() => unlockLogScroll()}
                      title="解除滚动锁并跳到最新日志"
                      className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full border border-primary/20 bg-background/92 px-3 py-1.5 text-xs text-foreground shadow-sm backdrop-blur-md transition-colors duration-150 hover:bg-background"
                    >
                      <ArrowDown className="h-3.5 w-3.5 text-primary" />
                      解除锁定
                    </button>
                  ) : null}
                </div>
              </Terminal>
            </div>
          </section>
        ) : null}

        {!result ? (
          <section className="flex min-h-[320px] flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-card/70 px-6 text-center">
            {running ? <Loader2 className="mb-4 h-12 w-12 animate-spin text-muted-foreground/50" /> : <Sparkles className="mb-4 h-12 w-12 text-muted-foreground/50" />}
            <h3 className="text-lg font-semibold">{running ? '诊断正在运行' : '还没有诊断结果'}</h3>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              {running
                ? '上方日志会持续刷新，已完成的阶段和能力项会实时出现在这里。'
                : '运行后这里会展示耗时、流式事件、模型能力评分和每个评分的证据链。'}
            </p>
          </section>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section className="rounded-lg border border-border/70 bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">运行调试</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {result.engineDebug?.effectiveEngine || result.engine} · {result.engineDebug?.streamSupported ? '支持流式输出' : '未确认流式输出'}
                  </p>
                </div>
                <Badge className={cn('border', result.ok ? statusClass('passed') : statusClass('warning'))}>
                  {result.ok ? <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}
                  {result.ok ? '整体通过' : '存在风险'}
                </Badge>
              </div>

              <div className="mt-5 space-y-3">
                {(result.engineDebug?.stages || []).map((stage) => (
                  <div key={stage.id} className="rounded-lg border border-border/60 bg-background p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                          <Clock3 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{stage.label}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{stage.detail || '--'}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold tabular-nums">{formatMs(stage.durationMs)}</span>
                        <Badge variant="outline" className={cn('border', statusClass(stage.status))}>
                          {statusLabel(stage.status)}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 rounded-lg border border-border/60 bg-background p-4">
                <div className="text-sm font-medium">事件格式覆盖</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(result.engineDebug?.observedEventTypes || []).length > 0
                    ? result.engineDebug?.observedEventTypes.map((type) => (
                      <Badge key={type} variant="secondary" className="rounded-md">
                        {type}
                      </Badge>
                    ))
                    : <span className="text-sm text-muted-foreground">没有观察到事件</span>}
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border/70 bg-card p-5 xl:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">模型能力评分</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    左侧切换能力项，右侧用 Test Results 展示题目、证据、耗时、事件和完整输出。
                  </p>
                </div>
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                  {result.modelEvaluation ? `${result.modelEvaluation.overallScore}/100` : '未运行'}
                </Badge>
              </div>

              <div className="mt-5 grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
                <aside className="overflow-hidden rounded-lg border border-border/70 bg-background">
                  <div className="border-b border-border/60 px-4 py-3">
                    <div className="text-sm font-semibold">能力探针</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {result.modelEvaluation?.capabilities.length || 0} 项能力 · {result.modelEvaluation?.runs.length || 0} 个 probe
                    </div>
                  </div>
                  <div className="divide-y divide-border/60">
                    {(result.modelEvaluation?.capabilities || []).map((capability) => {
                      const Icon = CAPABILITY_ICONS[capability.id] || Gauge;
                      const selected = selectedCapability?.id === capability.id;
                      return (
                        <button
                          key={capability.id}
                          type="button"
                          onClick={() => setSelectedCapabilityId(capability.id)}
                          className={cn(
                            'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60',
                            selected && 'bg-primary/10'
                          )}
                        >
                          <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground', selected && 'bg-primary text-primary-foreground')}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-sm font-medium">{capability.label}</span>
                              <span className={cn('text-sm font-semibold tabular-nums', scoreTone(capability.score))}>
                                {capability.score}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {capabilitySummary(capability)}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  {drawingSvgDataUri ? (
                    <button
                      type="button"
                      onClick={() => setSelectedCapabilityId('drawing_pelican')}
                      className="m-3 flex w-[calc(100%-1.5rem)] items-center gap-3 rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <div className="flex h-16 w-20 shrink-0 items-center justify-center rounded-md bg-background">
                        <img
                          src={drawingSvgDataUri}
                          alt="骑自行车的鹈鹕 SVG 缩略图"
                          className="h-full w-full object-contain"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold">骑车鹈鹕 SVG</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">点击查看渲染与原始输出</div>
                      </div>
                    </button>
                  ) : null}
                </aside>

                <div className="min-w-0">
                  {selectedCapability && selectedCapabilitySummary ? (
                    <TestResults summary={selectedCapabilitySummary} className="overflow-hidden">
                      <TestResultsHeader>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h4 className="text-base font-semibold">{selectedCapability.label}</h4>
                            <Badge variant="outline" className={cn('border rounded-md', statusClass(selectedCapability.status))}>
                              {statusLabel(selectedCapability.status)}
                            </Badge>
                            {!running && selectedCapability.id !== 'output_speed' && (selectedCapability.status === 'failed' || selectedCapability.status === 'warning' || selectedCapability.score < 80) ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => void retrySingleCapability(selectedCapability.id)}
                              >
                                <RotateCcw className="mr-2 h-3.5 w-3.5" />
                                重试此项
                              </Button>
                            ) : null}
                          </div>
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                            {selectedCapability.summary}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-4">
                          <TestResultsSummary />
                          <div className={cn('text-3xl font-semibold tabular-nums', scoreTone(selectedCapability.score))}>
                            {selectedCapability.score}
                          </div>
                        </div>
                      </TestResultsHeader>

                      <div className="space-y-3 border-b border-border/60 px-4 py-3">
                        <Progress value={selectedCapability.score} />
                        <TestResultsProgress />
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <TestResultsDuration />
                          {Object.entries(selectedCapability.metrics).slice(0, 8).map(([key, value]) => (
                            <Badge key={key} variant="secondary" className="rounded-md font-normal">
                              {key}: {formatMetricValue(value)}
                            </Badge>
                          ))}
                        </div>
                      </div>

                      <TestResultsContent>
                        {selectedCapability.id === 'output_speed' ? (
                          <TestSuite name="输出速度证据" status={testStatus(selectedCapability.status)} defaultOpen>
                            <TestSuiteName />
                            <TestSuiteContent>
                              {selectedCapability.evidence.map((item) => (
                                <Test key={item} name={item} status={testStatus(selectedCapability.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                </Test>
                              ))}
                            </TestSuiteContent>
                          </TestSuite>
                        ) : (
                          <TestSuite name="评分证据链" status={testStatus(selectedCapability.status)} defaultOpen={false}>
                            <TestSuiteName />
                            <TestSuiteContent>
                              {selectedCapability.evidence.map((item) => (
                                <Test key={item} name={item} status={testStatus(selectedCapability.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                </Test>
                              ))}
                            </TestSuiteContent>
                          </TestSuite>
                        )}

                        {selectedCapability.id === 'drawing_pelican' ? (
                          <TestSuite name="骑车鹈鹕 SVG 渲染" status={drawingSvgDataUri ? 'passed' : 'warning'} defaultOpen>
                            <TestSuiteName />
                            <TestSuiteContent>
                              <Test name="SVG 预览" status={drawingSvgDataUri ? 'passed' : 'warning'}>
                                <div className="w-full px-4 py-2">
                                  <div className="flex min-h-[280px] items-center justify-center rounded-lg border border-border/60 bg-card p-4">
                                    {drawingSvgDataUri ? (
                                      <img
                                        src={drawingSvgDataUri}
                                        alt="骑自行车的鹈鹕 SVG 预览"
                                        className="h-auto max-h-[380px] w-full max-w-[620px] object-contain"
                                      />
                                    ) : (
                                      <div className="text-center text-sm text-muted-foreground">
                                        本次输出里没有提取到可渲染 SVG，可在详细模式查看原始输出。
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </Test>
                            </TestSuiteContent>
                          </TestSuite>
                        ) : null}

                        {selectedCapabilityRuns.length > 0 ? selectedCapabilityRuns.map((run) => {
                          const meta = RUN_EVIDENCE_META[run.id];
                          const counts = scoreStatusCount(run.status);
                          return (
                            <TestSuite
                              key={`${selectedCapability.id}-${run.id}`}
                              name={meta?.title || run.label}
                              status={testStatus(run.status)}
                              defaultOpen={selectedCapabilityRuns.length === 1}
                            >
                              <TestSuiteName>
                                <span className="min-w-0 flex-1 truncate font-medium text-sm">{meta?.title || run.label}</span>
                                <TestSuiteStats {...counts} />
                              </TestSuiteName>
                              <TestSuiteContent>
                                <Test name="Probe 目标" status={testStatus(run.status)} duration={run.durationMs}>
                                  <TestStatusIndicator />
                                  <TestName />
                                  <TestDuration />
                                  <div className="mt-2 w-full text-xs leading-5 text-muted-foreground">
                                    {meta?.goal || '该 run 用于支撑当前能力分。'}
                                  </div>
                                </Test>
                                <Test name="判定点" status={testStatus(run.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                  <div className="mt-2 flex w-full flex-wrap gap-1.5">
                                    {(meta?.checks || ['返回状态', '耗时', '事件格式']).map((item) => (
                                      <Badge key={item} variant="outline" className="rounded-md text-[11px] font-normal">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                </Test>
                                <Test name="题目" status={testStatus(run.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                  <DiagnosticRichBlock content={formatPromptText(run.prompt)} className="max-h-56" />
                                </Test>
                                <Test name="模型输出" status={testStatus(run.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                  {run.error ? (
                                    <TestError className="w-full">
                                      <TestErrorMessage>{run.error}</TestErrorMessage>
                                    </TestError>
                                  ) : (
                                    <DiagnosticRichBlock
                                      content={detailedLogs ? (run.outputPreview || '无输出') : (run.outputPreview || '无输出')}
                                      className="max-h-72"
                                    />
                                  )}
                                </Test>
                                <Test name="事件与耗时" status={testStatus(run.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                  <div className="mt-2 flex w-full flex-wrap gap-1.5">
                                    <Badge variant="secondary" className="rounded-md text-[11px]">首事件 {formatMs(run.firstEventMs)}</Badge>
                                    <Badge variant="secondary" className="rounded-md text-[11px]">首文本 {formatMs(run.firstTextMs)}</Badge>
                                    <Badge variant="secondary" className="rounded-md text-[11px]">输出 {run.outputChars} 字符</Badge>
                                    <Badge variant="secondary" className="rounded-md text-[11px]">{run.charsPerSecond == null ? '-- cps' : `${run.charsPerSecond.toFixed(1)} cps`}</Badge>
                                    <Badge variant="secondary" className="rounded-md text-[11px]">{formatEventCounts(run)}</Badge>
                                  </div>
                                </Test>
                              </TestSuiteContent>
                            </TestSuite>
                          );
                        }) : selectedCapability.id !== 'output_speed' ? (
                          <TestSuite name="关联 probe" status="skipped" defaultOpen>
                            <TestSuiteName />
                            <TestSuiteContent>
                              <Test name="当前能力没有关联的 probe run" status="skipped" />
                            </TestSuiteContent>
                          </TestSuite>
                        ) : null}
                      </TestResultsContent>
                    </TestResults>
                  ) : (
                    <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-border/70 bg-background text-sm text-muted-foreground">
                      模型能力评分未运行
                    </div>
                  )}
                </div>
              </div>
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
