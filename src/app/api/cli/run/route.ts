import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { resolveConfiguredCommand, runCommand } from '@/lib/core/command-runner';
import { resolveWorkspaceRoot, workspaceErrorResponse } from '@/lib/core/workspace-path-safety';

export const dynamic = 'force-dynamic';

const ALLOWED_COMMANDS = new Set([
  'codespec',
]);

function normalizeCommandName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArgs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const workspace = typeof body?.workspace === 'string' ? body.workspace.trim() : '';
    const commandName = normalizeCommandName(body?.commandName);
    const args = normalizeArgs(body?.args);

    if (!workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }
    if (!commandName) {
      return NextResponse.json({ error: '缺少 commandName 参数' }, { status: 400 });
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(commandName)) {
      return NextResponse.json({ error: 'commandName 不合法' }, { status: 400 });
    }
    if (!ALLOWED_COMMANDS.has(commandName)) {
      return NextResponse.json({ error: `${commandName} 不在可执行 CLI 允许列表中` }, { status: 403 });
    }

    const cwd = await resolveWorkspaceRoot(workspace);
    const { command, env } = resolveConfiguredCommand(commandName, { userId: auth.id });
    if (!command) {
      return NextResponse.json({ error: `未找到 ${commandName} CLI，请先安装并确认 PATH 配置可用` }, { status: 404 });
    }

    const label = [commandName, ...args].join(' ');
    const result = await runCommand({
      command,
      args,
      cwd,
      env,
      timeoutLabel: label,
    });

    const success = result.exitCode === 0;
    const error = success
      ? null
      : (result.stderr || result.stdout || `${label} 退出码 ${result.exitCode}`).trim();

    return NextResponse.json({
      success,
      commandName,
      commandLine: label,
      workspace: cwd,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      error,
    });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message || error?.message || '命令执行失败' }, { status });
  }
}
