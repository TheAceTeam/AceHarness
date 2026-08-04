import { describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MockEngine } from './helpers/mock-engine';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

const engineState = vi.hoisted(() => ({
  engine: null as MockEngine | null,
}));

vi.mock('@/lib/workflow/runtime-facade', () => ({
  createWorkflowRuntime: vi.fn().mockImplementation(async () => engineState.engine),
  getConfiguredWorkflowRuntime: vi.fn().mockResolvedValue('mock-engine'),
  getWorkflowRuntimeSkillsSubdir: vi.fn().mockReturnValue('.agent/skills'),
  getLogicalEngineId: vi.fn((engine) => engine),
  resolveRequestedWorkflowRuntimeType: vi.fn((engine) => engine || 'mock-engine'),
  compactWorkflowRuntimeContextManually: vi.fn().mockResolvedValue(null),
  executeWorkflowRuntimeWithContextRecovery: vi.fn((engine, options) => engine.execute(options)),
  resolveRecoveredWorkflowRuntimeSessionId: vi.fn((result, fallback) => result.sessionId || fallback || null),
}));

vi.mock('@/lib/engines/workflow-engine-selection', () => ({
  resolveAgentEngineSelection: vi.fn().mockReturnValue({ engine: 'mock-engine', model: 'mock-model' }),
}));

