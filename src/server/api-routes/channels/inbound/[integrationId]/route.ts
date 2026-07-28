import { errorMessage, jsonError, jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';
import { handleChannelInbound } from '@/lib/channel/gateway';

export async function POST(request: Request, { params }: { params: { integrationId: string } | Promise<{ integrationId: string }> }) {
  try {
    const { integrationId } = await params;
    const body = await readJsonBody<Record<string, any>>(request, {});
    const result = await handleChannelInbound(integrationId, body, request.headers.get('x-ace-channel-secret'));
    if ('challenge' in result) {
      return jsonOk({ challenge: result.challenge });
    }
    return jsonOk(result);
  } catch (error) {
    return jsonError(errorMessage(error) || '处理渠道消息失败', 400);
  }
}
