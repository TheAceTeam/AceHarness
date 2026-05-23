import {
  createEngine,
  createEngineForDriver,
  getEngineAvailabilityReport,
  resolveEffectiveEngine,
  type EngineDriver,
  type EngineType,
} from '@/lib/engines/engine-factory';
import type { Engine, EngineOptions, EngineResult, EngineStreamEvent } from '@/lib/engines/engine-interface';
import type {
  DiagnosticDriver,
  DiagnosticLogEntry,
  DiagnosticLogLevel,
  DiagnosticPromptRun,
  DiagnosticRunStatus,
  DiagnosticStage,
  EngineDiagnosticSummary,
  ModelCapabilityScore,
  ModelDiagnosticsRequest,
  ModelDiagnosticsResponse,
  ModelEvaluationSummary,
} from '@/lib/models/diagnostic-types';

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 900_000;
const EVENT_SAMPLE_LIMIT = 80;
const EVENT_VERBOSE_LOG_LIMIT = 80;
const MULTI_TURN_MEMORY_TOKEN = 'ACE_MEMORY_7319';

interface JsonParseResult {
  parsed: any;
  wholeJson: boolean;
}

interface PromptSpec {
  id: string;
  label: string;
  category: string;
  prompt: string;
  systemPrompt: string;
  capabilityId: string;
  timeoutMultiplier?: number;
}

interface DiagnosticsRunOptions {
  onLog?: (entry: DiagnosticLogEntry) => void;
  onProgress?: (result: ModelDiagnosticsResponse) => void;
  signal?: AbortSignal;
}

type DiagnosticLogger = (input: {
  level?: DiagnosticLogLevel;
  message: string;
  detail?: string;
  fullDetail?: string;
  verbose?: boolean;
}) => void;

function abortError(): Error {
  const error = new Error('诊断任务已停止');
  error.name = 'AbortError';
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message === '诊断任务已停止');
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError();
}

function createLogCollector(startedAtMs: number, onLog?: (entry: DiagnosticLogEntry) => void) {
  const logs: DiagnosticLogEntry[] = [];
  let sequence = 0;

  const log: DiagnosticLogger = (input) => {
    const entry: DiagnosticLogEntry = {
      id: `diagnostic-log-${++sequence}`,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAtMs,
      level: input.level || 'info',
      message: input.message,
      detail: input.detail,
      fullDetail: input.fullDetail,
      verbose: input.verbose,
    };
    logs.push(entry);
    onLog?.(entry);
  };

  return { logs, log };
}

function cloneSerializable<T>(value: T): T {
  if (value == null) return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function logLevelFromStatus(status: DiagnosticRunStatus): DiagnosticLogLevel {
  if (status === 'passed') return 'success';
  if (status === 'warning' || status === 'skipped') return 'warning';
  return 'error';
}

function normalizeDiagnosticLogLevel(value: unknown): DiagnosticLogLevel {
  if (value === 'success' || value === 'warning' || value === 'error' || value === 'info') {
    return value;
  }
  return 'info';
}

function runLogDetail(run: DiagnosticPromptRun): string {
  return run.error || `耗时 ${run.durationMs}ms，输出 ${run.outputChars} 字符，首文本 ${run.firstTextMs ?? '--'}ms`;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function runLogFullDetail(run: DiagnosticPromptRun): string {
  return safeJson({
    id: run.id,
    label: run.label,
    category: run.category,
    status: run.status,
    durationMs: run.durationMs,
    firstEventMs: run.firstEventMs,
    firstTextMs: run.firstTextMs,
    outputChars: run.outputChars,
    charsPerSecond: run.charsPerSecond,
    sessionId: run.sessionId,
    stopReason: run.stopReason,
    error: run.error,
    prompt: run.prompt,
    eventCounts: run.eventCounts,
    eventSamples: run.eventSamples,
    output: run.outputPreview,
  });
}

function clampTimeoutMs(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(5_000, parsed));
}

function normalizeDriver(value: unknown): DiagnosticDriver {
  return value === 'sdk' || value === 'stdio' ? value : 'auto';
}

function normalizeCapabilityIds(value: unknown): Set<string> {
  const allProbeCapabilities = MODEL_DIAGNOSTIC_CAPABILITIES.filter((id) => id !== 'output_speed');
  const all = new Set(allProbeCapabilities);
  if (!Array.isArray(value) || value.length === 0) return all;
  const selected = new Set<string>();
  for (const item of value) {
    const id = String(item || '').trim();
    if (all.has(id as any)) selected.add(id);
  }
  return selected.size > 0 ? selected : all;
}

function capabilitySelectionLabel(selected: Set<string>): string {
  const allProbeCount = MODEL_DIAGNOSTIC_CAPABILITIES.filter((id) => id !== 'output_speed').length;
  if (selected.size === allProbeCount) return '全部能力';
  return Array.from(selected).join(', ');
}

function capabilityEnabled(selected: Set<string>, capabilityId: string): boolean {
  return selected.has(capabilityId);
}

function promptTimeoutMs(baseTimeoutMs: number, spec: PromptSpec): number {
  const multiplier = spec.timeoutMultiplier || 1;
  return Math.min(MAX_TIMEOUT_MS, Math.round(baseTimeoutMs * multiplier));
}

function previewText(value: unknown, maxLength = 240): string | undefined {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}...` : normalized;
}

function fullLogText(value: unknown, maxLength = 80_000): string | undefined {
  const normalized = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return undefined;
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}\n...[truncated ${normalized.length - maxLength} chars]`
    : normalized;
}

function statusFromScore(score: number): DiagnosticRunStatus {
  if (score >= 80) return 'passed';
  if (score >= 55) return 'warning';
  return 'failed';
}

function makeStage(input: {
  id: string;
  label: string;
  startedAtMs: number;
  status: DiagnosticRunStatus;
  detail?: string;
}): DiagnosticStage {
  const finishedAtMs = Date.now();
  return {
    id: input.id,
    label: input.label,
    status: input.status,
    durationMs: finishedAtMs - input.startedAtMs,
    startedAt: new Date(input.startedAtMs).toISOString(),
    finishedAt: new Date(finishedAtMs).toISOString(),
    detail: input.detail,
  };
}

function scoreCap(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function parseJsonCandidate(output: string): JsonParseResult | null {
  const trimmed = String(output || '').trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) candidates.push(objectMatch[0].trim());

  for (const candidate of candidates) {
    try {
      return {
        parsed: JSON.parse(candidate),
        wholeJson: candidate === trimmed,
      };
    } catch {
      // Try next candidate.
    }
  }
  return null;
}

function runStatusFromResult(result: EngineResult | null, output: string, error?: string): DiagnosticRunStatus {
  if (error) return 'failed';
  if (result?.success && output.trim()) return 'passed';
  if (output.trim()) return 'warning';
  return 'failed';
}

