import { beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeCodeAcpEngineWrapper } from '@/lib/engines/claude-code-acp-wrapper';
import { ClaudeCodeEngineWrapper } from '@/lib/engines/claude-code-wrapper';
import { OpenCodeEngineWrapper } from '@/lib/engines/opencode-wrapper';
import { OpenCodeSdkEngineWrapper } from '@/lib/engines/opencode-sdk-wrapper';

describe('engine driver resolution', () => {
  let aceHome: string;

  beforeEach(() => {
    vi.restoreAllMocks();
    aceHome = join(tmpdir(), `aceharness-engine-driver-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(aceHome, { recursive: true });
    process.env.ACE_HOME = aceHome;
  });

  test('claude-code with stdio driver prefers claude-code-acp and may fallback to sdk', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'claude-code',
      driver: 'stdio',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    const { getConfiguredEngine, resolveRequestedEngineType, resolveEffectiveEngine } = await import('@/lib/engines/engine-factory');
    expect(resolveEffectiveEngine('claude-code', 'stdio')).toBe('claude-code-acp');
    await expect(getConfiguredEngine()).resolves.toSatisfy((value: string) => ['claude-code-acp', 'claude-code'].includes(value));
    await expect(resolveRequestedEngineType('claude-code')).resolves.toSatisfy((value: string) => ['claude-code-acp', 'claude-code'].includes(value));
  });

  test('claude-code with sdk driver stays on claude-code', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'claude-code',
      driver: 'sdk',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    const { getConfiguredEngine } = await import('@/lib/engines/engine-factory');
    await expect(getConfiguredEngine()).resolves.toBe('claude-code');
  });

  test('claude-code defaults to sdk when driver is omitted', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'claude-code',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    const { getConfiguredEngine, resolveRequestedEngineType } = await import('@/lib/engines/engine-factory');
    await expect(getConfiguredEngine()).resolves.toBe('claude-code');
    await expect(resolveRequestedEngineType('claude-code')).resolves.toBe('claude-code');
  });

  test('opencode defaults to sdk when driver is omitted', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'opencode',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    const { getConfiguredEngine, resolveRequestedEngineType } = await import('@/lib/engines/engine-factory');
    await expect(getConfiguredEngine()).resolves.toBe('opencode-sdk');
    await expect(resolveRequestedEngineType('opencode')).resolves.toBe('opencode-sdk');
  });

  test('requested engine prefers its own stored driver from drivers map', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'claude-code',
      driver: 'sdk',
      drivers: {
        'claude-code': 'sdk',
        'opencode': 'stdio',
      },
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    const { getConfiguredEngine, resolveRequestedEngineType } = await import('@/lib/engines/engine-factory');
    await expect(getConfiguredEngine()).resolves.toBe('claude-code');
    await expect(resolveRequestedEngineType('opencode')).resolves.toBe('opencode');
  });

  test('driver helpers prefer sdk for dual-driver engines', async () => {
    const { getDefaultDriver, getLogicalEngineId, normalizeDriverSelection, resolveEffectiveEngine } = await import('@/lib/engines/engine-factory');
    expect(getDefaultDriver('claude-code')).toBe('sdk');
    expect(getDefaultDriver('opencode')).toBe('sdk');
    expect(getLogicalEngineId('claude-code-acp')).toBe('claude-code');
    expect(getLogicalEngineId('opencode-sdk')).toBe('opencode');
    expect(getLogicalEngineId('codex')).toBe('codex');
    expect(normalizeDriverSelection('claude-code', undefined)).toBe('sdk');
    expect(normalizeDriverSelection('opencode', undefined)).toBe('sdk');
    expect(resolveEffectiveEngine('claude-code', undefined)).toBe('claude-code');
    expect(resolveEffectiveEngine('claude-code', 'stdio')).toBe('claude-code-acp');
    expect(resolveEffectiveEngine('opencode', undefined)).toBe('opencode-sdk');
    expect(resolveEffectiveEngine('opencode', 'stdio')).toBe('opencode');
  });

  test('createEngine resolves logical claude-code to configured acp driver', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'claude-code',
      driver: 'stdio',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    vi.spyOn(ClaudeCodeAcpEngineWrapper.prototype, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(ClaudeCodeEngineWrapper.prototype, 'isAvailable').mockResolvedValue(true);

    const { createEngine } = await import('@/lib/engines/engine-factory');
    const engine = await createEngine('claude-code');
    expect(engine?.getName()).toBe('claude-code-acp');
  });

  test('createEngine resolves logical opencode to configured sdk driver', async () => {
    const engineConfigPath = join(aceHome, '.engine.json');
    writeFileSync(engineConfigPath, JSON.stringify({
      engine: 'opencode',
      driver: 'sdk',
      updatedAt: new Date().toISOString(),
    }, null, 2), 'utf8');

    vi.spyOn(OpenCodeSdkEngineWrapper.prototype, 'isAvailable').mockResolvedValue(true);
    vi.spyOn(OpenCodeEngineWrapper.prototype, 'isAvailable').mockResolvedValue(true);

    const { createEngine } = await import('@/lib/engines/engine-factory');
    const engine = await createEngine('opencode');
    expect(engine?.getName()).toBe('opencode-sdk');
  });
});
