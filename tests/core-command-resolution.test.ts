import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  launchCommand,
  normalizeChildProcessEnv,
  probeCommand,
  resolveCommand,
  type CommandAttempt,
} from '@/lib/core/resolved-command';
import { runCommand } from '@/lib/core/command-runner';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'aceh command fixture with spaces-'));
  temporaryDirectories.push(directory);
  return directory;
}

async function createVersionFixture(directory: string, name: string, windowsExtension: 'cmd' | 'bat' = 'cmd'): Promise<string> {
  const fileName = process.platform === 'win32' ? `${name}.${windowsExtension}` : name;
  const executable = join(directory, fileName);
  const content = process.platform === 'win32'
    ? '@echo off\r\necho fixture-version\r\nexit /b 0\r\n'
    : '#!/bin/sh\necho fixture-version\nexit 0\n';
  await writeFile(executable, content, 'utf8');
  if (process.platform !== 'win32') await chmod(executable, 0o755);
  return executable;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('shared command resolution', () => {
  test('resolves an explicit executable in a path containing spaces as one argv element', async () => {
    const directory = await temporaryDirectory();
    const executable = await createVersionFixture(directory, 'agent tool');
    const resolution = resolveCommand({
      id: 'fixture',
      candidates: ['missing-fixture'],
      fixedArgs: ['acp'],
      overrideEnvKey: 'ACEH_FIXTURE_COMMAND',
    }, {
      env: { ACEH_FIXTURE_COMMAND: executable },
    });

    expect(resolution.selected).toMatchObject({
      executable,
      args: ['acp'],
      source: 'explicit',
      resolved: true,
    });
    expect(resolution.selected?.executable).not.toContain('"');
  });

  test('does not fall back after an invalid explicit override', () => {
    const resolution = resolveCommand({
      id: 'fixture',
      candidates: ['fallback-fixture'],
      fixedArgs: [],
      overrideEnvKey: 'ACEH_FIXTURE_COMMAND',
    }, {
      env: { ACEH_FIXTURE_COMMAND: 'fixture --version' },
    });

    expect(resolution.selected).toBeUndefined();
    expect(resolution.attempts).toEqual([]);
    expect(resolution.diagnostics.rejectedOverride).toBe('contains-arguments');
  });

  test('uses configured search paths before process PATH', async () => {
    const directory = await temporaryDirectory();
    await createVersionFixture(directory, 'search-fixture');
    const command = process.platform === 'win32' ? 'search-fixture' : 'search-fixture';
    const resolution = resolveCommand({ id: 'fixture', candidates: [command], fixedArgs: [] }, {
      configuredSearchPaths: [directory],
      env: { PATH: '' },
    });

    expect(resolution.selected?.source).toBe('configured-path');
    expect(resolution.selected?.executable).toContain('search-fixture');
  });

  test('rejects CR/LF in an explicit override', () => {
    const resolution = resolveCommand({
      id: 'fixture',
      candidates: ['fallback-fixture'],
      fixedArgs: [],
      overrideEnvKey: 'ACEH_FIXTURE_COMMAND',
    }, {
      env: { ACEH_FIXTURE_COMMAND: 'fixture\r\n--version' },
    });

    expect(resolution.diagnostics.rejectedOverride).toBe('contains-crlf');
    expect(resolution.selected).toBeUndefined();
  });

  test('accepts one pair of outer quotes around an executable path', async () => {
    const directory = await temporaryDirectory();
    const executable = await createVersionFixture(directory, 'quoted fixture');
    const resolution = resolveCommand({
      id: 'fixture',
      candidates: ['fallback-fixture'],
      fixedArgs: [],
      overrideEnvKey: 'ACEH_FIXTURE_COMMAND',
    }, {
      env: { ACEH_FIXTURE_COMMAND: `"${executable}"` },
    });

    expect(resolution.selected?.executable).toBe(executable);
  });

  test('accepts a filesystem path containing legal cmd metacharacters', async () => {
    const directory = join(await temporaryDirectory(), 'tool & (fixture)');
    await mkdir(directory);
    const executable = await createVersionFixture(directory, 'metacharacter fixture');
    const resolution = resolveCommand({
      id: 'fixture',
      candidates: ['fallback-fixture'],
      fixedArgs: [],
      overrideEnvKey: 'ACEH_FIXTURE_COMMAND',
    }, {
      env: { ACEH_FIXTURE_COMMAND: executable },
    });

    expect(resolution.selected?.executable).toBe(executable);
    expect(resolution.diagnostics.rejectedOverride).toBeUndefined();
  });

  test('rejects PowerShell scripts without an explicit interpreter', () => {
    const resolution = resolveCommand({
      id: 'fixture',
      candidates: ['fallback-fixture'],
      fixedArgs: [],
      overrideEnvKey: 'ACEH_FIXTURE_COMMAND',
    }, {
      env: { ACEH_FIXTURE_COMMAND: 'C:\\Tools\\fixture.ps1' },
    });

    expect(resolution.selected).toBeUndefined();
    expect(resolution.diagnostics.rejectedOverride).toBe('ps1-without-interpreter');
  });

  test('normalizes PATH and Path together on Windows', () => {
    const environment = normalizeChildProcessEnv({ Path: 'C:\\tools' });
    if (process.platform === 'win32') {
      expect(environment.PATH).toBe('C:\\tools');
      expect(environment.Path).toBe('C:\\tools');
    } else {
      expect(environment).toEqual({ Path: 'C:\\tools' });
    }
  });
});

describe('shared command launcher', () => {
  test('probes a fixture under a path containing spaces', async () => {
    const directory = await temporaryDirectory();
    const executable = await createVersionFixture(directory, 'probe fixture');
    const attempt: CommandAttempt = {
      executable,
      args: [],
      source: 'explicit',
      fileKind: process.platform === 'win32' ? 'cmd' : 'unknown',
      candidateName: executable,
      resolved: true,
    };

    const result = await probeCommand(attempt);
    expect(result).toMatchObject({ ok: true, missing: false });
    expect(result.output).toContain('fixture-version');
  });

  test('probes a Windows batch fixture under a path containing spaces', async () => {
    const directory = await temporaryDirectory();
    const executable = await createVersionFixture(directory, 'batch fixture', 'bat');
    const attempt: CommandAttempt = {
      executable,
      args: [],
      source: 'explicit',
      fileKind: process.platform === 'win32' ? 'bat' : 'unknown',
      candidateName: executable,
      resolved: true,
    };

    const result = await probeCommand(attempt);
    expect(result).toMatchObject({ ok: true, missing: false });
    expect(result.output).toContain('fixture-version');
  });

  test('runs a native executable through structured argv', async () => {
    const result = await runCommand({
      command: process.execPath,
      args: ['--version'],
      cwd: process.cwd(),
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^v\d+/);
  });

  test('launches a resolved fixture without a caller-provided shell string', async () => {
    const directory = await temporaryDirectory();
    const executable = await createVersionFixture(directory, 'launch fixture');
    const attempt: CommandAttempt = {
      executable,
      args: ['--version'],
      source: 'explicit',
      fileKind: process.platform === 'win32' ? 'cmd' : 'unknown',
      candidateName: executable,
      resolved: true,
    };
    const child = launchCommand(attempt, { stdio: ['ignore', 'pipe', 'pipe'] });
    const output = await new Promise<string>((resolve, reject) => {
      let stdout = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`exit ${code}`)));
    });

    expect(output).toContain('fixture-version');
  });
});
