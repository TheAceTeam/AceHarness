import { applyOfficeTeamPlan } from '@/lib/office/team-store';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const state = await applyOfficeTeamPlan({
      plan: body?.plan,
      requirement: body?.requirement,
      agentNames: Array.isArray(body?.agentNames) ? body.agentNames : undefined,
      assignments: Array.isArray(body?.assignments) ? body.assignments : undefined,
    });
    return jsonOk({ success: true, state });
  } catch (error: any) {
    return jsonOk(
      { error: '创建团队失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
