import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

async function loadBatchRoute() {
  return import('@/app/api/agents/batch/route');
}

describe('agents batch route', () => {
  test('set-model-policy updates agents without existing strategy', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      vi.resetModules();
      const { getRuntimeAgentsDirPath } = await import('@/lib/runtime-configs');
      const agentsDir = await getRuntimeAgentsDirPath();
      await mkdir(agentsDir, { recursive: true });

      await writeFile(path.join(agentsDir, 'unconfigured.yaml'), stringify({
        name: 'unconfigured-agent',
        team: 'red',
        engineModels: {},
        activeEngine: '',
      }), 'utf8');

      await writeFile(path.join(agentsDir, 'configured.yaml'), stringify({
        name: 'configured-agent',
        team: 'blue',
        engineModels: {
          codex: 'gpt-5.2',
        },
        activeEngine: 'codex',
      }), 'utf8');

      const { POST } = await loadBatchRoute();
      const response = await POST(makeRequest('/api/agents/batch', {
        json: {
          action: 'set-model-policy',
          sourceType: 'unconfigured',
          targetEngine: 'claude-code',
          targetModel: 'claude-sonnet-4-6',
        },
      }));

      expect(response.status).toBe(200);
      const json = await responseJson<any>(response);
      expect(json.success).toBe(true);
      expect(json.updatedCount).toBeGreaterThanOrEqual(1);

      const updatedUnconfigured = parse(await readFile(path.join(agentsDir, 'unconfigured.yaml'), 'utf8'));
      expect(updatedUnconfigured.engineModels['claude-code']).toBe('claude-sonnet-4-6');
      expect(updatedUnconfigured.activeEngine).toBe('claude-code');

      const untouchedConfigured = parse(await readFile(path.join(agentsDir, 'configured.yaml'), 'utf8'));
      expect(untouchedConfigured.engineModels.codex).toBe('gpt-5.2');
      expect(untouchedConfigured.activeEngine).toBe('codex');
    });
  });
});
