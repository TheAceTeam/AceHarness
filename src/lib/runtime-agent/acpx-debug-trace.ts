import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';

export type AcpxDebugTraceStage =
  | 'acpx.raw_event'
  | 'acpx.turn_result'
  | 'adapter.normalized_event'
  | 'chat.formatted_chunk'
  | 'chat.turn_result'
  | 'runtime.formatted_chunk'
  | 'chat.stream.registered'
  | 'chat.stream.append'
  | 'chat.stream.session'
  | 'chat.stream.thought'
  | 'chat.stream.error'
  | 'chat.stream.check_active'
  | 'chat.stream.sse_send'
  | 'chat.stream.final_payload';

export interface AcpxDebugTraceContext {
  runtimeSessionId?: string;
  frontendSessionId?: string;
  chatId?: string;
  turnId?: string;
  requestId?: string;
  traceId?: string;
  agentId?: string;
  runtime?: string;
}

export interface AcpxDebugTraceEntry {
  stage: AcpxDebugTraceStage;
  context?: AcpxDebugTraceContext;
  payload: unknown;
}

let cachedEnabled = false;
let cachedCheckedAt = 0;
let cachedMtimeMs = -1;

export function isAcpxDebugTraceEnabled(): boolean {
  const envValue = process.env.CSIHARNESS_ACPX_DEBUG_TRACE?.trim().toLowerCase();
  if (envValue === '1' || envValue === 'true') return true;
  if (envValue === '0' || envValue === 'false' || envValue === 'no' || envValue === 'off') return false;

  const now = Date.now();
  if (now - cachedCheckedAt < 2000) return cachedEnabled;
  cachedCheckedAt = now;

  try {
    const settingsPath = getWorkspaceDataFile('system-settings.yaml');
    const stat = statSync(settingsPath);
    if (stat.mtimeMs === cachedMtimeMs) return cachedEnabled;
    cachedMtimeMs = stat.mtimeMs;
    const parsed = parse(readFileSync(settingsPath, 'utf8'));
    cachedEnabled = Boolean(parsed?.runtimeDebug?.acpxTraceEnabled);
  } catch {
    cachedEnabled = false;
    cachedMtimeMs = -1;
  }
  return cachedEnabled;
}

export function getAcpxDebugTraceDirectory(): string {
  return getWorkspaceDataFile('acpx-debug-traces');
}

export function writeAcpxDebugTrace(entry: AcpxDebugTraceEntry): void {
  if (!isAcpxDebugTraceEnabled()) return;

  try {
    const directory = getAcpxDebugTraceDirectory();
    mkdirSync(directory, { recursive: true });
    appendFileSync(traceFilePath(directory, entry.context), `${stableStringify({
      timestamp: new Date().toISOString(),
      stage: entry.stage,
      context: entry.context,
      payload: entry.payload,
    })}\n`, 'utf8');
  } catch {
    // Debug tracing must never affect runtime execution.
  }
}

function traceFilePath(directory: string, context: AcpxDebugTraceContext | undefined): string {
  const session = safeSegment(context?.runtimeSessionId) || safeSegment(context?.frontendSessionId) || safeSegment(context?.chatId) || 'unknown-session';
  const turn = safeSegment(context?.turnId) || safeSegment(context?.requestId) || safeSegment(context?.chatId) || 'session';
  return join(directory, `${session}__${turn}.ndjson`);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, child) => {
    if (typeof child === 'bigint') return child.toString();
    if (child instanceof Error) {
      return {
        name: child.name,
        message: child.message,
        stack: child.stack,
      };
    }
    return child;
  });
}

function safeSegment(value: string | undefined): string {
  return String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 120);
}
