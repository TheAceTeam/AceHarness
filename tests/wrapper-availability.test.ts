import { describe, expect, test } from 'vitest';
import { buildEnvObject, loadEnvVars } from '@/lib/core/env-manager';
import { commandExists, findCommand, getCommonCliSearchPaths } from '@/lib/core/command-exists';
import { detectCangjieHome, buildCangjieSpawnEnv, isCjpmAvailable } from '@/lib/cangjie/env';
import { ClaudeCodeEngineWrapper } from '@/lib/engines/claude-code-wrapper';
import { KiroCliEngineWrapper } from '@/lib/engines/kiro-cli-wrapper';
import { OpenCodeEngineWrapper } from '@/lib/engines/opencode-wrapper';
import { CodegenieEngineWrapper } from '@/lib/engines/codegenie-wrapper';
import { CursorEngineWrapper } from '@/lib/engines/cursor-wrapper';
import { TraeCliEngineWrapper } from '@/lib/engines/trae-cli-wrapper';
import { NgaEngineWrapper } from '@/lib/engines/nga-wrapper';
import { CodexEngineWrapper } from '@/lib/engines/codex-wrapper';

async function hasModule(moduleName: string): Promise<boolean> {
  try {
    await import(moduleName);
    return true;
  } catch {
    return false;
  }
}

describe('wrapper availability in current environment', () => {
  test('claude-code matches SDK availability', async () => {
    const wrapper = new ClaudeCodeEngineWrapper();
    const expected = await hasModule('@anthropic-ai/claude-agent-sdk');
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('codex matches SDK + CLI discovery availability', async () => {
    const wrapper = new CodexEngineWrapper();
    const expected = await hasModule('@openai/codex-sdk') || Boolean((wrapper as any).findCodexFallbackPath());
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('codex fallback avoids Windows npm command shims for SDK spawn', async () => {
    const wrapper = new CodexEngineWrapper();
    const codexPath = (wrapper as any).findCodexFallbackPath();

    if (process.platform !== 'win32' || !codexPath) {
      expect(true).toBe(true);
      return;
    }

    expect(codexPath.toLowerCase()).toMatch(/codex\.exe$/);
    expect(codexPath.toLowerCase()).not.toMatch(/\.(cmd|bat|ps1)$/);
  });

  test('cursor matches CLI discovery availability', async () => {
    const wrapper = new CursorEngineWrapper();
    const expected = commandExists('cursor-agent', getCommonCliSearchPaths()) || commandExists('agent', getCommonCliSearchPaths());
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('kiro-cli matches CLI discovery availability', async () => {
    const wrapper = new KiroCliEngineWrapper();
    const expected = commandExists('kiro-cli', getCommonCliSearchPaths());
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('opencode matches CLI discovery availability', async () => {
    const wrapper = new OpenCodeEngineWrapper();
    const expected = commandExists('opencode', getCommonCliSearchPaths());
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('codegenie matches CLI discovery availability', async () => {
    const wrapper = new CodegenieEngineWrapper();
    const explicit = process.env.ACEH_CODEGENIE_COMMAND?.trim();
    const binary = explicit
      ? findCommand(explicit, getCommonCliSearchPaths()) ||
        findCommand('codegenie', getCommonCliSearchPaths()) ||
        'codegenie'
      : findCommand('codegenie', getCommonCliSearchPaths()) || 'codegenie';
    const expected = commandExists(binary, getCommonCliSearchPaths());
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('trae-cli matches CLI discovery availability', async () => {
    const wrapper = new TraeCliEngineWrapper();
    const expected = commandExists('trae-cli', getCommonCliSearchPaths());
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });

  test('nga matches CLI/configured fallback availability', async () => {
    const wrapper = new NgaEngineWrapper();
    const expected =
      commandExists('ngagent') ||
      commandExists('nga') ||
      (wrapper as any).findConfiguredCodeagent() !== null;
    await expect(wrapper.isAvailable()).resolves.toBe(expected);
  });
});
