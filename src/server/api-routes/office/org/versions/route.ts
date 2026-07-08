import { listOfficeOrgVersions } from '@/lib/office/org-store';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function GET() {
  try {
    const versions = await listOfficeOrgVersions();
    return jsonOk({ versions });
  } catch (error: any) {
    return jsonOk(
      { error: '获取组织版本失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
