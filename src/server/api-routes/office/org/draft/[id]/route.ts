import { getOfficeOrgDraft, updateOfficeOrgDraft } from '@/lib/office/org-store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function GET(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await getOfficeOrgDraft(id);
    if (!draft) return jsonOk({ error: '组织草案不存在' }, { status: 404 });
    return jsonOk({ draft });
  } catch (error: any) {
    return jsonOk(
      { error: '获取组织草案失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } | Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await readJsonBody<any>(request, {});
    const draft = await updateOfficeOrgDraft(id, {
      requirement: typeof body?.requirement === 'string' ? body.requirement : undefined,
      nodes: Array.isArray(body?.nodes) ? body.nodes : undefined,
      edges: Array.isArray(body?.edges) ? body.edges : undefined,
      gaps: Array.isArray(body?.gaps) ? body.gaps : undefined,
      clarificationAnswers: body?.clarificationAnswers,
    });
    return jsonOk({ success: true, draft });
  } catch (error: any) {
    return jsonOk(
      { error: '更新组织草案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
