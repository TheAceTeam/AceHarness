import { restoreOfficeOrgVersion } from '@/lib/office/org-store';
import { jsonOk } from '@/server/api-route-runtime/request-utils';

export async function POST(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await restoreOfficeOrgVersion(id);
    return jsonOk({ success: true, ...result });
  } catch (error: any) {
    return jsonOk(
      { error: '恢复组织版本失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
