import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { createDirectRoom, getOrCreateDirectRoom } from '@/lib/collaboration/rooms';
import { ensureCollaborationRoomChatSession } from '@/lib/collaboration/session-adapter';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<Record<string, any>>(request, {});
    const agentName = String(body?.agentName || '').trim();
    if (!agentName) {
      return jsonError('缺少 Agent 名称', 400);
    }

    const input = {
      agentName,
      spaceType: body?.spaceType,
      topic: typeof body?.topic === 'string' ? body.topic : undefined,
      createdBy: typeof body?.createdBy === 'string' ? body.createdBy : undefined,
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : undefined,
    };

    const result = body?.forceNew
      ? { room: await createDirectRoom(input), created: true }
      : await getOrCreateDirectRoom(input);

    if (body?.ensureSession) {
      const sessionResult = await ensureCollaborationRoomChatSession({
        roomId: result.room.id,
        createdBy: input.createdBy,
        visibility: body?.visibility === 'private' ? 'private' : 'public',
      });
      return jsonOk({
        success: true,
        room: sessionResult.room,
        created: result.created,
        session: sessionResult.session,
        sessionCreated: sessionResult.created,
      });
    }

    return jsonOk({ success: true, ...result });
  } catch (error) {
    return jsonError('创建协作房间失败', 400, error);
  }
}
