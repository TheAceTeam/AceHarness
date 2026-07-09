import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { RuntimeSqliteStore } from '@/lib/runtime-agent/sqlite/runtime-store';
import { responseJson } from './helpers/route-helpers';

describe('/api/agents runtime registry', () => {
  let tempDir: string | undefined;
  let db: RuntimeSqliteDatabase | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    vi.resetModules();
    vi.doUnmock('@/lib/core/app-paths');
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  test('returns merged builtin and sqlite runtime state while preserving preRuntime list fields', async () => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'ace-agents-route-'));
    const dbPath = path.join(tempDir, 'runtime-agent.sqlite');
    db = openRuntimeSqliteDatabase(dbPath);
    const store = new RuntimeSqliteStore(db);
    store.upsertAgentRuntimeState({
      agentId: 'claude',
      enabled: false,
      override: {
        displayName: 'Claude Override',
        fallbackCommands: ['claude-code'],
      },
      availabilityStatus: 'missing',
      availabilityCheckedAt: '2026-07-09T02:00:00.000Z',
      capabilityProbe: {
        shell: false,
      },
      now: '2026-07-09T02:00:00.000Z',
    });
    store.upsertAgentRuntimeState({
      agentId: 'local-discovered',
      discovery: {
        commandPath: 'local-discovered',
        version: '0.1.0',
      },
      envReadiness: {
        status: 'ready',
      },
      now: '2026-07-09T02:00:00.000Z',
    });
    db.close();
    db = undefined;

    vi.doMock('@/lib/core/app-paths', () => ({
      getWorkspaceDataFile: (...segments: string[]) => path.join(tempDir!, ...segments),
    }));

    const route = await import('@/server/api-routes/agents/route');
    const response = await route.GET();

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    const claude = json.agents.find((agent: any) => agent.id === 'claude');
    const discovered = json.agents.find((agent: any) => agent.id === 'local-discovered');

    expect(claude).toMatchObject({
      id: 'claude',
      name: 'claude',
      title: 'Claude Override',
      displayName: 'Claude Override',
      activeEngine: 'claude',
      engineModels: { claude: '' },
      runtimeState: {
        enabled: false,
        availability: {
          status: 'missing',
          checkedAt: '2026-07-09T02:00:00.000Z',
        },
      },
      sources: {
        override: 'override',
        capabilities: 'probe',
      },
    });
    expect(claude.capabilities.shell).toBe(false);
    expect(claude.definition.availabilityProbe.resolver.primaryCommand).toBe('claude');

    expect(discovered).toMatchObject({
      id: 'local-discovered',
      name: 'local-discovered',
      tier: 'hidden',
      iconPath: '/engines/code-agent.svg',
      runtimeState: {
        hidden: true,
        envReadiness: {
          status: 'ready',
        },
      },
    });
    expect(json.registry.some((entry: any) => entry.definition.id === 'codex')).toBe(true);
  });
});
