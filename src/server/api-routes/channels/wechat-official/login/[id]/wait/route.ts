import { errorMessage, jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';
import { waitForWeChatOfficialLogin } from '@/lib/channel/wechat/official-service';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> },
) {
  const user = await requireAuth(request);
  if (user instanceof Response) return user;

  try {
    const { id } = await params;
    const timeoutRaw = requestUrl(request).searchParams.get('timeoutMs');
    const timeoutMs = timeoutRaw ? Number(timeoutRaw) : undefined;
    const session = await waitForWeChatOfficialLogin(
      id,
      Number.isFinite(timeoutMs) ? timeoutMs : undefined,
      { createdBy: user.id },
    );
    if (!session) {
      return jsonError('扫码会话不存在或已过期', 404);
    }
    return jsonOk({ session });
  } catch (error) {
    return jsonError(errorMessage(error) || '等待微信扫码确认失败', 500);
  }
}
