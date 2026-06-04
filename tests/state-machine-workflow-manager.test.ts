import { describe, expect, test, vi, beforeEach } from 'vitest';
import { MockEngine } from './helpers/mock-engine';

// Mock all heavy external dependencies
vi.mock('@/lib/run/store', () => ({
  createRun: vi.fn().mockResolvedValue(undefined),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/run/state-persistence', () => ({
  saveRunState: vi.fn().mockResolvedValue(undefined),
  saveProcessOutput: vi.fn().mockResolvedValue(undefined),
  saveStreamContent: vi.fn().mockResolvedValue(undefined),
  appendStreamContent: vi.fn().mockResolvedValue(undefined),
  appendFeedbackToStream: vi.fn().mockResolvedValue(undefined),
  loadRunState: vi.fn().mockResolvedValue(null),
  loadStepOutputs: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/core/process-manager', () => ({
  processManager: {
    registerExternalProcess: vi.fn().mockReturnValue({
      status: 'running',
      sessionId: null,
      streamContent: '',
    }),
    getProcess: vi.fn().mockReturnValue(null),
    getProcessRaw: vi.fn().mockReturnValue(null),
    getAllProcesses: vi.fn().mockReturnValue([]),
    killProcess: vi.fn().mockReturnValue(false),
    setProcessOutput: vi.fn(),
    setProcessError: vi.fn(),
    appendStreamContent: vi.fn().mockReturnValue(''),
    on: vi.fn(),
    off: vi.fn(),
    emit: vi.fn(),
  },
}));

vi.mock('@/lib/workflow/workflow-experience-store', () => ({
  appendWorkflowExperience: vi.fn().mockResolvedValue(undefined),
  buildWorkflowExperiencePromptBlock: vi.fn().mockReturnValue(''),
  findRelevantWorkflowExperiences: vi.fn().mockResolvedValue([]),
  saveWorkflowFinalReview: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/workflow/workflow-memory-store', () => ({
  appendMemoryEntries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agent/agent-relationship-store', () => ({
  upsertRelationshipSignal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/chat/chat-persistence', () => ({
  updateChatSessionCreationBinding: vi.fn().mockResolvedValue(undefined),
  updateChatSessionWorkflowBinding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/core/default-supervisor', () => ({
  DEFAULT_SUPERVISOR_NAME: 'default-supervisor',
  ensureDefaultSupervisorConfig: vi.fn(),
  resolveWorkflowSupervisorAgent: vi.fn().mockReturnValue('default-supervisor'),
}));

vi.mock('@/lib/spec/coding-store', () => ({
  appendSpecCodingRevision: vi.fn(),
  appendSupervisorSpecCodingRevision: vi.fn(),
  cloneSpecCodingForRun: vi.fn(),
  loadCreationSession: vi.fn().mockResolvedValue(null),
  markSpecCodingStateStatus: vi.fn().mockImplementation((doc) => doc),
  normalizeSpecCodingDocument: vi.fn().mockImplementation((doc) => doc),
  updateSpecCodingTaskStatuses: vi.fn(),
}));

vi.mock('@/lib/spec/persistence', () => ({
  ensureSpecDirStructure: vi.fn().mockResolvedValue(undefined),
  getSpecRootDir: vi.fn().mockReturnValue('/tmp/spec'),
  writeDeltaSpec: vi.fn().mockResolvedValue(undefined),
  readDeltaSpec: vi.fn().mockResolvedValue(null),
  readChecklist: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/engines', () => ({
  createEngine: vi.fn(),
  getConfiguredEngine: vi.fn().mockResolvedValue('mock-engine'),
  getLogicalEngineId: vi.fn((engine) => engine),
  resolveRequestedEngineType: vi.fn((engine) => engine || 'mock-engine'),
}));

vi.mock('@/lib/engines/engine-config', () => ({
  getEngineSkillsSubdir: vi.fn().mockReturnValue('skills'),
}));

vi.mock('@/lib/run/runtime-configs', () => ({
  getRuntimeAgentsDirPath: vi.fn().mockReturnValue('/tmp/agents'),
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/config.yaml'),
}));

vi.mock('@/lib/run/runtime-skills', () => ({
  getRuntimeSkillsDirPath: vi.fn().mockResolvedValue('/tmp/skills'),
}));

vi.mock('@/lib/core/app-paths', () => ({
  getInstallPath: vi.fn((...segments: string[]) => ['/tmp/install', ...segments].join('/')),
  getInstallConfigsDir: vi.fn().mockReturnValue('/tmp/install/configs'),
  getInstallConfigPath: vi.fn((...segments: string[]) => ['/tmp/install/configs', ...segments].join('/')),
  getRepoRoot: vi.fn().mockReturnValue('/tmp/install'),
  getWorkspaceCacheFile: vi.fn((...segments: string[]) => ['/tmp/workspace/cache', ...segments].join('/')),
  getWorkspaceConfigFile: vi.fn((...segments: string[]) => ['/tmp/workspace/config', ...segments].join('/')),
  getWorkspaceDataFile: vi.fn((...segments: string[]) => ['/tmp/workspace/data', ...segments].join('/')),
  getWorkspaceLogFile: vi.fn((...segments: string[]) => ['/tmp/workspace/logs', ...segments].join('/')),
  getWorkspaceSkillPath: vi.fn((...segments: string[]) => ['/tmp/workspace/skills', ...segments].join('/')),
  getWorkspaceSkillsDir: vi.fn().mockReturnValue('/tmp/workspace/skills'),
  getWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspace'),
  getWorkspaceRunsDir: vi.fn().mockReturnValue('/tmp/runs'),
}));

vi.mock('@/lib/workflow/manager', () => ({
  resolveAgentModel: vi.fn().mockReturnValue('test-model'),
}));

vi.mock('@/lib/core/utils', () => ({
  formatTimestamp: vi.fn().mockReturnValue('2024-01-01-000000'),
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isDirectory: () => false, isFile: () => true, size: 0 }),
  mkdir: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn().mockReturnValue(false),
}));

vi.mock('yaml', () => ({
  parse: vi.fn(),
}));

vi.mock('crypto', () => ({
  randomUUID: vi.fn().mockReturnValue('test-uuid'),
}));

