import { NextRequest, NextResponse } from 'next/server';
import { loadRunState } from '@/lib/run-state-persistence';
import { loadWorkflowFinalReview } from '@/lib/workflow-experience-store';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const id = (await params).id;
    const [state, finalReview] = await Promise.all([
      loadRunState(id),
      loadWorkflowFinalReview(id),
    ]);
    if (!state) {
      return NextResponse.json({ error: '运行详情不存在' }, { status: 404 });
    }
    return NextResponse.json({
      ...state,
      finalReview,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行详情失败', message: error.message },
      { status: 500 }
    );
  }
}
