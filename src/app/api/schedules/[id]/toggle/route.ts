import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await scheduler.init();
    const { id } = await params;
    const job = await scheduler.toggleJob(id);
    return NextResponse.json({ job });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
