import { exec } from 'child_process';
import { promisify } from 'util';
import { resolve } from 'path';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { getWorkspaceRoot } from '@/lib/core/app-paths';
import { getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import type { PersistedQualityCheck, PersistedQualityCommandResult } from '@/lib/run/state-persistence';

const execAsync = promisify(exec);
const EXEC_TIMEOUT_MS = 10 * 60 * 1000;

function resolveProjectRoot(personalDir: string, projectRoot?: string | null): string {
  const baseDir = personalDir || getWorkspaceRoot();
  return projectRoot ? resolve(baseDir, projectRoot) : baseDir;
}

export function classifyQualityCommand(command: string): 'lint' | 'compile' | 'test' | 'custom' {
  const normalized = command.toLowerCase();
  if (/eslint|lint|cjlint/.test(normalized)) return 'lint';
  if (/tsc|build|compile|cjc|cjpm build|make/.test(normalized)) return 'compile';
  if (/test|pytest|jest|vitest|cjpm test/.test(normalized)) return 'test';
  return 'custom';
}

export function truncate(text: string, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}\n...(截断)...` : text;
}

type PreflightCommand = {
  command: string;
  origin: 'workflow' | 'inferred';
  configFile?: string;
  cwd?: string;
};

type PreflightOptions = {
  configContent?: string;
  /** Exact run-owned contents for the root workflow and every referenced subworkflow. */
  configContents?: Record<string, string>;
};

export async function getWorkflowPreflightPlan(
  configFile: string,
  personalDir: string,
  workingDirectory?: string,
  options: PreflightOptions = {},
): Promise<{
  cwd: string;
  commands: PreflightCommand[];
  policy: {
    blockOnFailure: boolean;
    allowOnWarning: boolean;
    inferredCommandCount: number;
  };
}> {
  if (options.configContents) {
    const orderedFiles = [
      configFile,
      ...Object.keys(options.configContents).filter((file) => file !== configFile).sort(),
    ].filter((file, index, files) => files.indexOf(file) === index);
    const plans = await Promise.all(orderedFiles.map(async (file) => getWorkflowPreflightPlan(
      file,
      personalDir,
      workingDirectory,
      { configContent: options.configContents?.[file] },
    )));
    const commands: PreflightCommand[] = [];
    const seen = new Set<string>();
    for (let index = 0; index < plans.length; index += 1) {
      const plan = plans[index];
      const file = orderedFiles[index];
      for (const item of plan.commands) {
        const key = `${plan.cwd}\0${item.command}`;
        if (seen.has(key)) continue;
        seen.add(key);
        commands.push({ ...item, configFile: file, cwd: plan.cwd });
      }
    }
    return {
      cwd: plans[0]?.cwd || resolveProjectRoot(personalDir, workingDirectory),
      commands,
      policy: {
        blockOnFailure: true,
        allowOnWarning: true,
        inferredCommandCount: commands.filter((command) => command.origin === 'inferred').length,
      },
    };
  }

  const raw = options.configContent ?? await readFile(await getRuntimeWorkflowConfigPath(configFile), 'utf-8');
  const config = parse(raw) as any;
  const cwd = resolveProjectRoot(personalDir, workingDirectory || config?.context?.projectRoot);
  const commands = await collectPreflightCommands(config, cwd);
  return {
    cwd,
    commands,
    policy: {
      blockOnFailure: true,
      allowOnWarning: true,
      inferredCommandCount: commands.filter((command) => command.origin === 'inferred').length,
    },
  };
}

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

export async function runWorkflowPreflight(
  configFile: string,
  personalDir: string,
  workingDirectory?: string,
  options: PreflightOptions = {},
): Promise<{
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
  const { cwd, commands, policy } = await getWorkflowPreflightPlan(configFile, personalDir, workingDirectory, options);

  if (commands.length === 0) {
    return {
      ok: true,
      cwd,
      checks: [],
      failedCount: 0,
      warningCount: 0,
      policy,
    };
  }

  const checks: PersistedQualityCheck[] = [];
  let failedCount = 0;
  let warningCount = 0;

  for (const item of commands) {
    const command = item.command;
    const commandCwd = item.cwd || cwd;
    let result: PersistedQualityCommandResult;
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: commandCwd,
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
      ...(item.configFile ? { configFile: item.configFile } : {}),
      ...(item.cwd ? { cwd: item.cwd } : {}),
      summary: result.status === 'passed'
        ? `${item.configFile ? `[${item.configFile}] ` : ''}${item.origin === 'inferred' ? '[推断]' : '[配置]'} ${command} 通过`
        : result.status === 'failed'
          ? `${item.configFile ? `[${item.configFile}] ` : ''}${item.origin === 'inferred' ? '[推断]' : '[配置]'} ${command} 失败`
          : `${item.configFile ? `[${item.configFile}] ` : ''}${item.origin === 'inferred' ? '[推断]' : '[配置]'} ${command} 返回警告`,
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
    policy,
  };
}
