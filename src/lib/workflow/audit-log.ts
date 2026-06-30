import { mkdir, readFile, appendFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { randomUUID } from 'crypto';
import { getWorkspaceRunsDir } from '@/lib/core/app-paths';

export interface WorkflowAuditEvent {
  id: string;
  timestamp: string;
  action: string;
  runId?: string;
  rootRunId?: string;
  childRunId?: string;
  configFile?: string;
  actorId?: string;
  actorName?: string;
  requestId?: string;
  ip?: string;
  userAgent?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  details?: Record<string, unknown>;
}

function auditPath(runId: string) {
  return resolve(getWorkspaceRunsDir(), runId, 'audit.jsonl');
}

export function getWorkflowAuditRequestMeta(request: Request) {
  return {
    requestId: request.headers.get('x-request-id') || request.headers.get('x-correlation-id') || randomUUID(),
    ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
  };
}

export async function appendWorkflowAuditEvent(input: Omit<WorkflowAuditEvent, 'id' | 'timestamp'>): Promise<WorkflowAuditEvent | null> {
  const runId = input.runId || input.rootRunId || input.childRunId;
  if (!runId) return null;
  const event: WorkflowAuditEvent = {
    id: `wfa-${Date.now()}-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    ...input,
  };
  const file = auditPath(runId);
  await mkdir(resolve(file, '..'), { recursive: true });
  await appendFile(file, `${JSON.stringify(event)}\n`, 'utf-8');
  return event;
}

export async function readWorkflowAuditEvents(runId: string, options: { limit?: number } = {}): Promise<WorkflowAuditEvent[]> {
  const raw = await readFile(auditPath(runId), 'utf-8').catch(() => '');
  const events = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as WorkflowAuditEvent;
      } catch {
        return null;
      }
    })
    .filter((event): event is WorkflowAuditEvent => Boolean(event));
  const limit = Math.max(1, Math.min(options.limit || 500, 200000));
  return events.slice(-limit);
}

export async function pruneWorkflowAuditLog(
  runId: string,
  options: { maxEvents?: number; maxAgeMs?: number; now?: Date } = {}
): Promise<{ runId: string; before: number; after: number; pruned: number }> {
  const events = await readWorkflowAuditEvents(runId, { limit: 200000 });
  const before = events.length;
  const maxEvents = Math.max(1, options.maxEvents || 1000);
  const cutoff = typeof options.maxAgeMs === 'number'
    ? (options.now || new Date()).getTime() - Math.max(0, options.maxAgeMs)
    : null;
  let retained = cutoff === null
    ? events
    : events.filter((event) => {
        const ts = new Date(event.timestamp).getTime();
        return !Number.isFinite(ts) || ts >= cutoff;
      });
  retained = retained.slice(-maxEvents);
  const file = auditPath(runId);
  await mkdir(resolve(file, '..'), { recursive: true });
  await writeFile(file, retained.map((event) => JSON.stringify(event)).join('\n') + (retained.length ? '\n' : ''), 'utf-8');
  return {
    runId,
    before,
    after: retained.length,
    pruned: Math.max(0, before - retained.length),
  };
}