// --- Helper to build a minimal state machine config ---
function makeConfig(overrides: Record<string, any> = {}) {
  const { workflow: workflowOverrides, context: contextOverrides, ...rest } = overrides;
  return {
    workflow: {
      name: 'Test Workflow',
      mode: 'state-machine',
      maxTransitions: 50,
      states: [
        {
          name: '设计',
          isInitial: true,
          steps: [
            { name: 'design-step', agent: 'developer', task: 'Design the feature', role: 'judge' },
          ],
          transitions: [
            { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
            { condition: { verdict: 'fail' }, to: '设计', priority: 2 },
          ],
        },
        {
          name: '实施',
          steps: [
            { name: 'impl-step', agent: 'developer', task: 'Implement the feature', role: 'judge' },
          ],
          transitions: [
            { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
            { condition: { verdict: 'fail' }, to: '设计', priority: 2 },
          ],
        },
        {
          name: '完成',
          isFinal: true,
          steps: [],
          transitions: [],
        },
      ],
      ...workflowOverrides,
    },
    context: {
      requirements: 'Build a feature',
      ...contextOverrides,
    },
    roles: [
      { name: 'developer', systemPrompt: 'You are a developer' },
    ],
    ...rest,
  } as any;
}

// --- Helper to set up manager internal state ---
function makeAgentState(name: string) {
  return {
    name,
    team: '',
    model: 'test-model',
    status: 'idle',
    currentTask: null,
    completedTasks: 0,
    tokenUsage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
    costUsd: 0,
    sessionId: null,
    lastOutput: '',
    summary: '',
  };
}

async function createManagerForTest(engine: MockEngine) {
  const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
  const manager = new StateMachineWorkflowManager();

  // Set up minimum internal state
  (manager as any).currentEngine = engine;
  (manager as any).engineType = 'mock-engine';
  (manager as any).status = 'running';
  (manager as any).currentRunId = 'test-run-001';
  (manager as any).currentConfigFile = 'test.yaml';
  (manager as any).currentRequirements = 'Build a feature';
  (manager as any).workflowName = 'Test Workflow';
  (manager as any).runStartTime = new Date().toISOString();
  (manager as any).agents = [makeAgentState('developer')];
  (manager as any).agentConfigs = [
    { name: 'developer', systemPrompt: 'You are a developer' },
  ];

  // Stub internal methods to avoid filesystem/IO calls
  (manager as any).persistState = vi.fn().mockResolvedValue(undefined);
  (manager as any).collectSupervisorReview = vi.fn().mockResolvedValue(null);
  (manager as any).syncSkillsToWorkspace = vi.fn().mockResolvedValue(undefined);
  (manager as any).finalizeRun = vi.fn().mockResolvedValue(undefined);
  (manager as any).buildStepContext = vi.fn().mockResolvedValue('Test context for step');
  (manager as any).loadWorkspaceSkills = vi.fn().mockResolvedValue('');
  (manager as any).loadAdditionalSkills = vi.fn().mockResolvedValue('');
  (manager as any).applyRunSpecCodingTaskUpdatesFromOutput = vi.fn();
  (manager as any).applyLiveSpecCodingTaskUpdatesFromStream = vi.fn();
  (manager as any).markStepActive = vi.fn();
  (manager as any).markStepInactive = vi.fn();
  (manager as any).removeCurrentProcess = vi.fn();
  (manager as any).upsertCurrentProcess = vi.fn();
  (manager as any).getChannelContext = vi.fn().mockReturnValue('');
  (manager as any).resolveProjectRootPath = vi.fn().mockReturnValue('/tmp/project');

  return manager;
}

// ============================================================
// parseVerdict
// ============================================================
describe('parseVerdict', () => {
  test('parses pass from bare JSON object', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('{"verdict": "pass"}')).toBe('pass');
  });

  test('parses pass from JSON block', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('```json\n{"verdict": "pass"}\n```')).toBe('pass');
  });

  test('parses fail from JSON block', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('```json\n{"verdict": "fail"}\n```')).toBe('fail');
  });

  test('parses conditional_pass from JSON block', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('```json\n{"verdict": "conditional_pass"}\n```')).toBe('conditional_pass');
  });

  test('falls back to keyword matching for pass', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('All checks pass')).toBe('pass');
  });

  test('falls back to keyword matching for fail (English)', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('This is a fail result')).toBe('fail');
  });

  test('Chinese keywords do not match due to \\b word boundary limitation', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('检查失败')).toBe('conditional_pass');
    expect(parseVerdict('检查通过')).toBe('conditional_pass');
  });

  test('returns conditional_pass when no keywords match', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('Some partial results, needs more work')).toBe('conditional_pass');
  });

  test('returns fail for empty output', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('')).toBe('fail');
    expect(parseVerdict('   ')).toBe('fail');
  });

  test('parses verdict from step conclusion when JSON is missing', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('<step-conclusion>\n## 结果 / 裁决\n- 当前状态最终裁定为 fail。\n</step-conclusion>')).toBe('fail');
  });
});

describe('engine-level failure detection', () => {
  test('treats Claude context window limit as an engine-level failure', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure('ApiError: the model has reached its context window limit')).toBe(true);
  });

  test('does not treat AI file-read ENOENT as an engine-level failure', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure(
      "codex 引擎执行失败: ENOENT: no such file or directory, open 'C:\\Users\\Shawn\\Desktop\\jinja4cj\\opencode_glm5.1_ace\\src\\ast.cj'"
    )).toBe(false);
  });

  test('stops the workflow when an engine returns a context-window error as plain output', async () => {
    const engine = new MockEngine({
      success: true,
      output: 'ApiError: the model has reached its context window limit',
    });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();

    await expect((manager as any).executeStateMachine(config, 'Build a feature')).rejects.toThrow(/context window limit/i);
  });

  test('automatically resumes recoverable file-read failures in the same step conversation', async () => {
    const engine = new MockEngine();
    engine.executeImpl = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: "ENOENT: no such file or directory, open 'C:\\Users\\Shawn\\Desktop\\jinja4cj\\opencode_glm5.1_ace\\src\\ast.cj'",
        sessionId: 'same-session',
      })
      .mockResolvedValueOnce({
        success: true,
        output: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"recovered"}\n```\nRecovered by searching the workspace and using the correct file path.',
        sessionId: 'same-session',
      });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(result.stepOutputs.join('\n')).toContain('Recovered by searching');
    expect(engine.calls).toHaveLength(2);
    expect(engine.calls[1].options.sessionId).toBe('same-session');
    expect(engine.calls[1].options.prompt).toContain('系统自动恢复');
    expect(engine.calls[1].options.prompt).toContain('ENOENT');
  });

  test('counts automatic recovery failures consecutively after a successful recovery response', async () => {
    const engine = new MockEngine();
    let manager: any;
    engine.executeImpl = vi.fn()
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: "ENOENT: no such file or directory, open 'missing-a.cj'",
        sessionId: 'same-session',
      })
      .mockImplementationOnce(async () => {
        manager.queueLiveFeedback('继续补充验证');
        return {
          success: true,
          output: 'Recovered first failure and continuing.',
          sessionId: 'same-session',
        };
      })
      .mockResolvedValueOnce({
        success: false,
        output: '',
        error: "ENOENT: no such file or directory, open 'missing-b.cj'",
        sessionId: 'same-session',
      })
      .mockResolvedValueOnce({
        success: true,
        output: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"recovered"}\n```\nRecovered second failure.',
        sessionId: 'same-session',
      });
    manager = await createManagerForTest(engine);
    const config = makeConfig();

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(engine.calls).toHaveLength(4);
    expect(engine.calls[1].options.prompt).toContain('第 1/3 次');
    expect(engine.calls[3].options.prompt).toContain('第 1/3 次');
  });

  test('stops workflow after three failed automatic recoveries', async () => {
    const engine = new MockEngine();
    engine.executeImpl = vi.fn().mockResolvedValue({
      success: false,
      output: '',
      error: "ENOENT: no such file or directory, open 'C:\\Users\\Shawn\\Desktop\\jinja4cj\\opencode_glm5.1_ace\\src\\ast.cj'",
      sessionId: 'same-session',
    });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();

    await expect((manager as any).executeState(config.workflow.states[0], config, 'Build a feature'))
      .rejects.toThrow(/自动恢复 3 次后仍失败|引擎连续失败/);
    expect(engine.calls).toHaveLength(4);
  });
});

