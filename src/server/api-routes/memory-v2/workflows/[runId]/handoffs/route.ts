import {
  createMemoryService,
  MemoryServiceError,
  type MemoryHandoffIndexSnapshot,
} from '@/lib/memory-v2';
import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { memoryV2RouteError } from '../../../_shared';
import {
  authorizeWorkflowHandoffRun,
  createAuthorizedWorkflowHandoffReadContext,
  ensureMemoryV2WorkflowHandoffReady,
  parseWorkflowHandoffRouteId,
  resolveHandoffDetailAccess,
  summarizeHandoffReadState,
} from '../../_shared';

export const dynamic = 'force-dynamic';

const HANDOFF_STATUSES = new Set(['pending', 'resolved', 'cancelled', 'failed']);
const BATCH_STATUSES = new Set(['no-op', 'emitted', 'failed', 'cancelled', 'retrying', 'superseded']);
const HANDOFF_MODES = new Set(['manifest', 'on-demand', 'required-read']);
const HANDOFF_TARGETS = new Set(['next-step', 'matching-steps', 'named-agents']);
const ALLOWED_QUERY_KEYS = new Set(['status', 'batchStatus', 'mode', 'target', 'requiredRead', 'offset', 'limit']);
// Keep the page size bounded, but do not create an unreachable tail of a run.
const MAX_PAGE_OFFSET = Number.MAX_SAFE_INTEGER;
const MAX_PAGE_LIMIT = 100;

interface HandoffListFilter {
  statuses: Set<string>;
  batchStatuses: Set<string>;
  modes: Set<string>;
  targets: Set<string>;
  requiredRead?: boolean;
  offset: number;
  limit: number;
}

