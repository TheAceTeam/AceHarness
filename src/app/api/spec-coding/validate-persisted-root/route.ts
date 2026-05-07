import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { assertPersistedSpecRootReady } from '@/lib/spec-persistence';

export async function POST(request: NextRequest) {
  const auth = await requireAuth(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const body = await request.json();
    const persistMode = body.persistMode === 'repository' ? 'repository' : 'none';
    if (persistMode !== 'repository') {
      return NextResponse.json({ valid: true });
    }

    const workingDirectory = String(body.workingDirectory || '').trim();
    const specRoot = String(body.specRoot || '').trim() || '.spec';
    if (!workingDirectory) {
      return NextResponse.json({ error: '缺少 workingDirectory' }, { status: 400 });
    }

    const specRootDir = assertPersistedSpecRootReady(workingDirectory, specRoot);
    return NextResponse.json({ valid: true, specRootDir });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '持久化 Spec 校验失败' }, { status: 400 });
  }
}
