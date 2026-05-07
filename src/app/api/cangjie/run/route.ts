import { existsSync } from 'fs';
import { mkdtemp, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { resolve, join } from 'path';
import { spawn } from 'child_process';
import { NextRequest, NextResponse } from 'next/server';
import { detectCangjieHome, buildCangjieSpawnEnv, buildCjpmShellCommand } from '@/lib/cangjie-env';
import { requireAuth } from '@/lib/auth-middleware';

interface RunCangjieRequest {
  code: string;
  sourceName?: string;
  origin?: 'markdown' | 'workspace';
}

function sanitizeSourceName(name?: string) {
  if (!name) return 'main.cj';
  // strip extensions, keep only alphanumeric/underscore, max 32 chars
  const base = name
    .replace(/\.[^.]*$/, '')          // strip last extension
    .replace(/\.[^.]*$/, '')          // strip second-to-last extension (e.g. .cj.md → strip .md then .cj)
    .replace(/[^a-zA-Z0-9_]/g, '_')  // replace non-alphanumeric with _
    .replace(/^_+|_+$/g, '')          // trim leading/trailing underscores
    .slice(0, 32)
    || 'main';
  return `${base}.cj`;
}

function runProcess(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) {
  return new Promise<{ stdout: string; stderr: string; exitCode: number | null }>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killedByTimeout = false;

    const timer = setTimeout(() => {
      killedByTimeout = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(0, 200_000) + '\n...[stdout truncated]';
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(0, 200_000) + '\n...[stderr truncated]';
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        reject(new Error('执行超时'));
        return;
      }
      resolvePromise({ stdout, stderr, exitCode });
    });
  });
}

async function buildRunCommand(cangjieHome: string, tempDir: string, sourceName: string, outputPath: string, options?: { userId?: string }) {
  const outputName = process.platform === 'win32' ? 'main_exec.exe' : 'main_exec';
  const compileCommand = `cjc ${JSON.stringify(sourceName)} -o ${JSON.stringify(outputName)}`;
  const executeCommand = process.platform === 'win32' ? `./${outputName}` : `./${outputName}`;

  if (process.platform === 'win32') {
    const env = await buildCangjieSpawnEnv(cangjieHome, process.env as Record<string, string | undefined>, options);
    return {
      mode: 'direct' as const,
      command: process.platform === 'win32' ? 'cjc.exe' : 'cjc',
      args: [sourceName, '-o', outputPath],
      env: env as NodeJS.ProcessEnv,
      commandSummary: `cjc ${sourceName} -o ${outputName}`,
      runCommand: outputPath,
      runArgs: [] as string[],
      runSummary: outputName,
    };
  }

  const shellCommand = await buildCjpmShellCommand(cangjieHome, `${compileCommand} && ${executeCommand}`, tempDir, options);
  const env = await buildCangjieSpawnEnv(cangjieHome, process.env as Record<string, string | undefined>, options);

  return {
    mode: 'shell' as const,
    command: shellCommand.command,
    args: shellCommand.args,
    env: env as NodeJS.ProcessEnv,
    commandSummary: `source ${resolve(cangjieHome, 'envsetup.sh')} && cjc ${sourceName} -o ${outputName} && ./${outputName}`,
    runCommand: null,
    runArgs: [] as string[],
    runSummary: `./${outputName}`,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  let baseTmpDir: string | null = null;
  let tempDir: string | null = null;
  let outputPath: string | null = null;

  try {
    const body = await req.json() as RunCangjieRequest;
    const code = typeof body.code === 'string' ? body.code : '';
    if (!code.trim()) {
      return NextResponse.json({ error: '代码不能为空' }, { status: 400 });
    }
    if (code.length > 200_000) {
      return NextResponse.json({ error: '代码过长，无法运行' }, { status: 400 });
    }

    const cangjieHome = await detectCangjieHome({ userId: auth.id });
    if (!cangjieHome) {
      return NextResponse.json({ error: '未检测到 CANGJIE_HOME，请先在环境变量中配置仓颉 SDK 根目录' }, { status: 400 });
    }

    const setupScript = resolve(cangjieHome, 'envsetup.sh');
    if (process.platform !== 'win32' && !existsSync(setupScript)) {
      return NextResponse.json({ error: `未找到 envsetup.sh: ${setupScript}` }, { status: 400 });
    }

    baseTmpDir = await mkdtemp(join(tmpdir(), 'aceharness-cangjie-'));
    tempDir = await mkdtemp(join(baseTmpDir, 'run-'));

    const sourceName = sanitizeSourceName(body.sourceName);
    const sourcePath = resolve(tempDir, sourceName);
    outputPath = resolve(tempDir, process.platform === 'win32' ? 'main_exec.exe' : 'main_exec');

    await writeFile(sourcePath, code, 'utf-8');

    const commandConfig = await buildRunCommand(cangjieHome, tempDir, sourceName, outputPath, { userId: auth.id });

    const compileResult = await runProcess(commandConfig.command, commandConfig.args, {
      cwd: tempDir,
      env: commandConfig.env,
      timeoutMs: 20_000,
    });

    if (compileResult.exitCode !== 0) {
      return NextResponse.json({
        success: false,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        combinedOutput: [compileResult.stdout, compileResult.stderr].filter(Boolean).join('\n'),
        exitCode: compileResult.exitCode,
        commandSummary: commandConfig.commandSummary,
        env: { cangjieHome, platform: process.platform, usedEnvsetup: true },
        error: '编译失败',
      }, { status: 200 });
    }

    if (commandConfig.mode === 'shell') {
      return NextResponse.json({
        success: compileResult.exitCode === 0,
        stdout: compileResult.stdout,
        stderr: compileResult.stderr,
        combinedOutput: [compileResult.stdout, compileResult.stderr].filter(Boolean).join('\n'),
        exitCode: compileResult.exitCode,
        commandSummary: commandConfig.commandSummary,
        env: { cangjieHome, platform: process.platform, usedEnvsetup: true },
      });
    }

    const runResult = await runProcess(commandConfig.runCommand!, commandConfig.runArgs, {
      cwd: tempDir,
      env: commandConfig.env,
      timeoutMs: 20_000,
    });

    return NextResponse.json({
      success: runResult.exitCode === 0,
      stdout: runResult.stdout,
      stderr: [compileResult.stderr, runResult.stderr].filter(Boolean).join('\n'),
      combinedOutput: [compileResult.stdout, compileResult.stderr, runResult.stdout, runResult.stderr].filter(Boolean).join('\n'),
      exitCode: runResult.exitCode,
      commandSummary: `${commandConfig.commandSummary} && ${commandConfig.runSummary}`,
      env: { cangjieHome, platform: process.platform, usedEnvsetup: true },
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      stdout: '',
      stderr: error?.message || '运行失败',
      combinedOutput: error?.message || '运行失败',
      exitCode: null,
      error: error?.message || '运行失败',
    }, { status: 500 });
  } finally {
    if (outputPath) {
      await unlink(outputPath).catch(() => {});
    }
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
    if (baseTmpDir) {
      await rm(baseTmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