describe('state machine live feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('emits stable feedback lifecycle events when feedback interrupts a running step', async () => {
    const { processManager } = await import('@/lib/core/process-manager');
    vi.mocked(processManager.getAllProcesses).mockReturnValueOnce([
      { id: 'proc-1', stepId: 'step-1', status: 'running' },
    ] as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentState = '设计';
    (manager as any).currentProcesses = [{ id: 'proc-1', stepId: 'step-1' }];
    const events: any[] = [];
    manager.on('feedback-injected', (event) => events.push(event));

    const interrupted = manager.injectLiveFeedback('请先确认 lexer/parser/runtime 是否都已完成', { id: 'fb-1' } as any);

    expect(interrupted).toBe(true);
    expect(processManager.killProcess).toHaveBeenCalledWith('proc-1');
    expect(events.map((event) => event.status)).toEqual(['queued', 'interrupting']);
    expect(events.every((event) => event.id === 'fb-1')).toBe(true);
    expect((manager as any).liveFeedback).toHaveLength(1);
    expect((manager as any).liveFeedback[0]).toMatchObject({
      id: 'fb-1',
      message: '请先确认 lexer/parser/runtime 是否都已完成',
      interrupt: false,
    });
    expect(manager.getStatus().pendingLiveFeedback).toEqual([
      expect.objectContaining({
        id: 'fb-1',
        message: '请先确认 lexer/parser/runtime 是否都已完成',
        status: 'queued',
      }),
    ]);
  });

  test('promotes an existing queued feedback to interrupt without duplicating it', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentState = '设计';
    (manager as any).currentProcesses = [];
    const events: any[] = [];
    manager.on('feedback-injected', (event) => events.push(event));

    manager.injectLiveFeedback('优先处理这条反馈', { id: 'fb-promote' } as any);
    const interrupted = manager.interruptWithFeedback('优先处理这条反馈', { id: 'fb-promote' } as any);

    expect(interrupted).toBe(false);
    expect((manager as any).liveFeedback).toHaveLength(1);
    expect((manager as any).liveFeedback[0]).toMatchObject({
      id: 'fb-promote',
      message: '优先处理这条反馈',
      interrupt: true,
    });
    expect(events.map((event) => event.status)).toEqual(['queued', 'interrupting']);
  });

  test('injects the global workflow route into each step context', async () => {
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig();
    (manager as any).currentRunId = '';
    (manager as any).completedSteps = ['设计-design-step'];
    const context = await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[1].steps[0],
      config.workflow.states[1],
      config,
      'Build a feature',
    );

    expect(context).toContain('全局工作流路线与当前职责边界');
    expect(context).toContain('不能把当前步骤的核心交付留给后续步骤');
    expect(context).toContain('状态: 设计');
    expect(context).toContain('状态: 实施');
    expect(context).toContain('步骤: impl-step [待执行]');
    expect(context).toContain('可能流向: 完成 / 设计');
  });
});

