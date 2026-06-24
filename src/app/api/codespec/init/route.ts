import { NextRequest, NextResponse } from 'next/server';
import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { requireAuth } from '@/lib/auth/middleware';
import { buildConfiguredProcessEnvSync, getConfiguredCliSearchPaths } from '@/lib/core/configured-env';
import { findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { resolveWorkspaceRoot, workspaceErrorResponse } from '@/lib/core/workspace-path-safety';
import { isWindows } from '@/lib/core/runtime-platform';

export const dynamic = 'force-dynamic';

const COMMAND_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 256 * 1024;

function escapeWinCmdToken(value: string): string {
  if (value === '') return '""';
  if (/[\s"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function resolveWindowsCmdShell(): string {
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
    .map((item) => item?.trim())
    .filter(Boolean) as string[];
  const candidates = [
    process.env.ComSpec?.trim(),
    ...roots.flatMap((root) => [join(root, 'System32', 'cmd.exe'), join(root, 'Sysnative', 'cmd.exe'), join(root, 'cmd.exe')]),
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => candidate.toLowerCase().endsWith('cmd.exe') && existsSync(candidate)) || candidates[0];
}

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  if (next.length <= OUTPUT_LIMIT) return next;
  return next.slice(next.length - OUTPUT_LIMIT);
}

function closeProcessTree(child: ChildProcess): void {
  if (child.killed || child.exitCode !== null) return;
  if (isWindows() && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  child.kill('SIGTERM');
  setTimeout(() => {
    if (!child.killed && child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }, 3000);
}

function spawnCodespec(command: string, cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  if (!isWindows()) {
    return spawn(command, ['init'], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }

  const line = [command, 'init'].map(escapeWinCmdToken).join(' ');
  return spawn(line, {
    shell: resolveWindowsCmdShell(),
    windowsHide: true,
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

async function runCodespecInit(command: string, cwd: string, env: NodeJS.ProcessEnv) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolve, reject) => {
    const child = spawnCodespec(command, cwd, env);
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      closeProcessTree(child);
      reject(new Error('codespec init 执行超时'));
    }, COMMAND_TIMEOUT_MS);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendOutput(stdout, chunk);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendOutput(stderr, chunk);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode });
    });

    child.stdin?.end();
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json().catch(() => ({}));
    const workspace = typeof body?.workspace === 'string' ? body.workspace.trim() : '';
    if (!workspace) {
      return NextResponse.json({ error: '缺少 workspace 参数' }, { status: 400 });
    }

    const cwd = await resolveWorkspaceRoot(workspace);
    const env = buildConfiguredProcessEnvSync(undefined, process.env, { userId: auth.id });
    const configuredPaths = getConfiguredCliSearchPaths(getCommonCliSearchPaths(), { userId: auth.id });
    const command = findCommand('codespec', configuredPaths);
    if (!command) {
      return NextResponse.json({ error: '未找到 codespec CLI，请先安装并确认 PATH 配置可用' }, { status: 404 });
    }

    const result = await runCodespecInit(command, cwd, env);
    if (result.exitCode !== 0) {
      const message = (result.stderr || result.stdout || `codespec init 退出码 ${result.exitCode}`).trim();
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
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  } catch (error: any) {
    const { message, status } = workspaceErrorResponse(error);
    return NextResponse.json({ error: message || error?.message || 'CodeSpec 初始化失败' }, { status });
  }
}
