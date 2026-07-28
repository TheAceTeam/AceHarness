import { jsonOk, readJsonBody, requestUrl } from '@/server/api-route-runtime/request-utils';
import { appendWerewolfHistory, listWerewolfHistory } from '@/plugins/werewolf/history-store';

export async function GET(request: Request) {
  try {
    const limit = Math.max(1, Math.min(20, Number(requestUrl(request).searchParams.get('limit') || 8)));
    const entries = await listWerewolfHistory(limit);
    return jsonOk({ entries });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '获取历史对局记忆失败' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    await appendWerewolfHistory(body);
    return jsonOk({ success: true });
  } catch (error: any) {
    return jsonOk({ error: error?.message || '写入历史对局记忆失败' }, { status: 500 });
  }
}
