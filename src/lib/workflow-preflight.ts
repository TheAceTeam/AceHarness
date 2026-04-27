import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { getWorkspaceRoot } from '@/lib/app-paths';
import { getRuntimeWorkflowConfigPath } from '@/lib/runtime-configs';
import type { PersistedQualityCheck, PersistedQualityCommandResult } from '@/lib/run-state-persistence';

const execAsync = promisify(exec);
const EXEC_TIMEOUT_MS = 10 * 60 * 1000;

function resolveProjectRoot(personalDir: string, projectRoot?: string | null): string {
  const baseDir = personalDir || getWorkspaceRoot();
  return projectRoot ? resolve(baseDir, projectRoot) : baseDir;
}

function classifyQualityCommand(command: string): 'lint' | 'compile' | 'test' | 'custom' {
  const normalized = command.toLowerCase();
  if (/eslint|lint|cjlint/.test(normalized)) return 'lint';
  if (/tsc|build|compile|cjc|cjpm build|make/.test(normalized)) return 'compile';
  if (/test|pytest|jest|vitest|cjpm test/.test(normalized)) return 'test';
  return 'custom';
}

function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n...(截断)...` : text;
}

type PreflightCommand = {
  command: string;
  origin: 'workflow' | 'inferred';
};

async function inferProjectPreflightCommands(cwd: string): Promise<PreflightCommand[]> {
  const commands: PreflightCommand[] = [];
  let packageJson: any = null;

  try {
    packageJson = JSON.parse(await readFile(resolve(cwd, 'package.json'), 'utf-8'));
  } catch {
    packageJson = null;
  }

  const scripts = packageJson?.scripts && typeof packageJson.scripts === 'object' ? packageJson.scripts : {};
  const hasScript = (name: string) => typeof scripts[name] === 'string' && scripts[name].trim().length > 0;
  const add = (command: string) => {
    if (!command.trim()) return;
    if (commands.some((item) => item.command === command)) return;
    commands.push({ command, origin: 'inferred' });
  };

  if (hasScript('lint')) add('npm run lint');
  if (hasScript('typecheck')) add('npm run typecheck');
  else if (hasScript('build')) add('npm run build');
  else {
    try {
      await readFile(resolve(cwd, 'tsconfig.json'), 'utf-8');
      add('npx tsc --noEmit');
    } catch {
      // ignore
    }
  }
  if (hasScript('test')) add('npm run test');

  try {
    await readFile(resolve(cwd, 'cjpm.toml'), 'utf-8');
    add('cjpm build');
  } catch {
    try {
      await readFile(resolve(cwd, 'cjpm.yaml'), 'utf-8');
      add('cjpm build');
    } catch {
      // ignore
    }
  }

  return commands.slice(0, 4);
}

async function collectPreflightCommands(config: any, cwd: string): Promise<PreflightCommand[]> {
  const steps = Array.isArray(config?.workflow?.states)
    ? config.workflow.states.flatMap((state: any) => state?.steps || [])
    : Array.isArray(config?.workflow?.phases)
      ? config.workflow.phases.flatMap((phase: any) => phase?.steps || [])
      : [];

  const commands = new Set<string>();
  const collected: PreflightCommand[] = [];
  for (const step of steps) {
    for (const command of Array.isArray(step?.preCommands) ? step.preCommands : []) {
      const normalized = String(command || '').trim();
      if (normalized && !commands.has(normalized)) {
        commands.add(normalized);
        collected.push({ command: normalized, origin: 'workflow' });
      }
    }
  }

  if (collected.length > 0) return collected;
  return inferProjectPreflightCommands(cwd);
}

export async function runWorkflowPreflight(configFile: string, personalDir: string): Promise<{
  ok: boolean;
  cwd: string;
  checks: PersistedQualityCheck[];
  failedCount: number;
  warningCount: number;
  policy: {
    blockOnFailure: boolean;
    allowOnWarning: boolean;
    inferredCommandCount: number;
  };
}> {
  const configPath = await getRuntimeWorkflowConfigPath(configFile);
  const raw = await readFile(configPath, 'utf-8');
  const config = parse(raw) as any;
  const cwd = resolveProjectRoot(personalDir, config?.context?.projectRoot);
  const commands = await collectPreflightCommands(config, cwd);

  if (commands.length === 0) {
    return {
      ok: true,
      cwd,
      checks: [],
      failedCount: 0,
      warningCount: 0,
      policy: {
        blockOnFailure: true,
        allowOnWarning: true,
        inferredCommandCount: 0,
      },
    };
  }

  const checks: PersistedQualityCheck[] = [];
  let failedCount = 0;
  let warningCount = 0;

  for (const item of commands) {
    const command = item.command;
    let result: PersistedQualityCommandResult;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: EXEC_TIMEOUT_MS,
        maxBuffer: 1024 * 1024 * 8,
        env: process.env,
      });
      result = {
        command,
        exitCode: 0,
        status: 'passed',
        stdout: truncate(stdout || '', 1200),
        stderr: truncate(stderr || '', 1200),
      };
    } catch (error: any) {
      const exitCode = typeof error?.code === 'number' ? error.code : null;
      const status = exitCode === null ? 'warning' : 'failed';
      if (status === 'failed') failedCount += 1;
      else warningCount += 1;
      result = {
        command,
        exitCode,
        status,
        stdout: truncate(error?.stdout || '', 1200),
        stderr: truncate(error?.stderr || '', 1200),
        errorText: truncate(error?.message || String(error), 1200),
      };
    }

    const category = classifyQualityCommand(command);
    checks.push({
      id: `preflight-${category}-${checks.length + 1}`,
      stateName: '__preflight__',
      stepName: '__preflight__',
      agent: 'system',
      category,
      status: result.status,
      origin: item.origin,
      summary: result.status === 'passed'
        ? `${item.origin === 'inferred' ? '[推断]' : '[配置]'} ${command} 通过`
        : result.status === 'failed'
          ? `${item.origin === 'inferred' ? '[推断]' : '[配置]'} ${command} 失败`
          : `${item.origin === 'inferred' ? '[推断]' : '[配置]'} ${command} 返回警告`,
      createdAt: new Date().toISOString(),
      commands: [result],
    });
  }

  return {
    ok: failedCount === 0,
    cwd,
    checks,
    failedCount,
    warningCount,
    policy: {
      blockOnFailure: true,
      allowOnWarning: true,
      inferredCommandCount: checks.filter((check) => check.origin === 'inferred').length,
    },
  };
}
