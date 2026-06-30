import { appendFile, mkdir } from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { getWorkspaceDataFile } from '@/lib/core/app-paths';
import { appendWorkflowAuditEvent } from '@/lib/workflow/audit-log';
import type { RuntimeDatabaseGrant } from '@/lib/runtime/database-capabilities';

export interface RuntimeDatabaseAuditInput {
  grant: RuntimeDatabaseGrant;
  skillName?: string;
  capability: 'rag' | 'sqlite';
  operation: string;
  target: string;
  status: 'success' | 'error';
  durationMs: number;
  inputSummary?: Record<string, unknown>;
  outputSummary?: Record<string, unknown>;
  error?: string;
}

export async function appendRuntimeDatabaseAudit(input: RuntimeDatabaseAuditInput): Promise<void> {
  const record = {
    id: `rda-${Date.now()}-${randomUUID().slice(0, 8)}`,
    timestamp: new Date().toISOString(),
    runId: input.grant.runId,
    chatSessionId: input.grant.chatSessionId,
    workflowConfigFile: input.grant.workflowConfigFile,
    skillName: input.skillName,
    capability: input.capability,
    operation: input.operation,
    target: input.target,
    status: input.status,
    durationMs: input.durationMs,
    inputSummary: input.inputSummary || {},
    outputSummary: input.outputSummary || {},
    error: input.error,
  };
  const file = getWorkspaceDataFile('runtime-database-audit.jsonl');
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`, 'utf-8');
  if (input.grant.runId) {
    await appendWorkflowAuditEvent({
      action: `runtime-database.${input.capability}.${input.operation}`,
      runId: input.grant.runId,
      configFile: input.grant.workflowConfigFile,
      details: record,
    }).catch(() => null);
  }
}
