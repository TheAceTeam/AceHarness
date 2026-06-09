import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';
import { assertScheduleWorkflowConfig } from '@/lib/core/schedule-validation';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    await scheduler.init();
    return NextResponse.json({ jobs: scheduler.listJobs() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    await scheduler.init();
    const body = await request.json();
    await assertScheduleWorkflowConfig(body?.configFile);
    const job = await scheduler.createJob({
      ...body,
      createdBy: user.id,
      createdByName: user.username,
    });
    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
