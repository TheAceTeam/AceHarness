import { requireAuth } from '@/lib/auth/middleware';
import { getWeChatOfficialLoginSession } from '@/lib/channel/wechat/official-service';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET(request: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { id } = await params;
    const session = await getWeChatOfficialLoginSession(id, { createdBy: user.id });
    if (!session) {
      return jsonError('扫码会话不存在或已过期', 404);
    }
    return jsonOk({ session });
  } catch (error) {
    return jsonError(errorMessage(error) || '获取微信扫码状态失败', 500);
  }
}
