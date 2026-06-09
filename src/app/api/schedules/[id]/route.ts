import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';
import { requireAuth } from '@/lib/auth/middleware';
import { assertScheduleWorkflowConfig } from '@/lib/core/schedule-validation';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(_req);
  if (user instanceof NextResponse) return user;

  try {
    await scheduler.init();
    const { id } = await params;
    const job = scheduler.getJob(id);
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(req);
  if (user instanceof NextResponse) return user;

  try {
    await scheduler.init();
    const { id } = await params;
    const body = await req.json();
    if (body?.configFile) {
      await assertScheduleWorkflowConfig(body.configFile);
    }
    const job = await scheduler.updateJob(id, body);
    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAuth(_req);
  if (user instanceof NextResponse) return user;

  try {
    await scheduler.init();
    const { id } = await params;
    await scheduler.deleteJob(id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
