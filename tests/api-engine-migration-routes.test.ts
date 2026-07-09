import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { makeRequest, responseJson } from './helpers/route-helpers';

describe('pre-runtime /api/engine migration routes', () => {
  const originalAceHome = process.env.ACE_HOME;
  let tempDir: string | undefined;
  let db: RuntimeSqliteDatabase | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    vi.resetModules();
    vi.doUnmock('@/lib/auth/middleware');
    vi.doUnmock('@/lib/core/app-paths');
    vi.doUnmock('@/lib/engines/engine-factory');
    vi.doUnmock('@/lib/engines/claude-code-wrapper');
    vi.doUnmock('@/lib/engines/context-recovery');
    vi.doUnmock('@/lib/engines/engine-config');
    if (originalAceHome === undefined) {
      delete process.env.ACE_HOME;
    } else {
      process.env.ACE_HOME = originalAceHome;
    }
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('root GET returns migration-only config without old-architecture engine helpers', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'ace-engine-root-get-'));
    process.env.ACE_HOME = tempDir;
    writeFileSync(path.join(tempDir, '.engine.json'), JSON.stringify({
      engine: 'claude-code',
      defaultModel: 'sonnet',
      drivers: { 'claude-code': 'stdio' },
      engineRuntime: 'auto',
      cangjieRuntime: { enabled: true },
      updatedAt: '2026-07-09T03:00:00.000Z',
    }));
    vi.doMock('@/lib/engines/engine-factory', () => {
      throw new Error('old-architecture engine factory must not be imported');
    });
    vi.doMock('@/lib/engines/cangjie-runtime-config', () => {
      throw new Error('old-architecture runtime config must not be imported');
    });
    vi.doMock('@/lib/engines/engine-config', () => {
      throw new Error('old-architecture engine config must not be imported');
    });

    const { GET } = await import('@/server/api-routes/engine/route');
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ace-migration-only')).toBe('pre-runtime-engine-api');
    const body = await responseJson<any>(response);
    expect(body).toMatchObject({
      engine: 'claude-code',
      defaultModel: 'sonnet',
      engineRuntime: 'auto',
      cangjieRuntime: { enabled: true },
      migrationOnly: true,
    });
    expect(body).not.toHaveProperty('driver');
    expect(body).not.toHaveProperty('drivers');
  });

  test('root POST ignores pre-runtime driver fields and creates shared agent config dir', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'ace-engine-root-post-'));
    process.env.ACE_HOME = tempDir;
    vi.doMock('@/lib/engines/engine-factory', () => {
      throw new Error('old-architecture engine factory must not be imported');
    });
    vi.doMock('@/lib/engines/cangjie-runtime-config', () => {
      throw new Error('old-architecture runtime config must not be imported');
    });
    vi.doMock('@/lib/engines/engine-config', () => {
      throw new Error('old-architecture engine config must not be imported');
    });

    const { POST } = await import('@/server/api-routes/engine/route');
    const response = await POST(makeRequest('/api/engine', {
      json: {
        engine: 'opencode',
        defaultModel: 'qwen3-coder',
        driver: 'stdio',
        drivers: { opencode: 'sdk' },
        engineRuntime: 'js',
        cangjieRuntime: { fallbackToJs: false },
      },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-ace-migration-only')).toBe('pre-runtime-engine-api');
    const body = await responseJson<any>(response);
    expect(body).toMatchObject({
      success: true,
      engine: 'opencode',
      defaultModel: 'qwen3-coder',
      engineRuntime: 'js',
      cangjieRuntime: { fallbackToJs: false },
      ignoredFields: ['driver', 'drivers'],
      notice: 'Pre-runtime driver settings are ignored by this one-time migration endpoint.',
      migrationOnly: true,
    });
    expect(existsSync(path.join(tempDir, '.agents'))).toBe(true);
    const saved = JSON.parse(readFileSync(path.join(tempDir, '.engine.json'), 'utf-8'));
    expect(saved).toMatchObject({
      engine: 'opencode',
      defaultModel: 'qwen3-coder',
      engineRuntime: 'js',
      cangjieRuntime: { fallbackToJs: false },
    });
    expect(saved).not.toHaveProperty('driver');
    expect(saved).not.toHaveProperty('drivers');
  });

  test.each([
    {
      storedStatus: undefined,
      expectedAvailable: false,
      expectedDiagnostics: {},
    },
    {
      storedStatus: 'missing' as const,
      expectedAvailable: false,
      expectedDiagnostics: {
        checkedAt: '2026-07-09T03:00:00.000Z',
        error: 'missing',
      },
    },
    {
      storedStatus: 'failed' as const,
      expectedAvailable: false,
      expectedDiagnostics: {
        checkedAt: '2026-07-09T03:00:00.000Z',
        summary: 'Runtime availability probe reported failed',
      },
    },
    {
      storedStatus: 'available' as const,
      expectedAvailable: true,
      expectedDiagnostics: {
        checkedAt: '2026-07-09T03:00:00.000Z',
      },
    },
  ])('availability adapts $storedStatus runtime agent state without old engine probes', async ({
    storedStatus,
    expectedAvailable,
    expectedDiagnostics,
  }) => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'ace-engine-availability-route-'));
    db = openRuntimeSqliteDatabase(path.join(tempDir, 'runtime-agent.sqlite'));
    const store = new RuntimeSqliteStore(db);
    store.upsertAgentRuntimeState({
      agentId: 'claude',
      availabilityStatus: storedStatus,
      availabilityCheckedAt: '2026-07-09T03:00:00.000Z',
      now: '2026-07-09T03:00:00.000Z',
    });
    db.close();
    db = undefined;

    const getEngineAvailabilityReport = vi.fn();
    const isEngineAvailable = vi.fn();
    vi.doMock('@/lib/engines/engine-factory', () => ({
      getEngineAvailabilityReport,
      isEngineAvailable,
    }));
    vi.doMock('@/lib/core/app-paths', () => ({
      getWorkspaceDataFile: (...segments: string[]) => path.join(tempDir!, ...segments),
    }));

    const { GET } = await import('@/server/api-routes/engine/availability/route');
    const response = await GET(makeRequest('/api/engine/availability?engine=claude&driver=sdk'));
    expect(response.status).toBe(200);
    const body = await responseJson<any>(response);
    expect(body).toMatchObject({
      engine: 'claude',
      available: expectedAvailable,
      source: 'runtime-agent-state',
      migrationOnly: true,
      canonicalRoute: '/api/agents',
      diagnostics: expectedDiagnostics,
    });
    expect(body).not.toHaveProperty('driver');
    expect(body).not.toHaveProperty('drivers');
    expect(getEngineAvailabilityReport).not.toHaveBeenCalled();
    expect(isEngineAvailable).not.toHaveBeenCalled();
  });

  test('commands returns an empty migration result without wrapper discovery', async () => {
    const discoverOpenCodeSdkCommands = vi.fn();
    const createEngine = vi.fn();
    vi.doMock('@/lib/auth/middleware', () => ({
      requireAuth: vi.fn(async () => ({ id: 'user-1' })),
    }));
    vi.doMock('@/lib/engines/opencode-sdk-wrapper', () => ({ discoverOpenCodeSdkCommands }));
    vi.doMock('@/lib/engines/engine-factory', () => ({ createEngine }));

    const { GET } = await import('@/server/api-routes/engine/commands/route');
    const response = await GET(makeRequest('/api/engine/commands?engine=opencode&cwd=C%3A%5Ctmp'));
    expect(response.status).toBe(200);
    const body = await responseJson<any>(response);
    expect(body).toEqual({
      engine: 'opencode',
      namespace: 'opencode',
      commands: [],
      source: 'migration-only-empty-compat',
      migrationOnly: true,
      canonicalRoute: '/api/agents',
    });
    expect(discoverOpenCodeSdkCommands).not.toHaveBeenCalled();
    expect(createEngine).not.toHaveBeenCalled();
  });

  test('model smoke returns skipped compatibility rows without executing wrappers', async () => {
    const ClaudeCodeEngineWrapper = vi.fn();
    const executeEngineWithContextRecovery = vi.fn();
    vi.doMock('@/lib/engines/claude-code-wrapper', () => ({ ClaudeCodeEngineWrapper }));
    vi.doMock('@/lib/engines/context-recovery', () => ({ executeEngineWithContextRecovery }));

    const { POST } = await import('@/server/api-routes/engine/models/smoke/route');
    const response = await POST(makeRequest('/api/engine/models/smoke', {
      json: { models: ['sonnet', 'opus'] },
    }));
    expect(response.status).toBe(200);
    const body = await responseJson<any>(response);
    expect(body).toMatchObject({
      engine: '',
      migrationOnly: true,
      canonicalRoute: '/api/models/probes',
      source: 'migration-only-empty-compat',
      results: [
        { model: 'sonnet', ok: false, durationMs: 0, skipped: true },
        { model: 'opus', ok: false, durationMs: 0, skipped: true },
      ],
    });
    expect(ClaudeCodeEngineWrapper).not.toHaveBeenCalled();
    expect(executeEngineWithContextRecovery).not.toHaveBeenCalled();
  });
});
