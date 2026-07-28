import { jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { resolveCollaborationParticipantMemoryContext } from '@/lib/collaboration/memory-context';

export async function GET(
  request: Request,
  { params }: { params: { roomId: string; agentName: string } | Promise<{ roomId: string; agentName: string }> }
) {
  try {
    const { roomId, agentName } = await params;
    const context = await resolveCollaborationParticipantMemoryContext({
      roomId,
      agentName: decodeURIComponent(agentName),
      workingDirectory: requestUrl(request).searchParams.get('workingDirectory') || undefined,
    });
    return jsonOk({ context });
  } catch (error) {
    return jsonError('获取协作成员记忆失败', 400, error);
  }
}
