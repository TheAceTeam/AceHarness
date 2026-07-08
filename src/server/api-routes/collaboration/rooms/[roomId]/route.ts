import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { getCollaborationRoom } from '@/lib/collaboration/rooms';

export async function GET(
  request: Request,
  { params }: { params: { roomId: string } | Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const room = await getCollaborationRoom(roomId);
    if (!room) return jsonError('房间不存在', 404);
    return jsonOk({ room });
  } catch (error) {
    return jsonError('获取协作房间失败', 500, error);
  }
}
