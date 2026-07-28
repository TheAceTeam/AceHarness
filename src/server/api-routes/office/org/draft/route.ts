import { createOfficeOrgDraft } from '@/lib/office/org-store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const draft = await createOfficeOrgDraft({
      requirement: typeof body?.requirement === 'string' ? body.requirement : undefined,
      plan: body?.plan,
      nodes: Array.isArray(body?.nodes) ? body.nodes : undefined,
      edges: Array.isArray(body?.edges) ? body.edges : undefined,
      gaps: Array.isArray(body?.gaps) ? body.gaps : undefined,
      mode: body?.mode,
      clarificationAnswers: body?.clarificationAnswers,
      model: typeof body?.model === 'string' ? body.model : undefined,
    });
    return jsonOk({ success: true, draft });
  } catch (error: any) {
    return jsonOk(
      { error: '生成组织草案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
