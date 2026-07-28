import { jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { listCollaborationMembers } from '@/lib/collaboration/members';

export async function GET(request: Request) {
  try {
    const spaceType = requestUrl(request).searchParams.get('spaceType') || 'meeting-room';
    const members = await listCollaborationMembers({ spaceType });
    return jsonOk({ members });
  } catch (error) {
    return jsonError('获取协作空间成员失败', 500, error);
  }
}
