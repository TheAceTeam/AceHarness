import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/auth/middleware';
import {
  createMemoryService,
  type MemoryGovernanceAction,
  type PersistedMemoryRetention,
} from '@/lib/memory-v2';
import { recordMemoryV2CutoverEvent } from '@/lib/memory-v2-cutover/telemetry';
import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import {
  createMemoryV2ReviewerContext,
  ensureMemoryV2GovernanceReady,
  memoryV2RouteError,
} from '../../_shared';

export const dynamic = 'force-dynamic';

function text(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  const unavailable = await ensureMemoryV2GovernanceReady();
  if (unavailable) return unavailable;

  const body = await readJsonBody<Record<string, unknown>>(request, {});
  const action = text(body.action) as MemoryGovernanceAction | undefined;
  const memoryId = text(body.memoryId);
  const expectedDetailVersion = Number(body.expectedDetailVersion);
  if (!action || !memoryId || !Number.isInteger(expectedDetailVersion) || expectedDetailVersion < 1) {
    return jsonError('action, memoryId, and a positive expectedDetailVersion are required', 400);
  }

  try {
    const requestId = randomUUID();
    const service = createMemoryService();
    try {
      const result = service.applyGovernanceAction({
        context: createMemoryV2ReviewerContext(auth),
        action,
        memoryId,
        expectedDetailVersion,
        ...(text(body.expectedFingerprint) ? { expectedFingerprint: text(body.expectedFingerprint)! } : {}),
        sourceEventId: `governance:${auth.id}:${requestId}`,
        idempotencyKey: requestId,
        ...(text(body.reason) ? { reason: text(body.reason)! } : {}),
        ...(text(body.replacementMemoryId) ? { replacementMemoryId: text(body.replacementMemoryId)! } : {}),
        ...(body.requestedRetention === 'short' || body.requestedRetention === 'long'
          ? { requestedRetention: body.requestedRetention as PersistedMemoryRetention }
          : {}),
      });
      recordMemoryV2CutoverEvent('governanceActions');
      return jsonOk({ result });
    } finally {
      service.close();
    }
  } catch (error) {
    recordMemoryV2CutoverEvent('governanceActionFailures');
    return memoryV2RouteError(error);
  }
}
