import { NextRequest, NextResponse } from 'next/server';
import { generateOfficeTeamPlan } from '@/lib/office/team-planner';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const plan = await generateOfficeTeamPlan({
      requirement: String(body?.requirement || ''),
      maxMembers: Number.isFinite(body?.maxMembers) ? Number(body.maxMembers) : undefined,
      minMembers: Number.isFinite(body?.minMembers) ? Number(body.minMembers) : undefined,
      candidateAgentNames: Array.isArray(body?.candidateAgentNames) ? body.candidateAgentNames : undefined,
    });
    return NextResponse.json({ plan });
  } catch (error: any) {
    return NextResponse.json(
      { error: '生成团队方案失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