describe('state machine resume', () => {
  test('restores workflow agora session id before emitting resume status', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-resume-001',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'stopped',
      startTime: '2024-01-01T00:00:00.000Z',
      currentState: '设计',
      currentPhase: '设计',
      currentStep: null,
      completedSteps: [],
      failedSteps: [],
      stepLogs: [],
      agents: [{ name: 'developer', sessionId: 'agent-session-1' }],
      iterationStates: {},
      processes: [],
      requirements: 'Build a feature',
      workflowFrontendSessionId: 'workflow-agora-session-1',
      supervisorAgent: 'default-supervisor',
      supervisorSessionId: null,
      attachedAgentSessions: {},
      stateHistory: [],
      issueTracker: [],
      transitionCount: 0,
      globalContext: '',
      phaseContexts: {},
      workingDirectory: '/tmp/project',
      qualityChecks: [],
    } as any);
    vi.mocked(parse).mockReturnValue(makeConfig());

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeEngine = vi.fn().mockResolvedValue(undefined);
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);
    (manager as any).executeStateMachine = vi.fn().mockResolvedValue(undefined);

    const statusEvents: any[] = [];
    manager.on('status', (event) => statusEvents.push(event));

    await (manager as any).resume('run-resume-001');

    expect((manager as any)._frontendSessionId).toBe('workflow-agora-session-1');
    expect(statusEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'running',
        runId: 'run-resume-001',
        workflowFrontendSessionId: 'workflow-agora-session-1',
      }),
    ]));
  });

  test('resumes a failed state-machine run from the failed step instead of the first step', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'first-step', agent: 'developer', task: 'Already completed', role: 'executor' },
              { name: 'retry-step', agent: 'developer', task: 'Retry this step', role: 'executor' },
              { name: 'final-step', agent: 'developer', task: 'Continue after retry', role: 'judge' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
            ],
          },
          {
            name: '完成',
            isFinal: true,
            steps: [],
            transitions: [],
          },
        ],
      },
    });
    vi.mocked(parse).mockReturnValue(config);
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-resume-failed-step',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'failed',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: null,
      currentState: '设计',
      currentPhase: '设计',
      currentStep: null,
      completedSteps: ['设计-first-step'],
      failedSteps: [],
      stepLogs: [
        {
          id: 'step-1',
          stepName: '设计-first-step',
          agent: 'developer',
          status: 'completed',
          output: 'first-step completed',
          error: '',
          costUsd: 0,
          durationMs: 1,
          timestamp: '2024-01-01T00:00:01.000Z',
        },
        {
          id: 'step-2',
          stepName: '设计-retry-step',
          agent: 'developer',
          status: 'failed',
          output: '',
          error: 'previous failure',
          costUsd: 0,
          durationMs: 1,
          timestamp: '2024-01-01T00:00:02.000Z',
        },
      ],
      agents: [{ name: 'developer', sessionId: null }],
      iterationStates: {},
      processes: [],
      requirements: 'Build a feature',
      workflowFrontendSessionId: 'workflow-agora-session-2',
      supervisorAgent: 'default-supervisor',
      supervisorSessionId: null,
      attachedAgentSessions: {},
      stateHistory: [],
      issueTracker: [],
      transitionCount: 0,
      globalContext: '',
      phaseContexts: {},
      workingDirectory: '/tmp/project',
      qualityChecks: [],
    } as any);

    const engine = new MockEngine();
    engine.executeImpl = async (options) => ({
      success: true,
      output: options.step === 'final-step'
        ? '```json\n{"verdict":"pass"}\n```\nfinal complete'
        : `${options.step} complete`,
      sessionId: `session-${options.step}`,
    });
    const manager = await createManagerForTest(engine);
    (manager as any).status = 'idle';
    (manager as any).engineType = 'claude-code';
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeEngine = vi.fn().mockResolvedValue(undefined);
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);

    await (manager as any).resume('run-resume-failed-step');

    expect(engine.calls.map((call) => call.options.step)).toEqual(['retry-step', 'final-step']);
    expect((manager as any).failedSteps).not.toContain('设计-retry-step');
    expect((manager as any).completedSteps).toEqual(expect.arrayContaining([
      '设计-retry-step',
      '设计-final-step',
    ]));
  });

  test('force jumps a completed run to a target state and resumes execution', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeConfig();
    vi.mocked(parse).mockReturnValue(config);
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-completed-force-jump',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'completed',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:10:00.000Z',
      currentState: '完成',
      currentPhase: '完成',
      currentStep: null,
      completedSteps: ['设计-design-step', '实施-impl-step'],
      failedSteps: [],
      stepLogs: [],
      agents: [{ name: 'developer', sessionId: 'agent-session-existing' }],
      iterationStates: {},
      processes: [],
      requirements: 'Build a feature',
      workflowFrontendSessionId: 'workflow-agora-session-completed',
      supervisorAgent: 'default-supervisor',
      supervisorSessionId: null,
      attachedAgentSessions: {},
      stateHistory: [
        { from: '设计', to: '实施', reason: 'pass', issues: [], timestamp: '2024-01-01T00:01:00.000Z' },
        { from: '实施', to: '完成', reason: 'pass', issues: [], timestamp: '2024-01-01T00:05:00.000Z' },
      ],
      issueTracker: [],
      transitionCount: 2,
      globalContext: '',
      phaseContexts: {},
      workingDirectory: '/tmp/project',
      qualityChecks: [],
    } as any);

    const engine = new MockEngine();
    engine.executeImpl = async (options) => ({
      success: true,
      output: options.step === 'impl-step'
        ? '```json\n{"verdict":"pass"}\n```\nimplementation rerun complete'
        : `${options.step} complete`,
      sessionId: `session-${options.step}`,
    });
    const manager = await createManagerForTest(engine);
    (manager as any).status = 'idle';
    (manager as any).engineType = 'claude-code';
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeEngine = vi.fn().mockResolvedValue(undefined);
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);
    (manager as any).finalizeRun = vi.fn().mockResolvedValue(undefined);

    await (manager as any).forceJumpToState('run-completed-force-jump', '实施', '重新验证实现');

    expect(engine.calls.map((call) => call.options.step)).toEqual(['impl-step']);
    expect((manager as any).stateHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: '完成',
        to: '实施',
        reason: expect.stringContaining('重新验证实现'),
      }),
    ]));
    expect((manager as any).currentRunId).toBe('run-completed-force-jump');
    expect((manager as any).currentState).toBe('完成');
    expect((manager as any).runEndTime).toBeNull();
  });
});

