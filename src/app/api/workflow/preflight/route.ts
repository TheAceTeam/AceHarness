import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-middleware';
import { runWorkflowPreflight } from '@/lib/workflow-preflight';

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const configFile = String(body?.configFile || '').trim();
    if (!configFile) {
      return NextResponse.json({ error: '缺少配置文件参数' }, { status: 400 });
    }

    const result = await runWorkflowPreflight(configFile, user.personalDir || '');
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '执行 preflight 失败' },
      { status: 500 }
    );
  }
}
