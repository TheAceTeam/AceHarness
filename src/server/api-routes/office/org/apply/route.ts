import { applyOfficeOrgDraft } from '@/lib/office/org-store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const result = await applyOfficeOrgDraft({
      draftId: typeof body?.draftId === 'string' ? body.draftId : undefined,
      org: body?.org,
    });
    return jsonOk({ success: true, ...result });
  } catch (error: any) {
    return jsonOk(
      { error: '应用组织草案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
