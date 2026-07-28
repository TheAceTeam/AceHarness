import { requireAuth, type AuthenticatedUser } from '@/lib/auth/middleware';
import {
  MemoryServiceError,
  type MemoryHandoffReceiptRecord,
  type MemoryHandoffRecord,
  type MemoryRequestContext,
  type MemoryService,
} from '@/lib/memory-v2';
import { ensureMemoryV2FreshStart } from '@/lib/memory-v2-cutover/feature-flag';
import { loadRunState, type PersistedRunState } from '@/lib/run/state-persistence';
import { canAccessRunState, getRunOwnerId } from '@/lib/workflow/run-access';
import { jsonError } from '@/server/api-route-runtime/request-utils';

export interface AuthorizedWorkflowHandoffRun {
  auth: AuthenticatedUser;
  runId: string;
  runState: PersistedRunState;
}

export type HandoffDetailAccess =
  | { state: 'allowed'; mode: 'admin' | 'owner' }
  | { state: 'denied'; reason: 'requires-run-owner-or-admin' };

export function parseWorkflowHandoffRouteId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 320 || /[\u0000-\u001f]/.test(normalized)) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} is invalid`);
  }
  return normalized;
}

export async function authorizeWorkflowHandoffRun(
  request: Request,
  runId: string,
  capability: 'view' | 'review' = 'view',
): Promise<AuthorizedWorkflowHandoffRun | Response> {
  const auth = await requireAuth(request);
  if (auth instanceof Response) return auth;
  const runState = await loadRunState(runId, { hydrateLargeOutputs: false });
  if (!runState) return jsonError('Workflow run was not found', 404);
  if (!canAccessRunState(auth, runState, capability)) {
    return jsonError('Workflow run access is denied', 403);
  }
  return { auth, runId, runState };
}

/**
 * Reconciles the persisted workflow owner with the server-owned Memory V2
 * participant snapshot before either handoff route exposes run state.
 */
export function createAuthorizedWorkflowHandoffReadContext(input: {
  service: Pick<MemoryService, 'createServerHandoffRunReadContext'>;
  authorized: AuthorizedWorkflowHandoffRun;
}): { context: MemoryRequestContext } | undefined {
  const serverContext = input.service.createServerHandoffRunReadContext(input.authorized.runId);
  const runOwnerId = getRunOwnerId(input.authorized.runState);
  if (!runOwnerId) {
    throw new MemoryServiceError('MEMORY_CONFLICT', 'workflow handoff access requires a persisted workflow run owner');
  }
  if (serverContext && serverContext.context.ownerUserId !== runOwnerId) {
    throw new MemoryServiceError('MEMORY_CONFLICT', 'workflow handoff participant ownership does not match the persisted workflow run owner');
  }
  return serverContext;
}

export async function ensureMemoryV2WorkflowHandoffReady(): Promise<Response | undefined> {
  const status = await ensureMemoryV2FreshStart();
  if (status.ready) return undefined;
  return jsonError(status.reason || 'Memory V2 is unavailable', 409);
}

export function resolveHandoffDetailAccess(input: {
  auth: AuthenticatedUser;
  runState: PersistedRunState;
  ownerUserId: string;
}): HandoffDetailAccess {
  const runOwnerId = getRunOwnerId(input.runState);
  if (!runOwnerId || runOwnerId !== input.ownerUserId) {
    return { state: 'denied', reason: 'requires-run-owner-or-admin' };
  }
  if (input.auth.role === 'admin') return { state: 'allowed', mode: 'admin' };
  if (runOwnerId === input.auth.id) return { state: 'allowed', mode: 'owner' };
  return { state: 'denied', reason: 'requires-run-owner-or-admin' };
}

export function createHandoffOwnerReviewContext(
  context: MemoryRequestContext,
  auth: AuthenticatedUser,
): MemoryRequestContext {
  return {
    ownerUserId: context.ownerUserId,
    workspaceId: context.workspaceId,
    actor: 'reviewer',
    actorId: `memory-v2-workflow-handoff:${auth.id}`,
  };
}

export function summarizeHandoffReadState(
  handoff: MemoryHandoffRecord,
  receipts: readonly MemoryHandoffReceiptRecord[],
) {
  const handoffReceipts = receipts.filter((receipt) => receipt.handoffId === handoff.id);
  if (handoff.mode !== 'required-read') {
    return {
      required: false,
      state: 'not-required' as const,
      receiptCount: handoffReceipts.length,
    };
  }
  const statuses = handoffReceipts.map((receipt) => receipt.status);
  const blocked = statuses.some((status) => status === 'failed' || status === 'cancelled');
  const pending = statuses.some((status) => status === 'pending' || status === 'retrying');
  const acknowledged = statuses.length > 0 && statuses.every((status) => status === 'acknowledged');
  return {
    required: true,
    state: blocked ? 'blocked' as const : acknowledged ? 'acknowledged' as const : pending ? 'pending' as const : 'unread' as const,
    receiptCount: handoffReceipts.length,
  };
}
