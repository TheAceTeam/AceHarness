import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveConfiguredCommand, runCommand } from '@/lib/core/command-runner';
import { resolveWorkspaceRoot, workspaceErrorResponse } from '@/lib/core/workspace-path-safety';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const workspace = typeof body?.workspace === 'string' ? body.workspace.trim() : '';
    const generate = body?.generate === true;
    if (!workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }

    const cwd = await resolveWorkspaceRoot(workspace);
    const { command, env } = resolveConfiguredCommand('codespec', { userId: auth.id });
    if (!command) {
      return NextResponse.json({ error: '未找到 codespec CLI，请先安装并确认 PATH 配置可用' }, { status: 404 });
    }

    const args = generate ? ['sync', '--generate'] : ['sync'];
    const label = generate ? 'codespec sync --generate' : 'codespec sync';
    const result = await runCommand({
      command,
      args,
      cwd,
      env,
      timeoutLabel: label,
    });

    if (result.exitCode !== 0) {
      const message = (result.stderr || result.stdout || `${label} 退出码 ${result.exitCode}`).trim();
      return NextResponse.json({
        success: false,
        error: message,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      workspace: cwd,
      command: label,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message || error?.message || 'CodeSpec 同步失败' }, { status });
  }
}
