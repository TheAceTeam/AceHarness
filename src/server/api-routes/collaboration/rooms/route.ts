import { jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { listCollaborationRooms } from '@/lib/collaboration/rooms';

export async function GET(request: Request) {
  try {
    const rooms = await listCollaborationRooms({
      spaceType: requestUrl(request).searchParams.get('spaceType') || undefined,
      roomType: requestUrl(request).searchParams.get('roomType') || undefined,
      status: requestUrl(request).searchParams.get('status') || undefined,
    });
    return jsonOk({ rooms });
  } catch (error) {
    return jsonError('获取协作房间失败', 500, error);
  }
}
