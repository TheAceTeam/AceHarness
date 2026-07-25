import { requireAuth } from '@/lib/auth/middleware';
import {
  MemoryV2ConsumerUnavailableError,
} from '@/lib/memory-v2-cutover/consumer-context';
import {
  readCollaborationParticipantMemoryDetail,
  resolveCollaborationParticipantMemoryContext,
} from '@/lib/collaboration/memory-context';
import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';

function numberOrUndefined(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(
  request: Request,
  { params }: { params: { roomId: string; agentName: string } | Promise<{ roomId: string; agentName: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { roomId, agentName } = await params;
    const url = requestUrl(request);
    const input = {
      roomId,
      agentName: decodeURIComponent(agentName),
      ownerUserId: user.id,
    };
    const memoryId = url.searchParams.get('memoryId')?.trim();
    if (memoryId) {
      const detailVersion = numberOrUndefined(url.searchParams.get('detailVersion'));
      if (!detailVersion || detailVersion < 1 || !Number.isInteger(detailVersion)) {
        return jsonError('Memory detailVersion must be a positive integer', 400);
      }
      const detail = await readCollaborationParticipantMemoryDetail({
        ...input,
        memoryId,
        detailVersion,
        cursor: url.searchParams.get('cursor') || undefined,
        maxChars: numberOrUndefined(url.searchParams.get('maxChars')),
      });
      return jsonOk({ detail });
    }

    const context = await resolveCollaborationParticipantMemoryContext(input);
    return jsonOk({ context });
  } catch (error) {
    const status = error instanceof MemoryV2ConsumerUnavailableError ? 409 : 400;
    return jsonError('Unable to resolve collaboration Memory V2 context', status, errorMessage(error));
  }
}
