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
  const [validate, create, recommendations] = await Promise.all([
    import('@/app/api/configs/validate/route'),
    import('@/app/api/configs/create/route'),
    import('@/app/api/configs/recommendations/route'),
  ]);
  return { validate, create, recommendations };
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

function phaseConfig(projectRoot: string, overrides: Record<string, any> = {}) {
  return {
    workflow: {
      name: 'Validated Workflow',
      supervisor: {
        enabled: true,
        agent: 'default-supervisor',
      },
      phases: [
        {
          name: 'Build',
          steps: [
            { name: 'Implement', agent: 'developer', task: 'Implement the requested change' },
          ],
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
      const { validate, create, recommendations } = await loadConfigRoutes();

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
      await assertErrorResponse(
        await recommendations.POST(makeRequest('/api/configs/recommendations', { json: {} })),
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
          json: { config: phaseConfig(workspace) },
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

  test('config create route writes phase and state-machine workflows and rejects duplicates', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const { create } = await loadConfigRoutes();

        let response = await create.POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename: 'phase-created.yaml',
            workflowName: 'Phase Created',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            mode: 'phase-based',
            description: 'Created from route test',
          },
        }));
        expect(response.status).toBe(200);
        let json = await responseJson<any>(response);
        expect(json.success).toBe(true);
        expect(json.filename).toBe('phase-created.yaml');
        expect(json.creationSession.createdBy).toBe(user.id);
        expect(json.creationSession.status).toBe('config-generated');

        const phaseYaml = parse(await readFile(path.join(aceHome, 'configs', 'phase-created.yaml'), 'utf8'));
        expect(phaseYaml.workflow.name).toBe('Phase Created');
        expect(phaseYaml.workflow.supervisor.agent).toBe('default-supervisor');
        expect(phaseYaml.workflow.phases[0].steps[0].agent).toBe('developer');
        expect(phaseYaml.context.projectRoot).toBe(workspace);

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
              filename: 'phase-created.yaml',
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

  test('config recommendations use explicit reference workflow agents and supervisor fallback', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        const configsDir = path.join(aceHome, 'configs');
        await mkdir(configsDir, { recursive: true });
        await writeFile(path.join(configsDir, 'reference.yaml'), stringify(phaseConfig(workspace, {
          workflow: {
            name: 'Reference Workflow',
            description: 'Reference for recommendation route',
            phases: [
              {
                name: 'Build',
                steps: [
                  { name: 'Design', agent: 'architect', task: 'Design the change' },
                  { name: 'Review', agent: 'code-auditor', task: 'Review implementation risks' },
                ],
              },
            ],
          },
        })), 'utf8');

        const { recommendations } = await loadConfigRoutes();
        const response = await recommendations.POST(makeRequest('/api/configs/recommendations', {
          token,
          json: {
            workflowName: 'New Workflow',
            requirements: 'Need architecture and implementation review support',
            workingDirectory: workspace,
            referenceWorkflow: 'reference.yaml',
          },
        }));
        expect(response.status).toBe(200);
        const json = await responseJson<any>(response);
        expect(json.recommendations.referenceWorkflow.filename).toBe('reference.yaml');
        expect(json.recommendations.referenceWorkflow.source).toBe('manual');
        expect(json.recommendations.referenceWorkflow.agents).toEqual(['architect', 'code-auditor']);
        expect(json.recommendations.recommendedAgents[0]).toBe('architect');
        expect(json.recommendations.recommendedAgents[1]).toBe('code-auditor');
        expect(json.recommendations.recommendedSupervisorAgent).toBe('default-supervisor');
        expect(json.recommendations.recommendedAgents.includes('default-supervisor')).toBe(false);
      });
    });
  });

  test('config recommendations can disable historical experience without disabling manual references', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token } = await createAuthToken();
        const configsDir = path.join(aceHome, 'configs');
        await mkdir(configsDir, { recursive: true });
        await writeFile(path.join(configsDir, 'historical-reference.yaml'), stringify(phaseConfig(workspace, {
          workflow: {
            name: 'Historical Reference',
            phases: [
              {
                name: 'Historical Build',
                steps: [
                  { name: 'Implement', agent: 'developer', task: 'Reuse a known implementation path' },
                ],
              },
            ],
          },
        })), 'utf8');

        const { appendWorkflowExperience } = await import('@/lib/workflow/experience-store');
        await appendWorkflowExperience({
          runId: 'run-historical-recommendation',
          configFile: 'historical-reference.yaml',
          workflowName: 'Historical Recommendation',
          projectRoot: workspace,
          workflowMode: 'phase-based',
          supervisorAgent: 'default-supervisor',
          status: 'completed',
          summary: 'Historical recommendation summary',
          nextFocus: ['Keep the known workflow shape'],
          experience: ['Reuse historical phase structure'],
          scoreCards: [],
          agentNames: ['developer'],
          keywords: ['historical', 'recommendation'],
          generatedAt: new Date().toISOString(),
        });

        const { recommendations } = await loadConfigRoutes();
        let response = await recommendations.POST(makeRequest('/api/configs/recommendations', {
          token,
          json: {
            workflowName: 'Historical Recommendation',
            requirements: 'historical recommendation should find known workflow',
            workingDirectory: workspace,
          },
        }));
        expect(response.status).toBe(200);
        let json = await responseJson<any>(response);
        expect(json.recommendations.experiences).toHaveLength(1);
        expect(json.recommendations.referenceWorkflow.filename).toBe('historical-reference.yaml');
        expect(json.recommendations.referenceWorkflow.source).toBe('recommended-experience');

        response = await recommendations.POST(makeRequest('/api/configs/recommendations', {
          token,
          json: {
            workflowName: 'Historical Recommendation',
            requirements: 'historical recommendation should find known workflow',
            workingDirectory: workspace,
            useHistoricalExperience: false,
          },
        }));
        expect(response.status).toBe(200);
        json = await responseJson<any>(response);
        expect(json.recommendations.experiences).toEqual([]);
        expect(json.recommendations.referenceWorkflow).toBeNull();

        response = await recommendations.POST(makeRequest('/api/configs/recommendations', {
          token,
          json: {
            workflowName: 'Historical Recommendation',
            requirements: 'historical recommendation should find known workflow',
            workingDirectory: workspace,
            referenceWorkflow: 'historical-reference.yaml',
            useHistoricalExperience: false,
          },
        }));
        expect(response.status).toBe(200);
        json = await responseJson<any>(response);
        expect(json.recommendations.experiences).toEqual([]);
        expect(json.recommendations.referenceWorkflow.filename).toBe('historical-reference.yaml');
        expect(json.recommendations.referenceWorkflow.source).toBe('manual');
      });
    });
  });

  test('config copy route preserves SpecCoding for the copied workflow', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await withTempWorkspace(async ({ workspace }) => {
        const { token, user } = await createAuthToken();
        const configsDir = path.join(aceHome, 'configs');
        await mkdir(configsDir, { recursive: true });
        const config = phaseConfig(workspace, {
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
          mode: 'phase-based',
          workingDirectory: workspace,
          workspaceMode: 'in-place',
          requirements: 'Copy route must preserve SpecCoding',
          config,
        });
        sourceSession.specCoding.artifacts.design = '# Design\n\nKeep this copied design.';
        await saveCreationSession(sourceSession);

        const { POST } = await import('@/app/api/configs/[filename]/copy/route');
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
