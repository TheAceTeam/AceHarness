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

        const historicalLightweightResponse = await validate.POST(makeRequest('/api/configs/validate', {
          token,
          json: {
            config: stateMachineConfig(workspace, {
              workflow: {
                name: 'Historical Lightweight',
                profile: 'lightweight',
                lightweight: {},
                supervisor: { enabled: true, agent: 'default-supervisor' },
                states: [{
                  name: 'Execute',
                  isInitial: true,
                  isFinal: true,
                  steps: [{
                    name: 'Run tasklist',
                    type: 'agent',
                    agent: 'developer',
                    task: 'Run the lightweight tasklist',
                    skills: ['aceharness-tasklist'],
                    specTaskBinding: { taskIds: ['T1.1'] },
                  }],
                  transitions: [],
                }],
              },
              context: {
                requirements: 'Run the lightweight tasklist',
              },
            }),
          },
        }));
        expect(historicalLightweightResponse.status).toBe(200);
        const historicalLightweightJson = await responseJson<any>(historicalLightweightResponse);
        expect(historicalLightweightJson.validation.ok).toBe(true);
        expect(historicalLightweightJson.validation.normalized.workflow.profile).toBe('lightweight');
        expect(historicalLightweightJson.validation.normalized.workflow.supervisor).toBeUndefined();
        expect(historicalLightweightJson.validation.normalized.workflow.states[0].steps[0].specTaskBinding).toBeUndefined();
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
          lightweight: {},
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

  test('config create route ignores a client tasklist directory override and rejects duplicates', async () => {
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
              // Legacy client input is intentionally ignored by the creation route.
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
        expect(lightweightYaml.workflow.lightweight?.tasklistDirectory).toBeUndefined();
        expect(JSON.stringify(lightweightYaml)).not.toContain('docs/tasklists');

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

  test('config save normalizes historical lightweight supervisor while preserving state-machine supervisor', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        const route = await import('@/server/api-routes/configs/[filename]/route');

        const lightweightConfig = {
          workflow: {
            name: 'Historical Lightweight',
            mode: 'state-machine',
            profile: 'lightweight',
            lightweight: {},
            supervisor: { enabled: true, agent: 'default-supervisor' },
            states: [{
              name: 'Execute',
              isInitial: true,
              isFinal: true,
              steps: [{
                name: 'Run tasklist',
                type: 'agent',
                agent: 'developer',
                task: 'Run the lightweight tasklist',
                skills: ['aceharness-tasklist'],
              }],
              transitions: [],
            }],
          },
          context: {
            projectRoot: workspace,
            workspaceMode: 'in-place',
            requirements: 'Run the lightweight tasklist',
            executionPolicy: {
              defaultModel: 'gpt-5',
              agentOverrides: {
                'default-supervisor': {
                  enabled: true,
                  model: 'gpt-5-supervisor',
                },
                developer: {
                  enabled: true,
                  model: 'gpt-5-dev',
                },
              },
            },
          },
        };

        const lightweightResponse = await route.POST(
          makeRequest('/api/configs/historical-lightweight.yaml', {
            token,
            json: { config: lightweightConfig },
          }),
          { params: Promise.resolve({ filename: 'historical-lightweight.yaml' }) }
        );

        expect(lightweightResponse.status).toBe(200);
        const lightweightJson = await responseJson<any>(lightweightResponse);
        expect(lightweightJson.success).toBe(true);
        const persistedLightweight = parse(await readFile(path.join(aceHome, 'configs', 'historical-lightweight.yaml'), 'utf-8'));
        expect(persistedLightweight.workflow.profile).toBe('lightweight');
        expect(persistedLightweight.workflow.supervisor).toBeUndefined();
        expect(persistedLightweight.context.executionPolicy.agentOverrides).toEqual({
          developer: {
            enabled: true,
            model: 'gpt-5-dev',
          },
        });

        const stateConfig = stateMachineConfig(workspace, {
          workflow: { name: 'Supervisor State Machine' },
          context: { requirements: 'Keep state-machine supervisor' },
        });
        const stateResponse = await route.POST(
          makeRequest('/api/configs/supervisor-state-machine.yaml', {
            token,
            json: { config: stateConfig },
          }),
          { params: Promise.resolve({ filename: 'supervisor-state-machine.yaml' }) }
        );

        expect(stateResponse.status).toBe(200);
        const stateJson = await responseJson<any>(stateResponse);
        expect(stateJson.success).toBe(true);
        const persistedState = parse(await readFile(path.join(aceHome, 'configs', 'supervisor-state-machine.yaml'), 'utf-8'));
        expect(persistedState.workflow.profile).toBeUndefined();
        expect(persistedState.workflow.supervisor).toEqual({
          enabled: true,
          agent: 'default-supervisor',
          stageReviewEnabled: true,
          stageReviewAsync: true,
          checkpointAdviceEnabled: true,
          scoringEnabled: true,
          experienceEnabled: true,
        });
      });
    });
  });

  test('saving a pre-protocol workflow does not adopt the review protocol for it', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        const route = await import('@/server/api-routes/configs/[filename]/route');

        // Shaped like a workflow authored before state-level review existed: no
        // reviewPolicy anywhere, a parallel tail, and a defender/attacker/judge
        // sequence that would otherwise be inferred as adversarial.
        const legacyConfig = {
          workflow: {
            name: 'Pre Protocol',
            mode: 'state-machine',
            supervisor: { enabled: true, agent: 'default-supervisor' },
            states: [
              {
                name: 'Build',
                isInitial: true,
                isFinal: false,
                steps: [
                  { name: 'Impl A', type: 'agent', agent: 'developer', task: 'A', parallelGroup: 'g' },
                  { name: 'Impl B', type: 'agent', agent: 'developer', task: 'B', parallelGroup: 'g' },
                ],
                transitions: [
                  { to: 'Review', condition: { verdict: 'pass' } },
                  { to: 'Build', condition: { verdict: 'conditional_pass' } },
                  { to: 'Build', condition: { verdict: 'fail' } },
                ],
              },
              {
                name: 'Review',
                isInitial: false,
                isFinal: false,
                steps: [
                  { name: 'Produce', type: 'agent', agent: 'developer', task: 'produce', role: 'defender' },
                  { name: 'Challenge', type: 'agent', agent: 'developer', task: 'challenge', role: 'attacker' },
                  { name: 'Decide', type: 'agent', agent: 'developer', task: 'decide', role: 'judge' },
                ],
                transitions: [
                  { to: 'Done', condition: { verdict: 'pass' } },
                  { to: 'Review', condition: { verdict: 'conditional_pass' } },
                  { to: 'Review', condition: { verdict: 'fail' } },
                ],
              },
              { name: 'Done', isInitial: false, isFinal: true, steps: [], transitions: [] },
            ],
          },
          context: { projectRoot: workspace, workspaceMode: 'in-place', requirements: 'keep as authored' },
        };

        const response = await route.POST(
          makeRequest('/api/configs/pre-protocol.yaml', { token, json: { config: legacyConfig } }),
          { params: Promise.resolve({ filename: 'pre-protocol.yaml' }) },
        );
        expect(response.status).toBe(200);

        const persisted = parse(await readFile(path.join(aceHome, 'configs', 'pre-protocol.yaml'), 'utf-8')) as any;
        const [build, review] = persisted.workflow.states;
        expect(build.steps).toHaveLength(2);
        expect(build.reviewPolicy).toBeUndefined();
        expect(build.maxSelfTransitions).toBeUndefined();
        expect(review.steps).toHaveLength(3);
        expect(review.reviewPolicy).toBeUndefined();
        expect(review.maxSelfTransitions).toBeUndefined();
        expect(review.steps.map((step: any) => step.agentInstanceId)).toEqual([undefined, undefined, undefined]);
        expect(persisted.workflow.reviewProtocol).toBeUndefined();

        // Adding one state must not drag the rest of a pre-protocol workflow into
        // the protocol — every other state would then fail the "must declare a
        // reviewPolicy" rule and the whole config would become unsavable.
        const withExtraState = JSON.parse(JSON.stringify(legacyConfig));
        withExtraState.workflow.states.splice(2, 0, {
          name: 'Extra',
          isInitial: false,
          isFinal: false,
          maxSelfTransitions: 3,
          reviewPolicy: {
            mode: 'standard',
            source: 'default',
            locked: false,
            confidence: 'medium',
            riskSignals: [],
            rationale: '手工新增状态默认采用标准模式。',
          },
          steps: [{ name: 'Do', type: 'agent', agent: 'developer', task: 'do' }],
          transitions: [
            { to: 'Done', condition: { verdict: 'pass' } },
            { to: 'Extra', condition: { verdict: 'conditional_pass' } },
            { to: 'Extra', condition: { verdict: 'fail' } },
          ],
        });
        const withExtra = await route.POST(
          makeRequest('/api/configs/pre-protocol.yaml', { token, json: { config: withExtraState } }),
          { params: Promise.resolve({ filename: 'pre-protocol.yaml' }) },
        );
        expect(withExtra.status).toBe(200);
        const persistedWithExtra = parse(
          await readFile(path.join(aceHome, 'configs', 'pre-protocol.yaml'), 'utf-8'),
        ) as any;
        expect(persistedWithExtra.workflow.reviewProtocol).toBeUndefined();
        expect(persistedWithExtra.workflow.states[0].reviewPolicy).toBeUndefined();
        expect(persistedWithExtra.workflow.states[1].reviewPolicy).toBeUndefined();
        expect(persistedWithExtra.workflow.states[2].reviewPolicy?.mode).toBe('standard');

        // Once every non-final state carries a policy, a save must replace the
        // legacy quorum inference with the durable workflow-level marker.
        const fullyAdopted = JSON.parse(JSON.stringify(legacyConfig));
        fullyAdopted.workflow.states[0].reviewPolicy = {
          mode: 'standard',
          source: 'default',
          locked: false,
          confidence: 'medium',
          riskSignals: [],
          rationale: '存量标准状态。',
        };
        fullyAdopted.workflow.states[1].reviewPolicy = {
          mode: 'adversarial',
          source: 'default',
          locked: false,
          confidence: 'medium',
          riskSignals: ['独立挑战'],
          rationale: '存量对抗状态。',
        };
        const adoptedSave = await route.POST(
          makeRequest('/api/configs/pre-protocol.yaml', { token, json: { config: fullyAdopted } }),
          { params: Promise.resolve({ filename: 'pre-protocol.yaml' }) },
        );
        expect(adoptedSave.status).toBe(200);
        const persistedAdopted = parse(
          await readFile(path.join(aceHome, 'configs', 'pre-protocol.yaml'), 'utf-8'),
        ) as any;
        expect(persistedAdopted.workflow.reviewProtocol).toBe('state-level');
      });
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
