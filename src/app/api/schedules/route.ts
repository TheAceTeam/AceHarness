import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';

export async function GET() {
  try {
    await scheduler.init();
    return NextResponse.json({ jobs: scheduler.listJobs() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await scheduler.init();
    const body = await request.json();
    const job = await scheduler.createJob(body);
    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
