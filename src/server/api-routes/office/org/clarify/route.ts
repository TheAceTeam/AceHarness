import { createOfficeOrgClarification } from '@/lib/office/org-clarifier';
import { generateOfficeTeamPlan } from '@/lib/office/team-planner';
import { jsonOk, readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  try {
    const body = await readJsonBody<any>(request, {});
    const requirement = typeof body?.requirement === 'string' ? body.requirement : '';
    const candidateAgentNames = Array.isArray(body?.candidateAgentNames) ? body.candidateAgentNames : undefined;
    let availableAgentCount: number | undefined;
    if (requirement.trim()) {
      const plan = await generateOfficeTeamPlan({ requirement, maxMembers: 1, minMembers: 1, candidateAgentNames }).catch(() => null);
      availableAgentCount = plan?.availableAgentCount;
    }
    const clarification = createOfficeOrgClarification({ requirement, availableAgentCount });
    return jsonOk({ clarification });
  } catch (error: any) {
    return jsonOk(
      { error: '生成组织澄清问题失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
