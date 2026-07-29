import { createMemoryService, MemoryServiceError } from '@/lib/memory-v2';
import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { memoryV2RouteError } from '../../../../../_shared';
import {
  authorizeWorkflowHandoffRun,
  createAuthorizedWorkflowHandoffReadContext,
  createHandoffOwnerReviewContext,
  ensureMemoryV2WorkflowHandoffReady,
  parseWorkflowHandoffRouteId,
  resolveHandoffDetailAccess,
  summarizeHandoffReadState,
} from '../../../../_shared';

export const dynamic = 'force-dynamic';

const ALLOWED_QUERY_KEYS = new Set(['detailVersion', 'cursor', 'maxChars']);
const MAX_CURSOR_CHARS = 4_096;
const MAX_DETAIL_PAGE_CHARS = 8_000;

interface DetailPageRequest {
  detailVersion: number;
  cursor?: string;
  maxChars?: number;
}

function parsePositiveInteger(value: string, label: string, maximum: number): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${label} is outside the allowed range`);
  }
  return parsed;
}

function parseDetailPageRequest(request: Request): DetailPageRequest {
  const url = requestUrl(request);
  for (const key of Array.from(url.searchParams.keys())) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', `unsupported handoff detail query parameter: ${key}`);
    }
  }
  const versions = url.searchParams.getAll('detailVersion');
  if (versions.length !== 1) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'detailVersion is required exactly once');
  }
  const cursors = url.searchParams.getAll('cursor');
  if (cursors.length > 1 || (cursors[0] !== undefined && (!cursors[0] || cursors[0].length > MAX_CURSOR_CHARS))) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'cursor is invalid');
  }
  const maxCharsValues = url.searchParams.getAll('maxChars');
  if (maxCharsValues.length > 1 || (maxCharsValues.length === 1 && !maxCharsValues[0])) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'maxChars must be supplied once as a positive integer');
  }
  return {
    detailVersion: parsePositiveInteger(versions[0], 'detailVersion', Number.MAX_SAFE_INTEGER),
    ...(cursors[0] ? { cursor: cursors[0] } : {}),
    ...(maxCharsValues.length ? { maxChars: parsePositiveInteger(maxCharsValues[0], 'maxChars', MAX_DETAIL_PAGE_CHARS) } : {}),
  };
}

export async function GET(
  request: Request,
  { params }: { params: { runId: string; handoffId: string } | Promise<{ runId: string; handoffId: string }> },
) {
  try {
    const routeParams = await params;
    const runId = parseWorkflowHandoffRouteId(routeParams.runId || '', 'runId');
    const handoffId = parseWorkflowHandoffRouteId(routeParams.handoffId || '', 'handoffId');
    const authorized = await authorizeWorkflowHandoffRun(request, runId, 'review');
    if (authorized instanceof Response) return authorized;
    const unavailable = await ensureMemoryV2WorkflowHandoffReady();
    if (unavailable) return unavailable;
    const pageRequest = parseDetailPageRequest(request);
    const service = createMemoryService();
    try {
      const serverContext = createAuthorizedWorkflowHandoffReadContext({ service, authorized });
      if (!serverContext) {
        return jsonOk({
          runId,
          handoffId,
          detailVersion: pageRequest.detailVersion,
          handoffState: 'uninitialized',
          detailAccess: { state: 'denied', reason: 'requires-run-owner-or-admin' },
        }, { status: 409 });
      }

      const state = service.listHandoffRunState(serverContext.context, runId);
      const handoff = state.handoffs.find((item) => item.id === handoffId);
      if (!handoff) {
        throw new MemoryServiceError('MEMORY_NOT_FOUND', 'handoff does not belong to this workflow run');
      }
      const receipts = state.receipts.filter((receipt) => receipt.handoffId === handoff.id);
      const detailAccess = resolveHandoffDetailAccess({
        auth: authorized.auth,
        runState: authorized.runState,
        ownerUserId: serverContext.context.ownerUserId,
      });
      if (handoff.detailVersion !== pageRequest.detailVersion) {
        return jsonOk({
          runId,
          handoffId,
          detailVersion: pageRequest.detailVersion,
          detailAccess,
          readState: summarizeHandoffReadState(handoff, receipts),
          error: 'requested detailVersion does not match the frozen handoff revision',
        }, { status: 409 });
      }
      if (detailAccess.state !== 'allowed') {
        return jsonOk({
          runId,
          handoffId,
          detailVersion: pageRequest.detailVersion,
          detailAccess,
          readState: summarizeHandoffReadState(handoff, receipts),
        }, { status: 403 });
      }

      const page = service.readGovernanceDetails({
        context: createHandoffOwnerReviewContext(serverContext.context, authorized.auth),
        memoryId: handoff.memoryId,
        detailVersion: handoff.detailVersion,
        ...(pageRequest.cursor ? { cursor: pageRequest.cursor } : {}),
        ...(pageRequest.maxChars ? { maxChars: pageRequest.maxChars } : {}),
      });

      const refreshedState = service.listHandoffRunState(serverContext.context, runId);
      const refreshedHandoff = refreshedState.handoffs.find((item) => item.id === handoff.id);
      if (!refreshedHandoff) {
        throw new MemoryServiceError('MEMORY_CONFLICT', 'handoff changed while its detail was read');
      }
      return jsonOk({
        runId,
        handoffId,
        detailVersion: handoff.detailVersion,
        detailAccess,
        readState: summarizeHandoffReadState(refreshedHandoff, refreshedState.receipts),
        page,
      });
    } finally {
      service.close();
    }
  } catch (error) {
    return memoryV2RouteError(error);
  }
}