// ============================================================
// State machine execution flow
// ============================================================
describe('state machine execution flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('step execution produces output from engine', async () => {
    const engine = new MockEngine({ success: true, output: 'Step completed with results' });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0]; // 设计 state

    const result = await (manager as any).executeState(state, config, 'Build a feature');
    expect(result.stepOutputs).toHaveLength(1);
    expect(result.stepOutputs[0]).toContain('Step completed');
  });

  test('step execution falls back to streamed output when engine result output is empty', async () => {
    const engine = new MockEngine({ success: true, output: '' });
    engine.executeImpl = async () => {
      engine.emitStream('```json\n{"verdict":"pass","summary":"streamed pass"}\n```');
      return { success: true, output: '' };
    };
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0];

    const result = await (manager as any).executeState(state, config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(result.stepOutputs[0]).toContain('streamed pass');
  });

  test('non-final defender and judge steps execute without requiring verdict JSON', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      if (options.step === 'defend-step') {
        return { success: true, output: 'Defense implementation completed without verdict JSON' };
      }
      if (options.step === 'intermediate-review') {
        return { success: true, output: '检查失败项已修复，继续下一步，不输出 verdict JSON' };
      }
      return { success: true, output: '```json\n{"verdict":"pass","summary":"final judge passed"}\n```' };
    };
    const manager = await createManagerForTest(engine);
    (manager as any).engineType = 'claude-code';

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '实施',
            isInitial: true,
            steps: [
              { name: 'defend-step', agent: 'developer', task: 'Implement defense', role: 'defender' },
              { name: 'intermediate-review', agent: 'developer', task: 'Review intermediate result', role: 'judge' },
              { name: 'final-verdict', agent: 'developer', task: 'Decide transition', role: 'judge' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
              { condition: { verdict: 'fail' }, to: '实施', priority: 2 },
            ],
          },
          { name: '完成', isFinal: true, steps: [], transitions: [] },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(engine.calls.map((call) => call.options.step)).toEqual([
      'defend-step',
      'intermediate-review',
      'final-verdict',
    ]);
    expect(result.stepOutputs).toHaveLength(3);
    expect(result.stepOutputs[0]).toContain('Defense implementation completed');
    expect(result.stepOutputs[1]).toContain('不输出 verdict JSON');
    expect(result.verdict).toBe('pass');
  });

  test('step context requires conclusions for every step but verdict JSON only for final decision step', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).buildStepContext = Object.getPrototypeOf(manager).buildStepContext.bind(manager);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '实施',
            isInitial: true,
            steps: [
              { name: 'defend-step', agent: 'developer', task: 'Implement defense', role: 'defender' },
              { name: 'intermediate-review', agent: 'developer', task: 'Review intermediate result', role: 'judge' },
              { name: 'final-verdict', agent: 'developer', task: 'Decide transition', role: 'judge' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
              { condition: { verdict: 'fail' }, to: '实施', priority: 2 },
            ],
          },
          { name: '完成', isFinal: true, steps: [], transitions: [] },
        ],
      },
    });
    const state = config.workflow.states[0];

    const defenderPrompt = await (manager as any).buildStepContext(state.steps[0], state, config, 'Build a feature');
    const intermediateJudgePrompt = await (manager as any).buildStepContext(state.steps[1], state, config, 'Build a feature');
    const finalJudgePrompt = await (manager as any).buildStepContext(state.steps[2], state, config, 'Build a feature');

    expect(defenderPrompt).toContain('# 步骤结论归档协议');
    expect(defenderPrompt).toContain('<step-conclusion>');
    expect(defenderPrompt).not.toContain('# 结构化输出要求');
    expect(intermediateJudgePrompt).toContain('# 步骤结论归档协议');
    expect(intermediateJudgePrompt).toContain('<step-conclusion>');
    expect(intermediateJudgePrompt).not.toContain('# 结构化输出要求');
    expect(finalJudgePrompt).toContain('# 步骤结论归档协议');
    expect(finalJudgePrompt).toContain('# 结构化输出要求');
    expect(finalJudgePrompt.indexOf('# 结构化输出要求')).toBeLessThan(finalJudgePrompt.indexOf('<step-conclusion>'));
  });

  test('final defender step is prompted to repair missing verdict JSON and archives conclusion', async () => {
    const persistence = await import('@/lib/run/state-persistence');
    const saveProcessOutputMock = vi.mocked(persistence.saveProcessOutput);
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      if (engine.calls.length === 1) {
        return {
          success: true,
          output: '<step-conclusion>\n## 结果 / 裁决\n- 实现完成，但本轮漏掉 verdict JSON。\n</step-conclusion>',
        };
      }
      expect(options.prompt).toContain('缺少最终裁决 JSON');
      return {
        success: true,
        output: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"final pass"}\n```\n<step-conclusion>\n## 结果 / 裁决\n- 当前状态最终裁定为 pass。\n</step-conclusion>',
      };
    };
    const manager = await createManagerForTest(engine);
    (manager as any).engineType = 'claude-code';

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '实施',
            isInitial: true,
            steps: [
              { name: 'final-defender', agent: 'developer', task: 'Implement and decide', role: 'defender' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
              { condition: { verdict: 'fail' }, to: '实施', priority: 2 },
            ],
          },
          { name: '完成', isFinal: true, steps: [], transitions: [] },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(engine.calls).toHaveLength(2);
    expect(result.verdict).toBe('pass');
    expect(saveProcessOutputMock).toHaveBeenCalledWith(
      'test-run-001',
      '实施-final-defender',
      expect.stringContaining('当前状态最终裁定为 pass')
    );
    expect(saveProcessOutputMock.mock.calls.at(-1)?.[2]).not.toContain('漏掉 verdict JSON');
  });

  test('serial steps ignore agentInstanceId so synthetic parallel agents are not started', async () => {
    const engine = new MockEngine({ success: true, output: 'Step completed by base role' });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', agentInstanceId: 'developer-1', task: 'Design', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.stepOutputs[0]).toContain('base role');
    expect(engine.calls[0].options.agent).toBe('developer');
    expect((manager as any).stepLogs[0].agent).toBe('developer');
  });

  test('agentInstanceId is used only for step-level parallel branches', async () => {
    const engine = new MockEngine({ success: true, output: 'Parallel branch completed' });
    const manager = await createManagerForTest(engine);
    (manager as any).agents.push(makeAgentState('developer-a'), makeAgentState('developer-b'));

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'branch-a', agent: 'developer', agentInstanceId: 'developer-a', parallelGroup: 'group-1', task: 'Design A', role: 'defender' },
              { name: 'branch-b', agent: 'developer', agentInstanceId: 'developer-b', parallelGroup: 'group-1', task: 'Design B', role: 'defender' },
            ],
            transitions: [],
          },
        ],
      },
    });

    await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(engine.calls.map((call) => call.options.agent).sort()).toEqual(['developer-a', 'developer-b']);
    expect((manager as any).stepLogs.map((log: any) => log.agent).sort()).toEqual(['developer-a', 'developer-b']);
  });

  test('initializeAgents does not create unused serial agentInstanceId aliases', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig({
      workflow: {
        concurrency: {
          enabled: false,
          agentInstances: [
            { id: 'developer-main', role: 'developer' },
            { id: 'architect-main', role: 'architect' },
          ],
        },
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', agentInstanceId: 'developer-main', task: 'Design', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });

    (manager as any).initializeAgents(config);

    expect((manager as any).agents.map((agent: any) => agent.name).sort()).toEqual([
      'default-supervisor',
      'developer',
    ]);
  });

  test('run spec coding is not marked completed before workflow reaches a final state', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentRunSpecCoding = {
      id: 'spec-1',
      workflowName: 'Test Workflow',
      version: 1,
      status: 'completed',
      summary: 'mapped phase completed',
      requirements: [],
      phases: [{ id: 'phase-1', title: '设计', status: 'completed', ownerAgents: [] }],
      assignments: [],
      checkpoints: [],
      tasks: [],
      artifacts: {},
      progress: {
        overallStatus: 'completed',
        completedPhaseIds: ['phase-1'],
        summary: '所有阶段已完成。',
      },
      revisions: [],
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
    };

    (manager as any).keepRunSpecCodingActiveUntilWorkflowFinal('状态 设计 已完成，下一状态为 实施。');

    expect((manager as any).currentRunSpecCoding.status).toBe('in-progress');
    expect((manager as any).currentRunSpecCoding.progress.overallStatus).toBe('in-progress');
    expect((manager as any).currentRunSpecCoding.progress.summary).toBe('状态 设计 已完成，下一状态为 实施。');
  });

  test('supervisor cannot substitute a normal workflow step runtime agent', async () => {
    const engine = new MockEngine({ success: true, output: 'Supervisor should not run this step' });
    const manager = await createManagerForTest(engine);
    (manager as any).agents.push(makeAgentState('default-supervisor'));

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', agentInstanceId: 'default-supervisor', parallelGroup: 'guard-group', task: 'Design', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('fail');
    expect(result.stepOutputs[0]).toContain('Supervisor');
    expect(engine.calls).toHaveLength(0);
    expect((manager as any).completedSteps).not.toContain('设计-design-step');
  });

  test('supervisor review text is rejected as a normal step output', async () => {
    const supervisorReview = [
      '当前阶段结论：建议继续留在方案设计。',
      '是否建议继续迭代：是。',
      '下一步指导意见：让 architect 产出 design.md。',
      '下一步只做一件事：把统一事实基线固化成设计约束，然后输出 2-3 个方案对比。',
      '重点锁定搜索入口、数据契约、结果规则、恢复逻辑这四项契约。',
      '风险点只保留两个：不要默认跨会话历史搜索，不要默认结果可跳到命中消息。',
    ].join('\n');
    const engine = new MockEngine({ success: true, output: supervisorReview });
    const manager = await createManagerForTest(engine);
    (manager as any).latestSupervisorReview = {
      type: 'state-review',
      stateName: '方案设计',
      content: supervisorReview,
      timestamp: new Date().toISOString(),
    };

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '方案设计',
            isInitial: true,
            steps: [
              { name: '搜索方案设计', agent: 'developer', task: 'Design search', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('fail');
    expect(result.stepOutputs[0]).toContain('Supervisor 审阅内容');
    expect((manager as any).completedSteps).not.toContain('方案设计-搜索方案设计');
    expect((manager as any).stepLogs[0].status).toBe('failed');
  });

  test('verdict=pass transitions to next state', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```\nAll checks pass',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0];
    const result = await (manager as any).executeState(state, config, 'Build a feature');

    expect(result.verdict).toBe('pass');

    const nextState = await (manager as any).evaluateTransitions(
      state.transitions,
      result,
      config
    );
    expect(nextState).toBe('实施');
  });

  test('verdict=fail transitions back to previous state', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "fail"}\n```\nFound critical issues',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[1]; // 实施 state
    const result = await (manager as any).executeState(state, config, 'Build a feature');

    expect(result.verdict).toBe('fail');

    const nextState = await (manager as any).evaluateTransitions(
      state.transitions,
      result,
      config
    );
    expect(nextState).toBe('设计');
  });

  test('verdict=conditional_pass causes self-transition', async () => {
    const engine = new MockEngine({
      success: true,
      output: 'Partial progress, needs more iterations',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0];
    const result = await (manager as any).executeState(state, config, 'Build a feature');

    expect(result.verdict).toBe('conditional_pass');

    const nextState = await (manager as any).evaluateTransitions(
      state.transitions,
      result,
      config
    );
    expect(nextState).toBe('设计'); // self-transition
  });

  test('maxTransitions limit throws error', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: { maxTransitions: 2 },
    });

    await expect(
      (manager as any).executeStateMachine(config, 'Build a feature')
    ).rejects.toThrow(/最大状态转移次数/);
  });

  test('engine exception causes step failure', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      throw new Error('Engine crashed');
    };
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0];

    const result = await (manager as any).executeState(state, config, 'Build a feature');
    expect(result.verdict).toBe('fail');
    expect(result.stepOutputs[0]).toContain('ERROR');
  });

  test('engine-level failure (ACP closed) throws fatal error', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      throw new Error('ACP connection closed unexpectedly');
    };
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0];

    await expect(
      (manager as any).executeState(state, config, 'Build a feature')
    ).rejects.toThrow(/引擎异常/);
  });

  test('self-transition circuit breaker triggers after maxSelfTransitions', async () => {
    let callCount = 0;
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      callCount++;
      return {
        success: true,
        output: '```json\n{"verdict": "conditional_pass"}\n```',
      };
    };
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    config.workflow.states[0].maxSelfTransitions = 2;
    config.workflow.states[0].transitions.push({
      condition: { verdict: 'conditional_pass' },
      to: '实施',
      priority: 3,
    });

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  test('final state executes steps and completes', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```\nAll done',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', task: 'Design', role: 'judge' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
            ],
          },
          {
            name: '完成',
            isFinal: true,
            steps: [
              { name: 'final-step', agent: 'developer', task: 'Final regression', role: 'normal' },
            ],
            transitions: [],
          },
        ],
      },
    });

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(engine.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Force transition
// ============================================================
describe('force transition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('forceTransition sets pendingForceTransition and emits event', async () => {
    const engine = new MockEngine({ success: true, output: 'working' });
    const manager = await createManagerForTest(engine);

    const events: any[] = [];
    manager.on('force-transition', (data: any) => events.push(data));

    (manager as any).forceTransition('实施', 'skip to implementation');

    expect((manager as any).pendingForceTransition).toBe('实施');
    expect((manager as any).pendingForceInstruction).toBe('skip to implementation');
    expect(events).toHaveLength(1);
    expect(events[0].targetState).toBe('实施');
    expect(events[0].instruction).toBe('skip to implementation');
  });

  test('forceTransition throws when not running', async () => {
    const engine = new MockEngine();
    const manager = await createManagerForTest(engine);
    (manager as any).status = 'idle';

    expect(() => (manager as any).forceTransition('实施')).toThrow('工作流未在运行中');
  });

  test('forced transition skips human approval check', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    // Pre-set a force transition before executeStateMachine runs
    const originalExecuteState = (manager as any).executeState.bind(manager);
    (manager as any).executeState = async function (...args: any[]) {
      const result = await originalExecuteState(...args);
      if (args[0].name === '设计') {
        (manager as any).pendingForceTransition = '完成';
      }
      return result;
    };

    config.workflow.states[0].transitions = [
      { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
    ];

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have reached 完成 via forced transition, skipping human approval
    expect((manager as any).currentState).toBe('完成');
  });

  test('evaluateTransitions consumes pendingForceTransition before condition matching', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    const state = config.workflow.states[0];
    const result = await (manager as any).executeState(state, config, 'Build a feature');

    // Set pending force transition before evaluating
    (manager as any).pendingForceTransition = '完成';

    const events: any[] = [];
    manager.on('transition-forced', (data: any) => events.push(data));

    const nextState = await (manager as any).evaluateTransitions(
      state.transitions,
      result,
      config
    );

    // Should use forced target, not the pass transition
    expect(nextState).toBe('完成');
    expect((manager as any).pendingForceTransition).toBeNull();
    expect(events).toHaveLength(1);
    expect(events[0].to).toBe('完成');
  });
});

