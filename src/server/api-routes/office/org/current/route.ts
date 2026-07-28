import { getCurrentOfficeOrg } from '@/lib/office/org-store';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const org = await getCurrentOfficeOrg();
    return jsonOk({ org });
  } catch (error: any) {
    return jsonOk(
      { error: '获取当前组织失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
