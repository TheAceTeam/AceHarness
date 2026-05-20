'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  Bird,
  Boxes,
  Braces,
  Calculator,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Code2,
  FileJson2,
  Gauge,
  GitBranch,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  Sigma,
  Sparkles,
  TimerReset,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from '@/components/ai-elements/terminal';
import {
  Test,
  TestDuration,
  TestError,
  TestErrorMessage,
  TestErrorStack,
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
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { SingleCombobox } from '@/components/ui/combobox';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/core/utils';
import { getEngineDisplayName } from '@/lib/core/engine-metadata';
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
  endpoints: string[];
  engines: string[];
}

const ENGINE_OPTIONS = [
  'claude-code',
  'codex',
  'opencode',
  'kiro-cli',
  'nga',
  'codegenie',
  'cursor',
  'trae-cli',
  'magic-cli',
];

const DRIVER_CAPABLE_ENGINES = new Set(['claude-code', 'opencode', 'nga', 'codegenie']);

const DRIVER_OPTIONS: Array<{ value: DiagnosticDriver; label: string; description: string }> = [
  { value: 'auto', label: '自动选择', description: '使用当前引擎配置中的默认 driver' },
  { value: 'sdk', label: 'SDK / HTTP', description: '适用于支持 SDK driver 的引擎' },
  { value: 'stdio', label: 'STDIO / ACP', description: '适用于 ACP stdio driver' },
];

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
const DEFAULT_TIMEOUT_MS = 180_000;
const MODEL_CAPABILITY_OPTIONS = [
  { id: 'json_output', label: 'JSON', description: '嵌套 JSON / 类型 / checksum' },
  { id: 'code_generation', label: '代码', description: 'TypeScript 生成与聚合逻辑' },
  { id: 'drawing_pelican', label: '鹈鹕', description: 'SVG 可渲染绘图' },
  { id: 'math', label: '数学', description: '线代、积分、贝叶斯、优化' },
  { id: 'reasoning', label: '推理', description: '约束、真假话、逻辑网格' },
  { id: 'structured_output', label: '结构化', description: '复杂 schema 与交叉引用' },
  { id: 'consistency', label: '一致性', description: '重复 probe 稳定性' },
];
const DEFAULT_MODEL_CAPABILITY_IDS = MODEL_CAPABILITY_OPTIONS.map((item) => item.id);

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
    goal: '要求生成较完整的 TypeScript 工单统计函数，检测类型、去重、逾期、高优先级、均值和 owner 聚合。',
    checks: ['函数名 summarizeTickets', 'Ticket/TicketSummary 类型', '去重与排序', '逾期与均值统计'],
  },
  'cap-drawing-pelican': {
    title: '骑车鹈鹕绘图',
    goal: '要求输出一张可直接渲染的 SVG，画面主体是骑自行车的鹈鹕。',
    checks: ['SVG 根节点和闭合', '长喙、喉囊、身体、翅膀', '自行车、车轮、踏板'],
  },
  'cap-math': {
    title: '数学能力',
    goal: '要求模型用 JSON 给出行列式、线性方程组、积分、特征值、贝叶斯、递推、约束优化、多项式系数和马尔可夫链的精确答案。',
    checks: ['JSON 可解析', '12 个高阶数学字段精确命中', '包含至少 8 条计算步骤'],
  },
  'cap-reasoning': {
    title: '推理能力',
    goal: '用多道确定性推理题检测约束排序、真假话、逻辑网格和命题约束满足。',
    checks: ['ordering=E-D-B-A-C', 'culprit=C', 'Ada=Rust/M', 'P=true,Q=true,R=false'],
  },
  'cap-structured': {
    title: '结构化输出',
    goal: '要求模型按复杂 schema 输出 release_readiness 风险、行动项、交叉引用矩阵、rollout 和 summary。',
    checks: ['title/version 字段', '4 risks / 4 actions / 3 matrix', 'cross-reference 正确', 'summary.ready=false'],
  },
  'cap-consistency': {
    title: '一致性首轮',
    goal: '第一次询问确定性序列题，作为一致性对照样本。',
    checks: ['输出 NEXT=127', '格式稳定', '用于与复测结果比较'],
  },
  'cap-consistency-repeat': {
    title: '一致性复测',
    goal: '第二次询问同一确定性序列题，检测重复回答是否漂移。',
    checks: ['输出 NEXT=127', '与首轮归一化后一致', '重复结果稳定'],
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

function supportsDriverSelection(engine: string): boolean {
  return DRIVER_CAPABLE_ENGINES.has(engine);
}

function modelSupportsEngine(model: ManagedModelReference, engine: string): boolean {
  return model.engines.length === 0 || model.engines.includes(engine);
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

function localSavedLabel(value: string | null): string {
  if (!value) return '未保存';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '已保存';
  return `已保存 ${new Date(timestamp).toLocaleString()}`;
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
  if (value == null) return '--';
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

export default function ModelDiagnosticsWorkbench({ managedModels }: { managedModels: ManagedModelReference[] }) {
  const { toast, updateToast } = useToast();
  const [engine, setEngine] = useState('claude-code');
  const [driver, setDriver] = useState<DiagnosticDriver>('auto');
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

  const engineOptions = useMemo(() => ENGINE_OPTIONS.map((id) => ({
    value: id,
    label: getEngineDisplayName(id) || id,
  })), []);

  const driverOptions = useMemo(() => (
    supportsDriverSelection(engine) ? DRIVER_OPTIONS : DRIVER_OPTIONS.filter((item) => item.value === 'auto')
  ), [engine]);

  const eligibleModels = useMemo(() => (
    managedModels
      .filter((item) => modelSupportsEngine(item, engine))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id, 'zh-CN'))
  ), [engine, managedModels]);

  const modelOptions = useMemo(() => {
    return eligibleModels.map((item) => ({
      value: item.id,
      label: item.name || item.id,
      description: [
        item.id,
        item.engines.length > 0 ? `engines: ${item.engines.join(', ')}` : '',
        item.endpoints.length > 0 ? `endpoints: ${item.endpoints.join(', ')}` : '',
      ].filter(Boolean).join(' · '),
    }));
  }, [eligibleModels]);

  const selectedModel = useMemo(() => managedModels.find((item) => item.id === model), [managedModels, model]);
  const selectedProviders = unique(selectedModel?.endpoints || []);
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
        setResult(stored.result);
        setLogs(stored.logs || stored.result.logs || []);
        setSavedAt(stored.savedAt || stored.result.finishedAt || null);
      }
    } catch {
      localStorage.removeItem(LOCAL_RESULT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!supportsDriverSelection(engine) && driver !== 'auto') {
      setDriver('auto');
    }
  }, [driver, engine]);

  useEffect(() => {
    const selectedStillEligible = eligibleModels.some((item) => item.id === model);
    if (!selectedStillEligible) {
      setModel(eligibleModels[0]?.id || '');
    }
  }, [eligibleModels, model]);

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
      setSavedAt(nextSavedAt);
    } catch {
      toast('warning', '诊断结果较大，本地保存失败');
    }
  };

  const runDiagnostics = async () => {
    if (!engine) {
      toast('warning', '请选择要诊断的引擎');
      return;
    }
    if (includeModelScore && !model) {
      toast('warning', '请选择要评测的模型');
      return;
    }
    if (includeModelScore && selectedModel && !modelSupportsEngine(selectedModel, engine)) {
      toast('warning', '当前模型不支持所选引擎，请重新选择');
      return;
    }
    if (includeModelScore && selectedModelCapabilityIds.length === 0) {
      toast('warning', '请至少选择一个模型能力 probe');
      return;
    }

    const requestBody = {
      engine,
      driver: supportsDriverSelection(engine) ? driver : 'auto',
      model,
      timeoutMs: Number.parseInt(timeoutMs, 10) || DEFAULT_TIMEOUT_MS,
      includeEngineDebug,
      includeModelScore,
      modelCapabilityIds: includeModelScore ? selectedModelCapabilityIds : [],
    };

    setRunning(true);
    setResult(null);
    setLogs([
      createClientLog(
        '已提交诊断任务',
        `engine=${requestBody.engine}, driver=${requestBody.driver}, model=${requestBody.model || '默认模型'}, capabilities=${includeModelScore ? selectedModelCapabilityLabel : '跳过模型评分'}`,
      ),
    ]);
    const toastId = toast('loading', '正在运行诊断评测...');
    try {
      const response = await authFetch('/api/models/diagnostics/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error || '诊断评测失败');
      }
      if (!response.body) {
        throw new Error('当前环境不支持诊断日志流');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalResult: ModelDiagnosticsResponse | null = null;

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          const payload = JSON.parse(line) as
            | { type: 'log'; log: DiagnosticLogEntry }
            | { type: 'result'; result: ModelDiagnosticsResponse }
            | { type: 'error'; error: string };

          if (payload.type === 'log') {
            setLogs((prev) => [...prev, payload.log]);
          } else if (payload.type === 'result') {
            finalResult = payload.result;
            setResult(payload.result);
            if (payload.result.logs?.length) setLogs(payload.result.logs);
            saveDiagnosticResult(payload.result);
          } else if (payload.type === 'error') {
            throw new Error(payload.error || '诊断评测失败');
          }
        }

        if (done) break;
      }

      if (!finalResult) {
        throw new Error('诊断评测没有返回结果');
      }
      updateToast(toastId, finalResult.ok ? 'success' : 'warning', finalResult.ok ? '诊断评测完成' : '诊断完成，但存在风险项');
    } catch (error) {
      setLogs((prev) => [
        ...prev,
        {
          id: `client-error-${Date.now()}`,
          at: new Date().toISOString(),
          elapsedMs: prev[prev.length - 1]?.elapsedMs || 0,
          level: 'error',
          message: '诊断请求失败',
          detail: error instanceof Error ? error.message : '诊断评测失败',
        },
      ]);
      updateToast(toastId, 'error', error instanceof Error ? error.message : '诊断评测失败');
    } finally {
      setRunning(false);
    }
  };

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
  const terminalOutput = useMemo(
    () => buildDiagnosticTerminalOutput(logs, result, running, detailedLogs),
    [detailedLogs, logs, result, running],
  );

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
                  诊断评测
                </Badge>
                <Badge variant="outline" className="border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  Probe to Evidence
                </Badge>
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">引擎调试与模型能力打分</h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                一次运行可覆盖环境可用性、单轮/多轮对话、流式事件，以及按需选择的 JSON、代码、骑车鹈鹕、数学、推理、结构化输出和一致性检查。
                所有结论都保留原始输出预览与事件统计，方便复盘。
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <label className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">引擎</span>
                  <SingleCombobox
                    value={engine}
                    onValueChange={(value) => {
                      setEngine(value || engine);
                      if (!supportsDriverSelection(value || engine)) setDriver('auto');
                    }}
                    options={engineOptions}
                    triggerClassName="h-10"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Driver</span>
                  <SingleCombobox
                    value={supportsDriverSelection(engine) ? driver : 'auto'}
                    onValueChange={(value) => setDriver((value || 'auto') as DiagnosticDriver)}
                    options={driverOptions}
                    triggerClassName="h-10"
                    disabled={!supportsDriverSelection(engine)}
                  />
                </label>
                <label className="space-y-2 xl:col-span-2">
                  <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
                    <span>模型</span>
                    <span>{eligibleModels.length} 个可用</span>
                  </span>
                  <SingleCombobox
                    value={model}
                    onValueChange={setModel}
                    options={modelOptions}
                    triggerClassName="h-10"
                    placeholder={eligibleModels.length > 0 ? '选择模型' : '当前引擎暂无可用模型'}
                    disabled={eligibleModels.length === 0}
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
                      <div className="text-sm font-medium">引擎链路调试</div>
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
                <Button
                  variant="outline"
                  onClick={() => {
                    setResult(null);
                    setLogs([]);
                    setSavedAt(null);
                    if (typeof window !== 'undefined') {
                      localStorage.removeItem(LOCAL_RESULT_STORAGE_KEY);
                    }
                  }}
                  disabled={running || (!result && logs.length === 0)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  清空结果
                </Button>
                {selectedProviders.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {selectedProviders.map((provider) => (
                      <Badge key={provider} variant="secondary" className="rounded-md">
                        {provider}
                      </Badge>
                    ))}
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
                          ? `${getEngineDisplayName(result.engine)} / ${result.driver.toUpperCase()} / ${result.model || '默认模型'}`
                          : '选择引擎与模型后，运行一次诊断即可生成分数、耗时和证据链。'}
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
                <p className="mt-1 text-sm text-muted-foreground">Terminal 会逐步刷新；详细模式会显示每个 stream event、fullDetail、prompt、event samples、metrics 和完整输出预览。</p>
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
              </div>
            </div>

            <div className="mt-4">
              <Terminal output={terminalOutput} isStreaming={running} className="border-border/70 shadow-sm">
                <TerminalHeader className="border-zinc-800/80 bg-zinc-950/95">
                  <TerminalTitle>详细日志</TerminalTitle>
                  <div className="flex items-center gap-2">
                    <TerminalStatus>streaming</TerminalStatus>
                    <TerminalActions>
                      <TerminalCopyButton />
                    </TerminalActions>
                  </div>
                </TerminalHeader>
                <TerminalContent className="max-h-[560px] text-[12px] leading-5" />
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
                ? '上方日志会持续刷新，完成后这里会展示完整阶段耗时、能力评分和证据链。'
                : '运行后这里会展示引擎阶段耗时、流式事件、模型能力评分和每个评分的证据链。'}
            </p>
          </section>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
            <section className="rounded-lg border border-border/70 bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold">引擎链路调试</h3>
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
                              defaultOpen={false}
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
                                  <TestErrorStack className="max-h-56 w-full text-muted-foreground dark:text-muted-foreground">
                                    {formatPromptText(run.prompt)}
                                  </TestErrorStack>
                                </Test>
                                <Test name="模型输出" status={testStatus(run.status)}>
                                  <TestStatusIndicator />
                                  <TestName />
                                  {run.error ? (
                                    <TestError className="w-full">
                                      <TestErrorMessage>{run.error}</TestErrorMessage>
                                    </TestError>
                                  ) : (
                                    <TestErrorStack className="max-h-72 w-full text-muted-foreground dark:text-muted-foreground">
                                      {detailedLogs ? (run.outputPreview || '无输出') : compactOutput(run.outputPreview, 2400)}
                                    </TestErrorStack>
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
