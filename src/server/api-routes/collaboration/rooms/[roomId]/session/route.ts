import { jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { ensureCollaborationRoomChatSession } from '@/lib/collaboration/session-adapter';

export async function POST(
  request: Request,
  { params }: { params: { roomId: string } | Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const result = await ensureCollaborationRoomChatSession({
      roomId,
      createdBy: typeof body?.createdBy === 'string' ? body.createdBy : undefined,
      visibility: body?.visibility === 'private' ? 'private' : 'public',
    });
    return jsonOk({ success: true, ...result });
  } catch (error) {
    return jsonError('创建协作会话失败', 400, error);
  }
}
