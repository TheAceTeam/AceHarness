import { NextRequest, NextResponse } from 'next/server';
import { applyOfficeTeamPlan } from '@/lib/office/team-store';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const state = await applyOfficeTeamPlan({
      plan: body?.plan,
      requirement: body?.requirement,
      agentNames: Array.isArray(body?.agentNames) ? body.agentNames : undefined,
      assignments: Array.isArray(body?.assignments) ? body.assignments : undefined,
    });
    return NextResponse.json({ success: true, state });
  } catch (error: any) {
    return NextResponse.json(
      { error: '创建团队失败', message: error?.message || String(error) },
      { status: 400 }
    );
  }
}
