import type { AuthenticatedUser } from '@/lib/auth/middleware';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import {
  MemoryServiceError,
  type MemoryRequestContext,
} from '@/lib/memory-v2';
import { ensureMemoryV2FreshStart } from '@/lib/memory-v2-cutover/feature-flag';
import { jsonError } from '@/server/api-route-runtime/request-utils';

export function createMemoryV2ReviewerContext(user: AuthenticatedUser): MemoryRequestContext {
  return {
    ownerUserId: user.id,
    workspaceId: getWorkspaceRoot(),
    actor: 'reviewer',
    actorId: user.id,
    reviewAllWorkspaces: true,
  };
}

export async function ensureMemoryV2GovernanceReady(): Promise<Response | undefined> {
  const status = await ensureMemoryV2FreshStart();
  if (status.ready) return undefined;
  return jsonError(status.reason || 'Memory V2 is unavailable', 409);
}

export function memoryV2RouteError(error: unknown): Response {
  if (error instanceof MemoryServiceError) {
    switch (error.code) {
      case 'MEMORY_INVALID_INPUT':
        return jsonError(error.message, 400);
      case 'MEMORY_UNAUTHORIZED':
        return jsonError(error.message, 403);
      case 'MEMORY_NOT_FOUND':
        return jsonError(error.message, 404);
      case 'MEMORY_CONFLICT':
      case 'MEMORY_CAPTURE_DISABLED':
      case 'MEMORY_REQUIRED_READ_BLOCKED':
        return jsonError(error.message, 409);
      case 'MEMORY_LIMIT_EXCEEDED':
        return jsonError(error.message, 413);
      default:
        return jsonError(error.message, 500);
    }
  }
  return jsonError(error instanceof Error ? error.message : 'Memory V2 request failed', 500);
}
