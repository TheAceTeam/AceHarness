import { getCurrentOfficeTeam } from '@/lib/office/team-store';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const state = await getCurrentOfficeTeam();
    return jsonOk({ state });
  } catch (error: any) {
    return jsonOk(
      { error: '获取办公室状态失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