async function runPrompt(
  engine: Engine,
  options: EngineOptions & { label: string; category: string; id: string },
  log?: DiagnosticLogger,
  signal?: AbortSignal,
): Promise<DiagnosticPromptRun> {
  throwIfAborted(signal);
  const startedAt = Date.now();
  let firstEventMs: number | null = null;
  let firstTextMs: number | null = null;
  const eventCounts: Record<string, number> = {};
  const eventSamples: DiagnosticPromptRun['eventSamples'] = [];
  let verboseEventLogs = 0;
  let verboseEventLimitLogged = false;

  const onStream = (event: EngineStreamEvent) => {
    const atMs = Date.now() - startedAt;
    const content = String(event.content || '');
    const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : null;
    const metadataRecord = metadata as Record<string, unknown> | null;
    const isWrapperLog = event.type === 'log';
    if (firstEventMs === null) {
      firstEventMs = atMs;
      log?.({
        message: `${options.label} 收到首个事件`,
        detail: `type=${event.type}, at=${atMs}ms`,
        fullDetail: safeJson({
          run: {
            id: options.id,
            label: options.label,
            category: options.category,
            agent: options.agent,
            step: options.step,
          },
          event: {
            type: event.type,
            atMs,
            contentLength: content.length,
            content,
            metadata,
          },
        }),
      });
    }
    eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;
    if (event.type === 'text' && content && firstTextMs === null) {
      firstTextMs = atMs;
      log?.({
        message: `${options.label} 收到首个文本`,
        detail: previewText(content, 240) || `at=${atMs}ms`,
        fullDetail: content,
      });
    }
    if (isWrapperLog) {
      const detailText = typeof metadataRecord?.detail === 'string'
        ? metadataRecord.detail
        : previewText(metadataRecord?.detail, 500);
      const fullDetail = typeof metadataRecord?.fullDetail === 'string'
        ? metadataRecord.fullDetail
        : safeJson({
            content,
            metadata,
          });
      log?.({
        level: normalizeDiagnosticLogLevel(metadataRecord?.level),
        message: content || String(metadataRecord?.message || `${options.label} wrapper log`),
        detail: detailText,
        fullDetail,
        verbose: metadataRecord?.verbose !== false,
      });
    }
    if (eventSamples.length < EVENT_SAMPLE_LIMIT) {
      eventSamples.push({
        type: event.type,
        atMs,
        contentPreview: previewText(content, 500),
        content: fullLogText(content, 20_000),
        contentLength: content.length,
        metadataKeys: metadata ? Object.keys(metadata).slice(0, 12) : undefined,
        metadata,
      });
    }
    if (!isWrapperLog && verboseEventLogs < EVENT_VERBOSE_LOG_LIMIT) {
      verboseEventLogs += 1;
      log?.({
        message: `${options.label} stream event #${verboseEventLogs}`,
        detail: `type=${event.type}, at=${atMs}ms, chars=${content.length}`,
        fullDetail: safeJson({
          run: {
            id: options.id,
            label: options.label,
            category: options.category,
            agent: options.agent,
            step: options.step,
          },
          event: {
            index: verboseEventLogs,
            type: event.type,
            atMs,
            contentLength: content.length,
            content,
            metadata,
          },
        }),
        verbose: true,
      });
    } else if (!isWrapperLog && !verboseEventLimitLogged) {
      verboseEventLimitLogged = true;
      log?.({
        level: 'warning',
        message: `${options.label} verbose stream event limit reached`,
        detail: `已记录前 ${EVENT_VERBOSE_LOG_LIMIT} 个事件，后续事件仍会计数到 run.eventCounts`,
        verbose: true,
      });
    }
  };

  let timer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = () => {
    try { engine.cancel(); } catch {}
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  engine.on('stream', onStream);
  try {
    const executePromise = engine.execute(options);
    executePromise.catch(() => undefined);
    const result = await Promise.race([
      executePromise,
      new Promise<EngineResult>((_, reject) => {
        if (!signal) return;
        if (signal.aborted) {
          reject(abortError());
          return;
        }
        signal.addEventListener('abort', () => reject(abortError()), { once: true });
      }),
      new Promise<EngineResult>((_, reject) => {
        timer = setTimeout(() => {
          try { engine.cancel(); } catch {}
          reject(new Error(`诊断请求超时 ${options.timeoutMs || DEFAULT_TIMEOUT_MS}ms`));
        }, options.timeoutMs || DEFAULT_TIMEOUT_MS);
      }),
    ]);
    const durationMs = Date.now() - startedAt;
    const output = String(result.output || '');
    const outputPreviewLength = options.id === 'cap-drawing-pelican'
      ? 80_000
      : options.category === 'model-score'
        ? 50_000
        : 20_000;
    const outputChars = output.length;
    return {
      id: options.id,
      label: options.label,
      category: options.category,
      status: runStatusFromResult(result, output, result.success ? undefined : result.error),
      durationMs,
      firstEventMs,
      firstTextMs,
      outputChars,
      charsPerSecond: durationMs > 0 ? Number((outputChars / (durationMs / 1000)).toFixed(2)) : null,
      sessionId: result.sessionId,
      stopReason: result.stopReason,
      outputPreview: fullLogText(output, outputPreviewLength),
      error: result.success ? undefined : (result.error || '引擎返回失败状态'),
      prompt: options.prompt,
      eventCounts,
      eventSamples,
    };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    if (isAbortError(error)) {
      try { engine.cancel(); } catch {}
      throw error;
    }
    return {
      id: options.id,
      label: options.label,
      category: options.category,
      status: 'failed',
      durationMs,
      firstEventMs,
      firstTextMs,
      outputChars: 0,
      charsPerSecond: null,
      outputPreview: undefined,
      error: error instanceof Error ? error.message : String(error),
      prompt: options.prompt,
      eventCounts,
      eventSamples,
    };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    engine.off('stream', onStream);
  }
}

async function instantiateDiagnosticEngine(engineId: string, driver: DiagnosticDriver): Promise<{ engine: Engine | null; effectiveEngine?: string }> {
  if (driver === 'sdk' || driver === 'stdio') {
    const effectiveEngine = resolveEffectiveEngine(engineId, driver) || engineId;
    return {
      engine: await createEngineForDriver(engineId as EngineType, driver as EngineDriver),
      effectiveEngine,
    };
  }
  return {
    engine: await createEngine(engineId as EngineType),
    effectiveEngine: resolveEffectiveEngine(engineId, null) || engineId,
  };
}

function basePromptOptions(input: {
  model: string;
  timeoutMs: number;
  sessionId?: string;
}): Omit<EngineOptions, 'prompt' | 'systemPrompt' | 'agent' | 'step'> {
  return {
    model: input.model,
    workingDirectory: process.cwd(),
    timeoutMs: input.timeoutMs,
    sessionId: input.sessionId,
    allowedTools: [],
    appendSystemPrompt: true,
    diagnosticLogging: true,
  };
}

async function runEngineDebug(input: {
  engine: Engine;
  engineId: string;
  driver: DiagnosticDriver;
  effectiveEngine?: string;
  model: string;
  timeoutMs: number;
  availabilityStage: DiagnosticStage;
  createStage: DiagnosticStage;
  log?: DiagnosticLogger;
  onProgress?: (summary: EngineDiagnosticSummary) => void;
  signal?: AbortSignal;
}): Promise<EngineDiagnosticSummary> {
  throwIfAborted(input.signal);
  const stages: DiagnosticStage[] = [input.availabilityStage, input.createStage];
  const runs: DiagnosticPromptRun[] = [];
  const eventTypes = new Set<string>();

  const buildSummary = (): EngineDiagnosticSummary => ({
    engine: input.engineId,
    driver: input.driver,
    effectiveEngine: input.effectiveEngine,
    available: input.availabilityStage.status !== 'failed' && input.createStage.status !== 'failed',
    streamSupported: runs.some((run) => (run.eventCounts.text || 0) > 0),
    observedEventTypes: Array.from(eventTypes).sort(),
    stages: cloneSerializable(stages),
    runs: cloneSerializable(runs),
  });

  const emitProgress = () => {
    input.onProgress?.(buildSummary());
  };

  const singleStartedAt = Date.now();
  input.log?.({ message: '开始单轮对话 probe', detail: `注入记忆验证码 ${MULTI_TURN_MEMORY_TOKEN}，期望输出 ACE_OK` });
  const single = await runPrompt(input.engine, {
    ...basePromptOptions(input),
    id: 'engine-single-turn',
    label: '单轮对话',
    category: 'engine-debug',
    agent: 'engine-diagnostics',
    step: 'single-turn',
    prompt: `请记住验证码 ${MULTI_TURN_MEMORY_TOKEN}，后续我会询问。现在请只回复 ACE_OK，不要解释，不要调用工具。`,
    systemPrompt: '你是 ACEHarness 引擎诊断助手。严格按用户要求回复。',
  }, input.log, input.signal);
  throwIfAborted(input.signal);
  input.log?.({
    level: logLevelFromStatus(single.status),
    message: '单轮对话 probe 完成',
    detail: runLogDetail(single),
    fullDetail: runLogFullDetail(single),
  });
  runs.push(single);
  Object.keys(single.eventCounts).forEach((type) => eventTypes.add(type));
  stages.push(makeStage({
    id: 'single-turn',
    label: '单轮对话',
    startedAtMs: singleStartedAt,
    status: single.status,
    detail: single.error || `输出 ${single.outputChars} 字符，首个文本 ${single.firstTextMs ?? '--'}ms`,
  }));

  const streamStartedAt = Date.now();
  const textEvents = single.eventCounts.text || 0;
  const streamStage = makeStage({
    id: 'stream-events',
    label: '流式输出与事件格式',
    startedAtMs: streamStartedAt,
    status: textEvents > 0 ? 'passed' : (single.status === 'passed' ? 'warning' : 'failed'),
    detail: textEvents > 0
      ? `观察到 ${Array.from(eventTypes).join(', ') || 'text'} 事件`
      : '本轮没有观察到 text 流事件，可能是阻塞式输出或 wrapper 未透传增量',
  });
  stages.push(streamStage);
  input.log?.({
    level: logLevelFromStatus(streamStage.status),
    message: '流式输出与事件格式检查完成',
    detail: streamStage.detail,
  });
  emitProgress();

  const multiStartedAt = Date.now();
  if (single.sessionId) {
    input.log?.({ message: '开始多轮记忆 probe', detail: `复用 session=${single.sessionId.slice(0, 12)}...` });
    const multi = await runPrompt(input.engine, {
      ...basePromptOptions({ ...input, sessionId: single.sessionId }),
      id: 'engine-multi-turn',
      label: '多轮记忆',
      category: 'engine-debug',
      agent: 'engine-diagnostics',
      step: 'multi-turn',
      prompt: '这是第二轮。请回忆我上一轮让你记住的验证码。只回复 MEMORY=验证码，不要解释。',
      systemPrompt: '你是 ACEHarness 引擎诊断助手。严格按用户要求回复。',
    }, input.log, input.signal);
    throwIfAborted(input.signal);
    const remembered = String(multi.outputPreview || '').includes(MULTI_TURN_MEMORY_TOKEN);
    const multiStatus: DiagnosticRunStatus = multi.status === 'failed'
      ? 'failed'
      : remembered
        ? 'passed'
        : 'warning';
    const multiWithMemory: DiagnosticPromptRun = {
      ...multi,
      status: multiStatus,
      error: multi.status === 'failed'
        ? multi.error
        : remembered
          ? multi.error
          : '多轮对话可执行，但未回忆出上一轮验证码',
    };
    input.log?.({
      level: logLevelFromStatus(multiWithMemory.status),
      message: '多轮记忆 probe 完成',
      detail: remembered ? runLogDetail(multiWithMemory) : `${runLogDetail(multiWithMemory)}，expected=${MULTI_TURN_MEMORY_TOKEN}`,
      fullDetail: runLogFullDetail(multiWithMemory),
    });
    runs.push(multiWithMemory);
    Object.keys(multiWithMemory.eventCounts).forEach((type) => eventTypes.add(type));
    stages.push(makeStage({
      id: 'multi-turn',
      label: '多轮记忆',
      startedAtMs: multiStartedAt,
      status: multiWithMemory.status,
      detail: multiWithMemory.error || `记忆命中 ${MULTI_TURN_MEMORY_TOKEN}，session=${single.sessionId.slice(0, 12)}...`,
    }));
    emitProgress();
  } else {
    const skippedStage = makeStage({
      id: 'multi-turn',
      label: '多轮记忆',
      startedAtMs: multiStartedAt,
      status: 'skipped',
      detail: '单轮对话未返回 sessionId，无法验证续聊',
    });
    stages.push(skippedStage);
    input.log?.({
      level: 'warning',
      message: '多轮记忆 probe 跳过',
      detail: skippedStage.detail,
    });
    emitProgress();
  }

  return buildSummary();
}

function scoreJsonOutput(run: DiagnosticPromptRun): ModelCapabilityScore {
  const parsed = parseJsonCandidate(run.outputPreview || '');
  let score = run.status === 'passed' ? 10 : 0;
  const evidence: string[] = [];
  const data = parsed?.parsed;
  if (parsed) {
    score += 20;
    evidence.push(parsed.wholeJson ? '返回内容可直接作为 JSON 解析' : '从返回内容中提取到了可解析 JSON');
    if (parsed.wholeJson) score += 10;
    if (data?.profile?.name === 'relay-check' && data.profile.mode === 'strict' && data.profile.sampleCount === 4) {
      score += 15;
      evidence.push('profile 对象字段精确命中');
    }
    if (Array.isArray(data?.checks)
      && data.checks.length === 4
      && data.checks.some((item: any) => item.id === 'prompt_injection' && item.severity === 'high' && item.passed === false)
      && data.checks.some((item: any) => item.id === 'context_truncation' && item.severity === 'medium' && item.passed === true)
      && data.checks.some((item: any) => item.id === 'tool_substitution' && item.severity === 'high' && item.passed === false)
      && data.checks.some((item: any) => item.id === 'sse_integrity' && item.severity === 'medium' && item.passed === true)) {
      score += 20;
      evidence.push('items 数组对象结构和数值正确');
    }
    if (data?.flags?.leakDetected === true && data.flags?.streamStable === true) {
      score += 15;
      evidence.push('布尔 flags 保持原生类型');
    }
    if (data?.summary?.risk === 'HIGH' && data.summary.failed === 2 && data.summary.passed === 2) {
      score += 10;
      evidence.push('totals 聚合字段正确');
    }
    if (Array.isArray(data?.trace) && data.trace.join('>') === 'sys-guard>user-probe>relay-hop') {
      score += 5;
      evidence.push('matrix 嵌套数组结构正确');
    }
    if (data?.checksum === 'prompt_injection:false|tool_substitution:false|risk:HIGH') {
      score += 10;
      evidence.push('checksum 精确命中');
    }
  } else {
    evidence.push('未能解析出合法 JSON');
  }
  return {
    id: 'json_output',
    label: 'JSON 输出',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: parsed ? '能够按约定返回机器可读 JSON' : 'JSON 格式不稳定，需要检查提示词或模型能力',
    evidence,
    metrics: {
      validJson: Boolean(parsed),
      wholeJson: parsed?.wholeJson || false,
      hasProfile: data?.profile?.name === 'relay-check' && data.profile.mode === 'strict',
      hasItems: Array.isArray(data?.checks) && data.checks.length === 4,
      totalsScore: typeof data?.summary?.failed === 'number' ? data.summary.failed : null,
      checksum: typeof data?.checksum === 'string' ? data.checksum : null,
      durationMs: run.durationMs,
    },
  };
}

function scoreCodeGeneration(run: DiagnosticPromptRun): ModelCapabilityScore {
  const output = String(run.outputPreview || '').toLowerCase();
  let score = run.status === 'passed' ? 10 : 0;
  const evidence: string[] = [];
  const checks = [
    { ok: /auditrelayevents/.test(output), points: 15, text: '包含指定函数名 auditRelayEvents' },
    { ok: /type\s+relaye?vent|interface\s+relaye?vent/.test(output), points: 10, text: '定义 RelayEvent 类型或接口' },
    { ok: /type\s+auditfinding|interface\s+auditfinding/.test(output), points: 10, text: '定义 AuditFinding 输出结构' },
    { ok: /system|user|assistant|tool/.test(output), points: 10, text: '包含角色或事件类型字面量' },
    { ok: /map\s*</.test(output) || /new\s+map/.test(output) || /seen|dedupe|duplicate/.test(output), points: 12, text: '包含去重或 Map 处理' },
    { ok: /promptinjection|prompt_injection|leak/.test(output), points: 10, text: '识别 prompt 泄漏或注入风险' },
    { ok: /toolsubstitution|tool_substitution|tool/.test(output), points: 10, text: '识别工具调用改写风险' },
    { ok: /missingdelta|missing_delta|delta/.test(output), points: 10, text: '识别流式 delta 完整性风险' },
    { ok: /risk|severity/.test(output), points: 10, text: '输出风险等级或严重性' },
    { ok: /byprovider|byendpoint|record\s*</.test(output), points: 8, text: '按 provider/endpoint 聚合' },
    { ok: /sort\s*\(|localecompare|severity|risk/.test(output), points: 8, text: '包含排序或风险优先级处理' },
    { ok: /reduce|for\s*\(|for\s+/.test(output), points: 7, text: '包含迭代聚合逻辑' },
    { ok: /return/.test(output), points: 5, text: '包含返回值' },
  ];
  for (const check of checks) {
    if (check.ok) {
      score += check.points;
      evidence.push(check.text);
    }
  }
  if (evidence.length === 0) evidence.push('输出中没有找到核心代码特征');
  return {
    id: 'code_generation',
    label: '代码生成',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? '代码结构和关键逻辑完整' : '代码可用性需要人工复核',
    evidence,
    metrics: {
      hasFunctionName: /auditrelayevents/.test(output),
      hasType: /type\s+relaye?vent|interface\s+relaye?vent/.test(output),
      hasPriorityOutput: /risk|severity/.test(output),
      hasOverdueOutput: /missingdelta|missing_delta|delta/.test(output),
      hasAverageResolution: /latency|duration/.test(output),
      durationMs: run.durationMs,
    },
  };
}

function hasSvgIdOrClass(output: string, pattern: string): boolean {
  return new RegExp(String.raw`(?:id|class)\s*=\s*["'][^"']*${pattern}[^"']*["']`, 'i').test(output);
}

function scorePelicanDrawing(run: DiagnosticPromptRun): ModelCapabilityScore {
  const output = String(run.outputPreview || '');
  const normalized = output.toLowerCase();
  const shapeCount = output.match(/<(path|circle|ellipse|polygon|polyline|line|rect)\b/gi)?.length || 0;
  const outputChars = output.trim().length;
  const hasSvg = /<svg[\s>]/i.test(output);
  const hasClosingSvg = /<\/svg\s*>/i.test(output);
  const hasViewBox = /\bviewBox\s*=\s*["'][^"']+["']/i.test(output);
  const hasExactViewBox = /\bviewBox\s*=\s*["']0\s+0\s+360\s+240["']/i.test(output);
  const titleText = output.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '';
  const hasTitle = Boolean(titleText.trim());
  const hasTitleKeywords = /pelican|鹈鹕/i.test(titleText) && /bicycle|bike|自行车/i.test(titleText);
  const hasPelicanKeyword = /pelican|鹈鹕/.test(normalized);
  const hasBikeKeyword = /bicycle|bike|自行车/.test(normalized);
  const hasBeak = hasSvgIdOrClass(output, 'pelican[-_](?:beak|bill)') || /pelican[-_](?:beak|bill)/.test(normalized);
  const hasPouch = hasSvgIdOrClass(output, 'pelican[-_](?:pouch|throat)') || /pelican[-_](?:pouch|throat)/.test(normalized);
  const hasBody = hasSvgIdOrClass(output, 'pelican[-_](?:body|torso)') || /pelican[-_](?:body|torso)/.test(normalized);
  const hasWing = hasSvgIdOrClass(output, 'pelican[-_](?:wing|wings)') || /pelican[-_](?:wing|wings)/.test(normalized);
  const hasLegs = hasSvgIdOrClass(output, 'pelican[-_](?:leg|legs|foot|feet)') || /pelican[-_](?:leg|legs|foot|feet)/.test(normalized);
  const hasFrontWheel = hasSvgIdOrClass(output, '(?:front|bike-front)[-_]wheel') || /front[-_]?wheel/.test(normalized);
  const hasRearWheel = hasSvgIdOrClass(output, '(?:rear|back|bike-rear)[-_]wheel') || /rear[-_]?wheel/.test(normalized);
  const wheelGeometryCount = output.match(/<(circle|ellipse)\b/gi)?.length || 0;
  const hasFrame = hasSvgIdOrClass(output, 'bike[-_](?:frame|tube)') || /bike[-_](?:frame|tube)/.test(normalized);
  const hasHandlebar = hasSvgIdOrClass(output, '(?:handlebar|bike[-_]handle)') || /handlebar|bike[-_]handle/.test(normalized);
  const hasSeat = hasSvgIdOrClass(output, '(?:seat|saddle)') || /seat|saddle/.test(normalized);
  const hasPedal = hasSvgIdOrClass(output, 'pedal') || /\bpedal\b/.test(normalized);
  const looksLikeTopology = /relay|gateway|provider|attack_probe|sse_stream|finding|audit topology|拓扑/.test(normalized);
  const pelicanPartCount = [hasBeak, hasPouch, hasBody, hasWing, hasLegs].filter(Boolean).length;
  const bikePartCount = [hasFrontWheel, hasRearWheel, hasFrame, hasHandlebar, hasSeat, hasPedal].filter(Boolean).length;
  const extraShapeCount = Math.max(0, shapeCount - (pelicanPartCount + bikePartCount));
  let score = 0;
  const evidence: string[] = [];

  if (hasSvg) {
    score += 12;
    evidence.push('包含 SVG 根节点');
  } else {
    evidence.push('未找到 SVG 根节点');
  }
  if (hasClosingSvg) {
    score += 8;
    evidence.push('SVG 闭合完整');
  }
  if (hasExactViewBox) {
    score += 6;
    evidence.push('viewBox 精确命中 0 0 360 240');
  } else if (hasViewBox) {
    score += 4;
    evidence.push('声明了 viewBox');
  } else {
    evidence.push('缺少 viewBox');
  }
  if (shapeCount >= 20) {
    score += 10;
    evidence.push(`图形层次很丰富：${shapeCount} 个图形元素`);
  } else if (shapeCount >= 16) {
    score += 8;
    evidence.push(`图形细节较丰富：${shapeCount} 个图形元素`);
  } else if (shapeCount >= 12) {
    score += 5;
    evidence.push(`图形元素达到可读细节量：${shapeCount}`);
  } else if (shapeCount >= 10) {
    score += 3;
    evidence.push(`图形元素数量偏少：${shapeCount}`);
  } else {
    evidence.push(`图形元素不足：${shapeCount}`);
  }
  if (hasTitle) {
    score += 3;
    evidence.push('包含 title');
  } else {
    evidence.push('缺少 title');
  }
  if (hasTitleKeywords) {
    score += 3;
    evidence.push('title 明确写出 pelican 和 bicycle');
  }
  if (hasPelicanKeyword) {
    score += 2;
    evidence.push('输出中明确出现 pelican / 鹈鹕');
  }
  if (hasBikeKeyword) {
    score += 2;
    evidence.push('输出中明确出现 bicycle / bike / 自行车');
  }
  if (wheelGeometryCount >= 2) {
    score += 4;
    evidence.push('至少有两个圆形/椭圆形车轮');
  }
  if (hasFrontWheel && hasRearWheel) {
    score += 6;
    evidence.push('前后车轮标记齐全');
  } else if (hasFrontWheel || hasRearWheel) {
    score += 3;
    evidence.push('只命中了一侧车轮标记');
  }
  if (bikePartCount >= 5) {
    score += 12;
    evidence.push('自行车关键部件较完整');
  } else if (bikePartCount >= 3) {
    score += 7;
    evidence.push('自行车部件部分命中');
  } else {
    evidence.push('自行车部件不足');
  }
  if (pelicanPartCount >= 5) {
    score += 15;
    evidence.push('鹈鹕长喙、喉囊、身体、翅膀、腿部齐全');
  } else if (pelicanPartCount >= 3) {
    score += 9;
    evidence.push('鹈鹕主体特征部分命中');
  } else {
    evidence.push('鹈鹕主体特征不足');
  }
  if (extraShapeCount >= 8) {
    score += 10;
    evidence.push(`除必需部件外还有较多补充细节：${extraShapeCount}`);
  } else if (extraShapeCount >= 6) {
    score += 8;
    evidence.push(`补充细节较丰富：${extraShapeCount}`);
  } else if (extraShapeCount >= 4) {
    score += 6;
    evidence.push(`有额外细节而非只画最低限度部件：${extraShapeCount}`);
  } else if (extraShapeCount >= 2) {
    score += 3;
    evidence.push(`有少量补充细节：${extraShapeCount}`);
  } else {
    evidence.push('额外细节偏少，接近最低限度作图');
  }
  if (outputChars >= 2200) {
    score += 8;
    evidence.push('SVG 内容密度高，细节表达充分');
  } else if (outputChars >= 1600) {
    score += 6;
    evidence.push('SVG 细节密度较好');
  } else if (outputChars >= 1300) {
    score += 3;
    evidence.push('SVG 内容密度中等');
  } else {
    evidence.push('SVG 内容较简略');
  }
  if (looksLikeTopology && !hasPelicanKeyword && pelicanPartCount < 3) {
    score -= 20;
    evidence.push('输出仍更像 relay 拓扑图，不像骑车鹈鹕');
  }

  return {
    id: 'drawing_pelican',
    label: '骑车鹈鹕',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? 'SVG 可渲染性和鹈鹕/自行车部件较完整' : '绘图可渲染性或目标特征不足',
    evidence,
    metrics: {
      hasSvg,
      hasClosingSvg,
      hasViewBox,
      hasExactViewBox,
      shapeCount,
      wheelGeometryCount,
      hasTitle,
      hasTitleKeywords,
      hasPelicanKeyword,
      hasBikeKeyword,
      hasBeak,
      hasPouch,
      hasBody,
      hasWing,
      hasLegs,
      hasFrontWheel,
      hasRearWheel,
      hasFrame,
      hasHandlebar,
      hasSeat,
      hasPedal,
      pelicanPartCount,
      bikePartCount,
      extraShapeCount,
      outputChars,
      looksLikeTopology,
      durationMs: run.durationMs,
    },
  };
}

function scoreReasoning(run: DiagnosticPromptRun): ModelCapabilityScore {
  const parsed = parseJsonCandidate(run.outputPreview || '');
  const data = parsed?.parsed;
  const repeatingIntegers = readNumberArrayField(data, 'repeatingIntegers')
    || readNumberArrayField(data, 'specialIntegers')
    || readNumberArrayField(data, 'repeatingNumbers');
  const trapezoidRatio = normalizeRatioField(data?.trapezoidRatio ?? data?.bcOverAd ?? data?.ratio);
  let score = run.status === 'passed' ? 10 : 0;
  const evidence: string[] = [];
  if (parsed) {
    score += 15;
    evidence.push('返回了可解析的推理评测 JSON');
  }
  if (parsed?.wholeJson) score += 5;
  if (readNumericField(data, 'truthTellers') === 7
    && readNumericField(data, 'liars') === 6
    && readNumericField(data, 'alternatersOddTruth') === 9
    && readNumericField(data, 'alternatersEvenTruth') === 9
    && readNumericField(data, 'truthCandyTotal') === 7) {
    score += 20;
    evidence.push('真假话/交替作答题 5 个字段全部命中');
  }
  if (repeatingIntegers
    && repeatingIntegers.join(',') === '111,222,333,444,481,518,555,592,629,666,777,888,999') {
    score += 20;
    evidence.push('循环小数约束题的 13 个整数枚举正确');
  }
  if (readNumericField(data, 'twoPassOrderings') === 8178) {
    score += 15;
    evidence.push('双轮扫描排列题命中 8178');
  }
  if (trapezoidRatio === '1/3') {
    score += 15;
    evidence.push('等腰梯形比例题命中 1/3');
  }
  if (readNumericField(data, 'returnStep') === 359) {
    score += 10;
    evidence.push('复合变换回归题命中 359');
  }
  if (Array.isArray(data?.steps) && data.steps.length >= 6) {
    score += 15;
    evidence.push('包含多题推理步骤');
  }
  return {
    id: 'reasoning',
    label: '推理能力',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? '离散推理、枚举和几何比例结果较稳定' : '推理答案或过程不够稳定',
    evidence,
    metrics: {
      validJson: Boolean(parsed),
      truthTellers: readNumericField(data, 'truthTellers'),
      liars: readNumericField(data, 'liars'),
      alternatersOddTruth: readNumericField(data, 'alternatersOddTruth'),
      alternatersEvenTruth: readNumericField(data, 'alternatersEvenTruth'),
      truthCandyTotal: readNumericField(data, 'truthCandyTotal'),
      repeatingIntegersCount: repeatingIntegers?.length || 0,
      twoPassOrderings: readNumericField(data, 'twoPassOrderings'),
      trapezoidRatio,
      returnStep: readNumericField(data, 'returnStep'),
      durationMs: run.durationMs,
    },
  };
}

function readNumericField(data: any, key: string): number | null {
  const value = data?.[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  return null;
}

function readNumberArrayField(data: any, key: string): number[] | null {
  const value = data?.[key];
  if (Array.isArray(value)) {
    const parsed = value.map((item) => {
      if (typeof item === 'number' && Number.isFinite(item)) return item;
      if (typeof item === 'string' && /^-?\d+$/.test(item.trim())) return Number(item.trim());
      return Number.NaN;
    });
    return parsed.every((item) => Number.isFinite(item)) ? parsed : null;
  }
  if (typeof value === 'string') {
    const matches = value.match(/-?\d+/g);
    if (!matches?.length) return null;
    return matches.map((item) => Number(item));
  }
  return null;
}

function normalizeRatioField(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value - 1 / 3) <= 1e-6 ? '1/3' : String(value);
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/1\s*\/\s*3/.test(text)) return '1/3';
  const decimal = text.match(/-?\d+(?:\.\d+)?/);
  if (decimal) {
    const parsed = Number(decimal[0]);
    if (Number.isFinite(parsed) && Math.abs(parsed - 1 / 3) <= 1e-3) return '1/3';
  }
  return text.replace(/\s+/g, '');
}

function isCloseTo(value: number | null, expected: number, tolerance = 1e-9): boolean {
  return value != null && Math.abs(value - expected) <= tolerance;
}

function scoreMath(run: DiagnosticPromptRun): ModelCapabilityScore {
  const parsed = parseJsonCandidate(run.outputPreview || '');
  const data = parsed?.parsed;
  const checks: Array<{ key: string; expected: number; label: string; tolerance?: number }> = [
    { key: 'pairPartitionCount', expected: 144, label: '配对约束题命中 144' },
    { key: 'cyclicExteriorSignature', expected: 1565, label: '圆内外面积题命中 1565' },
    { key: 'newBoxVolume', expected: 30, label: '长方体体积题命中 30' },
    { key: 'harmonicRemainderMod17', expected: 5, label: '调和和余数题命中 5' },
    { key: 'fourthCombinedTerm', expected: 206, label: '等差+等比数列题命中 206' },
    { key: 'constrainedStringCount', expected: 1296, label: '受限字符串计数题命中 1296' },
    { key: 'minEdgeSum', expected: 337, label: '格点正方形极值题命中 337' },
  ];
  let score = run.status === 'passed' ? 10 : 0;
  const evidence: string[] = [];
  const observed: Record<string, number | null> = {};
  let correctCount = 0;

  if (parsed) {
    score += 20;
    evidence.push('返回了可解析的数学答案 JSON');
    if (parsed.wholeJson) score += 5;
  } else {
    evidence.push('未能解析出数学答案 JSON');
  }

  for (const check of checks) {
    const value = readNumericField(data, check.key);
    observed[check.key] = value;
    if (isCloseTo(value, check.expected, check.tolerance ?? 1e-9)) {
      correctCount += 1;
      score += 5;
      evidence.push(check.label);
    }
  }

  if (Array.isArray(data?.steps) && data.steps.length >= 8) {
    score += 10;
    evidence.push('包含不少于 8 条计算步骤');
  }

  if (correctCount < checks.length) {
    evidence.push(`精确命中 ${correctCount}/${checks.length} 个数学字段`);
  }

  return {
    id: 'math',
    label: '数学能力',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? '高难数学题精确命中较多' : '高难数学题存在错答或格式不稳定',
    evidence,
    metrics: {
      validJson: Boolean(parsed),
      correctCount,
      expectedCount: checks.length,
      pairPartitionCount: observed.pairPartitionCount,
      cyclicExteriorSignature: observed.cyclicExteriorSignature,
      newBoxVolume: observed.newBoxVolume,
      harmonicRemainderMod17: observed.harmonicRemainderMod17,
      fourthCombinedTerm: observed.fourthCombinedTerm,
      constrainedStringCount: observed.constrainedStringCount,
      minEdgeSum: observed.minEdgeSum,
      durationMs: run.durationMs,
    },
  };
}

function scoreStructuredOutput(run: DiagnosticPromptRun): ModelCapabilityScore {
  const parsed = parseJsonCandidate(run.outputPreview || '');
  let score = run.status === 'passed' ? 10 : 0;
  const evidence: string[] = [];
  const data = parsed?.parsed;
  if (parsed) {
    score += 15;
    evidence.push('结构化输出可解析');
  }
  if (data?.title === 'relay_audit' && data?.version === 4) {
    score += 15;
    evidence.push('title/version 字段符合约定');
  }
  if (Array.isArray(data?.risks)
    && data.risks.length >= 5
    && data.risks.every((item: any) => item.id && item.category && item.level && item.owner && item.mitigation && typeof item.probability === 'number' && typeof item.impact === 'number' && Array.isArray(item.evidence))) {
    score += 25;
    evidence.push('risks 数组结构完整，包含 probability/impact/signals');
  }
  if (Array.isArray(data?.controls) && data.controls.length >= 5 && data.controls.every((item: any) => item.id && item.owner && item.action && item.gate && Array.isArray(item.covers) && item.successMetric)) {
    score += 20;
    evidence.push('actions 数组结构完整，包含 dependsOn/successMetric');
  }
  if (data?.summary?.safeToProxy === false && Array.isArray(data?.summary?.blockers) && data.summary.blockers.length >= 2 && typeof data.summary.confidence === 'number') {
    score += 15;
    evidence.push('summary 嵌套对象完整');
  }
  if (Array.isArray(data?.matrix) && data.matrix.length >= 4 && data.matrix.every((row: any) => row.surface && row.status && Array.isArray(row.riskIds) && Array.isArray(row.controlIds) && row.notes)) {
    score += 15;
    evidence.push('matrix 交叉引用结构完整');
  }
  if (data?.verification?.strategy === 'shadow' && Array.isArray(data.verification?.stages) && data.verification.stages.length >= 3) {
    score += 10;
    evidence.push('rollout canary 阶段结构完整');
  }
  const riskIds = new Set((Array.isArray(data?.risks) ? data.risks : []).map((item: any) => item.id));
  const referencesRisk = Array.isArray(data?.controls)
    && data.controls.some((control: any) => Array.isArray(control.covers) && control.covers.some((id: string) => riskIds.has(id)));
  if (referencesRisk) {
    score += 5;
    evidence.push('actions 正确引用 risks id');
  }
  if (evidence.length === 0) evidence.push('未命中约定结构');
  return {
    id: 'structured_output',
    label: '结构化输出',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? '复杂 schema 跟随良好' : '结构跟随或字段完整性不足',
    evidence,
    metrics: {
      validJson: Boolean(parsed),
      riskCount: Array.isArray(data?.risks) ? data.risks.length : 0,
      actionCount: Array.isArray(data?.controls) ? data.controls.length : 0,
      matrixCount: Array.isArray(data?.matrix) ? data.matrix.length : 0,
      rolloutStageCount: Array.isArray(data?.verification?.stages) ? data.verification.stages.length : 0,
      hasCrossReferences: Boolean(referencesRisk),
      durationMs: run.durationMs,
    },
  };
}

function normalizeConsistencyOutput(output?: string): string {
  const text = String(output || '').toUpperCase();
  const match = text.match(/BC[_\s-]*OVER[_\s-]*AD\s*=\s*([0-9]+(?:\s*\/\s*[0-9]+)?)/);
  if (match) return `BC_OVER_AD=${match[1].replace(/\s+/g, '')}`;
  if (/\b1\s*\/\s*3\b/.test(text)) return 'BC_OVER_AD=1/3';
  const decimal = text.match(/-?\d+(?:\.\d+)?/);
  if (decimal) {
    const parsed = Number(decimal[0]);
    if (Number.isFinite(parsed) && Math.abs(parsed - 1 / 3) <= 1e-3) return 'BC_OVER_AD=1/3';
  }
  return text.replace(/\s+/g, ' ').trim();
}

function scoreConsistency(first: DiagnosticPromptRun, second: DiagnosticPromptRun): ModelCapabilityScore {
  const a = normalizeConsistencyOutput(first.outputPreview);
  const b = normalizeConsistencyOutput(second.outputPreview);
  let score = 0;
  const evidence: string[] = [];
  if (first.status === 'passed') score += 15;
  if (second.status === 'passed') score += 15;
  if (a === 'BC_OVER_AD=1/3') {
    score += 25;
    evidence.push('第一次命中 BC_OVER_AD=1/3');
  }
  if (b === 'BC_OVER_AD=1/3') {
    score += 25;
    evidence.push('第二次命中 BC_OVER_AD=1/3');
  }
  if (a && a === b) {
    score += 20;
    evidence.push('两次输出归一化后一致');
  } else {
    evidence.push(`两次输出不一致：${a || '空'} / ${b || '空'}`);
  }
  return {
    id: 'consistency',
    label: '一致性检查',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? '重复探测结果一致' : '重复探测存在漂移',
    evidence,
    metrics: {
      first: a || null,
      second: b || null,
      firstDurationMs: first.durationMs,
      secondDurationMs: second.durationMs,
    },
  };
}

function scoreOutputSpeed(runs: DiagnosticPromptRun[]): ModelCapabilityScore {
  const completed = runs.filter((run) => run.status !== 'failed');
  const avgFirstText = average(completed.map((run) => run.firstTextMs).filter((value): value is number => typeof value === 'number'));
  const avgCps = average(completed.map((run) => run.charsPerSecond).filter((value): value is number => typeof value === 'number'));
  const successRate = runs.length > 0 ? completed.length / runs.length : 0;
  let score = successRate * 20;
  if (avgFirstText != null) {
    score += avgFirstText <= 1500 ? 40 : avgFirstText <= 4000 ? 30 : avgFirstText <= 8000 ? 20 : 10;
  }
  if (avgCps != null) {
    score += avgCps >= 80 ? 40 : avgCps >= 35 ? 30 : avgCps >= 15 ? 20 : 10;
  }
  return {
    id: 'output_speed',
    label: '输出速度',
    score: scoreCap(score),
    status: statusFromScore(score),
    summary: score >= 80 ? '首字延迟和输出吞吐表现良好' : '输出速度偏慢或流式事件不足',
    evidence: [
      `平均首个文本：${avgFirstText == null ? '--' : `${Math.round(avgFirstText)}ms`}`,
      `平均输出速度：${avgCps == null ? '--' : `${avgCps.toFixed(1)} chars/s`}`,
      `成功样本：${completed.length}/${runs.length}`,
    ],
    metrics: {
      averageFirstTextMs: avgFirstText == null ? null : Math.round(avgFirstText),
      averageCharsPerSecond: avgCps == null ? null : Number(avgCps.toFixed(2)),
      successRate: Number((successRate * 100).toFixed(2)),
    },
  };
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function tierFromScore(score: number): ModelEvaluationSummary['tier'] {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'stable';
  if (score >= 50) return 'usable';
  return 'weak';
}

function tierLabel(tier: ModelEvaluationSummary['tier']): string {
  if (tier === 'strong') return '强';
  if (tier === 'stable') return '稳';
  if (tier === 'usable') return '可用';
  return '弱';
}

const JSON_PROMPT: PromptSpec = {
  id: 'cap-json',
  label: 'JSON 输出',
  category: 'model-score',
  capabilityId: 'json_output',
  systemPrompt: '你是模型能力评测探针。严格输出用户要求的内容，不要解释。',
  prompt: '只输出一个 JSON 对象，不要 Markdown，不要额外文字。对象必须精确包含：{"profile":{"name":"relay-check","mode":"strict","sampleCount":4,"tags":["proxy","audit","stream"]},"checks":[{"id":"prompt_injection","severity":"high","passed":false},{"id":"context_truncation","severity":"medium","passed":true},{"id":"tool_substitution","severity":"high","passed":false},{"id":"sse_integrity","severity":"medium","passed":true}],"summary":{"risk":"HIGH","failed":2,"passed":2},"flags":{"leakDetected":true,"streamStable":true},"trace":["sys-guard","user-probe","relay-hop"],"checksum":"prompt_injection:false|tool_substitution:false|risk:HIGH"}。',
};

const CODE_PROMPT: PromptSpec = {
  id: 'cap-code',
  label: '代码生成',
  category: 'model-score',
  capabilityId: 'code_generation',
  timeoutMultiplier: 1.5,
  systemPrompt: '你是代码生成评测探针。输出应简洁、可读、可复制。',
  prompt: '用 TypeScript 写一个可复制的函数 auditRelayEvents(events: RelayEvent[], now: Date): AuditFinding[]。RelayEvent 包含 id:string、provider:string、endpoint:string、role:"system"|"user"|"assistant"|"tool"、type:"request"|"delta"|"result"|"tool_call"、content:string、createdAt:string、latencyMs?:number、parentId?:string、meta?:Record<string,unknown>。要求：按 id 去重且保留 createdAt 最新的一条；识别 promptInjection、toolSubstitution、missingDelta 三类风险；每条 finding 包含 id、risk、severity:"low"|"medium"|"high"、provider、endpoint、evidence、createdAt；按 severity 降序再 createdAt 升序排序；额外计算 byProvider 计数字段或等价聚合。请同时定义 RelayEvent 和 AuditFinding 类型。只输出代码块或代码本身。',
};

const DRAWING_PROMPT: PromptSpec = {
  id: 'cap-drawing-pelican',
  label: '骑车鹈鹕',
  category: 'model-score',
  capabilityId: 'drawing_pelican',
  systemPrompt: '你是 SVG 绘图能力评测探针。严格输出用户要求的内容，不要解释。',
  prompt: '只输出一个完整、可直接渲染的紧凑 SVG，不要 Markdown。画布必须是 360x240，viewBox 必须是 0 0 360 240。主体必须是一只正在骑自行车的鹈鹕，不是别的鸟，也不是拓扑图、流程图或示意框图。必须包含 <title>，且 title 同时出现 pelican 或 鹈鹕，以及 bicycle、bike 或 自行车。请用 id 或 class 明确标出 pelican-body、pelican-beak、pelican-pouch、pelican-wing、pelican-leg、bike-frame、front-wheel、rear-wheel、handlebar、seat、pedal。至少使用 10 个图形元素（path、circle、ellipse、polygon、polyline、line、rect 中任意组合），并保证两只车轮、车架、把手、车座、踏板、长喙、喉囊、翅膀和腿都可见。',
};

const MATH_PROMPT: PromptSpec = {
  id: 'cap-math',
  label: '数学能力',
  category: 'model-score',
  capabilityId: 'math',
  timeoutMultiplier: 2.5,
  systemPrompt: '你是数学能力评测探针。严格输出 JSON，不要解释，不要 Markdown。',
  prompt: '只输出 JSON，不要 Markdown，不要额外解释。下面 7 题均改写自 2022 AMC 10A 官方题面；除 steps 外其余字段都必须是数字。输出格式必须是 {"pairPartitionCount":0,"cyclicExteriorSignature":0,"newBoxVolume":0,"harmonicRemainderMod17":0,"fourthCombinedTerm":0,"constrainedStringCount":0,"minEdgeSum":0,"steps":["..."]}。题1：把整数 1 到 14 分成 7 对，且每对较大者至少是较小者的 2 倍，这样的分法有多少种？题2：圆内接四边形 ABCD 满足 AB=7, BC=24, CD=20, DA=15，圆内而四边形外的面积可写成 aπ-b/c，其中 a,c 互素，求 a+b+c。题3：多项式 10x^3-39x^2+29x-6 的三个根是长方体三条边；每条边都加长 2 后，新长方体体积是多少？题4：设 L17 是 1 到 17 的最小公倍数，且 1+1/2+...+1/17 = h/L17，求 h 除以 17 的余数。题5：一个四项正整数等差数列与一个四项正整数等比数列逐项相加，所得四项前 3 项是 57, 60, 91，第 4 项是多少？题6：用数字 0,1,2,3,4 组成长度 5 的字符串；对每个 j∈{1,2,3,4}，都至少有 j 个数字小于 j。这样的字符串有多少个？题7：格点正方形 R、S、T 的条件与 2022 AMC 10A 第 25 题一致：每个正方形底边都在 x 轴上，R 的左边在 y 轴上，S 的右边在 y 轴上，R 的格点数是 S 的 9/4 倍，T 的上方两个顶点在 R∪S 内，T 所含格点数是 R∪S 的 1/4，且 S 中落在 S∩T 的格点比例是 R 中落在 R∩T 的格点比例的 27 倍。求三者边长和的最小值。steps 至少 8 条，每条是简短字符串。',
};

const REASONING_PROMPT: PromptSpec = {
  id: 'cap-reasoning',
  label: '推理能力',
  category: 'model-score',
  capabilityId: 'reasoning',
  timeoutMultiplier: 2.25,
  systemPrompt: '你是推理能力评测探针。用 JSON 返回答案和步骤。',
  prompt: '只输出 JSON，不要 Markdown。下面 5 题均改写自 2022 AMC 10A 官方题面。输出格式必须是 {"truthTellers":0,"liars":0,"alternatersOddTruth":0,"alternatersEvenTruth":0,"truthCandyTotal":0,"repeatingIntegers":[0],"twoPassOrderings":0,"trapezoidRatio":"p/q","returnStep":0,"steps":["..."]}。题1：31 个孩子分为永远说真话、永远说假话、以及真话/假话交替三类。校长依次问三次：你是 truth-teller 吗？你是 alternater 吗？你是 liar 吗？三次回答 yes 的人数分别为 22、15、9。求 truthTellers、liars、alternatersOddTruth（第 1 题答真）、alternatersEvenTruth（第 1 题答假）以及 truthCandyTotal。题2：找出所有三位正整数 abc，其中 a,b,c 都是非零数字，且 0.abc循环 = (0.a循环 + 0.b循环 + 0.c循环)/3；把所有满足条件的整数按升序放进 repeatingIntegers。题3：编号 1 到 13 的卡片排成一行，从左到右反复扫描，每次按递增顺序捡起能捡的牌。恰好两轮捡完的排列有多少种？题4：等腰梯形 ABCD 中 AD ∥ BC 且 BC < AD，存在点 P 使得 PA=1, PB=2, PC=3, PD=4。求 BC/AD 的最简分数，填入 trapezoidRatio。题5：变换 Tk 先把平面绕原点逆时针旋转 k 度，再关于 y 轴对称；从点 (1,0) 开始依次执行 T1,T2,...,Tn，最小正整数 n 是多少时点回到自身？steps 至少 6 条，每条是简短字符串。',
};

const STRUCTURED_PROMPT: PromptSpec = {
  id: 'cap-structured',
  label: '结构化输出',
  category: 'model-score',
  capabilityId: 'structured_output',
  timeoutMultiplier: 1.75,
  systemPrompt: '你是结构化输出评测探针。严格遵守 schema。',
  prompt: '只输出 JSON，不要解释。schema: {"title":"relay_audit","version":4,"summary":{"safeToProxy":false,"decision":"block|monitor|allow","blockers":["R1","R2"],"confidence":0到1数字},"risks":[{"id":"R1","category":"prompt|tool|stream|auth|routing","level":"high|medium|low","owner":"...","probability":0到1数字,"impact":1到5数字,"evidence":["..."],"mitigation":"..."}],"controls":[{"id":"C1","owner":"...","action":"...","gate":"...","covers":["R1"],"successMetric":"..."}],"matrix":[{"surface":"chat|tool|stream|config","status":"pass|warn|fail","riskIds":["R1"],"controlIds":["C1"],"notes":"..."}],"verification":{"strategy":"shadow","stages":[{"sample":32,"gate":"..."},{"sample":128,"gate":"..."},{"sample":512,"gate":"..."}]}}。请给出 5 个 risks、5 个 controls、4 个 matrix 项；summary.safeToProxy 必须为 false，blockers 至少 2 条，controls/matrix 必须引用已有 risk/control id。',
};

const CONSISTENCY_PROMPT: PromptSpec = {
  id: 'cap-consistency',
  label: '一致性检查',
  category: 'model-score',
  capabilityId: 'consistency',
  timeoutMultiplier: 1.5,
  systemPrompt: '你是一致性评测探针。严格按格式回复。',
  prompt: '题目改写自 2022 AMC 10A：等腰梯形 ABCD 中 AD ∥ BC 且 BC < AD，存在点 P 使得 PA=1, PB=2, PC=3, PD=4。求 BC/AD 的最简分数。只回复 BC_OVER_AD=最简分数，不要解释。',
};

async function runCapabilityPrompt(
  engine: Engine,
  spec: PromptSpec,
  model: string,
  timeoutMs: number,
  log?: DiagnosticLogger,
  signal?: AbortSignal,
): Promise<DiagnosticPromptRun> {
  const effectiveTimeoutMs = promptTimeoutMs(timeoutMs, spec);
  throwIfAborted(signal);
  return runPrompt(engine, {
    ...basePromptOptions({ model, timeoutMs: effectiveTimeoutMs }),
    id: spec.id,
    label: spec.label,
    category: spec.category,
    agent: 'model-capability-diagnostics',
    step: spec.id,
    prompt: spec.prompt,
    systemPrompt: spec.systemPrompt,
  }, log, signal);
}

async function runModelEvaluation(
  engine: Engine,
  model: string,
  timeoutMs: number,
  selectedCapabilityIds: Set<string>,
  log?: DiagnosticLogger,
  onProgress?: (summary: ModelEvaluationSummary) => void,
  signal?: AbortSignal,
): Promise<ModelEvaluationSummary> {
  throwIfAborted(signal);
  const runs: DiagnosticPromptRun[] = [];
  const capabilities: ModelCapabilityScore[] = [];

  const buildSummary = (): ModelEvaluationSummary => {
    const fullCapabilities = runs.length > 0
      ? [scoreOutputSpeed(runs), ...capabilities]
      : [...capabilities];
    const overallScore = scoreCap(average(fullCapabilities.map((item) => item.score)) || 0);
    const tier = tierFromScore(overallScore);
    return {
      overallScore,
      tier,
      tierLabel: tierLabel(tier),
      capabilities: cloneSerializable(fullCapabilities),
      runs: cloneSerializable(runs),
    };
  };

  const emitProgress = () => {
    if (runs.length === 0 && capabilities.length === 0) return;
    onProgress?.(buildSummary());
  };

  log?.({
    message: '开始模型能力评测',
    detail: `模型 ${model || '默认模型'}；能力=${capabilitySelectionLabel(selectedCapabilityIds)}；基础超时=${timeoutMs}ms`,
  });

  const runSingleCapability = async (
    spec: PromptSpec,
    scorer: (run: DiagnosticPromptRun) => ModelCapabilityScore,
  ) => {
    if (!capabilityEnabled(selectedCapabilityIds, spec.capabilityId)) {
      log?.({ level: 'warning', message: `${spec.label} probe 已跳过`, detail: '本次未选择该能力' });
      return;
    }
    throwIfAborted(signal);
    const effectiveTimeoutMs = promptTimeoutMs(timeoutMs, spec);
    log?.({
      message: `开始${spec.label} probe`,
      detail: `capability=${spec.capabilityId}, timeout=${effectiveTimeoutMs}ms`,
    });
    const run = await runCapabilityPrompt(engine, spec, model, timeoutMs, log, signal);
    throwIfAborted(signal);
    runs.push(run);
    capabilities.push(scorer(run));
    log?.({
      level: logLevelFromStatus(run.status),
      message: `${spec.label} probe 完成`,
      detail: runLogDetail(run),
      fullDetail: runLogFullDetail(run),
    });
    emitProgress();
  };

  await runSingleCapability(JSON_PROMPT, scoreJsonOutput);
  await runSingleCapability(CODE_PROMPT, scoreCodeGeneration);
  await runSingleCapability(DRAWING_PROMPT, scorePelicanDrawing);
  await runSingleCapability(MATH_PROMPT, scoreMath);
  await runSingleCapability(REASONING_PROMPT, scoreReasoning);
  await runSingleCapability(STRUCTURED_PROMPT, scoreStructuredOutput);

  if (capabilityEnabled(selectedCapabilityIds, CONSISTENCY_PROMPT.capabilityId)) {
    throwIfAborted(signal);
    const consistencyTimeoutMs = promptTimeoutMs(timeoutMs, CONSISTENCY_PROMPT);
    log?.({ message: '开始一致性首轮 probe', detail: `capability=consistency, timeout=${consistencyTimeoutMs}ms` });
    const consistencyRunA = await runCapabilityPrompt(engine, CONSISTENCY_PROMPT, model, timeoutMs, log, signal);
    throwIfAborted(signal);
    log?.({ level: logLevelFromStatus(consistencyRunA.status), message: '一致性首轮 probe 完成', detail: runLogDetail(consistencyRunA), fullDetail: runLogFullDetail(consistencyRunA) });
    log?.({ message: '开始一致性复测 probe', detail: `capability=consistency, timeout=${consistencyTimeoutMs}ms` });
    const consistencyRunB = await runCapabilityPrompt(engine, { ...CONSISTENCY_PROMPT, id: 'cap-consistency-repeat', label: '一致性复测' }, model, timeoutMs, log, signal);
    throwIfAborted(signal);
    runs.push(consistencyRunA, consistencyRunB);
    capabilities.push(scoreConsistency(consistencyRunA, consistencyRunB));
    log?.({ level: logLevelFromStatus(consistencyRunB.status), message: '一致性复测 probe 完成', detail: runLogDetail(consistencyRunB), fullDetail: runLogFullDetail(consistencyRunB) });
    emitProgress();
  } else {
    log?.({ level: 'warning', message: '一致性检查 probe 已跳过', detail: '本次未选择该能力' });
  }

  const summary = buildSummary();
  log?.({
    level: summary.overallScore >= 50 ? 'success' : 'warning',
    message: '模型能力评测完成',
    detail: `quality=${summary.overallScore}/100 (${summary.tierLabel})`,
  });
  return summary;
}

export async function runModelDiagnostics(input: ModelDiagnosticsRequest, options: DiagnosticsRunOptions = {}): Promise<ModelDiagnosticsResponse> {
  const startedAtMs = Date.now();
  const { logs, log } = createLogCollector(startedAtMs, options.onLog);
  const signal = options.signal;
  const engineId = String(input.engine || 'claude-code').trim();
  const model = String(input.model || '').trim();
  const driver = normalizeDriver(input.driver);
  const timeoutMs = clampTimeoutMs(input.timeoutMs);
  const includeEngineDebug = input.includeEngineDebug !== false;
  const includeModelScore = input.includeModelScore !== false;
  const selectedCapabilityIds = normalizeCapabilityIds(input.modelCapabilityIds);

  log({
    message: '诊断任务已创建',
    detail: `engine=${engineId}, driver=${driver}, model=${model || '默认模型'}, timeout=${timeoutMs}ms, capabilities=${capabilitySelectionLabel(selectedCapabilityIds)}`,
  });
  throwIfAborted(signal);

  let engine: Engine | null = null;
  let effectiveEngine: string | undefined;
  let engineDebug: EngineDiagnosticSummary | undefined;
  let modelEvaluation: ModelEvaluationSummary | undefined;

  const emitProgress = (error?: string) => {
    options.onProgress?.({
      ok: Boolean(engineDebug?.available) && (!modelEvaluation || modelEvaluation.overallScore >= 50),
      engine: engineId,
      driver,
      model,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - startedAtMs,
      engineDebug: cloneSerializable(engineDebug),
      modelEvaluation: cloneSerializable(modelEvaluation),
      logs: cloneSerializable(logs),
      error,
    });
  };

  const availabilityStartedAt = Date.now();
  log({ message: '开始检查环境可用性', detail: driver === 'auto' ? engineId : `${engineId}/${driver}` });
  throwIfAborted(signal);
  let availability;
  try {
    availability = await getEngineAvailabilityReport(engineId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedAvailabilityStage = makeStage({
      id: 'availability',
      label: '环境可用性',
      startedAtMs: availabilityStartedAt,
      status: 'failed',
      detail: message,
    });
    log({
      level: 'error',
      message: '环境可用性检查失败',
      detail: message,
      fullDetail: error instanceof Error && error.stack ? error.stack : safeJson(error),
    });
    const finishedAtMs = Date.now();
    return {
      ok: false,
      engine: engineId,
      driver,
      model,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalDurationMs: finishedAtMs - startedAtMs,
      engineDebug: {
        engine: engineId,
        driver,
        available: false,
        streamSupported: false,
        observedEventTypes: [],
        stages: [failedAvailabilityStage],
        runs: [],
      },
      logs,
      error: message,
    };
  }
  const driverAvailability = driver === 'sdk' || driver === 'stdio' ? availability.drivers?.[driver] : undefined;
  const availabilityOk = driverAvailability ?? availability.available;
  const availabilityStage = makeStage({
    id: 'availability',
    label: '环境可用性',
    startedAtMs: availabilityStartedAt,
    status: availabilityOk ? 'passed' : 'failed',
    detail: driver === 'auto'
      ? `available=${availability.available}`
      : `${driver} available=${Boolean(driverAvailability)}`,
  });
  log({
    level: logLevelFromStatus(availabilityStage.status),
    message: '环境可用性检查完成',
    detail: availabilityStage.detail,
  });
  engineDebug = {
    engine: engineId,
    driver,
    effectiveEngine,
    available: availabilityOk,
    streamSupported: false,
    observedEventTypes: [],
    stages: [availabilityStage],
    runs: [],
  };
  emitProgress();

  const createStartedAt = Date.now();
  log({ message: '开始初始化引擎 wrapper', detail: driver === 'auto' ? '使用当前默认 driver' : `指定 ${driver}` });
  throwIfAborted(signal);
  let createStage: DiagnosticStage;
  try {
    const created = await instantiateDiagnosticEngine(engineId, driver);
    engine = created.engine;
    effectiveEngine = created.effectiveEngine;
    createStage = makeStage({
      id: 'create-engine',
      label: 'Wrapper 初始化',
      startedAtMs: createStartedAt,
      status: engine ? 'passed' : 'failed',
      detail: engine ? `effective=${effectiveEngine || engine.getName()}` : 'createEngine 返回 null',
    });
    log({
      level: logLevelFromStatus(createStage.status),
      message: '引擎 wrapper 初始化完成',
      detail: createStage.detail,
    });
    engineDebug = {
      engine: engineId,
      driver,
      effectiveEngine,
      available: availabilityOk && Boolean(engine),
      streamSupported: false,
      observedEventTypes: [],
      stages: [availabilityStage, createStage],
      runs: [],
    };
    emitProgress();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    createStage = makeStage({
      id: 'create-engine',
      label: 'Wrapper 初始化',
      startedAtMs: createStartedAt,
      status: 'failed',
      detail: message,
    });
    log({
      level: 'error',
      message: '引擎 wrapper 初始化失败',
      detail: message,
      fullDetail: error instanceof Error && error.stack ? error.stack : safeJson(error),
    });
    const finishedAtMs = Date.now();
    return {
      ok: false,
      engine: engineId,
      driver,
      model,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalDurationMs: finishedAtMs - startedAtMs,
      engineDebug: {
        engine: engineId,
        driver,
        effectiveEngine,
        available: false,
        streamSupported: false,
        observedEventTypes: [],
        stages: [availabilityStage, createStage],
        runs: [],
      },
      logs,
      error: message,
    };
  }

  if (!engine) {
    const finishedAtMs = Date.now();
    log({ level: 'error', message: '诊断终止', detail: '引擎不可用，无法执行后续 probe' });
    return {
      ok: false,
      engine: engineId,
      driver,
      model,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalDurationMs: finishedAtMs - startedAtMs,
      engineDebug: {
        engine: engineId,
        driver,
        effectiveEngine,
        available: false,
        streamSupported: false,
        observedEventTypes: [],
        stages: [availabilityStage, createStage],
        runs: [],
      },
      logs,
      error: '引擎不可用，无法执行诊断',
    };
  }

  try {
    if (includeEngineDebug) {
      throwIfAborted(signal);
      engineDebug = await runEngineDebug({
        engine,
        engineId,
        driver,
        effectiveEngine,
        model,
        timeoutMs,
        availabilityStage: {
          ...availabilityStage,
          detail: availabilityStage.detail || 'availability checked',
        },
        createStage,
        log,
        onProgress: (summary) => {
          engineDebug = summary;
          emitProgress();
        },
        signal,
      });
    } else {
      log({ level: 'warning', message: '引擎链路调试已跳过', detail: '只保留可用性与 wrapper 初始化结果' });
      engineDebug = {
        engine: engineId,
        driver,
        effectiveEngine,
        available: availabilityOk && Boolean(engine),
        streamSupported: false,
        observedEventTypes: [],
        stages: [availabilityStage, createStage],
        runs: [],
      };
      emitProgress();
    }

    if (includeModelScore) {
      throwIfAborted(signal);
      const scoreStartedAt = Date.now();
      modelEvaluation = await runModelEvaluation(engine, model, timeoutMs, selectedCapabilityIds, log, (summary) => {
        modelEvaluation = summary;
        emitProgress();
      }, signal);
      throwIfAborted(signal);
      engineDebug.stages.push(makeStage({
        id: 'model-score',
        label: '模型能力评测',
        startedAtMs: scoreStartedAt,
        status: modelEvaluation.overallScore >= 55 ? 'passed' : 'warning',
        detail: `quality=${modelEvaluation.overallScore}/100 (${modelEvaluation.tierLabel})`,
      }));
      emitProgress();
    } else {
      log({ level: 'warning', message: '模型能力评测已跳过' });
    }

    const finishedAtMs = Date.now();
    log({
      level: Boolean(engineDebug.available) && (!modelEvaluation || modelEvaluation.overallScore >= 50) ? 'success' : 'warning',
      message: '诊断任务完成',
      detail: `总耗时 ${finishedAtMs - startedAtMs}ms`,
    });
    return {
      ok: Boolean(engineDebug.available) && (!modelEvaluation || modelEvaluation.overallScore >= 50),
      engine: engineId,
      driver,
      model,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalDurationMs: finishedAtMs - startedAtMs,
      engineDebug,
      modelEvaluation,
      logs,
    };
  } catch (error) {
    const finishedAtMs = Date.now();
    log({
      level: 'error',
      message: '诊断任务异常',
      detail: error instanceof Error ? error.message : String(error),
    });
    return {
      ok: false,
      engine: engineId,
      driver,
      model,
      startedAt: new Date(startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      totalDurationMs: finishedAtMs - startedAtMs,
      engineDebug,
      modelEvaluation,
      logs,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      engine.cancel();
      (engine as any).cleanup?.();
    } catch {
      // Best-effort cleanup.
    }
  }
}

export const MODEL_DIAGNOSTIC_CAPABILITIES = [
  'output_speed',
  'json_output',
  'code_generation',
  'drawing_pelican',
  'math',
  'reasoning',
  'structured_output',
  'consistency',
] as const;
