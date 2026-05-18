import { NextRequest, NextResponse } from 'next/server';
import { loadEnvVars, saveEnvVars } from '@/lib/core/env-manager';
import { requireAuth } from '@/lib/auth/middleware';

export async function GET(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  const scope = new URL(request.url).searchParams.get('scope') || 'system';
  if (scope === 'user') {
    const vars = await loadEnvVars({ scope: 'user', userId: auth.id });
    return NextResponse.json({ vars, scope: 'user' });
  }
  if (scope === 'merged') {
    const vars = await loadEnvVars({ scope: 'merged', userId: auth.id });
    return NextResponse.json({ vars, scope: 'merged' });
  }
  const vars = await loadEnvVars({ scope: 'system' });
  return NextResponse.json({ vars, scope: 'system' });
}

export async function PUT(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const scope = body.scope === 'user' ? 'user' : 'system';
    if (scope === 'system' && auth.role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可修改全局环境变量' }, { status: 403 });
    }
    await saveEnvVars(body.vars || [], scope === 'user' ? { scope: 'user', userId: auth.id } : { scope: 'system' });
    return NextResponse.json({ success: true, scope });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
