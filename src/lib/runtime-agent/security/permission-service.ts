import {
  defaultPermissionPolicy,
  type RuntimeEvent,
  type RuntimePermissionDecision,
  type RuntimePermissionPolicyId,
  type RuntimePermissionRequest,
  type RuntimePermissionResolution,
  type RuntimeTraceEvent,
} from '../contracts';
import { redactRecord } from './redaction';

export interface PermissionResolutionInput {
  request: RuntimePermissionRequest;
  policyId?: RuntimePermissionPolicyId;
  userDecision?: 'approved' | 'denied';
  resolvedAt?: string;
}

export interface PermissionResolutionResult {
  request: RuntimePermissionRequest;
  policyId: RuntimePermissionPolicyId;
  requiresUserDecision: boolean;
  resolution?: RuntimePermissionResolution;
}

export interface PermissionAuditInput {
  request: RuntimePermissionRequest;
  resolution?: RuntimePermissionResolution;
  traceId: string;
  seqStart?: number;
  eventIdPrefix?: string;
  traceEventIdPrefix?: string;
  createdAt?: string;
}

const DESTRUCTIVE_COMMAND_PATTERN = /\b(rm\s+-rf|rm\s+-fr|sudo\s+rm|mkfs|diskutil\s+erase|format\s+[a-z]:|dd\s+if=|chmod\s+-R\s+777|chown\s+-R|git\s+clean\s+-fd|git\s+reset\s+--hard|docker\s+system\s+prune|kubectl\s+delete|DROP\s+TABLE|TRUNCATE\s+TABLE)\b/i;
const DESTRUCTIVE_DIFF_PATTERN = /^(?:-{3}\s|\-\s|deleted file mode|rename from|Binary files .* differ)/m;

export function normalizePermissionPolicyId(policyId?: RuntimePermissionPolicyId | null): RuntimePermissionPolicyId {
  return policyId ?? defaultPermissionPolicy;
}

export function isDestructivePermissionRequest(request: RuntimePermissionRequest): boolean {
  if (request.risk === 'high') {
    return true;
  }
  if (request.operation === 'write' && request.resource?.includes('delete:')) {
    return true;
  }
  if (request.proposedCommand && DESTRUCTIVE_COMMAND_PATTERN.test(request.proposedCommand)) {
    return true;
  }
  if (request.proposedDiff && DESTRUCTIVE_DIFF_PATTERN.test(request.proposedDiff)) {
    return true;
  }
  return false;
}

function makeResolution(
  request: RuntimePermissionRequest,
  policyId: RuntimePermissionPolicyId,
  decision: RuntimePermissionDecision,
  reason: string,
  resolvedBy: RuntimePermissionResolution['resolvedBy'],
  resolvedAt?: string,
): RuntimePermissionResolution {
  return {
    requestId: request.id,
    decision,
    policyId,
    reason,
    resolvedBy,
    resolvedAt: resolvedAt ?? new Date().toISOString(),
  };
}

export function resolvePermissionRequest(input: PermissionResolutionInput): PermissionResolutionResult {
  const policyId = normalizePermissionPolicyId(input.policyId);

  if (input.userDecision) {
    return {
      request: input.request,
      policyId,
      requiresUserDecision: false,
      resolution: makeResolution(
        input.request,
        policyId,
        input.userDecision,
        'Resolved by explicit user decision.',
        'user',
        input.resolvedAt,
      ),
    };
  }

  if (policyId === 'unrestricted') {
    return {
      request: input.request,
      policyId,
      requiresUserDecision: false,
      resolution: makeResolution(input.request, policyId, 'auto-approved', 'Default unrestricted policy auto-approves all runtime permission requests.', 'policy', input.resolvedAt),
    };
  }

  if (policyId === 'deny-all') {
    return {
      request: input.request,
      policyId,
      requiresUserDecision: false,
      resolution: makeResolution(input.request, policyId, 'auto-denied', 'Policy denies all runtime permission requests.', 'policy', input.resolvedAt),
    };
  }

  if (policyId === 'approve-reads' && input.request.operation === 'read') {
    return {
      request: input.request,
      policyId,
      requiresUserDecision: false,
      resolution: makeResolution(input.request, policyId, 'auto-approved', 'Policy auto-approves read requests.', 'policy', input.resolvedAt),
    };
  }

  if (policyId === 'deny-destructive' && isDestructivePermissionRequest(input.request)) {
    return {
      request: input.request,
      policyId,
      requiresUserDecision: false,
      resolution: makeResolution(input.request, policyId, 'auto-denied', 'Policy denies destructive requests.', 'policy', input.resolvedAt),
    };
  }

  if (policyId === 'deny-destructive' && input.request.risk === 'low') {
    return {
      request: input.request,
      policyId,
      requiresUserDecision: false,
      resolution: makeResolution(input.request, policyId, 'auto-approved', 'Policy auto-approves non-destructive low-risk requests.', 'policy', input.resolvedAt),
    };
  }

  return {
    request: input.request,
    policyId,
    requiresUserDecision: true,
  };
}

export function createPermissionAuditEvents(input: PermissionAuditInput): RuntimeEvent[] {
  const createdAt = input.createdAt ?? input.resolution?.resolvedAt ?? new Date().toISOString();
  const eventIdPrefix = input.eventIdPrefix ?? input.request.id;
  const seqStart = input.seqStart ?? 1;
  const requestedPayload = redactRecord(input.request).value;
  const events: RuntimeEvent[] = [
    {
      id: `${eventIdPrefix}:permission.requested`,
      sessionId: input.request.sessionId,
      turnId: input.request.turnId,
      traceId: input.traceId,
      seq: seqStart,
      type: 'permission.requested',
      correlationId: input.request.id,
      payload: requestedPayload,
      redacted: true,
      createdAt,
    },
  ];

  if (input.resolution) {
    events.push({
      id: `${eventIdPrefix}:permission.resolved`,
      sessionId: input.request.sessionId,
      turnId: input.request.turnId,
      traceId: input.traceId,
      seq: seqStart + 1,
      type: 'permission.resolved',
      correlationId: input.request.id,
      payload: input.resolution,
      redacted: false,
      createdAt: input.resolution.resolvedAt,
    });
  }

  return events;
}

export function createPermissionTraceEvents(input: PermissionAuditInput): RuntimeTraceEvent[] {
  const createdAt = input.createdAt ?? input.resolution?.resolvedAt ?? new Date().toISOString();
  const traceEventIdPrefix = input.traceEventIdPrefix ?? input.request.id;
  const requestPayload = redactRecord(input.request).value;
  const events: RuntimeTraceEvent[] = [
    {
      id: `${traceEventIdPrefix}:trace:permission.requested`,
      traceId: input.traceId,
      sessionId: input.request.sessionId,
      turnId: input.request.turnId,
      level: 'info',
      source: 'permission',
      payload: requestPayload,
      redacted: true,
      createdAt,
    },
  ];

  if (input.resolution) {
    events.push({
      id: `${traceEventIdPrefix}:trace:permission.resolved`,
      traceId: input.traceId,
      sessionId: input.request.sessionId,
      turnId: input.request.turnId,
      level: input.resolution.decision.endsWith('denied') ? 'warning' : 'info',
      source: 'permission',
      payload: input.resolution,
      redacted: false,
      createdAt: input.resolution.resolvedAt,
    });
  }

  return events;
}

