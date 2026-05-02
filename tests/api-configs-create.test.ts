import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';

async function createAuthToken() {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/user-store');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `test-${suffix}`,
    email: `test-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role: 'user',
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, user };
}

describe('configs create route', () => {
  test('rejects missing required fields', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      vi.resetModules();
      const { POST } = await import('@/app/api/configs/create/route');

      // Missing filename
      let response = await POST(makeRequest('/api/configs/create', {
        token,
        json: { workflowName: 'Test', workingDirectory: '/tmp' },
      }));
      await assertErrorResponse(response, 400);

      // Missing workflowName
      response = await POST(makeRequest('/api/configs/create', {
        token,
        json: { filename: 'test.yaml', workingDirectory: '/tmp' },
      }));
      await assertErrorResponse(response, 400);

      // Missing workingDirectory
      response = await POST(makeRequest('/api/configs/create', {
        token,
        json: { filename: 'test.yaml', workflowName: 'Test' },
      }));
      await assertErrorResponse(response, 400);
    });
  });

  test('rejects duplicate filenames', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/app/api/configs/create/route');

        const body = {
          filename: 'duplicate.yaml',
          workflowName: 'First',
          workingDirectory: workspace,
          workspaceMode: 'in-place',
          mode: 'phase-based',
        };

        const first = await POST(makeRequest('/api/configs/create', { token, json: body }));
        expect(first.status).toBe(200);

        const second = await POST(makeRequest('/api/configs/create', { token, json: body }));
        await assertErrorResponse(second, 409);
      });
    });
  });

  test('creates phase-based config with valid YAML structure', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/app/api/configs/create/route');
        const { readFile } = await import('fs/promises');
        const { parse } = await import('yaml');
        const path = await import('path');

        const response = await POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'phase-test.yaml',
            workflowName: 'Phase Test',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'phase-based',
            description: 'A test workflow',
          },
        }));
        expect(response.status).toBe(200);
        const json = await responseJson<any>(response);
        expect(json.success).toBe(true);

        const yamlContent = parse(await readFile(path.join(aceHome, 'configs', 'phase-test.yaml'), 'utf8'));
        expect(yamlContent.workflow.name).toBe('Phase Test');
        expect(yamlContent.workflow.description).toBe('A test workflow');
        expect(Array.isArray(yamlContent.workflow.phases)).toBe(true);
        expect(yamlContent.workflow.phases.length).toBeGreaterThan(0);
        expect(yamlContent.workflow.supervisor.enabled).toBe(true);
        expect(yamlContent.workflow.supervisor.agent).toBe('default-supervisor');
        expect(yamlContent.context.projectRoot).toBe(workspace);
      });
    });
  });

  test('creates state-machine config with valid states', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/app/api/configs/create/route');
        const { readFile } = await import('fs/promises');
        const { parse } = await import('yaml');
        const path = await import('path');

        const response = await POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'sm-test.yaml',
            workflowName: 'SM Test',
            workingDirectory: workspace,
            workspaceMode: 'isolated-copy',
            mode: 'state-machine',
          },
        }));
        expect(response.status).toBe(200);
        const json = await responseJson<any>(response);
        expect(json.success).toBe(true);
        expect(json.creationSession.generatedConfigSummary.mode).toBe('state-machine');

        const yamlContent = parse(await readFile(path.join(aceHome, 'configs', 'sm-test.yaml'), 'utf8'));
        expect(yamlContent.workflow.mode).toBe('state-machine');
        expect(Array.isArray(yamlContent.workflow.states)).toBe(true);
        expect(yamlContent.workflow.states.some((s: any) => s.isInitial)).toBe(true);
        expect(yamlContent.workflow.states.some((s: any) => s.isFinal)).toBe(true);
        expect(yamlContent.context.workspaceMode).toBe('isolated-copy');
      });
    });
  });

  test('rejects unauthenticated requests', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { POST } = await import('@/app/api/configs/create/route');
      const response = await POST(makeRequest('/api/configs/create', {
        json: {
          filename: 'test.yaml',
          workflowName: 'Test',
          workingDirectory: '/tmp',
        },
      }));
      await assertErrorResponse(response, 401);
    });
  });
});
