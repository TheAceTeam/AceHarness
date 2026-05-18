import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { getWorkspaceDataDir, getWorkspaceDataFile } from '@/lib/core/app-paths';
import { getEngineDisplayName } from '@/lib/core/engine-metadata';
import { getModelOptions } from '@/lib/core/models';
import {
  createEngine,
  normalizeDriverSelection,
  resolveEffectiveEngine,
  type EngineDriver,
  type EngineType,
} from '@/lib/engines/engine-factory';
import type {
  CreateModelProbeInput,
  ModelProbeAvailabilityWindow,
  ModelProbeHealth,
  ModelProbeHistoryPoint,
  ModelProbeListResponse,
  ModelProbeListSummary,
  ModelProbeRecord,
  ModelProbeRunRecord,
  ModelProbeRunSource,
  ModelProbeRuntimeStatus,
  ModelProbeSummary,
  RecordModelProbeObservationInput,
  UpdateModelProbeInput,
} from '@/lib/models/probe-types';

const MODEL_PROBE_FILE = getWorkspaceDataFile('model-probes.json');
const DEFAULT_INTERVAL_MINUTES = 5;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_RUNS_PER_PROBE = 240;
const DEFAULT_HISTORY_LIMIT = 60;

const ENGINE_ENDPOINT_HINTS: Record<string, string[]> = {
  'claude-code': ['anthropic'],
  'claude-code-acp': ['anthropic'],
  'codex': ['openai'],
  'cangjie-magic': ['cangjie'],
};

let writeLock: Promise<void> = Promise.resolve();
const runningProbeIds = new Set<string>();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release!: () => void;
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(fn).finally(() => release());
}

function clampPositiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function toIsoString(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    const time = Date.parse(value);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return fallback;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
}

