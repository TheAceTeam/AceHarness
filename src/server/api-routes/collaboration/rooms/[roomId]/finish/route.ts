import { jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';
import { finishCollaborationRoom } from '@/lib/collaboration/rooms';

export async function POST(
  request: Request,
  { params }: { params: { roomId: string } | Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const room = await finishCollaborationRoom(roomId);
    return jsonOk({ success: true, room });
  } catch (error) {
    return jsonError('结束协作房间失败', 400, error);
  }
}
