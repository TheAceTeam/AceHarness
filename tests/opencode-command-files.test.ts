import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import {
  discoverOpenCodeCommandFileFallback,
  mergeOpenCodeCommandLists,
  resolveOpenCodeGlobalConfigDirectories,
  resolveOpenCodeProjectConfigDirectories,
} from '@/lib/engines/opencode-command-files';

function writeCommand(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

describe('OpenCode command file fallback discovery', () => {
  let tempRoot = '';

  afterEach(() => {
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = '';
    }
  });

  test('discovers global and working directory command markdown files', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'aceharness-opencode-commands-'));
    const project = join(tempRoot, 'project');
    const cwd = join(project, 'packages', 'app');
    const xdgConfig = join(tempRoot, 'xdg-config');
    const home = join(tempRoot, 'home');
    mkdirSync(join(project, '.git'), { recursive: true });

    writeCommand(
      join(cwd, '.opencode', 'commands', 'project', 'deploy.md'),
      '---\ndescription: Deploy from project\n---\nProject command',
    );
    writeCommand(
      join(project, '.opencode', 'commands', 'parent.md'),
      '---\ndescription: Parent project command\n---\nParent command',
    );
    writeCommand(
      join(home, '.opencode', 'commands', 'home.md'),
      '---\ndescription: Home dot-opencode command\n---\nHome command',
    );
    writeCommand(
      join(xdgConfig, 'opencode', 'commands', 'global.md'),
      '---\ndescription: Global command\n---\nGlobal command',
    );
    writeCommand(
      join(xdgConfig, 'opencode', 'command', 'renamed.md'),
      '---\nname: alias-name\ndescription: Renamed command\n---\nRenamed command',
    );

    const commands = await discoverOpenCodeCommandFileFallback({
      workingDirectory: cwd,
      env: { XDG_CONFIG_HOME: xdgConfig },
      homeDir: home,
      platform: 'linux',
    });

    expect(commands.map((command) => command.name)).toEqual([
      'project/deploy',
      'parent',
      'home',
      'alias-name',
      'global',
    ]);
    expect(commands.find((command) => command.name === 'project/deploy')?.description).toBe('Deploy from project');
    expect(commands.find((command) => command.name === 'parent')?.description).toBe('Parent project command');
    expect(commands.find((command) => command.name === 'home')?.description).toBe('Home dot-opencode command');
    expect(commands.find((command) => command.name === 'global')?.description).toBe('Global command');
  });

  test('keeps discovered commands before fallback duplicates', () => {
    const merged = mergeOpenCodeCommandLists(
      [{ name: 'review', description: 'remote review' }],
      [
        { name: 'REVIEW', description: 'file review', source: 'command-file' },
        { name: 'local-only', description: 'local only', source: 'command-file' },
      ],
    );

    expect(merged).toEqual([
      { name: 'review', description: 'remote review' },
      { name: 'local-only', description: 'local only', source: 'command-file' },
    ]);
  });

  test('resolves the same global config locations as OpenCode-compatible commands', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'aceharness-opencode-config-'));
    const home = join(tempRoot, 'home');
    const xdgConfig = join(tempRoot, 'xdg');
    const override = join(tempRoot, 'override');

    expect(resolveOpenCodeGlobalConfigDirectories({
      env: {
        OPENCODE_CONFIG_DIR: override,
        XDG_CONFIG_HOME: xdgConfig,
      },
      homeDir: home,
      platform: 'linux',
    })).toEqual([
      override,
      join(xdgConfig, 'opencode'),
      join(home, '.config', 'opencode'),
    ]);
  });

  test('resolves .opencode directories from cwd parents to git root and home', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'aceharness-opencode-dotdirs-'));
    const home = join(tempRoot, 'home');
    const repo = join(tempRoot, 'repo');
    const cwd = join(tempRoot, 'repo', 'packages', 'app');
    mkdirSync(join(repo, '.git'), { recursive: true });

    await expect(resolveOpenCodeProjectConfigDirectories({
      workingDirectory: cwd,
      homeDir: home,
      platform: 'linux',
    })).resolves.toEqual([
      join(cwd, '.opencode'),
      join(tempRoot, 'repo', 'packages', '.opencode'),
      join(tempRoot, 'repo', '.opencode'),
      join(home, '.opencode'),
    ]);
  });

  test('resolves .opencode directories to filesystem root when no git root exists', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'aceharness-opencode-nongit-'));
    const home = join(tempRoot, 'home');
    const cwd = join(tempRoot, 'workspace', 'nested');

    await expect(resolveOpenCodeProjectConfigDirectories({
      workingDirectory: cwd,
      homeDir: home,
      platform: 'linux',
    })).resolves.toContain(join(tempRoot, 'workspace', '.opencode'));
  });
});