async function createAuthToken(): Promise<{ token: string; userId: string }> {
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `flow-${suffix}`,
    email: `flow-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role: 'user',
    personalDir: '',
  });
  const token = `token-${suffix}`;
  storeToken(token, user.id);
  return { token, userId: user.id };
}

function oneStepStateMachineConfig(projectRoot: string, taskIds?: string[]) {
  return {
    workflow: {
      name: 'Mock Spec Run',
      mode: 'state-machine',
      maxTransitions: 5,
      supervisor: {
        enabled: false,
      },
      states: [
        {
          name: 'Implement',
          isInitial: true,
          isFinal: true,
          steps: [
            {
              id: 'step-implement',
              name: 'Implement task',
              agent: 'developer',
              role: 'judge',
              task: 'Implement the requested change and report verdict.',
              specTaskBinding: taskIds ? { taskIds } : undefined,
            },
          ],
          transitions: [],
        },
      ],
    },
    context: {
      projectRoot,
      workspaceMode: 'in-place',
      requirements: 'Ship the mocked end-to-end SpecCoding workflow.',
      engine: 'mock-engine',
    },
    roles: [
      {
        name: 'developer',
        team: 'blue',
        roleType: 'normal',
        engineModels: { 'mock-engine': 'mock-model' },
        activeEngine: 'mock-engine',
        capabilities: ['development'],
        systemPrompt: 'You are a test developer.',
      },
    ],
  };
}

function flattenTasks(tasks: any[]): any[] {
  return (tasks || []).flatMap((task) => [task, ...flattenTasks(task.children || [])]);
}

describe('SpecCoding workflow creation to mocked AI run flow', () => {
  test('creates SpecCoding, binds workflow steps, and updates task status from system lifecycle during run', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        vi.resetModules();
        engineState.engine = new MockEngine({
          success: true,
          output: '```json\n{"verdict":"pass","summary":"mocked AI completed the task","issues":[]}\n```',
          metadata: {
            duration_ms: 12,
            usage: { input_tokens: 10, output_tokens: 5 },
          } as any,
        });

        const { token } = await createAuthToken();
        const configDraft = oneStepStateMachineConfig(workspace);
        const filename = `mock-spec-run-${Date.now()}.yaml`;

        const sessionsRoute = await import('@/server/api-routes/spec-coding/sessions/route');
        const sessionResponse = await sessionsRoute.POST(makeRequest('/api/spec-coding/sessions', {
          token,
          json: {
            chatSessionId: 'chat-flow',
            filename,
            workflowName: 'Mock Spec Run',
            mode: 'state-machine',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            description: 'Mocked run from workflow creation to SpecCoding execution',
            requirements: 'Ship the mocked end-to-end SpecCoding workflow.',
            config: configDraft,
          },
        }));
        expect(sessionResponse.status).toBe(200);
        const sessionJson = await responseJson<any>(sessionResponse);
        const flatTasks = flattenTasks(sessionJson.session.specCoding.tasks);
        expect(sessionJson.session.bindingValidation.ok).toBe(true);
        const boundTaskId = sessionJson.session.bindingValidation.bindings[0]?.taskIds[0];
        expect(flatTasks.some((task: any) => task.id === boundTaskId && task.children.length === 0)).toBe(true);
        expect(sessionJson.session.bindingValidation.bindings[0].taskIds).toContain(boundTaskId);
        const leafTaskIds = flatTasks.filter((task: any) => task.children.length === 0).map((task: any) => task.id);
        const boundConfigDraft = oneStepStateMachineConfig(workspace, leafTaskIds);

        const createConfigRoute = await import('@/server/api-routes/configs/create/route');
        const createResponse = await createConfigRoute.POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename,
            workflowName: 'Mock Spec Run',
            mode: 'state-machine',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            description: 'Mocked run from workflow creation to SpecCoding execution',
            requirements: 'Ship the mocked end-to-end SpecCoding workflow.',
          },
        }));
        const createJson = await responseJson<any>(createResponse);
        expect(createResponse.status, JSON.stringify(createJson)).toBe(200);
        expect(createJson.filename).toBe(filename);

        const configRoute = await import('@/server/api-routes/configs/[filename]/route');
        const saveResponse = await configRoute.POST(makeRequest(`/api/configs/${filename}`, {
          token,
          json: {
            config: boundConfigDraft,
            creationSessionId: sessionJson.session.id,
          },
        }), { params: Promise.resolve({ filename }) });
        const saveJson = await responseJson<any>(saveResponse);
        expect(saveResponse.status, JSON.stringify(saveJson)).toBe(200);
        expect(saveJson.bindingValidation.ok).toBe(true);
        expect(saveJson.bindingValidation.bindings[0].taskIds).toEqual(leafTaskIds);

        const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
        const manager = new StateMachineWorkflowManager();
        (manager as any)._creationSessionId = sessionJson.session.id;
        (manager as any)._userPersonalDir = workspace;

        await manager.start(filename);

        const status = manager.getStatus() as any;
        expect(status.status).toBe('idle');
        expect(status.bindingValidation.ok).toBe(true);
        expect(status.stepTaskBindingsSnapshot[0].taskIds).toContain(boundTaskId);
        const runtimeTask = flattenTasks(status.runSpecCoding.tasks).find((task: any) => task.id === boundTaskId);
        expect(runtimeTask?.status).toBe('completed');
        expect(status.runSpecCoding.artifacts.tasks).toContain('[x]');

        expect(engineState.engine?.calls).toHaveLength(1);
        const prompt = engineState.engine?.calls[0].options.prompt || '';
        expect(prompt).not.toContain('<spec-tasks>');
        expect(prompt).not.toContain('spec task status protocol');
      });
    });
  });

  test('persists delta spec during run and imports workspace revisions without reversing task status', async () => {
    await withIsolatedAceHome(async () => {
      await withTempWorkspace(async ({ workspace }) => {
        vi.resetModules();

        const specRoot = resolve(workspace, '.spec');
        await mkdir(specRoot, { recursive: true });
        await writeFile(resolve(specRoot, 'spec.md'), '# Master Spec\n\nExisting baseline.\n', 'utf-8');

        let sawDeltaDuringExecution = false;
        let sawInProgressDuringExecution = false;
        engineState.engine = new MockEngine();
        engineState.engine.executeImpl = async () => {
          const specDirs = await readdir(resolve(specRoot, 'specs'));
          const deltaDir = resolve(specRoot, 'specs', specDirs[0]);
          const [requirements, design, tasks] = await Promise.all([
            readFile(resolve(deltaDir, 'requirements.md'), 'utf-8'),
            readFile(resolve(deltaDir, 'design.md'), 'utf-8'),
            readFile(resolve(deltaDir, 'tasks.md'), 'utf-8'),
          ]);
          sawDeltaDuringExecution = Boolean(requirements && design && tasks);
          sawInProgressDuringExecution = /-\s+\[-\]/.test(tasks);
          return {
            success: true,
            output: '```json\n{"verdict":"pass","summary":"mocked AI completed persisted run","issues":[]}\n```',
            metadata: {
              duration_ms: 12,
              usage: { input_tokens: 7, output_tokens: 3 },
            } as any,
          };
        };

        const { token } = await createAuthToken();
        const configDraft = oneStepStateMachineConfig(workspace);
        const filename = `mock-persisted-spec-run-${Date.now()}.yaml`;

        const sessionsRoute = await import('@/server/api-routes/spec-coding/sessions/route');
        const sessionResponse = await sessionsRoute.POST(makeRequest('/api/spec-coding/sessions', {
          token,
          json: {
            chatSessionId: 'chat-persisted-flow',
            filename,
            workflowName: 'Mock Spec Run',
            mode: 'state-machine',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            description: 'Mocked persisted SpecCoding workflow',
            requirements: 'Ship persisted spec flow.',
            persistMode: 'repository',
            specRoot: '.spec',
            config: configDraft,
          },
        }));
        const sessionJson = await responseJson<any>(sessionResponse);
        expect(sessionResponse.status, JSON.stringify(sessionJson)).toBe(200);

        const flatTasks = flattenTasks(sessionJson.session.specCoding.tasks);
        expect(sessionJson.session.bindingValidation.ok).toBe(true);
        const boundTaskId = sessionJson.session.bindingValidation.bindings[0]?.taskIds[0];
        expect(flatTasks.some((task: any) => task.id === boundTaskId && task.children.length === 0)).toBe(true);
        expect(sessionJson.session.bindingValidation.bindings[0].taskIds).toContain(boundTaskId);
        const leafTaskIds = flatTasks.filter((task: any) => task.children.length === 0).map((task: any) => task.id);
        const boundConfigDraft = oneStepStateMachineConfig(workspace, leafTaskIds);

        const createConfigRoute = await import('@/server/api-routes/configs/create/route');
        const createResponse = await createConfigRoute.POST(makeRequest('/api/configs/create', {
          token,
          json: {
            filename,
            workflowName: 'Mock Spec Run',
            mode: 'state-machine',
            workingDirectory: workspace,
            workspaceMode: 'in-place',
            description: 'Mocked persisted SpecCoding workflow',
            requirements: 'Ship persisted spec flow.',
            persistMode: 'repository',
            specRoot: '.spec',
          },
        }));
        const createJson = await responseJson<any>(createResponse);
        expect(createResponse.status, JSON.stringify(createJson)).toBe(200);
        expect(createJson.filename).toBe(filename);

        const configRoute = await import('@/server/api-routes/configs/[filename]/route');
        const saveResponse = await configRoute.POST(makeRequest(`/api/configs/${filename}`, {
          token,
          json: {
            config: boundConfigDraft,
            creationSessionId: sessionJson.session.id,
          },
        }), { params: Promise.resolve({ filename }) });
        const saveJson = await responseJson<any>(saveResponse);
        expect(saveResponse.status, JSON.stringify(saveJson)).toBe(200);
        expect(saveJson.bindingValidation.ok).toBe(true);
        expect(saveJson.bindingValidation.bindings[0].taskIds).toEqual(leafTaskIds);

        const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
        const { deltaDirName } = await import('@/lib/spec/persistence');
        const manager = new StateMachineWorkflowManager();
        (manager as any)._creationSessionId = sessionJson.session.id;
        (manager as any)._userPersonalDir = workspace;

        await manager.start(filename);

        expect(sawDeltaDuringExecution).toBe(true);
        expect(sawInProgressDuringExecution).toBe(true);

        const status = manager.getStatus() as any;
        const deltaDir = resolve(specRoot, 'specs', deltaDirName('Mock Spec Run', status.runId));
        const completedTasks = await readFile(resolve(deltaDir, 'tasks.md'), 'utf-8');
        expect(completedTasks).toMatch(/-\s+\[x\]/);

        const editedRequirements = `${await readFile(resolve(deltaDir, 'requirements.md'), 'utf-8')}\n\n## 用户修订\n\nWorkspace delta edit.\n`;
        await writeFile(resolve(deltaDir, 'requirements.md'), editedRequirements, 'utf-8');
        await writeFile(resolve(deltaDir, 'tasks.md'), completedTasks.replace(/\[x\]/g, '[ ]'), 'utf-8');

        const imported = await manager.importWorkspaceDeltaSpecRevision({
          summary: 'Import edited workspace delta',
          createdBy: 'test-user',
        });

        expect(imported?.artifacts.requirements).toContain('Workspace delta edit.');
        const runtimeTask = flattenTasks((manager.getStatus() as any).runSpecCoding.tasks).find((task: any) => task.id === boundTaskId);
        expect(runtimeTask?.status).toBe('completed');
        expect(imported?.revisions.at(-1)?.summary).toBe('Import edited workspace delta');
        expect(imported?.revisions.at(-1)?.createdBy).toBe('test-user');

        const rewrittenTasks = await readFile(resolve(deltaDir, 'tasks.md'), 'utf-8');
        expect(rewrittenTasks).toMatch(/-\s+\[x\]/);
      });
    });
  });
});
