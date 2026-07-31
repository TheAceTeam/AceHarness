import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { makeRequest, responseJson, assertErrorResponse } from './helpers/route-helpers';

async function createAuthToken() {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
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
      const { POST } = await import('@/server/api-routes/configs/create/route');

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
        const { POST } = await import('@/server/api-routes/configs/create/route');

        const body = {
          filename: 'duplicate.yaml',
          workflowName: 'First',
          workingDirectory: workspace,
          workspaceMode: 'in-place',
          mode: 'state-machine',
        };

        const first = await POST(makeRequest('/api/configs/create', { token, json: body }));
        expect(first.status).toBe(200);

        const second = await POST(makeRequest('/api/configs/create', { token, json: body }));
        await assertErrorResponse(second, 409);
      });
    });
  });

  test('creates lightweight config with the locked tasklist step', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/server/api-routes/configs/create/route');
        const { readFile } = await import('fs/promises');
        const { parse } = await import('yaml');
        const path = await import('path');

        const response = await POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'lightweight-test.yaml',
            workflowName: 'Lightweight Test',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'lightweight',
            description: 'A test workflow',
            lightweight: {
              tasklistDirectory: 'docs/tasklists/client-supplied-location',
              agent: 'developer',
              task: 'Implement the requested change',
            },
          },
        }));
        expect(response.status).toBe(200);
        const json = await responseJson<any>(response);
        expect(json.success).toBe(true);
        expect(json.creationSession).toMatchObject({
          createdBy: expect.any(String),
          mode: 'lightweight',
          lightweight: {
            agent: 'developer',
            task: 'Implement the requested change',
            tasklistDirectory: 'docs/tasklists/lightweight-test',
          },
        });

        const yamlContent = parse(await readFile(path.join(aceHome, 'configs', 'lightweight-test.yaml'), 'utf8'));
        expect(yamlContent.workflow.name).toBe('Lightweight Test');
        expect(yamlContent.workflow.description).toBe('A test workflow');
        expect(yamlContent.workflow.mode).toBe('state-machine');
        expect(yamlContent.workflow.profile).toBe('lightweight');
        expect(yamlContent.workflow.lightweight.tasklistDirectory).toBe('docs/tasklists/lightweight-test');
        expect(yamlContent.workflow.states).toHaveLength(1);
        expect(yamlContent.workflow.states[0]).toMatchObject({ isInitial: true, isFinal: true });
        expect(yamlContent.workflow.states[0].steps[0].skills).toContain('aceharness-tasklist');
        expect(yamlContent.workflow.supervisor.enabled).toBe(true);
        expect(yamlContent.workflow.supervisor.agent).toBe('default-supervisor');
        expect(yamlContent.context.projectRoot).toBe(workspace);
      });
    });
  });

  test('creates state-machine config with valid states', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/server/api-routes/configs/create/route');
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
        expect(json.creationSession).toMatchObject({
          createdBy: user.id,
          status: 'config-generated',
          generatedConfigSummary: { mode: 'state-machine' },
        });
        expect(json.creationSession.generatedConfigSummary.stateCount).toBeGreaterThanOrEqual(4);
        const yamlContent = parse(await readFile(path.join(aceHome, 'configs', 'sm-test.yaml'), 'utf8'));
        expect(yamlContent.workflow.mode).toBe('state-machine');
        expect(Array.isArray(yamlContent.workflow.states)).toBe(true);
        expect(yamlContent.workflow.states.some((s: any) => s.isInitial)).toBe(true);
        expect(yamlContent.workflow.states.some((s: any) => s.isFinal)).toBe(true);
        expect(yamlContent.context.workspaceMode).toBe('isolated-copy');
        const { getConfigMeta } = await import('@/lib/config/metadata');
        await expect(getConfigMeta('sm-test.yaml')).resolves.toMatchObject({
          createdBy: user.id,
          specCodingEnabled: true,
          specCodingSkipped: false,
        });
      });
    });
  });

  test('preserves a supplied state-machine draft and skipped Spec Coding metadata', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/server/api-routes/configs/create/route');
        const { readFile } = await import('fs/promises');
        const { parse } = await import('yaml');
        const path = await import('path');

        const configDraft = {
          workflow: {
            name: 'Draft-owned workflow',
            mode: 'state-machine',
            maxTransitions: 1,
            supervisor: { enabled: true, agent: 'default-supervisor' },
            states: [{
              name: '完成',
              isInitial: true,
              isFinal: true,
              position: { x: 120, y: 160 },
              steps: [{ name: '草案步骤', type: 'agent', agent: 'developer', task: 'Use the supplied draft.' }],
              transitions: [],
            }],
          },
          context: {
            projectRoot: workspace,
            workspaceMode: 'in-place',
            requirements: 'Persist this draft unchanged.',
          },
        };
        const response = await POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'draft-test.yaml',
            workflowName: 'Ignored outer name',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'state-machine',
            skipSpecCoding: true,
            configDraft,
          },
        }));

        expect(response.status).toBe(200);
        expect(await responseJson<any>(response)).toMatchObject({
          success: true,
          filename: 'draft-test.yaml',
          creationSession: null,
          specCodingSkipped: true,
        });
        const yamlContent = parse(await readFile(path.join(aceHome, 'configs', 'draft-test.yaml'), 'utf8'));
        expect(yamlContent.workflow.name).toBe('Draft-owned workflow');
        expect(yamlContent.workflow.states[0].steps[0].name).toBe('草案步骤');
        const { getConfigMeta } = await import('@/lib/config/metadata');
        await expect(getConfigMeta('draft-test.yaml')).resolves.toMatchObject({
          createdBy: user.id,
          specCodingEnabled: false,
          specCodingSkipped: true,
        });
      });
    });
  });

  test('keeps reference-workflow authorization for state-machine creation', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const owner = await createAuthToken();
        const otherUser = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/server/api-routes/configs/create/route');

        const source = await POST(makeRequest('/api/configs/create', {
          token: owner.token,
          json: {
            filename: 'private-source.yaml',
            workflowName: 'Private Source',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'state-machine',
            skipSpecCoding: true,
          },
        }));
        expect(source.status).toBe(200);

        const authorizedReference = await POST(makeRequest('/api/configs/create', {
          token: owner.token,
          json: {
            filename: 'authorized-reference.yaml',
            workflowName: 'Authorized Reference',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'state-machine',
            referenceWorkflow: 'private-source.yaml',
            skipSpecCoding: true,
          },
        }));
        expect(authorizedReference.status).toBe(200);

        const response = await POST(makeRequest('/api/configs/create', {
          token: otherUser.token,
          json: {
            filename: 'forbidden-reference.yaml',
            workflowName: 'Forbidden Reference',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'state-machine',
            referenceWorkflow: 'private-source.yaml',
            skipSpecCoding: true,
          },
        }));
        await assertErrorResponse(response, 403);
      });
    });
  });

  test('ignores client tasklist directory overrides and derives the directory from the filename', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        vi.resetModules();
        const { POST } = await import('@/server/api-routes/configs/create/route');
        const { readFile } = await import('fs/promises');
        const { parse } = await import('yaml');
        const path = await import('path');

        const response = await POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'unsafe-lightweight.yaml',
            workflowName: 'Unsafe Lightweight',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'lightweight',
            lightweight: {
              tasklistDirectory: '../outside-workspace',
              agent: 'developer',
              task: 'Create the derived tasklist workflow',
            },
          },
        }));
        expect(response.status).toBe(200);
        const json = await responseJson<any>(response);
        expect(json.creationSession.lightweight.tasklistDirectory).toBe('docs/tasklists/unsafe-lightweight');
        const yamlContent = parse(await readFile(path.join(aceHome, 'configs', 'unsafe-lightweight.yaml'), 'utf8'));
        expect(yamlContent.workflow.lightweight.tasklistDirectory).toBe('docs/tasklists/unsafe-lightweight');
      });
    });
  });

  test('rejects unauthenticated requests', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { POST } = await import('@/server/api-routes/configs/create/route');
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
