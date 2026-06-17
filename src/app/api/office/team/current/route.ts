import { NextResponse } from 'next/server';
import { getCurrentOfficeTeam } from '@/lib/office/team-store';

export async function GET() {
  try {
    const state = await getCurrentOfficeTeam();
    return NextResponse.json({ state });
  } catch (error: any) {
    return NextResponse.json(
      { error: '获取办公室状态失败', message: error?.message || String(error) },
      { status: 500 }
    );
  }
}