// ============================================================
// Full multi-state flow
// ============================================================
describe('full multi-state flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('transitions through 设计 → 实施 → 完成 with pass verdicts', async () => {
    let callIndex = 0;
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      callIndex++;
      return {
        success: true,
        output: '```json\n{"verdict": "pass"}\n```\nAll pass',
      };
    };
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(callIndex).toBeGreaterThanOrEqual(2);
    expect((manager as any).currentState).toBe('完成');
  });

  test('transitions back to 设计 when 实施 fails, eventually hits maxTransitions', async () => {
    let callIndex = 0;
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      callIndex++;
      if (callIndex === 1) {
        return { success: true, output: '```json\n{"verdict": "pass"}\n```' };
      }
      return { success: true, output: '```json\n{"verdict": "fail"}\n```\nIssues found' };
    };
    const manager = await createManagerForTest(engine);

    // The loop alternates: 设计→实施(pass)→设计(fail)→实施(pass)→设计(fail)...
    // With maxTransitions=4, after 4 transitions it throws
    const config = makeConfig({ workflow: { maxTransitions: 4 } });

    await expect(
      (manager as any).executeStateMachine(config, 'Build a feature')
    ).rejects.toThrow(/最大状态转移次数/);

    const history = (manager as any).stateHistory;
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].from).toBe('设计');
    expect(history[0].to).toBe('实施');
    expect(history[1].from).toBe('实施');
    expect(history[1].to).toBe('设计');
  });
});