function previewText(value: string | undefined, maxLength = 160): string | undefined {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function normalizeStoredDriver(value: unknown, engine?: string): 'auto' | EngineDriver | undefined {
  if (value === 'auto') return 'auto';
  const normalized = normalizeDriverSelection(engine, typeof value === 'string' ? value : null);
  return normalized || undefined;
}

function normalizeRunRecord(item: unknown): ModelProbeRunRecord | null {
  if (!item || typeof item !== 'object') return null;
  const source = item as Record<string, unknown>;
  const startedAt = toIsoString(source.startedAt, new Date(0).toISOString());
  const finishedAt = toIsoString(source.finishedAt, startedAt);
  const runSource: ModelProbeRunSource = source.source === 'chat'
    ? 'chat'
    : source.source === 'agent-chat'
      ? 'agent-chat'
      : 'probe';
  const officialStatus: ModelProbeHealth = source.officialStatus === 'down'
    ? 'down'
    : source.officialStatus === 'degraded'
      ? 'degraded'
      : 'operational';

  return {
    id: typeof source.id === 'string' && source.id ? source.id : randomUUID(),
    startedAt,
    finishedAt,
    success: Boolean(source.success),
    engineAvailable: source.engineAvailable !== false,
    officialStatus,
    responseLatencyMs: clampPositiveInt(source.responseLatencyMs, 0, 0, 3600_000),
    availabilityCheckMs: source.availabilityCheckMs == null
      ? null
      : clampPositiveInt(source.availabilityCheckMs, 0, 0, 3600_000),
    totalDurationMs: clampPositiveInt(source.totalDurationMs, 0, 0, 3600_000),
    source: runSource,
    resolvedModel: typeof source.resolvedModel === 'string' ? source.resolvedModel : undefined,
    outputPreview: typeof source.outputPreview === 'string' ? source.outputPreview : undefined,
    error: typeof source.error === 'string' ? source.error : undefined,
  };
}

function normalizeProbeRecord(item: unknown): ModelProbeRecord | null {
  if (!item || typeof item !== 'object') return null;
  const source = item as Record<string, unknown>;
  const engine = String(source.engine || '').trim();
  const model = String(source.model || '').trim();
  if (!engine || !model) return null;

  const createdAt = toIsoString(source.createdAt, new Date().toISOString());
  const updatedAt = toIsoString(source.updatedAt, createdAt);
  const runs = Array.isArray(source.runs)
    ? source.runs.map(normalizeRunRecord).filter((item): item is ModelProbeRunRecord => Boolean(item))
    : [];

  return {
    id: typeof source.id === 'string' && source.id ? source.id : randomUUID(),
    groupId: typeof source.groupId === 'string' && source.groupId ? source.groupId : (typeof source.id === 'string' && source.id ? source.id : randomUUID()),
    groupName: typeof source.groupName === 'string' && source.groupName.trim()
      ? source.groupName.trim()
      : String(source.name || `${engine} / ${model}`),
    name: String(source.name || `${engine} / ${model}`),
    engine,
    driver: normalizeStoredDriver(source.driver, engine),
    model,
    endpoints: uniqueStrings(source.endpoints),
    intervalMinutes: clampPositiveInt(source.intervalMinutes, DEFAULT_INTERVAL_MINUTES, 1, 24 * 60),
    timeoutMs: clampPositiveInt(source.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 300_000),
    enabled: source.enabled !== false,
    note: typeof source.note === 'string' ? source.note.trim() || undefined : undefined,
    createdAt,
    updatedAt,
    lastRunAt: typeof source.lastRunAt === 'string' ? toIsoString(source.lastRunAt, updatedAt) : undefined,
    lastSuccessAt: typeof source.lastSuccessAt === 'string' ? toIsoString(source.lastSuccessAt, updatedAt) : undefined,
    running: Boolean(source.running),
    runs: runs
      .sort((a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt))
      .slice(0, MAX_RUNS_PER_PROBE),
  };
}

async function saveModelProbes(items: ModelProbeRecord[]): Promise<void> {
  await mkdir(getWorkspaceDataDir(), { recursive: true });
  await writeFile(MODEL_PROBE_FILE, JSON.stringify(items, null, 2), 'utf-8');
}

async function loadModelProbes(): Promise<ModelProbeRecord[]> {
  if (!existsSync(MODEL_PROBE_FILE)) return [];
  try {
    const raw = await readFile(MODEL_PROBE_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeProbeRecord)
      .filter((item): item is ModelProbeRecord => Boolean(item))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  } catch {
    return [];
  }
}

function buildFallbackEndpoints(engine: string): string[] {
  return ENGINE_ENDPOINT_HINTS[engine] ? [...ENGINE_ENDPOINT_HINTS[engine]] : [];
}

async function resolveProbeEndpoints(input: {
  endpoints?: string[];
  engine: string;
  model: string;
  currentProbe?: ModelProbeRecord;
}): Promise<string[]> {
  const explicit = uniqueStrings(input.endpoints);
  if (explicit.length > 0) return explicit;
  if (input.currentProbe?.endpoints?.length) return uniqueStrings(input.currentProbe.endpoints);

  const models = await getModelOptions().catch(() => []);
  const matched = models.find((item) => item.value === input.model);
  const fromModels = uniqueStrings(matched?.endpoints || []);
  if (fromModels.length > 0) return fromModels;
  return buildFallbackEndpoints(input.engine || input.currentProbe?.engine || '');
}

function computeAvailabilityWindow(runs: ModelProbeRunRecord[], days: number, nowMs: number): ModelProbeAvailabilityWindow {
  const threshold = nowMs - days * 24 * 60 * 60 * 1000;
  const relevant = runs.filter((run) => Date.parse(run.finishedAt) >= threshold);
  const successCount = relevant.filter((run) => run.success).length;
  const totalCount = relevant.length;
  const successRate = totalCount > 0 ? Number(((successCount / totalCount) * 100).toFixed(2)) : 0;
  return { successRate, successCount, totalCount };
}

function computeConsecutiveFailures(runs: ModelProbeRunRecord[]): number {
  let count = 0;
  for (const run of runs) {
    if (run.success) break;
    count += 1;
  }
  return count;
}

function computeNextRunAt(probe: ModelProbeRecord): string | null {
  if (!probe.enabled) return null;
  const latestFinishedAt = probe.runs[0]?.finishedAt || probe.lastRunAt;
  if (!latestFinishedAt) return probe.createdAt;
  const next = Date.parse(latestFinishedAt) + probe.intervalMinutes * 60 * 1000;
  return new Date(next).toISOString();
}

function computeProbeStatus(probe: ModelProbeRecord, latestRun: ModelProbeRunRecord | null): ModelProbeRuntimeStatus {
  if (!probe.enabled) return 'paused';
  if (probe.running || runningProbeIds.has(probe.id)) return 'running';
  if (!latestRun) return 'unknown';
  const consecutiveFailures = computeConsecutiveFailures(probe.runs);
  if (!latestRun.engineAvailable || consecutiveFailures >= 3) return 'down';
  if (!latestRun.success) return 'degraded';
  return latestRun.officialStatus;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizeObservationTimestamp(value?: string): string {
  return value ? toIsoString(value, new Date().toISOString()) : new Date().toISOString();
}

function inferObservationHealth(success: boolean, engineAvailable: boolean): ModelProbeHealth {
  if (!engineAvailable) return 'down';
  return success ? 'operational' : 'degraded';
}

function inferEngineAvailability(message: string | undefined, fallback = true): boolean {
  const normalized = String(message || '').toLowerCase();
  if (!normalized) return fallback;
  if (
    normalized.includes('引擎不可用')
    || normalized.includes('engine unavailable')
    || normalized.includes('not available')
    || normalized.includes('missing api key')
    || normalized.includes('认证失败')
  ) {
    return false;
  }
  return fallback;
}

function buildHistory(runs: ModelProbeRunRecord[], limit: number): ModelProbeHistoryPoint[] {
  return runs.slice(0, limit).map((run) => ({
    at: run.finishedAt,
    status: run.success ? run.officialStatus : (run.engineAvailable ? 'degraded' : 'down'),
    success: run.success,
    responseLatencyMs: run.responseLatencyMs || null,
  }));
}

function isProbeDue(probe: ModelProbeRecord, nowMs = Date.now()): boolean {
  if (!probe.enabled) return false;
  if (probe.running || runningProbeIds.has(probe.id)) return false;
  const nextRunAt = computeNextRunAt(probe);
  if (!nextRunAt) return false;
  return Date.parse(nextRunAt) <= nowMs;
}

async function summarizeProbe(probe: ModelProbeRecord, historyLimit: number): Promise<ModelProbeSummary> {
  const nowMs = Date.now();
  const latestRun = probe.runs[0] || null;
  const matchingModels = await getModelOptions().catch(() => []);
  const matchedModel = matchingModels.find((item) => item.value === probe.model);
  const endpoints = probe.endpoints.length > 0
    ? uniqueStrings(probe.endpoints)
    : uniqueStrings(matchedModel?.endpoints || buildFallbackEndpoints(probe.engine));
  const status = computeProbeStatus(probe, latestRun);

  return {
    id: probe.id,
    groupId: probe.groupId,
    groupName: probe.groupName,
    name: probe.name,
    engine: probe.engine,
    engineLabel: getEngineDisplayName(probe.engine),
    driver: probe.driver,
    model: probe.model,
    endpoints,
    intervalMinutes: probe.intervalMinutes,
    timeoutMs: probe.timeoutMs,
    enabled: probe.enabled,
    note: probe.note,
    createdAt: probe.createdAt,
    updatedAt: probe.updatedAt,
    lastRunAt: probe.lastRunAt,
    lastSuccessAt: probe.lastSuccessAt,
    running: probe.running || runningProbeIds.has(probe.id),
    status,
    consecutiveFailures: computeConsecutiveFailures(probe.runs),
    nextRunAt: computeNextRunAt(probe),
    latestRun,
    availability: {
      days7: computeAvailabilityWindow(probe.runs, 7, nowMs),
      days15: computeAvailabilityWindow(probe.runs, 15, nowMs),
      days30: computeAvailabilityWindow(probe.runs, 30, nowMs),
    },
    averageResponseLatencyMs: average(probe.runs.slice(0, 20).map((run) => run.responseLatencyMs).filter((value) => value > 0)),
    averageAvailabilityCheckMs: average(
      probe.runs
        .slice(0, 20)
        .map((run) => run.availabilityCheckMs)
        .filter((value): value is number => typeof value === 'number' && value > 0),
    ),
    history: buildHistory(probe.runs, historyLimit),
  };
}

async function summarizeProbeList(probes: ModelProbeRecord[], historyLimit: number): Promise<ModelProbeListResponse> {
  const summaries = await Promise.all(
    probes.map((probe) => summarizeProbe(probe, historyLimit)),
  );
  const summary: ModelProbeListSummary = {
    total: summaries.length,
    enabled: summaries.filter((probe) => probe.enabled).length,
    running: summaries.filter((probe) => probe.status === 'running').length,
    operational: summaries.filter((probe) => probe.status === 'operational').length,
    degraded: summaries.filter((probe) => probe.status === 'degraded').length,
    down: summaries.filter((probe) => probe.status === 'down').length,
    paused: summaries.filter((probe) => probe.status === 'paused').length,
    unknown: summaries.filter((probe) => probe.status === 'unknown').length,
    lastUpdatedAt: summaries.reduce<string | null>((latest, probe) => {
      if (!latest) return probe.updatedAt;
      return Date.parse(probe.updatedAt) > Date.parse(latest) ? probe.updatedAt : latest;
    }, null),
    nextRunAt: summaries
      .map((probe) => probe.nextRunAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => Date.parse(a) - Date.parse(b))[0] || null,
    minIntervalMinutes: summaries
      .filter((probe) => probe.enabled)
      .reduce<number | null>((min, probe) => {
        if (min === null) return probe.intervalMinutes;
        return Math.min(min, probe.intervalMinutes);
      }, null),
  };

  return { probes: summaries, summary };
}

async function getProbeRecord(id: string): Promise<ModelProbeRecord | null> {
  const probes = await loadModelProbes();
  return probes.find((probe) => probe.id === id) || null;
}

async function setProbeRunning(id: string, running: boolean): Promise<ModelProbeRecord | null> {
  return withLock(async () => {
    const probes = await loadModelProbes();
    const index = probes.findIndex((probe) => probe.id === id);
    if (index < 0) return null;
    probes[index] = {
      ...probes[index],
      running,
      updatedAt: new Date().toISOString(),
    };
    await saveModelProbes(probes);
    return probes[index];
  });
}

function buildProbeExecutionFailure(input: {
  startedAt: number;
  availabilityCheckMs: number;
  message: string;
  engineAvailable: boolean;
}): ModelProbeRunRecord {
  const finishedAt = new Date().toISOString();
  return {
    id: randomUUID(),
    startedAt: new Date(input.startedAt).toISOString(),
    finishedAt,
    success: false,
    engineAvailable: input.engineAvailable,
    officialStatus: input.engineAvailable ? 'degraded' : 'down',
    responseLatencyMs: 0,
    availabilityCheckMs: input.availabilityCheckMs,
    totalDurationMs: Date.now() - input.startedAt,
    source: 'probe',
    error: input.message,
  };
}

async function executeProbeRun(probe: ModelProbeRecord): Promise<ModelProbeRunRecord> {
  const startedAt = Date.now();
  const availabilityStartedAt = Date.now();
  const effectiveEngine = probe.driver && probe.driver !== 'auto'
    ? resolveEffectiveEngine(probe.engine, probe.driver)
    : probe.engine;
  const engine = await createEngine((effectiveEngine || probe.engine) as EngineType);
  const availabilityCheckMs = Date.now() - availabilityStartedAt;

  if (!engine) {
    return buildProbeExecutionFailure({
      startedAt,
      availabilityCheckMs,
      message: `${getEngineDisplayName(probe.engine)} 当前不可用`,
      engineAvailable: false,
    });
  }

  try {
    const responseStartedAt = Date.now();
    const result = await engine.execute({
      agent: 'model-probe-monitor',
      step: 'availability-check',
      prompt: 'Reply with exactly OK.',
      systemPrompt: 'You are a health probe. Reply with exactly OK.',
      model: probe.model,
      workingDirectory: process.cwd(),
      timeoutMs: probe.timeoutMs,
    });
    const responseLatencyMs = Date.now() - responseStartedAt;
    const preview = previewText(result.output);
    const normalized = String(result.output || '').trim();
    const success = result.success && (/^OK\b/i.test(normalized) || normalized.length > 0);

    return {
      id: randomUUID(),
      startedAt: new Date(startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      success,
      engineAvailable: true,
      officialStatus: success ? 'operational' : 'degraded',
      responseLatencyMs,
      availabilityCheckMs,
      totalDurationMs: Date.now() - startedAt,
      source: 'probe',
      resolvedModel: typeof result.metadata?.resolvedModel === 'string' ? result.metadata.resolvedModel : undefined,
      outputPreview: preview,
      error: success ? undefined : (result.error || '探针调用未返回预期结果'),
    };
  } catch (error) {
    return buildProbeExecutionFailure({
      startedAt,
      availabilityCheckMs,
      message: error instanceof Error ? error.message : String(error),
      engineAvailable: true,
    });
  } finally {
    try {
      (engine as any).cleanup?.();
    } catch {
      // ignore cleanup failures
    }
  }
}

async function appendProbeRun(id: string, run: ModelProbeRunRecord): Promise<ModelProbeRecord> {
  return withLock(async () => {
    const probes = await loadModelProbes();
    const index = probes.findIndex((probe) => probe.id === id);
    if (index < 0) {
      throw new Error('探针不存在');
    }
    const previous = probes[index];
    const updated: ModelProbeRecord = {
      ...previous,
      running: false,
      updatedAt: run.finishedAt,
      lastRunAt: run.finishedAt,
      lastSuccessAt: run.success ? run.finishedAt : previous.lastSuccessAt,
      runs: [run, ...previous.runs].slice(0, MAX_RUNS_PER_PROBE),
    };
    probes[index] = updated;
    await saveModelProbes(probes);
    return updated;
  });
}

export async function recordModelProbeObservation(input: RecordModelProbeObservationInput): Promise<number> {
  const engine = String(input.engine || '').trim();
  const model = String(input.resolvedModel || input.model || '').trim();
  if (!engine || !model) return 0;

  const finishedAt = normalizeObservationTimestamp(input.occurredAt);
  const responseLatencyMs = clampPositiveInt(input.responseLatencyMs, 0, 0, 3600_000);
  const totalDurationMs = clampPositiveInt(
    input.totalDurationMs ?? input.responseLatencyMs,
    responseLatencyMs,
    0,
    3600_000,
  );
  const startedAt = new Date(Date.parse(finishedAt) - totalDurationMs).toISOString();
  const engineAvailable = input.engineAvailable ?? inferEngineAvailability(input.error, true);
  const officialStatus = input.officialStatus || inferObservationHealth(input.success, engineAvailable);
  const source: ModelProbeRunSource = input.source === 'agent-chat'
    ? 'agent-chat'
    : input.source === 'chat'
      ? 'chat'
      : 'probe';

  return withLock(async () => {
    const probes = await loadModelProbes();
    let updatedCount = 0;

    for (let index = 0; index < probes.length; index += 1) {
      const previous = probes[index];
      if (previous.engine !== engine || previous.model !== model || !previous.enabled) continue;

      const run: ModelProbeRunRecord = {
        id: randomUUID(),
        startedAt,
        finishedAt,
        success: input.success,
        engineAvailable,
        officialStatus,
        responseLatencyMs,
        availabilityCheckMs: input.availabilityCheckMs ?? null,
        totalDurationMs,
        source,
        resolvedModel: model,
        outputPreview: previewText(input.outputPreview),
        error: input.error ? previewText(input.error, 240) : undefined,
      };

      probes[index] = {
        ...previous,
        updatedAt: finishedAt,
        lastRunAt: finishedAt,
        lastSuccessAt: input.success ? finishedAt : previous.lastSuccessAt,
        runs: [run, ...previous.runs].slice(0, MAX_RUNS_PER_PROBE),
      };
      updatedCount += 1;
    }

    if (updatedCount > 0) {
      await saveModelProbes(probes);
    }
    return updatedCount;
  });
}

export async function listModelProbes(options?: {
  refreshDue?: boolean;
  forceRunAll?: boolean;
  historyLimit?: number;
}): Promise<ModelProbeListResponse> {
  const historyLimit = clampPositiveInt(options?.historyLimit, DEFAULT_HISTORY_LIMIT, 1, 240);
  if (options?.forceRunAll) {
    await runModelProbes({ force: true });
  } else if (options?.refreshDue) {
    await runModelProbes({ dueOnly: true });
  }

  const probes = await loadModelProbes();
  return summarizeProbeList(probes, historyLimit);
}

export async function getModelProbe(id: string, historyLimit = DEFAULT_HISTORY_LIMIT): Promise<ModelProbeSummary | null> {
  const probe = await getProbeRecord(id);
  if (!probe) return null;
  return summarizeProbe(probe, clampPositiveInt(historyLimit, DEFAULT_HISTORY_LIMIT, 1, 240));
}

export async function createModelProbe(input: CreateModelProbeInput): Promise<ModelProbeSummary> {
  const now = new Date().toISOString();
  const engine = String(input.engine || '').trim();
  const model = String(input.model || '').trim();
  if (!engine) throw new Error('engine is required');
  if (!model) throw new Error('model is required');

  const draft: ModelProbeRecord = {
    id: randomUUID(),
    groupId: String(input.groupId || '').trim() || randomUUID(),
    groupName: String(input.groupName || input.name || `${getEngineDisplayName(engine)} Group`).trim(),
    name: String(input.name || `${getEngineDisplayName(engine)} / ${model}`).trim(),
    engine,
    driver: normalizeStoredDriver(input.driver, engine),
    model,
    endpoints: await resolveProbeEndpoints({ endpoints: input.endpoints, engine, model }),
    intervalMinutes: clampPositiveInt(input.intervalMinutes, DEFAULT_INTERVAL_MINUTES, 1, 24 * 60),
    timeoutMs: clampPositiveInt(input.timeoutMs, DEFAULT_TIMEOUT_MS, 5_000, 300_000),
    enabled: input.enabled !== false,
    note: typeof input.note === 'string' ? input.note.trim() || undefined : undefined,
    createdAt: now,
    updatedAt: now,
    runs: [],
  };

  await withLock(async () => {
    const probes = await loadModelProbes();
    probes.unshift(draft);
    await saveModelProbes(probes);
  });

  return summarizeProbe(draft, DEFAULT_HISTORY_LIMIT);
}

export async function updateModelProbe(id: string, patch: UpdateModelProbeInput): Promise<ModelProbeSummary> {
  const updated = await withLock(async () => {
    const probes = await loadModelProbes();
    const index = probes.findIndex((probe) => probe.id === id);
    if (index < 0) throw new Error('探针不存在');

    const previous = probes[index];
    const nextEngine = typeof patch.engine === 'string' && patch.engine.trim() ? patch.engine.trim() : previous.engine;
    const nextModel = typeof patch.model === 'string' && patch.model.trim() ? patch.model.trim() : previous.model;
    const nextDriver = patch.driver === 'auto'
      ? 'auto'
      : normalizeStoredDriver(patch.driver, nextEngine) ?? previous.driver;
    const nextGroupId = typeof patch.groupId === 'string' && patch.groupId.trim() ? patch.groupId.trim() : previous.groupId;
    const nextGroupName = typeof patch.groupName === 'string' && patch.groupName.trim() ? patch.groupName.trim() : previous.groupName;
    const next: ModelProbeRecord = {
      ...previous,
      groupId: nextGroupId,
      groupName: nextGroupName,
      name: typeof patch.name === 'string' && patch.name.trim()
        ? patch.name.trim()
        : previous.name,
      engine: nextEngine,
      driver: nextDriver,
      model: nextModel,
      endpoints: await resolveProbeEndpoints({
        endpoints: patch.endpoints,
        engine: nextEngine,
        model: nextModel,
        currentProbe: { ...previous, engine: nextEngine },
      }),
      intervalMinutes: patch.intervalMinutes == null
        ? previous.intervalMinutes
        : clampPositiveInt(patch.intervalMinutes, previous.intervalMinutes, 1, 24 * 60),
      timeoutMs: patch.timeoutMs == null
        ? previous.timeoutMs
        : clampPositiveInt(patch.timeoutMs, previous.timeoutMs, 5_000, 300_000),
      enabled: patch.enabled == null ? previous.enabled : Boolean(patch.enabled),
      note: typeof patch.note === 'string' ? patch.note.trim() || undefined : previous.note,
      updatedAt: new Date().toISOString(),
    };
    probes[index] = next;
    await saveModelProbes(probes);
    return next;
  });

  return summarizeProbe(updated, DEFAULT_HISTORY_LIMIT);
}

export async function deleteModelProbe(id: string): Promise<boolean> {
  return withLock(async () => {
    const probes = await loadModelProbes();
    const next = probes.filter((probe) => probe.id !== id);
    if (next.length === probes.length) return false;
    await saveModelProbes(next);
    return true;
  });
}

export async function runModelProbe(id: string, options?: { force?: boolean }): Promise<ModelProbeSummary> {
  if (runningProbeIds.has(id)) {
    const current = await getModelProbe(id);
    if (!current) throw new Error('探针不存在');
    return current;
  }

  const probe = await getProbeRecord(id);
  if (!probe) throw new Error('探针不存在');
  if (!options?.force && (!probe.enabled || !isProbeDue(probe))) {
    return summarizeProbe(probe, DEFAULT_HISTORY_LIMIT);
  }

  runningProbeIds.add(id);
  await setProbeRunning(id, true);

  try {
    const run = await executeProbeRun(probe);
    const updated = await appendProbeRun(id, run);
    return summarizeProbe(updated, DEFAULT_HISTORY_LIMIT);
  } finally {
    runningProbeIds.delete(id);
    await setProbeRunning(id, false).catch(() => null);
  }
}

export async function runModelProbes(options?: {
  ids?: string[];
  dueOnly?: boolean;
  force?: boolean;
}): Promise<{
  executed: string[];
  skipped: string[];
  data: ModelProbeListResponse;
}> {
  const probes = await loadModelProbes();
  const requestedIds = Array.isArray(options?.ids)
    ? new Set(options?.ids.map((value) => String(value || '').trim()).filter(Boolean))
    : null;

  const candidates = probes.filter((probe) => {
    if (requestedIds && !requestedIds.has(probe.id)) return false;
    if (options?.force) return requestedIds ? true : probe.enabled;
    if (options?.dueOnly) return isProbeDue(probe);
    return probe.enabled;
  });

  const executed: string[] = [];
  const skipped: string[] = [];

  for (const probe of candidates) {
    try {
      const summary = await runModelProbe(probe.id, { force: options?.force });
      if (summary.lastRunAt === probe.lastRunAt && !summary.running) {
        skipped.push(probe.id);
      } else {
        executed.push(probe.id);
      }
    } catch {
      skipped.push(probe.id);
    }
  }

  const data = await listModelProbes();
  return { executed, skipped, data };
}

export const MODEL_PROBE_DEFAULTS = {
  intervalMinutes: DEFAULT_INTERVAL_MINUTES,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  historyLimit: DEFAULT_HISTORY_LIMIT,
} as const;
