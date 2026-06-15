import { NextRequest, NextResponse } from 'next/server';
import { createOfficeOrgClarification } from '@/lib/office/org-clarifier';
import { generateOfficeTeamPlan } from '@/lib/office/team-planner';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const requirement = typeof body?.requirement === 'string' ? body.requirement : '';
    let availableAgentCount: number | undefined;
    if (requirement.trim()) {
      const plan = await generateOfficeTeamPlan({ requirement, maxMembers: 1, minMembers: 1 }).catch(() => null);
      availableAgentCount = plan?.availableAgentCount;
    }
    const clarification = createOfficeOrgClarification({ requirement, availableAgentCount });
    return NextResponse.json({ clarification });
  } catch (error: any) {
    return NextResponse.json(
      { error: '生成组织澄清问题失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