// ============================================================
// State history tracking
// ============================================================
describe('state history tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('records state transitions in history', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```\nPass',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    await (manager as any).executeStateMachine(config, 'Build a feature');

    const history = (manager as any).stateHistory;
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0]).toHaveProperty('from');
    expect(history[0]).toHaveProperty('to');
    expect(history[0]).toHaveProperty('timestamp');
  });

  test('increments transitionCount on each transition', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect((manager as any).transitionCount).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================
// Circuit breaker with supervisor review
// ============================================================
describe('circuit breaker with supervisor review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('emits circuit-breaker event when self-transition limit exceeded', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    // Use a simple 2-state config: 设计 → 完成 (final)
    // conditional_pass causes self-transition on 设计, circuit breaker escapes to 完成
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', task: 'Design', role: 'judge' },
            ],
            maxSelfTransitions: 2,
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
              // No conditional_pass rule → self-transition → circuit breaker
            ],
          },
          {
            name: '完成',
            isFinal: true,
            steps: [],
            transitions: [],
          },
        ],
      },
    });

    const circuitBreakerEvents: any[] = [];
    manager.on('circuit-breaker', (data: any) => circuitBreakerEvents.push(data));

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(circuitBreakerEvents.length).toBeGreaterThanOrEqual(1);
    expect(circuitBreakerEvents[0]).toHaveProperty('state', '设计');
    expect(circuitBreakerEvents[0]).toHaveProperty('selfTransitionCount');
    expect(circuitBreakerEvents[0]).toHaveProperty('maxSelfTransitions', 2);
    expect(circuitBreakerEvents[0].message).toContain('自我转换次数超过限制');
  });

  test('circuit breaker forces transition to alternative state', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    config.workflow.states[0].maxSelfTransitions = 1;
    config.workflow.states[0].transitions.push({
      condition: { verdict: 'conditional_pass' },
      to: '实施',
      priority: 3,
    });

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have broken out of 设计 and eventually reached 完成
    expect((manager as any).currentState).toBe('完成');
  });

  test('circuit breaker throws when no alternative transition exists', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    // Only self-transition available (fail goes back to 设计 which is self)
    config.workflow.states[0].maxSelfTransitions = 1;
    // Remove the pass→实施 transition, only keep fail→设计 (self)
    config.workflow.states[0].transitions = [
      { condition: { verdict: 'fail' }, to: '设计', priority: 1 },
    ];

    await expect(
      (manager as any).executeStateMachine(config, 'Build a feature')
    ).rejects.toThrow(/达到最大自我转换次数/);
  });

  test('supervisor review is collected after state execution', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    // Unstub collectSupervisorReview to track calls
    const supervisorCalls: any[] = [];
    (manager as any).collectSupervisorReview = vi.fn().mockImplementation(
      (type: string, state: any, result: any, config: any, nextState?: string) => {
        supervisorCalls.push({ type, stateName: state.name, nextState });
        return Promise.resolve(null);
      }
    );

    const config = makeConfig();
    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have called collectSupervisorReview for each state execution
    expect(supervisorCalls.length).toBeGreaterThanOrEqual(2);
    // First call should be state-review for 设计
    expect(supervisorCalls[0].type).toBe('state-review');
    expect(supervisorCalls[0].stateName).toBe('设计');
    expect(supervisorCalls[0].nextState).toBe('实施');
  });

  test('supervisor checkpoint-advice collected before human approval', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const supervisorCalls: any[] = [];
    (manager as any).collectSupervisorReview = vi.fn().mockImplementation(
      (type: string, state: any, result: any, config: any, nextState?: string) => {
        supervisorCalls.push({ type, stateName: state.name, nextState });
        if (type === 'checkpoint-advice') {
          return Promise.resolve('Supervisor recommends proceeding to next phase');
        }
        return Promise.resolve(null);
      }
    );

    // Stub waitForHumanApproval and createHumanQuestion to avoid actual waiting
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      // Simulate human choosing the suggested next state
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have collected checkpoint-advice for 设计 state
    const checkpointCalls = supervisorCalls.filter(c => c.type === 'checkpoint-advice');
    expect(checkpointCalls.length).toBeGreaterThanOrEqual(1);
    expect(checkpointCalls[0].stateName).toBe('设计');
  });
});

