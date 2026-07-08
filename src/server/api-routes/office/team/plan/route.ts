import { generateOfficeTeamPlan } from '@/lib/office/team-planner';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const plan = await generateOfficeTeamPlan({
      requirement: String(body?.requirement || ''),
      maxMembers: Number.isFinite(body?.maxMembers) ? Number(body.maxMembers) : undefined,
      minMembers: Number.isFinite(body?.minMembers) ? Number(body.minMembers) : undefined,
      candidateAgentNames: Array.isArray(body?.candidateAgentNames) ? body.candidateAgentNames : undefined,
    });
    return jsonOk({ plan });
  } catch (error: any) {
    return jsonOk(
      { error: '生成团队方案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
