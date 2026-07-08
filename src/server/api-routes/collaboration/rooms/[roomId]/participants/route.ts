import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { addRoomParticipants } from '@/lib/collaboration/rooms';
import { syncCollaborationRoomChatSession } from '@/lib/collaboration/session-adapter';

export async function POST(
  request: Request,
  { params }: { params: { roomId: string } | Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const agentNames = Array.isArray(body?.agentNames)
      ? body.agentNames
      : [body?.agentName];
    const room = await addRoomParticipants({ roomId, agentNames });
    const session = await syncCollaborationRoomChatSession(room);
    return jsonOk({ success: true, room, session });
  } catch (error) {
    return jsonError('添加协作成员失败', 400, error);
  }
}