// ============================================================
// Human approval flow
// ============================================================
describe('human approval flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('requireHumanApproval transitions to __human_approval__ virtual state', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    // Track transitions
    const transitions: any[] = [];
    manager.on('transition', (data: any) => transitions.push(data));

    // Stub waitForHumanApproval to immediately resolve with force
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have transitioned: 设计 → __human_approval__ → 实施 → 完成
    const approvalTransition = transitions.find(t => t.to === '__human_approval__');
    expect(approvalTransition).toBeTruthy();
    expect(approvalTransition.from).toBe('设计');

    // And then from __human_approval__ to the human-selected state
    const humanDecision = transitions.find(t => t.from === '__human_approval__');
    expect(humanDecision).toBeTruthy();
    expect(humanDecision.to).toBe('实施');
  });

  test('human-approval-required event is emitted with correct data', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const approvalEvents: any[] = [];
    manager.on('human-approval-required', (data: any) => approvalEvents.push(data));

    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0].currentState).toBe('__human_approval__');
    expect(approvalEvents[0].suggestedNextState).toBe('实施');
    expect(approvalEvents[0].availableStates).toEqual(['设计', '实施', '完成']);
  });

  test('pendingApprovalInfo is populated during human approval', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    let approvalInfoSnapshot: any = null;
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      // Capture the approval info while waiting
      approvalInfoSnapshot = (manager as any).pendingApprovalInfo;
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(approvalInfoSnapshot).toBeTruthy();
    expect(approvalInfoSnapshot.suggestedNextState).toBe('实施');
    expect(approvalInfoSnapshot.availableStates).toEqual(['设计', '实施', '完成']);
    // After approval, pendingApprovalInfo should be cleared
    expect((manager as any).pendingApprovalInfo).toBeNull();
  });

  test('human approval with instruction records reason in history', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
      (manager as any).pendingForceInstruction = 'Focus on performance';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    const history = (manager as any).stateHistory;
    // Find the transition from __human_approval__
    const humanDecision = history.find((h: any) => h.from === '__human_approval__');
    expect(humanDecision).toBeTruthy();
    expect(humanDecision.to).toBe('实施');
    expect(humanDecision.reason).toContain('人工决策');
    expect(humanDecision.reason).toContain('Focus on performance');
  });

  test('human can select a different state than suggested', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      // Human overrides to 完成 instead of suggested 实施
      (manager as any).pendingForceTransition = '完成';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should skip 实施 and go directly to 完成 (final state)
    expect((manager as any).currentState).toBe('完成');
  });

  test('human approval skipped for self-transition but triggered for real transition', async () => {
    const engine = new MockEngine();
    let callCount = 0;
    engine.executeImpl = async () => {
      callCount++;
      // First call: conditional_pass (self-transition), second: pass (real transition)
      if (callCount <= 1) {
        return { success: true, output: '```json\n{"verdict": "conditional_pass"}\n```' };
      }
      return { success: true, output: '```json\n{"verdict": "pass"}\n```' };
    };
    const manager = await createManagerForTest(engine);

    const createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });
    (manager as any).createHumanQuestion = createHumanQuestion;

    // Stub waitForHumanApproval to resolve immediately (simulates human approving)
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
    });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // createHumanQuestion should be called ONCE (for the pass transition 设计→实施)
    // NOT called for the conditional_pass self-transition
    expect(createHumanQuestion).toHaveBeenCalledTimes(1);
    expect((manager as any).currentState).toBe('完成');
  });

  test('human approval skipped when transition was forced', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });
    (manager as any).createHumanQuestion = createHumanQuestion;

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    // Pre-set force transition to simulate user forcing before evaluation
    const originalExecuteState = (manager as any).executeState.bind(manager);
    (manager as any).executeState = async function (...args: any[]) {
      const result = await originalExecuteState(...args);
      if (args[0].name === '设计') {
        (manager as any).pendingForceTransition = '完成';
      }
      return result;
    };

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // createHumanQuestion should NOT have been called because wasForced=true
    expect(createHumanQuestion).not.toHaveBeenCalled();
    expect((manager as any).currentState).toBe('完成');
  });

  test('state-change event emitted for __human_approval__', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const stateChanges: any[] = [];
    manager.on('state-change', (data: any) => stateChanges.push(data));

    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have state-change for __human_approval__
    const approvalStateChange = stateChanges.find(s => s.state === '__human_approval__');
    expect(approvalStateChange).toBeTruthy();
    expect(approvalStateChange.message).toContain('等待人工审查');
  });

  test('persistState is called during human approval for crash recovery', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const persistCalls = (manager as any).persistState as ReturnType<typeof vi.fn>;
    persistCalls.mockClear();

    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    config.workflow.states[0].requireHumanApproval = true;

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // persistState should have been called at least once during the approval flow
    expect(persistCalls).toHaveBeenCalled();
  });
});

// ============================================================
// Escalation and unmatched verdict
// ============================================================
describe('escalation on unmatched verdict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('conditional_pass without matching rule triggers self-transition escalation', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const escalationEvents: any[] = [];
    manager.on('escalation', (data: any) => escalationEvents.push(data));

    const config = makeConfig();
    // Remove fail transition, keep only pass — conditional_pass has no matching rule
    config.workflow.states[0].transitions = [
      { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
    ];
    // Set low maxSelfTransitions to avoid long test
    config.workflow.states[0].maxSelfTransitions = 1;
    // Add conditional_pass escape route so it doesn't throw
    config.workflow.states[0].transitions.push({
      condition: { verdict: 'conditional_pass' },
      to: '实施',
      priority: 2,
    });

    await (manager as any).executeStateMachine(config, 'Build a feature');

    // Should have emitted escalation for conditional_pass self-transition
    expect(escalationEvents.length).toBeGreaterThanOrEqual(1);
    expect(escalationEvents[0].reason).toContain('conditional_pass');
    expect(escalationEvents[0].reason).toContain('继续迭代');
  });

  test('no matching transition for non-conditional verdict triggers human fallback', async () => {
    // This tests the evaluateTransitions fallback path directly
    const engine = new MockEngine({ success: true, output: 'test' });
    const manager = await createManagerForTest(engine);

    const escalationEvents: any[] = [];
    manager.on('escalation', (data: any) => escalationEvents.push(data));

    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
    });
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'q-1' });

    const config = makeConfig();
    const state = config.workflow.states[0];

    // Create a result with verdict='fail' but no fail transition defined
    const result = {
      stateName: '设计',
      verdict: 'fail' as const,
      stepOutputs: ['test output'],
      issues: [],
    };

    // Only pass transition, no fail
    const transitions = [
      { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
    ];

    const nextState = await (manager as any).evaluateTransitions(
      transitions,
      result,
      config
    );

    // Should have triggered escalation and human fallback
    expect(escalationEvents.length).toBeGreaterThanOrEqual(1);
    expect(escalationEvents[0].reason).toContain('没有匹配的状态转移规则');
    expect(nextState).toBe('实施'); // human selected via forceTransition mock
  });
});
