import { NextRequest, NextResponse } from 'next/server';
import { listRuns, createRun } from '@/lib/run/store';
import type { RunRecord } from '@/lib/run/store';
import { formatTimestamp } from '@/lib/core/utils';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  try {
    const allRuns = await listRuns();
    // Admin sees all, user sees public + own
    let runs = allRuns;
    if (!(user instanceof NextResponse) && user.role !== 'admin') {
      runs = allRuns.filter((r: any) =>
        r.visibility !== 'private' || r.createdBy === user.id
      );
    }
    return NextResponse.json({ runs });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  try {
    const body = await request.json();
    const record: RunRecord = {
      id: `run-${formatTimestamp()}`,
      configFile: body.configFile,
      configName: body.configName || body.configFile,
      startTime: new Date().toISOString(),
      endTime: null,
      status: 'running',
      currentPhase: null,
      totalSteps: body.totalSteps || 0,
      completedSteps: 0,
    };
    // Add createdBy if authenticated
    if (!(user instanceof NextResponse)) {
      (record as any).createdBy = user.id;
    }
    await createRun(record);
    return NextResponse.json({ success: true, id: record.id });
  } catch (error: any) {
    return NextResponse.json(
      { error: '创建运行记录失败', message: error.message },
      { status: 500 }
    );
  }
}
