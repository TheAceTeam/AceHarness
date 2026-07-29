import { requireAdmin } from '@/lib/auth/middleware';
import {
  createMemoryService,
  MemoryServiceError,
  type MemoryItemStatus,
  type PersistedMemoryRetention,
} from '@/lib/memory-v2';
import { recordMemoryV2CutoverEvent } from '@/lib/memory-v2-cutover/telemetry';
import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import {
  createMemoryV2ReviewerContext,
  ensureMemoryV2GovernanceReady,
  memoryV2RouteError,
} from '../_shared';

export const dynamic = 'force-dynamic';

const ALLOWED_QUERY_KEYS = new Set(['status', 'retention', 'ownerUserId', 'offset', 'limit', 'memoryId', 'auditLimit']);
// Governance is admin-only; keep page size bounded without imposing a synthetic last page.
const MAX_PAGE_OFFSET = Number.MAX_SAFE_INTEGER;
const MAX_PAGE_LIMIT = 200;
const MAX_AUDIT_LIMIT = 500;

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

function parseOptionalSingleText(url: URL, key: string): string | undefined {
  const values = url.searchParams.getAll(key);
  if (!values.length) return undefined;
  if (values.length !== 1) {
    throw new MemoryServiceError('MEMORY_INVALID_INPUT', `${key} must be supplied at most once`);
  }
  return values[0] || undefined;
}

function parseStatuses(values: string[]): MemoryItemStatus[] | undefined {
  if (!values.length) return undefined;
  const statuses: MemoryItemStatus[] = [];
  for (const value of values) {
    if (value !== 'pending-review' && value !== 'active' && value !== 'resolved'
      && value !== 'superseded' && value !== 'expired' && value !== 'rejected') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance status is invalid');
    }
    statuses.push(value);
  }
  return statuses;
}

function parseRetentions(values: string[]): PersistedMemoryRetention[] | undefined {
  if (!values.length) return undefined;
  const retentions: PersistedMemoryRetention[] = [];
  for (const value of values) {
    if (value !== 'short' && value !== 'long') {
      throw new MemoryServiceError('MEMORY_INVALID_INPUT', 'governance retention is invalid');
    }
    retentions.push(value);
  }
  return retentions;
}

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;
  const unavailable = await ensureMemoryV2GovernanceReady();
  if (unavailable) return unavailable;

  try {
    const url = requestUrl(request);
    for (const key of Array.from(url.searchParams.keys())) {
      if (!ALLOWED_QUERY_KEYS.has(key)) {
        throw new MemoryServiceError('MEMORY_INVALID_INPUT', `unsupported governance query parameter: ${key}`);
      }
    }
    const statuses = parseStatuses(url.searchParams.getAll('status'));
    const retentions = parseRetentions(url.searchParams.getAll('retention'));
    const ownerUserId = parseOptionalSingleText(url, 'ownerUserId');
    const memoryId = parseOptionalSingleText(url, 'memoryId');
    const offset = parseSingleInteger(url, 'offset', 0, 0, MAX_PAGE_OFFSET);
    const limit = parseSingleInteger(url, 'limit', 100, 1, MAX_PAGE_LIMIT);
    const auditLimit = parseSingleInteger(url, 'auditLimit', 200, 1, MAX_AUDIT_LIMIT);
    const service = createMemoryService();
    try {
      const context = createMemoryV2ReviewerContext(auth);
      const records = service.listGovernance({
        context,
        ...(statuses ? { statuses } : {}),
        ...(retentions ? { retentions } : {}),
        ...(ownerUserId ? { ownerUserId } : {}),
        offset,
        limit,
      });
      const audit = service.listGovernanceAudit({
        context,
        ...(memoryId ? { memoryId } : {}),
        limit: auditLimit,
      });
      recordMemoryV2CutoverEvent('governanceListReads');
      return jsonOk({ ...records, audit });
    } finally {
      service.close();
    }
  } catch (error) {
    return memoryV2RouteError(error);
  }
}
