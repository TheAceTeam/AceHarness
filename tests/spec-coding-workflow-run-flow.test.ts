import { describe, expect, test, vi } from 'vitest';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MockEngine } from './helpers/mock-engine';
import { withIsolatedAceHome, withTempWorkspace } from './helpers/module-helpers';
import { makeRequest, responseJson } from './helpers/route-helpers';

const engineState = vi.hoisted(() => ({
  engine: null as MockEngine | null,
}));

vi.mock('@/lib/engines', () => ({
  createEngine: vi.fn().mockImplementation(async () => engineState.engine),
  getConfiguredEngine: vi.fn().mockResolvedValue('mock-engine'),
}));

vi.mock('@/lib/engines/engine-config', () => ({
  getEngineSkillsSubdir: vi.fn().mockReturnValue('.agent/skills'),
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

function oneStepStateMachineConfig(projectRoot: string, taskId?: string) {
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
              specTaskBinding: taskId ? { taskIds: [taskId] } : undefined,
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

        const sessionsRoute = await import('@/app/api/spec-coding/sessions/route');
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
        const boundTaskId = flatTasks.find((task: any) => task.title.includes('Implement task'))?.id || flatTasks.at(-1)?.id;
        expect(boundTaskId).toBeTruthy();
        const boundConfigDraft = oneStepStateMachineConfig(workspace, boundTaskId);

        const createConfigRoute = await import('@/app/api/configs/create/route');
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
            creationSessionId: sessionJson.session.id,
            configDraft: boundConfigDraft,
          },
        }));
        const createJson = await responseJson<any>(createResponse);
        expect(createResponse.status, JSON.stringify(createJson)).toBe(200);
        expect(createJson.creationSession.bindingValidation.ok).toBe(true);
        expect(createJson.creationSession.bindingValidation.bindings[0].taskIds).toContain(boundTaskId);

        const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
        const manager = new StateMachineWorkflowManager();
        (manager as any)._creationSessionId = createJson.creationSession.id;
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

        const sessionsRoute = await import('@/app/api/spec-coding/sessions/route');
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
        const boundTaskId = flatTasks.find((task: any) => task.title.includes('Implement task'))?.id || flatTasks.at(-1)?.id;
        expect(boundTaskId).toBeTruthy();
        const boundConfigDraft = oneStepStateMachineConfig(workspace, boundTaskId);

        const createConfigRoute = await import('@/app/api/configs/create/route');
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
            creationSessionId: sessionJson.session.id,
            configDraft: boundConfigDraft,
          },
        }));
        const createJson = await responseJson<any>(createResponse);
        expect(createResponse.status, JSON.stringify(createJson)).toBe(200);
        expect(createJson.creationSession.bindingValidation.ok).toBe(true);

        const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
        const { deltaDirName } = await import('@/lib/spec/persistence');
        const manager = new StateMachineWorkflowManager();
        (manager as any)._creationSessionId = createJson.creationSession.id;
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
