import { NextRequest, NextResponse } from 'next/server';
import { scheduler } from '@/lib/core/scheduler';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await scheduler.init();
    const { id } = await params;
    const result = await scheduler.triggerNow(id);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
