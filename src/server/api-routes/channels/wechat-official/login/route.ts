import { requireAuth } from '@/lib/auth/middleware';
import { createWeChatOfficialLoginSession } from '@/lib/channel/wechat/official-service';
import { errorMessage, jsonError, jsonOk } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const session = await createWeChatOfficialLoginSession({ createdBy: user.id });
    return jsonOk({ session });
  } catch (error) {
    return jsonError(errorMessage(error) || '创建微信扫码会话失败', 500);
  }
}