function parseEnumValues(url: URL, key: string, allowed: ReadonlySet<string>): Set<string> {
  const values = url.searchParams.getAll(key);
  const parsed = new Set<string>();
  for (const value of values) {
    if (!allowed.has(value) || parsed.has(value)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${key} is invalid`);
    }
    parsed.add(value);
  }
  return parsed;
}

function parseSingleInteger(url: URL, key: string, fallback: number, minimum: number, maximum: number): number {
  const values = url.searchParams.getAll(key);
  if (!values.length) return fallback;
  if (values.length !== 1 || !/^(?:0|[1-9]\d*)$/.test(values[0])) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${key} must be an integer`);
  }
  const value = Number(values[0]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${key} is outside the allowed range`);
  }
  return value;
}

function parseRequiredRead(url: URL): boolean | undefined {
  const values = url.searchParams.getAll('requiredRead');
  if (!values.length) return undefined;
  if (values.length !== 1 || (values[0] !== 'true' && values[0] !== 'false')) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'requiredRead must be true or false');
  }
  return values[0] === 'true';
}

function parseFilters(request: Request): HandoffListFilter {
  const url = requestUrl(request);
  for (const key of Array.from(url.searchParams.keys())) {
    if (!ALLOWED_QUERY_KEYS.has(key)) {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', `unsupported handoff query parameter: ${key}`);
    }
  }
  return {
    statuses: parseEnumValues(url, 'status', HANDOFF_STATUSES),
    batchStatuses: parseEnumValues(url, 'batchStatus', BATCH_STATUSES),
    modes: parseEnumValues(url, 'mode', HANDOFF_MODES),
    targets: parseEnumValues(url, 'target', HANDOFF_TARGETS),
    requiredRead: parseRequiredRead(url),
    offset: parseSingleInteger(url, 'offset', 0, 0, MAX_PAGE_OFFSET),
    limit: parseSingleInteger(url, 'limit', 50, 1, MAX_PAGE_LIMIT),
  };
}

function projectSelector(selector: {
  mode: string;
  target: string;
  stepIds?: string[];
  stepTags?: string[];
  workflowStates?: string[];
  agentIds?: string[];
}) {
  return {
    mode: selector.mode,
    target: selector.target,
    ...(selector.stepIds?.length ? { stepIds: [...selector.stepIds] } : {}),
    ...(selector.stepTags?.length ? { stepTags: [...selector.stepTags] } : {}),
    ...(selector.workflowStates?.length ? { workflowStates: [...selector.workflowStates] } : {}),
    ...(selector.agentIds?.length ? { agentIds: [...selector.agentIds] } : {}),
  };
}

function projectIndexSnapshot(snapshot: MemoryHandoffIndexSnapshot | undefined) {
  if (!snapshot) return null;
  return {
    memoryId: snapshot.memoryId,
    retention: snapshot.retention,
    kind: snapshot.kind,
    ...(snapshot.lifecycleAnchor ? { lifecycleAnchor: snapshot.lifecycleAnchor } : {}),
    summary: snapshot.summary,
    readWhen: snapshot.readWhen,
    handoff: projectSelector(snapshot.handoff),
    detailVersion: snapshot.detailVersion,
    confidence: snapshot.confidence,
    indexChars: snapshot.indexChars,
    source: snapshot.source,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt,
  };
}

function projectReceipt(receipt: {
  targetStepAttemptId: string;
  targetAgentId: string;
  detailVersion: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    targetStepAttemptId: receipt.targetStepAttemptId,
    targetAgentId: receipt.targetAgentId,
    detailVersion: receipt.detailVersion,
    status: receipt.status,
    createdAt: receipt.createdAt,
    updatedAt: receipt.updatedAt,
  };
}

function matchesHandoff(
  handoff: { status: string; mode: string; target: { target: string } },
  filter: HandoffListFilter,
): boolean {
  if (filter.statuses.size && !filter.statuses.has(handoff.status)) return false;
  if (filter.modes.size && !filter.modes.has(handoff.mode)) return false;
  if (filter.targets.size && !filter.targets.has(handoff.target.target)) return false;
  if (filter.requiredRead !== undefined && (handoff.mode === 'required-read') !== filter.requiredRead) return false;
  return true;
}

function hasHandoffFilters(filter: HandoffListFilter): boolean {
  return filter.statuses.size > 0
    || filter.modes.size > 0
    || filter.targets.size > 0
    || filter.requiredRead !== undefined;
}

export async function GET(
  request: Request,
  { params }: { params: { runId: string } | Promise<{ runId: string }> },
) {
  try {
    const runId = parseWorkflowHandoffRouteId((await params).runId || '', 'runId');
    const authorized = await authorizeWorkflowHandoffRun(request, runId);
    if (authorized instanceof Response) return authorized;
    const unavailable = await ensureMemoryV2WorkflowHandoffReady();
    if (unavailable) return unavailable;
    const filter = parseFilters(request);
    const service = createMemoryService();
    try {
      const serverContext = createAuthorizedWorkflowHandoffReadContext({ service, authorized });
      if (!serverContext) {
        return jsonOk({
          runId,
          state: 'uninitialized',
          items: [],
          pagination: { offset: filter.offset, limit: filter.limit, total: 0, nextOffset: null },
        });
      }
      const state = service.listHandoffRunState(serverContext.context, runId);
      const receiptsByHandoffId = new Map<string, typeof state.receipts>();
      for (const receipt of state.receipts) {
        const receipts = receiptsByHandoffId.get(receipt.handoffId) || [];
        receipts.push(receipt);
        receiptsByHandoffId.set(receipt.handoffId, receipts);
      }
      const matchedBatches = state.batches.flatMap((batch) => {
        if (filter.batchStatuses.size && !filter.batchStatuses.has(batch.status)) return [];
        const handoffs = state.handoffs.filter((handoff) => handoff.batchId === batch.id && matchesHandoff(handoff, filter));
        if (hasHandoffFilters(filter) && !handoffs.length) return [];
        return [{ batch, handoffs }];
      });
      const pageItems = matchedBatches.slice(filter.offset, filter.offset + filter.limit).map(({ batch, handoffs }) => ({
        id: batch.id,
        sourceStepAttemptId: batch.sourceStepAttemptId,
        status: batch.status,
        ...(batch.parentRunId ? { parentRunId: batch.parentRunId } : {}),
        ...(batch.parentStepAttemptId ? { parentStepAttemptId: batch.parentStepAttemptId } : {}),
        createdAt: batch.createdAt,
        updatedAt: batch.updatedAt,
        handoffs: handoffs.map((handoff) => {
          const receipts = receiptsByHandoffId.get(handoff.id) || [];
          return {
            id: handoff.id,
            memoryId: handoff.memoryId,
            detailVersion: handoff.detailVersion,
            mode: handoff.mode,
            target: projectSelector(handoff.target),
            status: handoff.status,
            indexSnapshot: projectIndexSnapshot(handoff.indexSnapshot),
            resolvedTargets: handoff.resolvedTargets.map((target) => ({
              targetStepAttemptId: target.targetStepAttemptId,
              targetAgentId: target.targetAgentId,
            })),
            receipts: receipts.map(projectReceipt),
            detailAccess: resolveHandoffDetailAccess({
              auth: authorized.auth,
              runState: authorized.runState,
              ownerUserId: serverContext.context.ownerUserId,
            }),
            readState: summarizeHandoffReadState(handoff, receipts),
          };
        }),
      }));
      return jsonOk({
        runId,
        state: 'available',
        items: pageItems,
        pagination: {
          offset: filter.offset,
          limit: filter.limit,
          total: matchedBatches.length,
          nextOffset: filter.offset + pageItems.length < matchedBatches.length ? filter.offset + pageItems.length : null,
        },
        totals: {
          batches: state.batches.length,
          handoffs: state.handoffs.length,
          receipts: state.receipts.length,
        },
      });
    } finally {
      service.close();
    }
  } catch (error) {
    return memoryV2RouteError(error);
  }
}
