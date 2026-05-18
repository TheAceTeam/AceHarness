import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { CHANNEL_PROVIDER_PRESETS } from '@/lib/channel/providers';

export async function GET(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;
  return NextResponse.json({ providers: CHANNEL_PROVIDER_PRESETS });
}
