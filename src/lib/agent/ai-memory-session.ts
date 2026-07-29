import type {
  MemoryLifecycleAnchor,
  MemoryRequestContext,
} from '@/lib/memory-v2';

export type AiMemoryContinuityIdentity =
  | {
      kind: 'frontend-session';
      frontendSessionId: string;
    }
  | {
      kind: 'workflow-run';
      runId: string;
      workflowId: string;
    };

export interface AiMemoryRuntimeRecovery {
  continuity: AiMemoryContinuityIdentity;
  runtimeSessionId?: string;
}

function requireStableId(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required for Memory V2 continuity`);
  return value.trim();
}

/**
 * Uses only durable frontend-session or workflow-run identity for short-memory
 * lookup. Runtime/provider session IDs are carried as opaque telemetry and are
 * never used as a Memory V2 scope key.
 */
export function createAiMemoryContinuityIdentity(input: {
  frontendSessionId?: string | null;
  runId?: string | null;
  workflowId?: string | null;
}): AiMemoryContinuityIdentity {
  const runId = typeof input.runId === 'string' ? input.runId.trim() : '';
  const workflowId = typeof input.workflowId === 'string' ? input.workflowId.trim() : '';
  if (runId || workflowId) {
    if (!runId || !workflowId) throw new Error('workflow Memory V2 continuity requires both runId and workflowId');
    return { kind: 'workflow-run', runId, workflowId };
  }
  return {
    kind: 'frontend-session',
    frontendSessionId: requireStableId(input.frontendSessionId, 'frontendSessionId'),
  };
}

export function applyAiMemoryContinuity(
  context: MemoryRequestContext,
  continuity: AiMemoryContinuityIdentity,
): MemoryRequestContext {
  if (continuity.kind === 'frontend-session') {
    if (context.sessionId && context.sessionId !== continuity.frontendSessionId) {
      throw new Error('Memory V2 session context must use the stable frontend session ID, not a runtime session ID');
    }
    return {
      ...context,
      sessionId: continuity.frontendSessionId,
    };
  }
  if (context.runId && context.runId !== continuity.runId) {
    throw new Error('Memory V2 run context does not match the stable workflow run ID');
  }
  if (context.workflowId && context.workflowId !== continuity.workflowId) {
    throw new Error('Memory V2 workflow context does not match the stable workflow ID');
  }
  const { sessionId: _runtimeSessionId, ...runContext } = context;
  return {
    ...runContext,
    runId: continuity.runId,
    workflowId: continuity.workflowId,
  };
}

export function memoryLifecycleAnchorForContinuity(
  continuity: AiMemoryContinuityIdentity,
): MemoryLifecycleAnchor {
  if (continuity.kind === 'frontend-session') {
    return { scopeType: 'session', sessionId: continuity.frontendSessionId };
  }
  return {
    scopeType: 'run',
    runId: continuity.runId,
    workflowId: continuity.workflowId,
  };
}

/**
 * Engine adapters call this after compaction/recovery. The new runtime session
 * is returned for engine reuse only; continuity remains bound to the original
 * frontend session or workflow run.
 */
export function preserveAiMemoryContinuityAfterRuntimeRecovery(input: {
  continuity: AiMemoryContinuityIdentity;
  runtimeSessionId?: string | null;
}): AiMemoryRuntimeRecovery {
  const runtimeSessionId = typeof input.runtimeSessionId === 'string' && input.runtimeSessionId.trim()
    ? input.runtimeSessionId.trim()
    : undefined;
  return {
    continuity: input.continuity,
    ...(runtimeSessionId ? { runtimeSessionId } : {}),
  };
}
