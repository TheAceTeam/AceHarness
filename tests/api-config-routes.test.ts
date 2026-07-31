import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

interface AuthResult {
  token: string;
  user: { id: string };
}

async function loadConfigRoutes() {
  const [validate, create, references] = await Promise.all([
    import('@/server/api-routes/configs/validate/route'),
    import('@/server/api-routes/configs/create/route'),
    import('@/server/api-routes/configs/references/route'),
  ]);
  return { validate, create, references };
}

async function createAuthToken(role: 'admin' | 'user' = 'user'): Promise<AuthResult> {
  vi.resetModules();
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `test-${suffix}`,
    email: `test-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role,
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, user };
}

function stateMachineConfig(projectRoot: string, overrides: Record<string, any> = {}) {
  return {
    workflow: {
      name: 'Validated Workflow',
      mode: 'state-machine',
      supervisor: {
        enabled: true,
        agent: 'default-supervisor',
      },
      states: [
        {
          name: 'Build',
          isInitial: true,
          isFinal: true,
          steps: [
            { name: 'Implement', agent: 'developer', task: 'Implement the requested change' },
          ],
          transitions: [],
        },
      ],
      ...overrides.workflow,
    },
    context: {
      projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Ship a tested change',
      ...overrides.context,
    },
  };
}

describe('config API routes', () => {
  test('config routes reject unauthenticated requests before mutating state', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { validate, create } = await loadConfigRoutes();

      await assertErrorResponse(
        await validate.POST(makeRequest('/api/configs/validate', { json: {} })),
        401
      );
      await assertErrorResponse(
        await create.POST(makeRequest('/api/configs/create', {
          json: {
            filename: 'unauthorized.yaml',
            workflowName: 'Unauthorized',
            workingDirectory: process.cwd(),
          },
        })),
        401
      );
    });
  });

  test('config validate route reports bad requests and validates a real workflow draft', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        const { validate } = await loadConfigRoutes();

        await assertErrorResponse(
          await validate.POST(makeRequest('/api/configs/validate', { token, json: {} })),
          400
        );

        const response = await validate.POST(makeRequest('/api/configs/validate', {
          token,
          json: { config: stateMachineConfig(workspace) },
        }));
        expect(response.status).toBe(200);
        const json = await responseJson<any>(response);
        expect(json.success).toBe(true);
        expect(json.validation.ok).toBe(true);
        expect(json.validation.issues.some((issue: any) => issue.severity === 'error')).toBe(false);
        expect(json.validation.normalized.workflow.name).toBe('Validated Workflow');
        expect(json.validation.normalized.context.projectRoot).toBe(workspace);
      });
    });
  });

  test('config list exposes and filters state-machine and lightweight workflow kinds', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { token } = await createAuthToken();
      const { getRuntimeConfigsDirPath } = await import('@/lib/run/runtime-configs');
      const configsDir = await getRuntimeConfigsDirPath();
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'states-only-child.yaml'), stringify({
        workflow: {
          name: 'States Only Child',
          mode: 'state-machine',
          states: [
            {
              name: 'Done',
              isInitial: true,
              isFinal: true,
              steps: [{ name: 'Finish', agent: 'developer', task: 'Finish child workflow' }],
              transitions: [],
            },
          ],
        },
        context: {
          requirements: 'child workflow',
        },
      }), 'utf-8');
      await writeFile(path.join(configsDir, 'lightweight-child.yaml'), stringify({
        workflow: {
          name: 'Lightweight Child',
          mode: 'state-machine',
          profile: 'lightweight',
          lightweight: { tasklistDirectory: 'docs/tasklists/lightweight-child' },
          states: [{
            name: 'Execute',
            isInitial: true,
            isFinal: true,
            steps: [{
              name: 'Implement',
              type: 'agent',
              agent: 'developer',
              task: 'Finish child workflow',
              skills: ['aceharness-tasklist'],
            }],
            transitions: [],
          }],
        },
        context: { requirements: 'child workflow' },
      }), 'utf-8');
      const route = await import('@/server/api-routes/configs/route');

      const response = await route.GET(makeRequest('/api/configs?mode=state-machine&pageSize=100', { token }));
      const json = await responseJson<any>(response);

      expect(response.status).toBe(200);
      expect(json.configs).toEqual(expect.arrayContaining([
        expect.objectContaining({
          filename: 'states-only-child.yaml',
          mode: 'state-machine',
          kind: 'state-machine',
        }),
      ]));

      const lightweightResponse = await route.GET(makeRequest('/api/configs?mode=lightweight&pageSize=100', { token }));
      const lightweightJson = await responseJson<any>(lightweightResponse);
      expect(lightweightResponse.status).toBe(200);
      expect(lightweightJson.configs).toEqual([
        expect.objectContaining({
          filename: 'lightweight-child.yaml',
          mode: 'state-machine',
          kind: 'lightweight',
          profile: 'lightweight',
          stateCount: 1,
        }),
      ]);
    });
  });

  test('config create route writes state-machine and lightweight workflows and rejects duplicates', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const { create } = await loadConfigRoutes();

        let response = await create.POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'lightweight-created.yaml',
            workflowName: 'Lightweight Created',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'lightweight',
            description: 'Created from route test',
            lightweight: {
              tasklistDirectory: 'docs/tasklists/lightweight-created',
              agent: 'developer',
              task: 'Implement the requested change',
            },
          },
        }));
        expect(response.status).toBe(200);
        let json = await responseJson<any>(response);
        expect(json.success).toBe(true);
        expect(json.filename).toBe('lightweight-created.yaml');
        expect(json.creationSession.createdBy).toBe(user.id);
        expect(json.creationSession.status).toBe('config-generated');

        const lightweightYaml = parse(await readFile(path.join(aceHome, 'configs', 'lightweight-created.yaml'), 'utf8'));
        expect(lightweightYaml.workflow.name).toBe('Lightweight Created');
        expect(lightweightYaml.workflow.mode).toBe('state-machine');
        expect(lightweightYaml.workflow.profile).toBe('lightweight');
        expect(lightweightYaml.workflow.states).toHaveLength(1);
        expect(lightweightYaml.workflow.states[0].steps[0].skills).toContain('aceharness-tasklist');
        expect(lightweightYaml.context.projectRoot).toBe(workspace);

        response = await create.POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'state-created.yaml',
            workflowName: 'State Created',
            workingDirectory: workspace,
            workspaceMode: 'isolated-copy',
            mode: 'state-machine',
            description: 'State machine route test',
          },
        }));
        expect(response.status).toBe(200);
        json = await responseJson<any>(response);
        expect(json.success).toBe(true);
        expect(json.creationSession.generatedConfigSummary.mode).toBe('state-machine');
        expect(json.creationSession.generatedConfigSummary.stateCount).toBeGreaterThanOrEqual(4);

        const stateYaml = parse(await readFile(path.join(aceHome, 'configs', 'state-created.yaml'), 'utf8'));
        expect(stateYaml.workflow.mode).toBe('state-machine');
        expect(stateYaml.workflow.states.some((state: any) => state.isInitial)).toBe(true);
        expect(stateYaml.workflow.states.some((state: any) => state.isFinal)).toBe(true);
        expect(stateYaml.workflow.states.flatMap((state: any) => state.transitions || []).some((transition: any) => transition.to === '实施')).toBe(true);

        await assertErrorResponse(
          await create.POST(makeRequest('/api/configs/create', {
            token,
            json: {
              filename: 'lightweight-created.yaml',
              workflowName: 'Duplicate',
              workingDirectory: workspace,
              workspaceMode: 'in-place',
            },
          })),
          409
        );
      });
    });
  });

  test('config references route reports parent workflows that embed a child workflow', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const { references } = await loadConfigRoutes();
      const { getRuntimeConfigsDirPath } = await import('@/lib/run/runtime-configs');
      const configsDir = await getRuntimeConfigsDirPath();
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'child.yaml'), stringify({
        workflow: {
          name: 'Child Workflow',
          mode: 'state-machine',
          supervisor: { enabled: true, agent: 'default-supervisor' },
          states: [{
            name: 'Done',
            isInitial: true,
            isFinal: true,
            steps: [{ name: 'Finish', agent: 'developer', task: 'Finish' }],
            transitions: [],
          }],
        },
        context: { projectRoot: process.cwd(), workspaceMode: 'in-place' },
      }));
      await writeFile(path.join(configsDir, 'parent.yaml'), stringify({
        workflow: {
          name: 'Parent Workflow',
          mode: 'state-machine',
          states: [{
            name: 'Build',
            isInitial: true,
            steps: [{
              name: 'Run child',
              type: 'subworkflow',
              workflow: 'child.yaml',
            }],
            transitions: [],
          }],
        },
        context: { projectRoot: process.cwd(), workspaceMode: 'in-place' },
      }));

      const response = await references.GET(makeRequest('/api/configs/references?configFile=child.yaml', { token }));

      expect(response.status).toBe(200);
      const json = await responseJson<any>(response);
      expect(json.referenceCount).toBe(1);
      expect(json.references[0]).toMatchObject({
        filename: 'parent.yaml',
        name: 'Parent Workflow',
      });
      expect(json.references[0].refs[0]).toMatchObject({
        stateName: 'Build',
        stepName: 'Run child',
        configFile: 'child.yaml',
      });
    });
  });

  test('config delete refuses workflows that are still referenced unless forced', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const { getRuntimeConfigsDirPath } = await import('@/lib/run/runtime-configs');
      const deleteRoute = await import('@/server/api-routes/configs/[filename]/route');
      const configsDir = await getRuntimeConfigsDirPath();
      await mkdir(configsDir, { recursive: true });
      await writeFile(path.join(configsDir, 'child.yaml'), stringify({
        workflow: {
          name: 'Child Workflow',
          mode: 'state-machine',
          states: [{ name: 'Done', isInitial: true, isFinal: true, steps: [] }],
        },
        context: { projectRoot: process.cwd(), workspaceMode: 'in-place' },
      }));
      await writeFile(path.join(configsDir, 'parent.yaml'), stringify({
        workflow: {
          name: 'Parent Workflow',
          mode: 'state-machine',
          states: [{
            name: 'Build',
            isInitial: true,
            steps: [{ name: 'Run child', type: 'subworkflow', workflow: 'child.yaml' }],
          }],
        },
        context: { projectRoot: process.cwd(), workspaceMode: 'in-place' },
      }));

      const response = await deleteRoute.DELETE(
        makeRequest('/api/configs/child.yaml', { token }),
        { params: Promise.resolve({ filename: 'child.yaml' }) }
      );

      expect(response.status).toBe(409);
      const json = await responseJson<any>(response);
      expect(json.code).toBe('WORKFLOW_REFERENCED');
      expect(json.referenceCount).toBe(1);
      expect(json.references[0].filename).toBe('parent.yaml');
    });
  });

  test('updates parent subworkflow references when a workflow is renamed', async () => {
    await withIsolatedAceHome(async () => {
      const { token } = await createAuthToken();
      const { getRuntimeConfigsDirPath } = await import('@/lib/run/runtime-configs');
      const route = await import('@/server/api-routes/configs/[filename]/route');
      const configsDir = await getRuntimeConfigsDirPath();
      await mkdir(configsDir, { recursive: true });
      const childConfig = {
        workflow: {
          name: 'Child Workflow',
          mode: 'state-machine',
          supervisor: { enabled: true, agent: 'default-supervisor' },
          states: [{
            name: 'Done',
            isInitial: true,
            isFinal: true,
            steps: [{ name: 'Finish', agent: 'developer', task: 'Finish' }],
            transitions: [],
          }],
        },
        context: { projectRoot: process.cwd(), workspaceMode: 'in-place' },
      };
      await writeFile(path.join(configsDir, 'child-old.yaml'), stringify(childConfig));
      await writeFile(path.join(configsDir, 'parent.yaml'), stringify({
        workflow: {
          name: 'Parent Workflow',
          mode: 'state-machine',
          states: [{
            name: 'Build',
            isInitial: true,
            steps: [{ name: 'Run child', type: 'subworkflow', workflow: 'child-old.yaml' }],
          }],
        },
        context: { projectRoot: process.cwd(), workspaceMode: 'in-place' },
      }));

      const response = await route.POST(
        makeRequest('/api/configs/child-new.yaml', {
          token,
          json: { config: childConfig, renameFrom: 'child-old.yaml' },
        }),
        { params: Promise.resolve({ filename: 'child-new.yaml' }) }
      );

      expect(response.status).toBe(200);
      const json = await responseJson<any>(response);
      expect(json.referenceUpdate.updated).toEqual([{ filename: 'parent.yaml', count: 1 }]);
      const parent = parse(await readFile(path.join(configsDir, 'parent.yaml'), 'utf-8'));
      expect(parent.workflow.states[0].steps[0].workflow).toBe('child-new.yaml');
    });
  });

  test('config copy route preserves SpecCoding for the copied workflow', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const configsDir = path.join(aceHome, 'configs');
        await mkdir(configsDir, { recursive: true });
        const config = stateMachineConfig(workspace, {
          workflow: { name: 'Copy Source' },
          context: { requirements: 'Copy route must preserve SpecCoding' },
        });
        await writeFile(path.join(configsDir, 'copy-source.yaml'), stringify(config), 'utf8');

        const { buildCreationSession, loadLatestCreationSessionByFilename, saveCreationSession } = await import('@/lib/spec/coding-store');
        const sourceSession = buildCreationSession({
          chatSessionId: 'chat-copy-source',
          createdBy: user.id,
          filename: 'copy-source.yaml',
          workflowName: 'Copy Source',
          mode: 'state-machine',
          workingDirectory: workspace,
          workspaceMode: 'in-place',
          requirements: 'Copy route must preserve SpecCoding',
          config,
        });
        sourceSession.specCoding.artifacts.design = '# Design\n\nKeep this copied design.';
        await saveCreationSession(sourceSession);

        const { POST } = await import('@/server/api-routes/configs/[filename]/copy/route');
        const response = await POST(makeRequest('/api/configs/copy-source.yaml/copy', {
          method: 'POST',
          token,
          json: {
            newFilename: 'copy-target.yaml',
            workflowName: 'Copy Target',
          },
        }) as any, {
          params: Promise.resolve({ filename: 'copy-source.yaml' }),
        });

        expect(response.status).toBe(200);
        const body = await responseJson<any>(response);
        expect(body.success).toBe(true);
        expect(body.filename).toBe('copy-target.yaml');
        expect(body.creationSessionId).toBeTruthy();

        const copiedYaml = parse(await readFile(path.join(configsDir, 'copy-target.yaml'), 'utf8'));
        expect(copiedYaml.workflow.name).toBe('Copy Target');

        const copiedSession = await loadLatestCreationSessionByFilename('copy-target.yaml');
        expect(copiedSession).toBeTruthy();
        expect(copiedSession!.id).toBe(body.creationSessionId);
        expect(copiedSession!.id).not.toBe(sourceSession.id);
        expect(copiedSession!.filename).toBe('copy-target.yaml');
        expect(copiedSession!.workflowName).toBe('Copy Target');
        expect(copiedSession!.createdBy).toBe(user.id);
        expect(copiedSession!.specCoding.linkedConfigFilename).toBe('copy-target.yaml');
        expect(copiedSession!.specCoding.workflowName).toBe('Copy Target');
        expect(copiedSession!.specCoding.artifacts.design).toContain('Keep this copied design');
      });
    });
  });
});
