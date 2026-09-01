import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { MockEngine } from './helpers/mock-engine';
import { resolve } from 'path';

const registryMocks = vi.hoisted(() => ({
  getManagerForRun: vi.fn(),
  getManagerByRunId: vi.fn(),
  getRunningManagers: vi.fn().mockReturnValue([]),
}));

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
  appendStreamToolEvent: vi.fn().mockResolvedValue(undefined),
  appendFeedbackToStream: vi.fn().mockResolvedValue(undefined),
  loadRunState: vi.fn().mockResolvedValue(null),
  loadStepOutputs: vi.fn().mockResolvedValue({}),
  findActiveRuns: vi.fn().mockResolvedValue([]),
  isProcessAlive: vi.fn().mockReturnValue(false),
}));

vi.mock('@/lib/workflow/registry', () => ({
  workflowRegistry: {
    getManagerForRun: registryMocks.getManagerForRun,
    getManagerByRunId: registryMocks.getManagerByRunId,
    getRunningManagers: registryMocks.getRunningManagers,
  },
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
    upsertToolEvent: vi.fn(),
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

vi.mock('@/lib/chat/persistence', () => ({
  listChatSessions: vi.fn().mockResolvedValue([]),
  updateChatSessionCreationBinding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/workflow/runtime-session', () => ({
  bindWorkflowRunToConversation: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/workflow/lightweight-runtime', () => ({
  resolveLightweightTasklistDirectory: vi.fn(({ runId, workspaceRoot }) => ({
    tasklistDirectory: 'tasklist',
    workspaceRoot: resolve(workspaceRoot),
    resolvedTasklistDirectory: resolve('/tmp/runs', runId, 'tasklist'),
  })),
}));

vi.mock('@/lib/workflow/runtime-transcript', () => ({
  appendWorkflowRuntimeTranscript: vi.fn().mockResolvedValue(null),
  toWorkflowRuntimeTranscriptLiveEvent: vi.fn((event) => ({
    runId: event.runId,
    seq: event.seq,
    timestamp: event.timestamp,
    transcript: event.payload,
  })),
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

vi.mock('@/lib/workflow/runtime-facade', () => ({
  createWorkflowRuntime: vi.fn(),
  getConfiguredWorkflowRuntime: vi.fn().mockResolvedValue('mock-engine'),
  getWorkflowRuntimeSkillsSubdir: vi.fn().mockReturnValue('skills'),
  getLogicalEngineId: vi.fn((engine) => engine === 'mock-engine' ? 'claude-code' : engine),
  resolveRequestedWorkflowRuntimeType: vi.fn((engine) => engine || 'mock-engine'),
  compactWorkflowRuntimeContextManually: vi.fn().mockResolvedValue(null),
  executeWorkflowRuntimeWithContextRecovery: vi.fn((engine, options) => engine.execute(options)),
  resolveRecoveredWorkflowRuntimeSessionId: vi.fn((result, fallback) => result.sessionId || fallback || null),
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

vi.mock('@/lib/engines/workflow-engine-selection', () => ({
  resolveAgentEngineSelection: vi.fn().mockReturnValue({ engine: 'mock-engine', model: 'test-model' }),
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

function makeAdversarialConfig() {
  return makeConfig({
    workflow: {
      states: [
        {
          name: '高风险实现',
          isInitial: true,
          reviewPolicy: { mode: 'adversarial', source: 'user', locked: false },
          steps: [
            {
              id: 'defender-a-id',
              name: 'defender-a',
              agent: 'developer',
              agentInstanceId: 'developer-defender-a',
              parallelGroup: 'defender-group',
              concurrency: { groupId: 'defender-group', branchId: 'defender-a', joinPolicy: { mode: 'all' } },
              task: 'Produce defender evidence A',
              role: 'defender',
            },
            {
              id: 'defender-b-id',
              name: 'defender-b',
              agent: 'developer',
              agentInstanceId: 'developer-defender-b',
              parallelGroup: 'defender-group',
              concurrency: { groupId: 'defender-group', branchId: 'defender-b', joinPolicy: { mode: 'all' } },
              task: 'Produce defender evidence B',
              role: 'defender',
            },
            {
              id: 'attacker-id',
              name: 'attacker',
              agent: 'developer',
              agentInstanceId: 'developer-attacker',
              task: 'Challenge defender evidence',
              role: 'attacker',
            },
            {
              id: 'judge-id',
              name: 'judge',
              agent: 'developer',
              agentInstanceId: 'developer-judge',
              task: 'Judge all evidence',
              role: 'judge',
            },
          ],
          transitions: [
            { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
            { condition: { verdict: 'fail' }, to: '高风险实现', priority: 2 },
          ],
        },
        { name: '完成', isFinal: true, steps: [], transitions: [] },
      ],
    },
  });
}

function makeLightweightConfig() {
  return {
    workflow: {
      name: 'Lightweight Workflow',
      mode: 'state-machine',
      profile: 'lightweight',
      lightweight: {},
      states: [{
        name: 'Execute',
        isInitial: true,
        isFinal: true,
        steps: [{
          name: 'Run tasklist',
          agent: 'developer',
          task: 'Execute the tasklist',
          skills: ['aceharness-tasklist'],
        }],
        transitions: [],
      }],
    },
    context: {
      projectRoot: '/tmp/project',
      prewarmAgents: false,
    },
    roles: [{
      name: 'developer',
      team: 'blue',
      engineModels: {},
      activeEngine: '',
      capabilities: ['development'],
      systemPrompt: 'You are a developer',
    }],
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
  const enginesModule = await import('@/lib/workflow/runtime-facade');
  vi.mocked(enginesModule.createWorkflowRuntime).mockResolvedValue(engine as any);
  const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
  const manager = new StateMachineWorkflowManager();

  // Set up minimum internal state
  (manager as any).currentRuntime = engine;
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

describe('state-machine recovery startup', () => {
  test('rejects startup and persists a visible failed state when resume initialization fails', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const manager = await createManagerForTest(new MockEngine());
    const persistState = (manager as any).persistState;
    const logEvents: any[] = [];
    const statusEvents: any[] = [];
    manager.on('log', (event) => logEvents.push(event));
    manager.on('status', (event) => statusEvents.push(event));

    (manager as any).status = 'idle';
    (manager as any).currentRunId = null;
    (manager as any).restoreRunStateForContinuation = vi.fn().mockImplementation(async (runState: any) => {
      (manager as any).currentRunId = runState.runId;
      (manager as any).currentConfigFile = runState.configFile;
      (manager as any).status = 'running';
      (manager as any).shouldStop = false;
      (manager as any).runStartTime = '2024-01-01T00:00:00.000Z';
    });
    (manager as any).readWorkflowConfigContent = vi.fn().mockRejectedValue(new Error('模型 API 不可用'));
    vi.mocked(loadRunState).mockResolvedValue({
      runId: 'run-recovery-startup',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'stopped',
      startTime: '2024-01-01T00:00:00.000Z',
    } as any);

    await expect(manager.resumeInBackground('run-recovery-startup')).rejects.toThrow('模型 API 不可用');

    expect(persistState).toHaveBeenCalledWith('failed');
    expect(logEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        runId: 'run-recovery-startup',
        level: 'error',
        message: expect.stringContaining('模型 API 不可用'),
      }),
    ]));
    expect(statusEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'failed',
        statusReason: '模型 API 不可用',
        runId: 'run-recovery-startup',
      }),
    ]));
  });
});

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

  test('recovers a json-fenced verdict truncated only by its outer closing brace', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    const output = [
      '```json',
      '{',
      '  "verdict": "conditional_pass",',
      '  "remaining_issues": 2,',
      '  "summary": "核心逻辑正确，但仍需补充边界测试。"',
      '```',
      '<step-conclusion>需要回到实现状态修复。</step-conclusion>',
    ].join('\n');

    expect((manager as any).hasRequiredVerdictJson(output)).toBe(true);
    expect(parseVerdict(output)).toBe('conditional_pass');
  });

  test('does not recover an ambiguous truncated verdict with an unterminated string', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    const output = '```json\n{"verdict":"pass","summary":"unfinished\n```';

    expect((manager as any).hasRequiredVerdictJson(output)).toBe(false);
    expect(() => parseVerdict(output)).toThrow('缺少严格最终裁决 JSON');
  });

  test('rejects keyword-only pass without strict verdict JSON', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(() => parseVerdict('All checks pass')).toThrow('缺少严格最终裁决 JSON');
  });

  test('rejects keyword-only fail without strict verdict JSON', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(() => parseVerdict('This is a fail result')).toThrow('缺少严格最终裁决 JSON');
  });

  test('rejects Chinese keyword-only verdicts without strict verdict JSON', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(() => parseVerdict('检查失败')).toThrow('缺少严格最终裁决 JSON');
    expect(() => parseVerdict('检查通过')).toThrow('缺少严格最终裁决 JSON');
  });

  test('rejects unstructured output instead of defaulting to conditional_pass', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(() => parseVerdict('Some partial results, needs more work')).toThrow('缺少严格最终裁决 JSON');
  });

  test('returns fail for empty output', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(parseVerdict('')).toBe('fail');
    expect(parseVerdict('   ')).toBe('fail');
  });

  test('does not parse verdict from step conclusion when JSON is missing', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const parseVerdict = (manager as any).parseVerdict.bind(manager);
    expect(() => parseVerdict('<step-conclusion>\n## 结果 / 裁决\n- 当前状态最终裁定为 fail。\n</step-conclusion>')).toThrow('缺少严格最终裁决 JSON');
  });
});

describe('subworkflow step dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('uses child final output verdict for parent verdict when subworkflow is the deciding step', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-2024-01-01-000000-test-uui',
      configFile: 'child.yaml',
      status: 'completed',
      currentPhase: '子状态',
      stepLogs: [{ output: '{"verdict":"conditional_pass","summary":"child asks parent to continue carefully"}', error: '' }],
    } as any);

    const childStart = vi.fn().mockResolvedValue(undefined);
    registryMocks.getManagerForRun.mockResolvedValue({
      start: childStart,
      getStatus: vi.fn().mockReturnValue({ runId: 'run-2024-01-01-000000-test-uui', status: 'idle' }),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    });

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).currentProjectRoot = '/tmp/project';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');

    const state = {
      name: '父状态',
      steps: [],
      transitions: [],
    } as any;
    const step = {
      name: 'run-child',
      type: 'subworkflow',
      workflow: 'child.yaml',
    } as any;
    state.steps = [step];
    const config = makeConfig({
      context: { requirements: 'parent requirement', projectRoot: '/tmp/project' },
      workflow: { states: [state] },
    });

    const output = await (manager as any).executeWorkflowStepDispatch(step, state, config, 'parent requirement');

    expect(output).toContain('"verdict":"conditional_pass"');
    expect(childStart).toHaveBeenCalledWith(
      'child.yaml',
      'parent requirement',
      [],
      expect.objectContaining({ globalContext: expect.stringContaining('Parent workflow context') }),
      'run-2024-01-01-000000-test-uui',
    );
    expect((manager as any).subworkflowRuns[0]).toMatchObject({
      configFile: 'child.yaml',
      status: 'completed',
      verdict: 'conditional_pass',
      runId: 'run-2024-01-01-000000-test-uui',
    });
    expect((manager as any).stepLogs[0]).toMatchObject({
      stepType: 'subworkflow',
      childConfigFile: 'child.yaml',
      childStatus: 'completed',
      childVerdict: 'conditional_pass',
      status: 'completed',
    });
    expect((manager as any).subworkflowAuditEvents.map((event: any) => event.action)).toEqual(
      expect.arrayContaining(['start', 'result-mapping'])
    );
    expect((manager as any).subworkflowAuditEvents.find((event: any) => event.action === 'result-mapping')).toMatchObject({
      childRunId: 'run-2024-01-01-000000-test-uui',
      childConfigFile: 'child.yaml',
      resultMapping: {
        childStatus: 'completed',
        parentVerdict: 'conditional_pass',
      },
    });
  });

  test('does not allow oldArchitecture result mapping to hide a failed child workflow', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-2024-01-01-000000-test-uui',
      configFile: 'child.yaml',
      status: 'failed',
      statusReason: 'child failed',
      currentPhase: '子状态',
      stepLogs: [{ output: '{"verdict":"conditional_pass","summary":"oldArchitecture should not pass"}', error: '' }],
    } as any);

    registryMocks.getManagerForRun.mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ runId: 'run-2024-01-01-000000-test-uui', status: 'idle' }),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    });

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).currentProjectRoot = '/tmp/project';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = {
      name: 'run-child',
      type: 'subworkflow',
      workflow: 'child.yaml',
      result: { failed: 'conditional_pass' },
    } as any;
    state.steps = [step];

    await expect((manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'parent requirement'))
      .rejects.toThrow(/oldArchitecture should not pass|child failed|子工作流失败/);
    expect((manager as any).subworkflowRuns[0]).toMatchObject({
      status: 'failed',
      verdict: 'fail',
    });
    expect((manager as any).stepLogs[0]).toMatchObject({
      stepType: 'subworkflow',
      childStatus: 'failed',
      status: 'failed',
    });
  });

  test('times out child workflow, stops child, and emits subworkflow-stopped', async () => {
    vi.useFakeTimers();
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValue(null);

    const childStop = vi.fn().mockResolvedValue(undefined);
    const childManager: any = {
      start: vi.fn(() => new Promise<void>(() => {})),
      stop: childStop,
      getStatus: vi.fn().mockReturnValue({ runId: 'run-2024-01-01-000000-test-uui', status: 'running' }),
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    registryMocks.getManagerForRun.mockResolvedValue(childManager);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).currentProjectRoot = '/tmp/project';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');

    const stoppedEvents: any[] = [];
    manager.on('subworkflow-stopped', (payload) => stoppedEvents.push(payload));

    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = {
      name: 'run-child-timeout',
      type: 'subworkflow',
      workflow: 'child.yaml',
      runtime: { timeoutMinutes: 1 },
    } as any;
    state.steps = [step];

    const promise = (manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'parent requirement')
      .then(
        () => null,
        (error: any) => error
      );
    await vi.advanceTimersByTimeAsync(60_000);

    await expect(promise).resolves.toMatchObject({
      message: expect.stringMatching(/子工作流超时|子工作流失败/),
    });
    expect(childStop).toHaveBeenCalledTimes(1);
    expect((manager as any).subworkflowRuns[0]).toMatchObject({
      status: 'stopped',
      verdict: 'fail',
    });
    expect(stoppedEvents).toHaveLength(1);
    expect(stoppedEvents[0]).toMatchObject({
      runId: 'run-2024-01-01-000000-test-uui',
      childConfigFile: 'child.yaml',
      status: 'stopped',
    });
  });

  test('timeout ask-human strategy can release parent step as conditional pass', async () => {
    vi.useFakeTimers();
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValue(null);
    registryMocks.getManagerForRun.mockResolvedValue({
      start: vi.fn(() => new Promise<void>(() => {})),
      stop: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ status: 'running' }),
      on: vi.fn(),
      off: vi.fn(),
    });

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');
    (manager as any).createHumanQuestion = vi.fn().mockImplementation(async (input: any) => {
      const question = {
        id: 'timeout-q',
        runId: 'test-run-001',
        configFile: 'parent.yaml',
        status: 'answered',
        kind: input.kind,
        title: input.title,
        message: input.message,
        createdAt: new Date().toISOString(),
        answerSchema: input.answerSchema,
        answer: { selectedOption: 'continue' },
        answeredAt: new Date().toISOString(),
        source: input.source,
      };
      (manager as any).humanQuestions = [question];
      return question;
    });

    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = {
      name: 'run-child-timeout-human',
      type: 'subworkflow',
      workflow: 'child.yaml',
      runtime: { timeoutMinutes: 1, timeoutStrategy: 'ask-human' },
    } as any;
    state.steps = [step];
    const promise = (manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'req');
    await vi.advanceTimersByTimeAsync(60_000);
    const output = await promise;

    expect(output).toContain('"verdict":"conditional_pass"');
    expect((manager as any).createHumanQuestion).toHaveBeenCalledWith(expect.objectContaining({
      title: expect.stringContaining('子工作流超时'),
      source: expect.objectContaining({ type: 'subworkflow-timeout' }),
    }));
  });

  test('detached stop propagation persists detached child status without stopping child', async () => {
    const childStop = vi.fn().mockResolvedValue(undefined);
    registryMocks.getManagerByRunId.mockResolvedValue({ stop: childStop });

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentState = '父状态';
    (manager as any).currentWorkflowConfig = makeConfig({
      workflow: {
        states: [{
          name: '父状态',
          steps: [{
            name: 'run-child-detached',
            type: 'subworkflow',
            workflow: 'child.yaml',
            runtime: { stopPropagation: 'detach' },
          }],
          transitions: [],
        }],
      },
    });
    (manager as any).activeSubworkflowRunId = 'run-child-detached';
    (manager as any).subworkflowRuns = [{
      parentStepId: 'step-1',
      parentStepName: 'run-child-detached',
      parentStateName: '父状态',
      configFile: 'child.yaml',
      runId: 'run-child-detached',
      attempt: 1,
      status: 'running',
      startedAt: '2024-01-01T00:00:00.000Z',
    }];

    await manager.stop();

    expect(childStop).not.toHaveBeenCalled();
    expect((manager as any).activeSubworkflowRunId).toBeNull();
    expect((manager as any).subworkflowRuns[0]).toMatchObject({
      status: 'detached',
      summary: expect.stringContaining('脱离父流程继续运行'),
    });
  });

  test('force-complete child target forwards to active child manager', async () => {
    const childForceComplete = vi.fn().mockResolvedValue({
      step: 'child-state',
      output: 'child output',
      target: 'parent-step',
    });
    registryMocks.getManagerByRunId.mockResolvedValue({
      forceCompleteStep: childForceComplete,
    });

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentState = '父状态';
    (manager as any).activeSubworkflowRunId = 'run-child-force';

    const result = await manager.forceCompleteStep({ target: 'child-current-step' });

    expect(registryMocks.getManagerByRunId).toHaveBeenCalledWith('run-child-force');
    expect(childForceComplete).toHaveBeenCalledWith({ target: 'parent-step' });
    expect(result).toMatchObject({
      step: 'child-state',
      output: 'child output',
      target: 'child-current-step',
    });
    expect((manager as any).subworkflowAuditEvents[0]).toMatchObject({
      action: 'force-complete-child',
      childRunId: 'run-child-force',
    });
  });

  test('rejects subworkflow execution beyond runtime maxDepth', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'root-run';
    (manager as any).nestingPath = [
      { runId: 'root-run', configFile: 'parent.yaml' },
      { runId: 'child-run', configFile: 'child.yaml' },
    ];
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = {
      name: 'too-deep',
      type: 'subworkflow',
      workflow: 'grandchild.yaml',
      runtime: { maxDepth: 1 },
    } as any;
    state.steps = [step];

    await expect((manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'req'))
      .rejects.toThrow(/最大深度 1/);
  });

  test('enforces active child run limit before starting another subworkflow', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'root-run';
    (manager as any).nestingPath = [{ runId: 'root-run', configFile: 'parent.yaml' }];
    (manager as any).subworkflowRuns = Array.from({ length: 8 }, (_, index) => ({
      parentStepId: `step-${index}`,
      parentStepName: `child-${index}`,
      parentStateName: '父状态',
      configFile: `child-${index}.yaml`,
      runId: `run-child-${index}`,
      attempt: 1,
      status: 'running',
    }));
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = {
      name: 'too-many-active',
      type: 'subworkflow',
      workflow: 'child.yaml',
    } as any;
    state.steps = [step];

    await expect((manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'req'))
      .rejects.toThrow(/active child runs 超过上限 8/);
  });

  test('enforces root child run limit before starting another subworkflow', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'root-run';
    (manager as any).nestingPath = [{ runId: 'root-run', configFile: 'parent.yaml' }];
    (manager as any).subworkflowRuns = Array.from({ length: 64 }, (_, index) => ({
      parentStepId: `step-${index}`,
      parentStepName: `child-${index}`,
      parentStateName: '父状态',
      configFile: `child-${index}.yaml`,
      runId: `run-child-${index}`,
      attempt: 1,
      status: 'completed',
    }));
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = { name: 'too-many-root-children', type: 'subworkflow', workflow: 'child.yaml' } as any;

    await expect((manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'req'))
      .rejects.toThrow(/root child runs 超过上限 64/);
  });

  test('enforces child event count limit', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).subworkflowRuns = [{
      parentStepId: 'step-1',
      parentStepName: 'run-child',
      parentStateName: '父状态',
      configFile: 'child.yaml',
      runId: 'run-child-event-limit',
      attempt: 1,
      status: 'running',
      eventCount: 500,
    }];

    expect(() => (manager as any).bumpSubworkflowEventCount('run-child-event-limit', 'status', {
      childRunId: 'run-child-event-limit',
      childConfigFile: 'child.yaml',
      stateName: '父状态',
      stepName: 'run-child',
    })).toThrow(/事件数量超过上限 500/);
  });

  test('enforces parallel subworkflow branch limit', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const segment = {
      type: 'parallel',
      groupId: 'too-many-child-branches',
      steps: Array.from({ length: 9 }, (_, index) => ({
        name: `child-${index}`,
        type: 'subworkflow',
        workflow: `child-${index}.yaml`,
        parallelGroup: 'too-many-child-branches',
      })),
    } as any;

    await expect((manager as any).executeParallelBranches(segment, { name: '父状态' }, makeConfig(), 'req', { mode: 'all' }))
      .rejects.toThrow(/并发子工作流分支超过上限 8/);
  });

  test('truncates oversized child output summary before storing parent step log', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-2024-01-01-000000-test-uui',
      configFile: 'child.yaml',
      status: 'completed',
      currentPhase: '子状态',
      stepLogs: [{ output: `${'x'.repeat(20 * 1024)}\n{"verdict":"pass","summary":"child completed"}`, error: '' }],
    } as any);

    registryMocks.getManagerForRun.mockResolvedValue({
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      on: vi.fn(),
      off: vi.fn(),
    });

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = { name: 'run-child', type: 'subworkflow', workflow: 'child.yaml' } as any;

    await (manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'req');

    expect((manager as any).subworkflowRuns[0].summary).toContain('摘要已截断');
    expect(Buffer.byteLength((manager as any).subworkflowRuns[0].summary, 'utf-8')).toBeLessThan(17 * 1024);
    expect((manager as any).stepLogs[0].output).not.toContain('x'.repeat(1024));
  });

  test('collects structured child Spec delta summaries for parent final review', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).subworkflowRuns = [{
      parentStepId: 'step-child',
      parentStepName: 'Run Child',
      parentStateName: 'Parent',
      configFile: 'child.yaml',
      runId: 'run-child-spec',
      attempt: 1,
      status: 'completed',
      startedAt: new Date().toISOString(),
    }];
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-child-spec',
      configFile: 'child.yaml',
      status: 'completed',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      currentPhase: null,
      currentStep: null,
      completedSteps: [],
      failedSteps: [],
      stepLogs: [],
      agents: [],
      iterationStates: {},
      processes: [],
      workflowName: 'Child Workflow',
      runSpecCoding: {
        id: 'spec-child',
        version: 3,
        status: 'completed',
        title: 'Child Spec',
        workflowName: 'Child Workflow',
        summary: 'Child feature',
        goals: [],
        nonGoals: [],
        constraints: [],
        requirements: [],
        phases: [],
        assignments: [],
        checkpoints: [],
        tasks: [
          { id: 't1', title: 'Done task', status: 'completed', requirements: [], children: [] },
          { id: 't2', title: 'Parent task', status: 'in-progress', requirements: [], children: [
            { id: 't2-1', title: 'Nested done', status: 'completed', requirements: [], children: [] },
          ] },
        ],
        progress: {
          overallStatus: 'completed',
          completedPhaseIds: [],
          completedTaskIds: ['t1', 't2-1'],
          summary: 'Child spec delta ready',
        },
        revisions: [{ id: 'rev-3', version: 3, summary: 'Updated child design', createdAt: '2026-01-01T00:00:00.000Z' }],
        artifacts: { requirements: 'req', design: 'design', tasks: '' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      specRevisionVoteHistory: [{
        id: 'vote-1',
        trigger: 'state-complete',
        title: 'Vote',
        question: 'Keep?',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        ballots: [],
        tally: { revise: 0, keep: 1, defer: 0 },
        recommendedChoice: 'keep',
        supervisorDecision: { apply: false, summary: 'No parent merge needed', madeAt: '2026-01-01T00:00:00.000Z' },
      }],
      deltaMergeState: { status: 'available', requestedAt: '2026-01-01T00:00:00.000Z', aiSummary: 'Merge child delta' },
    } as any);

    const summaries = await (manager as any).collectChildSpecDeltaSummaries();

    expect(summaries).toEqual([expect.objectContaining({
      runId: 'run-child-spec',
      configFile: 'child.yaml',
      workflowName: 'Child Workflow',
      specStatus: 'completed',
      specVersion: 3,
      completedTaskCount: 2,
      totalTaskCount: 3,
      artifactKeys: ['requirements', 'design'],
      latestRevision: expect.objectContaining({ summary: 'Updated child design' }),
      latestVote: expect.objectContaining({ recommendedChoice: 'keep', summary: 'No parent merge needed' }),
      deltaMerge: expect.objectContaining({ status: 'available', aiSummary: 'Merge child delta' }),
    })]);
  });

  test('records operation actor for force-transition audit', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentState = '父状态';
    (manager as any).currentWorkflowConfig = makeConfig();
    (manager as any).forceTransition('实施', 'manual override', { id: 'user-2', name: 'Reviewer' });

    expect((manager as any).subworkflowAuditEvents[0]).toMatchObject({
      action: 'force-transition',
      actorId: 'user-2',
      actorName: 'Reviewer',
      stateName: '父状态',
      details: {
        fromState: '父状态',
        targetState: '实施',
        instruction: 'manual override',
      },
    });
  });

  test('marks restored run crashed when workflow snapshot is damaged', async () => {
    vi.resetModules();
    vi.doMock('@/lib/workflow/subworkflow-config', () => ({
      createWorkflowConfigSnapshot: vi.fn(),
      getSubworkflowConfigFile: vi.fn((step: any) => step?.workflow || step?.subworkflow?.configFile || ''),
      isSubworkflowStep: vi.fn((step: any) => step?.type === 'subworkflow'),
      normalizeWorkflowConfigRef: vi.fn((input: string) => input),
      readWorkflowConfigSnapshot: vi.fn().mockRejectedValue(new Error('manifest 校验失败')),
    }));
    const { saveRunState } = await import('@/lib/run/state-persistence');
    const manager = await createManagerForTest(new MockEngine());
    const runState = {
      runId: 'run-bad-snapshot',
      configFile: 'parent.yaml',
      rootRunId: 'run-bad-snapshot',
      workflowSnapshotRoot: 'parent.yaml',
      workflowSnapshotManifestHash: 'old-hash',
      mode: 'state-machine',
      status: 'stopped',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:01:00.000Z',
      currentPhase: '父状态',
      currentState: '父状态',
      completedSteps: [],
      failedSteps: [],
      stepLogs: [],
      agents: [],
      iterationStates: {},
      processes: [],
    } as any;

    await expect((manager as any).restoreRunStateForContinuation(runState))
      .rejects.toThrow(/配置快照损坏.*crashed/);
    expect(saveRunState).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-bad-snapshot',
      status: 'crashed',
      statusReason: expect.stringContaining('manifest 校验失败'),
    }));
    vi.doUnmock('@/lib/workflow/subworkflow-config');
  });

  test('retires a stale transition approval when a continuation restores another state', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const runState = {
      runId: 'run-stale-approval',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'running',
      startTime: '2024-01-01T00:00:00.000Z',
      currentState: '__human_approval__',
      currentPhase: '__human_approval__',
      completedSteps: [],
      failedSteps: [],
      stepLogs: [],
      agents: [],
      iterationStates: {},
      processes: [],
      humanQuestions: [{
        id: 'hq-old-approval',
        runId: 'run-stale-approval',
        configFile: 'test.yaml',
        status: 'unanswered',
        kind: 'approval',
        title: '等待人工审查',
        message: '请选择下一状态',
        createdAt: '2024-01-01T00:00:00.000Z',
        requiresWorkflowPause: true,
        answerSchema: { type: 'approval-transition', required: true },
      }],
      pendingHumanQuestionId: 'hq-old-approval',
    } as any;

    await (manager as any).restoreRunStateForContinuation(runState, '修复与验证');

    expect((manager as any).currentState).toBe('修复与验证');
    expect((manager as any).pendingHumanQuestionId).toBeNull();
    expect((manager as any).getPendingHumanQuestion()).toBeNull();
    expect((manager as any).humanQuestions).toEqual([
      expect.objectContaining({ id: 'hq-old-approval', status: 'dismissed' }),
    ]);
  });

  test('fails closed when a planned run cannot read its child snapshot', async () => {
    vi.resetModules();
    const createSnapshot = vi.fn();
    vi.doMock('@/lib/workflow/subworkflow-config', () => ({
      createWorkflowConfigSnapshot: createSnapshot,
      getSubworkflowConfigFile: vi.fn((step: any) => step?.workflow || step?.subworkflow?.configFile || ''),
      isSubworkflowStep: vi.fn((step: any) => step?.type === 'subworkflow'),
      normalizeWorkflowConfigRef: vi.fn((input: string) => input),
      readWorkflowConfigSnapshot: vi.fn().mockRejectedValue(new Error('planned manifest missing')),
    }));
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).currentRunId = 'run-planned';
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).runReviewPlan = { id: 'start-plan-1' };

    await expect((manager as any).ensureSubworkflowSnapshot('run-planned', 'child.yaml'))
      .rejects.toThrow(/禁止从当前 YAML 重新生成.*planned manifest missing/);
    expect(createSnapshot).not.toHaveBeenCalled();
    vi.doUnmock('@/lib/workflow/subworkflow-config');
  });

  test('passes workspace and context overrides to child manager', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-2024-01-01-000000-test-uui',
      configFile: 'child.yaml',
      status: 'completed',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:00:01.000Z',
      agents: [{ costUsd: 1.5 }],
      issueTracker: [{ type: 'test', severity: 'minor', description: 'child issue' }],
      stepLogs: [{ output: 'child ok\n{"verdict":"pass","summary":"child ok"}', error: '' }],
    } as any);

    const childManager: any = {
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ runId: 'run-2024-01-01-000000-test-uui', status: 'idle' }),
      on: vi.fn(),
      off: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    registryMocks.getManagerForRun.mockResolvedValue(childManager);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).currentProjectRoot = '/tmp/project';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');

    const config = makeConfig({
      context: {
        requirements: 'parent requirement',
        projectRoot: '/tmp/project',
        engine: 'parent-engine',
        mcpServers: ['parent-mcp'],
      },
    });
    (manager as any).currentWorkflowConfig = config;
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = {
      name: 'run-child',
      type: 'subworkflow',
      workflow: 'child.yaml',
      inputs: {
        workspace: 'child-isolated-copy',
        engine: 'inherit',
        mcpServers: 'parent-only',
      },
    } as any;
    state.steps = [step];

    await (manager as any).executeWorkflowStepDispatch(step, state, config, 'parent requirement');

    expect(childManager._embeddedProjectRoot).toBe('/tmp/project');
    expect(childManager._embeddedWorkspaceMode).toBe('isolated-copy');
    expect(childManager._embeddedContextOverrides).toMatchObject({
      engine: 'parent-engine',
      defaultEngine: 'parent-engine',
      mcpServers: ['parent-mcp'],
    });
    expect((manager as any).stepLogs[0]).toMatchObject({
      costUsd: 1.5,
      durationMs: 1000,
    });
    expect((manager as any).stepLogs[0].output).toContain('"issueCount":1');
    expect((manager as any).stepLogs[0].output).not.toContain('child issue');
  });

  test('passes parent workflow skills to child manager according to skills strategy', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-2024-01-01-000000-test-uui',
      configFile: 'child.yaml',
      status: 'completed',
      stepLogs: [{ output: 'child ok\n{"verdict":"pass","summary":"child ok"}', error: '' }],
    } as any);
    const childManager: any = {
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      on: vi.fn(),
      off: vi.fn(),
    };
    registryMocks.getManagerForRun.mockResolvedValue(childManager);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');
    const config = makeConfig({ context: { projectRoot: '/tmp/project', skills: ['parent-skill'] } });
    (manager as any).currentWorkflowConfig = config;
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = { name: 'run-child', type: 'subworkflow', workflow: 'child.yaml', inputs: { skills: 'parent-only' } } as any;
    state.steps = [step];

    await (manager as any).executeWorkflowStepDispatch(step, state, config, 'req');

    expect(childManager._embeddedContextOverrides).toMatchObject({ skills: ['parent-skill'] });
  });

  test('does not bubble child human questions when strategy is child-only', async () => {
    const childManager: any = {
      start: vi.fn().mockImplementation(async () => {
        childManager.handlers['human-question-required']?.({ question: { id: 'q1' }, message: 'child question' });
      }),
      getStatus: vi.fn().mockReturnValue({ status: 'idle' }),
      handlers: {} as Record<string, Function>,
      on: vi.fn((event: string, handler: Function) => { childManager.handlers[event] = handler; }),
      off: vi.fn(),
    };
    registryMocks.getManagerForRun.mockResolvedValue(childManager);
    const { loadRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-2024-01-01-000000-test-uui',
      configFile: 'child.yaml',
      status: 'completed',
      stepLogs: [{ output: 'child ok\n{"verdict":"pass","summary":"child ok"}', error: '' }],
    } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).rootRunId = 'test-run-001';
    (manager as any).nestingPath = [{ runId: 'test-run-001', configFile: 'parent.yaml' }];
    (manager as any).currentConfigFile = 'parent.yaml';
    (manager as any).ensureSubworkflowSnapshot = vi.fn().mockResolvedValue({ snapshotFile: 'configs/child.yaml' });
    (manager as any).recordStepGitBefore = vi.fn().mockResolvedValue('before-1');
    (manager as any).recordStepGitAfter = vi.fn().mockResolvedValue('after-1');
    const bubbled: any[] = [];
    const statuses: any[] = [];
    manager.on('subworkflow-waiting-human', (event) => bubbled.push(event));
    manager.on('subworkflow-status', (event) => statuses.push(event));
    const state = { name: '父状态', steps: [], transitions: [] } as any;
    const step = { name: 'run-child', type: 'subworkflow', workflow: 'child.yaml', runtime: { humanQuestions: 'child-only' } } as any;
    state.steps = [step];

    await (manager as any).executeWorkflowStepDispatch(step, state, makeConfig(), 'req');

    expect(bubbled).toEqual([]);
    expect(statuses.some((event) => event.childOnly === true && event.message === 'child question')).toBe(true);
  });
});

describe('engine-level failure detection', () => {
  test('treats Claude context window limit as an engine-level failure', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure('ApiError: the model has reached its context window limit')).toBe(true);
  });

  test('treats localized model auth failure as an engine-level failure', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure('模型调用失败 (401): 无效的令牌 (request id: abc)')).toBe(true);
  });

  test('treats HTTP auth status with context as an engine-level failure', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure('HTTP 401 Unauthorized: invalid api key')).toBe(true);
    expect(isEngineLevelFailure('request failed with statusCode 403')).toBe(true);
  });

  test('classifies provider rate limits as transient engine failures with bounded backoff', async () => {
    const { getRateLimitRetryDelayMs, isEngineLevelFailure, isRateLimitFailure } = await import('@/lib/state-machine/workflow-manager');
    const message = 'Internal error: Error from provider (Console): Rate limit exceeded. Please try again later.';

    expect(isRateLimitFailure(message)).toBe(true);
    expect(isEngineLevelFailure(message)).toBe(true);
    expect(getRateLimitRetryDelayMs(message, 1)).toBe(30_000);
    expect(getRateLimitRetryDelayMs('HTTP 429: retry after 45 seconds', 1)).toBe(45_000);
    expect(getRateLimitRetryDelayMs('HTTP 429: retry after 900 seconds', 1)).toBe(120_000);
  });

  test('does not treat markdown line numbers as HTTP auth failures', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure([
      '<ace-process>{"toolName":"read","output":"<content>"}',
      '399: ### 4.4 性能与实现建议（仓颉）',
      '401: - 长文本（商户名/地址）使用省略或自动换行',
      '403: - 列表滚动时底部栏固定不随动',
      '</ace-process>',
    ].join('\n'))).toBe(false);
  });

  test('does not treat AI file-read ENOENT as an engine-level failure', async () => {
    const { isEngineLevelFailure } = await import('@/lib/state-machine/workflow-manager');
    expect(isEngineLevelFailure(
      "codex 引擎执行失败: ENOENT: no such file or directory, open 'C:\\Users\\Shawn\\Desktop\\jinja4cj\\opencode_glm5.1_ace\\src\\ast.cj'"
    )).toBe(false);
  });

  test('does not fail a completed verdict that cites a historical rate-limit recovery', async () => {
    const engine = new MockEngine({
      success: true,
      output: [
        '```json',
        '{"verdict":"pass","remaining_issues":0,"summary":"evidence complete"}',
        '```',
        '<step-conclusion>',
        '本轮因之前的 rate-limit 恢复重放，未重复执行工具；证据未变。',
        '</step-conclusion>',
      ].join('\n'),
    });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(result.stepOutputs.join('\n')).toContain('rate-limit 恢复');
  });

  test('stops the workflow when the runtime itself returns localized 401', async () => {
    const engine = new MockEngine({
      success: false,
      output: '',
      error: '模型调用失败 (401): 无效的令牌 (request id: abc)',
    });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();

    await expect((manager as any).executeStateMachine(config, 'Build a feature')).rejects.toThrow(/无效的令牌|401/);
    expect((manager as any).completedSteps).not.toContain('设计-实现功能');
  });

  test('supervisor review fails hard on localized 401 instead of creating a review', async () => {
    const engine = new MockEngine({
      success: true,
      output: '模型调用失败 (401): 无效的令牌 (request id: supervisor)',
    });
    const manager = await createManagerForTest(engine);
    (manager as any).collectSupervisorReview = vi.fn(
      Object.getPrototypeOf(manager).collectSupervisorReview.bind(manager)
    );
    (manager as any).agents.push(makeAgentState('default-supervisor'));
    (manager as any).agentConfigs.push({ name: 'default-supervisor', systemPrompt: 'You are supervisor' });
    const config = makeConfig();
    const state = config.workflow.states[0];
    const result = {
      stateName: state.name,
      verdict: 'pass',
      issues: [],
      stepOutputs: ['ok'],
      summary: 'ok',
    };

    await expect((manager as any).collectSupervisorReview('state-review', state, result, config, '完成'))
      .rejects.toThrow(/无效的令牌|401/);
    expect((manager as any).latestSupervisorReview).toBeNull();
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

  test('recovers a completed turn that ended after a rejected PowerShell tool without a final answer', async () => {
    const engine = new MockEngine();
    engine.executeImpl = vi.fn()
      .mockImplementationOnce(async () => {
        (engine as any).emit('stream', {
          type: 'tool',
          tool: {
            id: 'tool-powershell-1',
            toolName: 'powershell',
            title: '执行命令',
            status: 'failed',
            result: { error: 'The user rejected permission to use this specific tool call.' },
          },
        });
        return { success: true, output: '', sessionId: 'same-session' };
      })
      .mockResolvedValueOnce({
        success: true,
        output: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"recovered after using bash"}\n```\nRecovered with the available evidence.',
        sessionId: 'same-session',
      });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(engine.calls).toHaveLength(2);
    expect(engine.calls[1].options.sessionId).toBe('same-session');
    expect(engine.calls[1].options.prompt).toContain('工具调用「powershell」的权限请求被拒绝');
    expect(engine.calls[1].options.prompt).toContain('绝不能调用 powershell');
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

  test('does not auto-recover a runtime turn cancelled by manual workflow stop', async () => {
    const engine = new MockEngine();
    let resolveExecution: ((result: any) => void) | undefined;
    engine.executeImpl = vi.fn().mockImplementation(() => new Promise((resolve) => {
      resolveExecution = resolve;
    }));
    const manager = await createManagerForTest(engine);
    const config = makeConfig();
    const step = config.workflow.states[0].steps[0];
    (manager as any).currentState = config.workflow.states[0].name;

    const execution = (manager as any).runAgentStep(step, 'Build a feature', config, 'step-stop-test');
    await vi.waitFor(() => expect(engine.calls).toHaveLength(1));

    await manager.stop();
    resolveExecution?.({
      success: false,
      output: '',
      error: 'cancelled',
      stopReason: 'cancelled',
      sessionId: 'cancelled-session',
    });

    await expect(execution).rejects.toThrow('工作流已停止');
    expect(engine.calls).toHaveLength(1);
    expect(engine.calls.some((call) => call.options.prompt.includes('系统自动恢复'))).toBe(false);
  });

  test('retains observed token usage in failed step logs and agent run state', async () => {
    const { saveRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(saveRunState).mockClear();
    const engine = new MockEngine({
      success: false,
      output: '',
      error: 'invalid api key after provider reported tokens',
      sessionId: 'failed-terminal-session',
      metadata: {
        usage: {
          input_tokens: 101,
          output_tokens: 103,
          cache_creation_input_tokens: 107,
          cache_read_input_tokens: 109,
        },
        cost_usd: 0.456,
        duration_ms: 789,
      },
    });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();
    const state = config.workflow.states[0];
    const step = state.steps[0];
    (manager as any).currentState = state.name;
    (manager as any).persistState = Object.getPrototypeOf(manager).persistState.bind(manager);

    await expect((manager as any).executeStep(step, state, config, 'Build a feature'))
      .rejects.toThrow('invalid api key after provider reported tokens');

    expect((manager as any).stepLogs).toHaveLength(1);
    expect((manager as any).stepLogs[0]).toMatchObject({
      status: 'failed',
      costUsd: 0.456,
      durationMs: 789,
      tokenUsage: {
        inputTokens: 101,
        outputTokens: 103,
        cacheCreationInputTokens: 107,
        cacheReadInputTokens: 109,
      },
      sessionId: 'failed-terminal-session',
    });
    expect(manager.getStatus().agents[0]).toMatchObject({
      status: 'failed',
      costUsd: 0.456,
      sessionId: 'failed-terminal-session',
      tokenUsage: {
        inputTokens: 101,
        outputTokens: 103,
        cacheCreationInputTokens: 107,
        cacheReadInputTokens: 109,
      },
    });
    expect(vi.mocked(saveRunState).mock.calls.at(-1)?.[0]).toMatchObject({
      agents: [expect.objectContaining({
        costUsd: 0.456,
        sessionId: 'failed-terminal-session',
        tokenUsage: {
          inputTokens: 101,
          outputTokens: 103,
          cacheCreationInputTokens: 107,
          cacheReadInputTokens: 109,
        },
      })],
    });
  });
});

describe('human-help runtime output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('turns streamed complete human-help output into a pending question, waits, then resumes', async () => {
    const humanHelpBlock = '<human-help>{"title":"Need product decision","question":"Which release channel should this use?","reason":"The implementation path depends on the channel.","answerType":"single-choice","options":[{"label":"Beta","value":"beta"},{"label":"Stable","value":"stable"}]}</human-help>';
    const engine = new MockEngine();
    let callCount = 0;
    engine.executeImpl = async (options) => {
      callCount += 1;
      if (callCount === 1) {
        engine.emitStream(humanHelpBlock);
        return {
          success: true,
          output: humanHelpBlock,
          sessionId: 'session-human-help',
          metadata: { usage: { input_tokens: 1, output_tokens: 1 } },
        };
      }
      expect(options.prompt).toContain('人工客服回复');
      expect(options.prompt).toContain('stable');
      const output = '{"verdict":"pass","summary":"resumed after human answer"}';
      engine.emitStream(output);
      return {
        success: true,
        output,
        sessionId: 'session-human-help',
        metadata: { usage: { input_tokens: 1, output_tokens: 1 } },
      };
    };

    const manager = await createManagerForTest(engine);
    (manager as any).currentState = '设计';
    (manager as any).currentWorkflowConfig = makeConfig({
      workflow: {
        humanHelp: {
          enabled: true,
          supervisorReviewEnabled: false,
          blockUntilAnswered: true,
        },
      },
    });

    const requiredEvents: any[] = [];
    manager.on('human-question-required', async (payload) => {
      requiredEvents.push(payload);
      await manager.answerHumanQuestion(payload.question.id, { selectedOption: 'stable', text: 'Use the stable channel.' });
    });

    const state = (manager as any).currentWorkflowConfig.workflow.states[0];
    const step = state.steps[0];
    const output = await (manager as any).executeWorkflowStepDispatch(
      step,
      state,
      (manager as any).currentWorkflowConfig,
      'Build a feature',
    );

    expect(output).toContain('"verdict":"pass"');
    expect(callCount).toBe(2);
    expect(requiredEvents).toHaveLength(1);
    expect(requiredEvents[0].question).toMatchObject({
      status: 'unanswered',
      kind: 'choice',
      title: 'Need product decision',
      source: {
        type: 'human-help',
        stateName: '设计',
        stepName: 'design-step',
        agent: 'developer',
      },
      answerSchema: {
        type: 'single-choice',
        required: true,
      },
    });
    expect((manager as any).humanQuestions[0]).toMatchObject({
      status: 'answered',
      answer: expect.objectContaining({ selectedOption: 'stable' }),
    });
    expect((manager as any).pendingHumanQuestionId).toBeNull();
  });

  test('does not parse a human-help block closed with </human>', async () => {
    const malformedBlock = '<human-help>{"title":"Need product decision","question":"Which release channel should this use?"}</human>';
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig({ workflow: { humanHelp: { enabled: true } } });

    const requests = (manager as any).parseHumanHelpRequests(malformedBlock, config);

    expect(requests).toEqual([]);
  });

  test('ignores human-help tags embedded in ace-process tool blocks', async () => {
    const output = [
      '<ace-process>{"toolName":"powershell","title":"write","command":"Set-Content -Value \'<human-help>{\\"title\\":\\"wrong\\",\\"question\\":\\"wrong\\"}</human-help>\'","kind":"tool-call"}</ace-process>',
      '<human-help>{"title":"Need input","question":"What should stage 1 build?","answerType":"text"}</human-help>',
    ].join('\n\n');
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig({ workflow: { humanHelp: { enabled: true } } });

    const requests = (manager as any).parseHumanHelpRequests(output, config);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      title: 'Need input',
      question: 'What should stage 1 build?',
      answerType: 'text',
    });
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

  test('builds a tasklist-owned full-goal prompt for lightweight workflows', async () => {
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const manager = await createManagerForTest(new MockEngine());
    const config = makeLightweightConfig();
    (manager as any).lightweightRunMetadata = {
      profile: 'lightweight',
      tasklistDirectory: 'tasklist',
      workspaceRoot: '/tmp/project',
      resolvedTasklistDirectory: '/tmp/runs/run-prompt/tasklist',
      stateName: 'Execute',
      stepName: 'Run tasklist',
      effectiveStepSkills: ['aceharness-tasklist'],
    };

    const context = await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Implement the complete user goal and verify it.',
    );

    expect(context).toContain('# 完整目标');
    expect(context).toContain('Implement the complete user goal and verify it.');
    expect(context).toContain('请使用 aceharness-tasklist。');
    expect(context).toMatch(/aceharness-tasklist[\\\\/]SKILL\.md/);
    expect(context).toContain('约十条边界清晰、依赖明确、可独立验证的任务');
    expect(context).toContain('当前 Agent 完成任务清单中的全部实施、验证与记录');
    expect(context).toContain('持续推进全部任务');
    expect(context).toContain('/tmp/runs/run-prompt/tasklist');
    expect(context).not.toContain('# 最终裁决格式');
    expect(context).toContain('# 步骤结束协议');
    expect(context).toContain('<step-conclusion>');
  });

  test('lightweight step confirms completion and repairs its conclusion in the original session', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      expect(options.timeoutMs).toBe(5 * 60 * 60 * 1000);
      if (engine.calls.length === 1) {
        return {
          success: true,
          sessionId: 'lightweight-session-1',
          output: '任务清单已完成，正在整理步骤结论。',
        };
      }

      expect(options.sessionId).toBe('lightweight-session-1');
      expect(options.appendSystemPrompt).toBe(true);
      expect(options.prompt).toContain('确认步骤结束状态');
      expect(options.prompt).toContain('当前步骤已经结束时');
      return {
        success: true,
        sessionId: 'lightweight-session-1',
        output: '<step-conclusion>\n## 结果 / 裁决\n- 当前步骤结束，交付物和风险已归档。\n</step-conclusion>',
      };
    };
    const manager = await createManagerForTest(engine);
    const config = makeLightweightConfig();
    (manager as any).currentWorkflowConfig = config;
    (manager as any).currentState = 'Execute';

    const output = await (manager as any).executeStep(
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Complete the tasklist.',
    );

    expect(engine.calls).toHaveLength(2);
    expect(output).toContain('<step-conclusion>');
    expect((manager as any).completedSteps).toContain('Execute-Run tasklist');
    expect((manager as any).failedSteps).not.toContain('Execute-Run tasklist');
  });

  test('lightweight step remains failed when the completion check has no conclusion', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      sessionId: 'lightweight-session-2',
      output: '```json\n{"verdict":"fail","remaining_issues":1,"summary":"work remains"}\n```',
    });
    const manager = await createManagerForTest(engine);
    const config = makeLightweightConfig();
    (manager as any).currentWorkflowConfig = config;
    (manager as any).currentState = 'Execute';

    await expect((manager as any).executeStep(
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Complete the tasklist.',
    )).rejects.toThrow('确认结束状态后仍缺少 <step-conclusion>');

    expect(engine.calls).toHaveLength(2);
    expect((manager as any).completedSteps).not.toContain('Execute-Run tasklist');
    expect((manager as any).failedSteps).toContain('Execute-Run tasklist');
  });

  test('lightweight state completes from a step conclusion without a final verdict JSON', async () => {
    const engine = new MockEngine({
      success: true,
      output: '<step-conclusion>\n## 结果 / 裁决\n- 任务清单的实施和验证已完成。\n</step-conclusion>',
    });
    const manager = await createManagerForTest(engine);
    const config = makeLightweightConfig();
    (manager as any).currentWorkflowConfig = config;
    (manager as any).currentState = 'Execute';

    const result = await (manager as any).executeState(
      config.workflow.states[0],
      config,
      'Complete the tasklist.',
    );

    expect(result.verdict).toBe('pass');
    expect(engine.calls).toHaveLength(1);
  });

  test('retries a model-capacity response reported as a completed runtime turn before failing the step', async () => {
    vi.useFakeTimers();
    const capacityMessage = 'Selected model is at capacity. Please try a different model.';
    const engine = new MockEngine();
    engine.executeImpl = vi.fn()
      .mockResolvedValueOnce({ success: true, output: capacityMessage, sessionId: 'capacity-session' })
      .mockResolvedValueOnce({ success: true, output: capacityMessage, sessionId: 'capacity-session' })
      .mockResolvedValueOnce({ success: true, output: capacityMessage, sessionId: 'capacity-session' });
    const manager = await createManagerForTest(engine);
    const config = makeLightweightConfig();
    (manager as any).currentWorkflowConfig = config;
    (manager as any).currentState = 'Execute';

    try {
      const execution = (manager as any).executeStep(
        config.workflow.states[0].steps[0],
        config.workflow.states[0],
        config,
        'Complete the tasklist.',
      );
      const failure = execution.then(
        () => null,
        (error: unknown) => error,
      );
      await vi.advanceTimersByTimeAsync(3_000);

      const error = await failure;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toMatch(/model is at capacity/i);
      expect(engine.calls).toHaveLength(3);
      expect(engine.calls.some((call) => call.options.prompt.includes('确认步骤结束状态'))).toBe(false);
      expect((manager as any).completedSteps).not.toContain('Execute-Run tasklist');
      expect((manager as any).failedSteps).toContain('Execute-Run tasklist');
    } finally {
      vi.useRealTimers();
    }
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
    expect(context).not.toContain('当前状态 verdict 转移规则');
    expect(context).toContain('它们是路由标签，真实流向完全由当前状态 transitions 决定');
    expect(context).toContain('conditional_pass 可能自迭代，也可能前进');
    expect(context).toContain('状态: 设计');
    expect(context).toContain('状态: 实施');
    expect(context).toContain('步骤: impl-step [待执行]');
    expect(context).toContain('verdict 流向: pass -> 完成 / fail -> 设计');
    expect(context).toContain('当前状态 verdict 实际流向');
    expect(context).toContain('- pass: 进入 "完成"');
    expect(context).toContain('- fail: 进入 "设计"');
    expect(context).not.toContain('# 可选的下一状态');
  });

  test('tells non-Windows workflow agents not to use PowerShell or cmd', async () => {
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig();
    const context = await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Build a feature',
    );

    if (process.platform === 'win32') {
      expect(context).toContain('当前宿主是 Windows');
    } else {
      expect(context).toContain(`当前宿主是 ${process.platform === 'darwin' ? 'macOS' : 'Unix-like'}`);
      expect(context).toContain('只使用 POSIX shell（bash/sh）');
      expect(context).toContain('不要调用 powershell、pwsh、cmd');
    }
  });

  test('injects current state verdict transitions even when roadmap memo is reused', async () => {
    const engine = new MockEngine({ success: true, output: 'ok' });
    const manager = await createManagerForTest(engine);
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const config = makeConfig();

    await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[1].steps[0],
      config.workflow.states[1],
      config,
      'Build a feature',
    );
    const context = await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[1].steps[0],
      config.workflow.states[1],
      config,
      'Build a feature',
    );

    expect(context).not.toContain('当前状态 verdict 转移规则');
    expect(context).toContain('当前状态 verdict 实际流向');
    expect(context).toContain('- pass: 进入 "完成"');
    expect(context).toContain('- fail: 进入 "设计"');
    expect(context).toContain('它们是路由标签，真实流向完全由当前状态 transitions 决定');
    expect(context).not.toContain('# 可选的下一状态');
  });

  test('injects verdict transition rules only for the final step in a state', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '需求拆解',
            isInitial: true,
            steps: [
              { name: '收集输入', agent: 'developer', task: 'Collect input', role: 'analyst' },
              { name: '形成裁决', agent: 'developer', task: 'Decide whether the state can move on', role: 'judge' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
              { condition: { verdict: 'conditional_pass' }, to: '需求拆解', priority: 2 },
              { condition: { verdict: 'fail' }, to: '需求拆解', priority: 3 },
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

    const firstStepContext = await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Build a feature',
    );

    expect(firstStepContext).not.toContain('当前状态 verdict 实际流向');
    expect(firstStepContext).not.toContain('verdict 流向:');
    expect(firstStepContext).not.toContain('"verdict": "pass | conditional_pass | fail"');
    expect(firstStepContext).toContain('当前步骤不是状态 "需求拆解" 的最后一个步骤');
    expect(firstStepContext).toContain('不要输出 pass / conditional_pass / fail 流程裁决');

    const finalStepContext = await (StateMachineWorkflowManager.prototype as any).buildStepContext.call(
      manager,
      config.workflow.states[0].steps[1],
      config.workflow.states[0],
      config,
      'Build a feature',
    );

    expect(finalStepContext).not.toContain('当前状态 verdict 转移规则');
    expect(finalStepContext).toContain('当前状态 verdict 实际流向');
    expect(finalStepContext).toContain('- pass: 进入 "完成"');
    expect(finalStepContext).toContain('- conditional_pass: 进入 "需求拆解"');
    expect(finalStepContext).toContain('"verdict": "pass | conditional_pass | fail"');
    expect(finalStepContext).toContain('当前步骤是状态 "需求拆解" 的最后一个步骤');
  });

  test('requires a state contract receipt before a configured self-loop can run again', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const { StateMachineWorkflowManager } = await import('@/lib/state-machine/workflow-manager');
    const state: any = {
      name: '门禁观察',
      steps: [],
      transitions: [
        { condition: { verdict: 'pass' }, to: '完成', priority: 1 },
        { condition: { verdict: 'conditional_pass' }, to: '门禁观察', priority: 2 },
        { condition: { verdict: 'fail' }, to: '修复', priority: 3 },
      ],
      maxSelfTransitions: 1,
      transitionContract: {
        completionCriteria: ['required-gates-passed'],
        selfLoop: { maxAttempts: 1, progressCriteria: ['ci-state-changed'] },
      },
    };
    const result: any = {
      stateName: '门禁观察',
      verdict: 'conditional_pass',
      issues: [],
      stepOutputs: [],
      summary: '等待 CI',
    };

    expect((StateMachineWorkflowManager.prototype as any).getTransitionContractViolation.call(
      manager, state, result, '门禁观察',
    )).toContain('缺少 transition_contract');

    result.transitionContract = {
      completed: [],
      remaining: ['required-gates-passed'],
      evidence: [],
      progress: [{ criterion: 'ci-state-changed', value: 'pipeline:42:running' }],
    };
    expect((StateMachineWorkflowManager.prototype as any).getTransitionContractViolation.call(
      manager, state, result, '门禁观察',
    )).toBeNull();

    (manager as any).stateHistory = [{
      from: '门禁观察', to: '门禁观察', reason: '条件性通过', issues: [], timestamp: '2026-08-31T00:00:00.000Z',
      transitionContract: result.transitionContract,
    }];
    expect((StateMachineWorkflowManager.prototype as any).getTransitionContractViolation.call(
      manager, state, result, '门禁观察',
    )).toContain('完全相同');
  });
});

describe('state machine resume', () => {
  test('moves a failed terminal run into human approval without replaying completed work', async () => {
    const { loadRunState, saveRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    vi.mocked(parse).mockReturnValue(makeConfig());
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-terminal-failed',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'failed',
      statusReason: '门禁未启动，等待人工处理',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:10:00.000Z',
      currentState: '实施',
      currentPhase: '实施',
      currentStep: null,
      completedSteps: ['设计-design-step', '实施-impl-step'],
      failedSteps: [],
      stepLogs: [{ id: 'done', stepName: '实施-impl-step', status: 'completed', output: 'kept as evidence' }],
      agents: [],
      iterationStates: {},
      processes: [],
      requirements: 'Build a feature',
      stateHistory: [],
      issueTracker: [],
      transitionCount: 3,
      globalContext: '',
      phaseContexts: {},
      qualityChecks: [],
    } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    (manager as any).assertRestoredWorkflowSnapshot = vi.fn().mockResolvedValue(undefined);
    (manager as any).readWorkflowConfigContent = vi.fn().mockResolvedValue('workflow: {}');
    const resumeContinuation = vi.spyOn(manager as any, 'resumeContinuation').mockResolvedValue(undefined);

    await (manager as any).recoverFailedRunToHumanApproval(
      'run-terminal-failed',
      '先确认平台要求的精确门禁命令',
    );

    expect(saveRunState).toHaveBeenCalledWith(expect.objectContaining({
      status: 'running',
      currentState: '__human_approval__',
      completedSteps: ['设计-design-step', '实施-impl-step'],
      failedSteps: [],
      stepLogs: [{ id: 'done', stepName: '实施-impl-step', status: 'completed', output: 'kept as evidence' }],
      pendingCheckpoint: expect.objectContaining({
        checkpoint: 'failed-run-recovery',
        suggestedNextState: '实施',
        result: expect.objectContaining({
          decision: expect.objectContaining({
            action: 'advance',
            targetState: '实施',
          }),
        }),
      }),
      stateHistory: expect.arrayContaining([
        expect.objectContaining({ from: '实施', to: '__human_approval__' }),
      ]),
    }));
    expect(resumeContinuation).toHaveBeenCalledWith('run-terminal-failed', undefined);
  });

  test('restores a failed-run recovery with its persisted target instead of inferring a pass route', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeConfig();
    vi.mocked(parse).mockReturnValue(config);
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-recovery-approval',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'running',
      startTime: '2024-01-01T00:00:00.000Z',
      currentState: '__human_approval__',
      currentPhase: '__human_approval__',
      currentStep: null,
      completedSteps: ['设计-design-step'],
      failedSteps: [],
      stepLogs: [],
      agents: [],
      iterationStates: {},
      processes: [],
      requirements: 'Build a feature',
      stateHistory: [{ from: '实施', to: '__human_approval__', reason: '失败终态转人工处理，等待人工决定下一状态', issues: [], timestamp: '2024-01-01T00:00:00.000Z' }],
      issueTracker: [],
      transitionCount: 4,
      globalContext: '',
      phaseContexts: {},
      qualityChecks: [],
      pendingCheckpoint: {
        phase: '__human_approval__',
        checkpoint: 'failed-run-recovery',
        message: '运行 run-recovery-approval 已从失败终态转入人工处理。\n建议下一状态：实施。',
        isIterativePhase: false,
        suggestedNextState: '实施',
        availableStates: ['设计', '实施', '完成'],
        supervisorAdvice: '运行 run-recovery-approval 已从失败终态转入人工处理。\n建议下一状态：实施。',
        result: { verdict: 'conditional_pass', issues: [] },
      },
    } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    (manager as any).readWorkflowConfigContent = vi.fn().mockResolvedValue('workflow: {}');
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeEngine = vi.fn().mockResolvedValue(undefined);
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeMemoryV2 = vi.fn().mockResolvedValue(undefined);
    (manager as any).executeStateMachine = vi.fn().mockResolvedValue(undefined);
    const createHumanQuestion = vi.fn().mockResolvedValue({ id: 'recovery-question', status: 'unanswered' });
    (manager as any).createHumanQuestion = createHumanQuestion;
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '实施';
      (manager as any).shouldStop = true;
    });
    const approvals: any[] = [];
    manager.on('human-approval-required', (event) => approvals.push(event));

    await (manager as any).resume('run-recovery-approval');

    expect(createHumanQuestion).toHaveBeenCalledWith(expect.objectContaining({
      suggestedNextState: '实施',
      source: { type: 'failed-run-recovery', restored: true },
      result: expect.objectContaining({
        decision: expect.objectContaining({
          action: 'advance',
          targetState: '实施',
        }),
      }),
    }));
    expect(approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({ suggestedNextState: '实施', nextState: '实施' }),
    ]));
  });

  test('restores workflow frontend session id before emitting resume status', async () => {
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
      workflowFrontendSessionId: 'workflow-frontend-session-1',
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
    vi.mocked(parse).mockReturnValue(makeConfig({
      roles: [
        {
          name: 'developer',
          team: 'blue',
          engineModels: {},
          activeEngine: '',
          capabilities: ['development'],
          systemPrompt: 'You are a developer',
        },
      ],
    }));

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

    expect((manager as any)._frontendSessionId).toBe('workflow-frontend-session-1');
    expect(statusEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: 'running',
        runId: 'run-resume-001',
        workflowFrontendSessionId: 'workflow-frontend-session-1',
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
              { name: 'first-step', agent: 'developer', task: 'Already completed', role: 'defender' },
              { name: 'retry-step', agent: 'developer', task: 'Retry this step', role: 'defender' },
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
      roles: [
        {
          name: 'developer',
          team: 'blue',
          engineModels: {},
          activeEngine: '',
          capabilities: ['development'],
          systemPrompt: 'You are a developer',
        },
      ],
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
      failedSteps: ['设计-retry-step'],
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
      workflowFrontendSessionId: 'workflow-frontend-session-2',
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

  test('reruns from a persisted step key while retaining superseded attempts outside the current result', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', task: 'Keep this result', role: 'judge' },
              { name: 'review-step', agent: 'developer', task: 'Replay from here', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
      roles: [
        {
          name: 'developer',
          team: 'blue',
          engineModels: {},
          activeEngine: '',
          capabilities: ['development'],
          systemPrompt: 'You are a developer',
        },
      ],
    });
    vi.mocked(parse).mockReturnValue(config);
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-rerun-step-key',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'failed',
      currentState: '设计',
      completedSteps: ['设计-design-step'],
      failedSteps: ['设计-review-step'],
      activeSteps: [],
      currentStep: '设计-review-step',
      stepLogs: [
        { id: 'completed', stepName: '设计-design-step', status: 'completed', output: 'done' },
        { id: 'review-completed', stepName: '设计-review-step', status: 'completed', output: 'old review result' },
        { id: 'failed', stepName: '设计-review-step', status: 'failed', error: 'retry me' },
      ],
      agents: [],
      requirements: 'Build a feature',
      stateHistory: [],
      transitionCount: 0,
      issueTracker: [],
      phaseContexts: {},
      qualityChecks: [],
    } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    const restoreRunStateForContinuation = vi.fn().mockImplementation(async (state: any) => {
      (manager as any).currentRunId = state.runId;
      (manager as any).currentConfigFile = state.configFile;
      (manager as any).currentState = '设计';
      (manager as any).completedSteps = state.completedSteps;
      (manager as any).failedSteps = state.failedSteps;
      (manager as any).stepLogs = state.stepLogs;
      (manager as any).subworkflowRuns = [];
      (manager as any).runStartTime = null;
      (manager as any).runEndTime = null;
      (manager as any).shouldStop = false;
      (manager as any).status = 'running';
    });
    (manager as any).restoreRunStateForContinuation = restoreRunStateForContinuation;
    (manager as any).persistState = vi.fn().mockResolvedValue(undefined);
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureSupervisorAgentExists = vi.fn();
    (manager as any).initializeAgents = vi.fn();
    (manager as any).initializeMemoryV2 = vi.fn().mockResolvedValue(undefined);
    (manager as any).startWorkflowAgentPrewarm = vi.fn();
    (manager as any).executeStateMachine = vi.fn().mockResolvedValue(undefined);
    (manager as any).finalizeRun = vi.fn().mockResolvedValue(undefined);

    await (manager as any).rerunFromStep('run-rerun-step-key', '设计-review-step');

    expect(restoreRunStateForContinuation).toHaveBeenCalledWith(expect.objectContaining({
      completedSteps: ['设计-design-step'],
      failedSteps: [],
      stepLogs: expect.arrayContaining([
        expect.objectContaining({ id: 'completed', stepName: '设计-design-step', status: 'completed' }),
        expect.objectContaining({
          id: 'review-completed',
          stepName: '设计-review-step',
          status: 'completed',
          output: 'old review result',
          superseded: true,
          supersededAt: expect.any(String),
          supersededByStep: '设计-review-step',
        }),
        expect.objectContaining({
          id: 'failed',
          stepName: '设计-review-step',
          status: 'failed',
          error: 'retry me',
          superseded: true,
          supersededAt: expect.any(String),
          supersededByStep: '设计-review-step',
        }),
      ]),
    }), '设计');
    expect((manager as any).stepLogs).toHaveLength(3);
    expect((manager as any).getLatestStepLog('设计-review-step')).toBeNull();
    expect((manager as any).deriveFailedStepKeys((manager as any).stepLogs)).toEqual([]);
    expect((manager as any).getResumeStepKeyForRun({
      currentState: '设计',
      failedSteps: [],
      activeSteps: [],
      currentStep: null,
      stepLogs: (manager as any).stepLogs,
    }, config)).toBeNull();
    expect((manager as any).resumeStateName).toBe('设计');
    expect((manager as any).resumeStepKey).toBe('设计-review-step');
    expect((manager as any).executeStateMachine).toHaveBeenCalledWith(
      expect.objectContaining({ workflow: expect.objectContaining({ name: 'Test Workflow' }) }),
      'Build a feature',
    );
  });

  test('rerun reloads a disabled Git baseline gate and clears stale persisted Git state', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeConfig({
      context: { gitBaselineEnabled: false },
      roles: [{
        name: 'developer',
        team: 'blue',
        engineModels: {},
        activeEngine: '',
        capabilities: ['development'],
        systemPrompt: 'You are a developer',
      }],
      workflow: {
        states: [{
          name: '设计',
          isInitial: true,
          steps: [{ name: 'review-step', agent: 'developer', task: 'Retry review', role: 'judge' }],
          transitions: [],
        }],
      },
    });
    vi.mocked(parse).mockReturnValue(config);
    vi.mocked(loadRunState).mockResolvedValueOnce({
      runId: 'run-rerun-git-disabled',
      configFile: 'test.yaml',
      mode: 'state-machine',
      status: 'failed',
      currentState: '设计',
      currentStep: '设计-review-step',
      completedSteps: [],
      failedSteps: ['设计-review-step'],
      activeSteps: [],
      stepLogs: [{ id: 'failed', stepName: '设计-review-step', status: 'failed', error: 'retry me' }],
      agents: [],
      requirements: 'Build a feature',
      stateHistory: [],
      transitionCount: 0,
      issueTracker: [],
      phaseContexts: {},
      qualityChecks: [],
      workingDirectory: '/tmp/aceharness-runtime/run-rerun-git-disabled',
      workspaceGit: {
        enabled: true,
        runId: 'run-rerun-git-disabled',
        workspacePath: '/tmp/aceharness-runtime/run-rerun-git-disabled',
        repoRoot: '/tmp/aceharness-runtime/run-rerun-git-disabled',
        wasGitRepository: false,
        initializedRepository: true,
        snapshots: [{ id: 'stale-baseline' }],
        stepDiffs: [],
      },
    } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    (manager as any).restoreRunStateForContinuation = vi.fn().mockImplementation(async (state: any) => {
      (manager as any).currentRunId = state.runId;
      (manager as any).currentConfigFile = state.configFile;
      (manager as any).currentState = state.currentState;
      (manager as any).completedSteps = state.completedSteps;
      (manager as any).failedSteps = state.failedSteps;
      (manager as any).stepLogs = state.stepLogs;
      (manager as any).subworkflowRuns = [];
      (manager as any).workflowGit = state.workspaceGit;
      (manager as any).isolatedDir = state.workingDirectory;
      (manager as any).currentProjectRoot = state.workingDirectory;
      (manager as any).status = 'running';
      (manager as any).shouldStop = false;
    });
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureSupervisorAgentExists = vi.fn();
    (manager as any).initializeAgents = vi.fn();
    (manager as any).initializeMemoryV2 = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeEngine = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).startWorkflowAgentPrewarm = vi.fn();
    (manager as any).executeStateMachine = vi.fn().mockResolvedValue(undefined);

    await (manager as any).rerunFromStep('run-rerun-git-disabled', '设计-review-step');

    expect((manager as any).workflowGitBaselineEnabled).toBe(false);
    expect((manager as any).ensureWorkflowGitBaseline).not.toHaveBeenCalled();
    expect((manager as any).workflowGit).toMatchObject({
      enabled: false,
      runId: 'run-rerun-git-disabled',
      workspacePath: '/tmp/aceharness-runtime/run-rerun-git-disabled',
      snapshots: [],
      stepDiffs: [],
    });
  });

  test('force jumps a completed run to a target state and resumes execution', async () => {
    const { loadRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeConfig({
      roles: [
        {
          name: 'developer',
          team: 'blue',
          engineModels: {},
          activeEngine: '',
          capabilities: ['development'],
          systemPrompt: 'You are a developer',
        },
      ],
    });
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
      failedSteps: ['设计-design-step'],
      stepLogs: [],
      agents: [{ name: 'developer', sessionId: 'agent-session-existing' }],
      iterationStates: {},
      processes: [],
      requirements: 'Build a feature',
      workflowFrontendSessionId: 'workflow-frontend-session-completed',
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
    expect((manager as any).failedSteps).toEqual([]);
  });

});

describe('Git baseline workspace isolation', () => {
  test.each([
    { gitBaselineEnabled: false, excludeGitMetadata: true },
    { gitBaselineEnabled: true, excludeGitMetadata: false },
  ])('passes the Git metadata copy gate through the isolated-copy startup path when gitBaselineEnabled=$gitBaselineEnabled', async ({ gitBaselineEnabled, excludeGitMetadata }) => {
    const { parse } = await import('yaml');
    const { existsSync } = await import('fs');
    vi.mocked(parse).mockReturnValue(makeConfig({
      context: {
        projectRoot: '/tmp/source-workspace',
        workspaceMode: 'isolated-copy',
        gitBaselineEnabled,
      },
    }));
    vi.mocked(existsSync).mockReturnValue(true);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    (manager as any)._userPersonalDir = '/tmp/aceharness-runtime';
    (manager as any).readWorkflowConfigContent = vi.fn().mockResolvedValue('workflow: {}');
    (manager as any).assertRequiredVerdictTransitions = vi.fn();
    (manager as any).copyDirectoryWithProgress = vi.fn().mockImplementation(async () => {
      (manager as any).shouldStop = true;
    });

    await (manager as any).start('test.yaml', 'Build a feature', [], undefined, 'run-isolated-copy-git-gate');

    const copyCall = (manager as any).copyDirectoryWithProgress.mock.calls[0];
    expect(copyCall[0]).toBe('/tmp/project');
    expect(String(copyCall[1]).replace(/\\/g, '/')).toMatch(/\/tmp\/aceharness-runtime\/run-isolated-copy-git-gate$/);
    expect(copyCall[2]).toBe('run-isolated-copy-git-gate');
    expect(copyCall[3]).toEqual(expect.any(Function));
    expect(copyCall[4]).toEqual({ excludeGitMetadata });
  });

  test('skips .git metadata while copying an isolated workspace when Git baseline is disabled', async () => {
    const { readdir, stat, copyFile } = await import('fs/promises');
    vi.mocked(readdir).mockImplementation(async (path: any) => {
      const portablePath = String(path).replace(/\\/g, '/');
      if (portablePath === '/tmp/source-workspace') {
        return [
          { name: '.git', isDirectory: () => true },
          { name: 'src', isDirectory: () => true },
          { name: 'README.md', isDirectory: () => false },
        ] as any;
      }
      if (portablePath === '/tmp/source-workspace/src') {
        return [{ name: 'index.ts', isDirectory: () => false }] as any;
      }
      throw new Error(`Unexpected directory scan: ${portablePath}`);
    });
    vi.mocked(stat).mockResolvedValue({ size: 10 } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).shouldStop = false;
    await (manager as any).copyDirectoryWithProgress(
      '/tmp/source-workspace',
      '/tmp/aceharness-runtime/run-copy',
      'run-copy',
      vi.fn().mockResolvedValue(undefined),
      { excludeGitMetadata: true },
    );

    const copiedPaths = vi.mocked(copyFile).mock.calls.map(([src, dst]) => [
      String(src).replace(/\\/g, '/'),
      String(dst).replace(/\\/g, '/'),
    ]);
    expect(copiedPaths).toEqual(expect.arrayContaining([
      ['/tmp/source-workspace/README.md', '/tmp/aceharness-runtime/run-copy/README.md'],
      ['/tmp/source-workspace/src/index.ts', '/tmp/aceharness-runtime/run-copy/src/index.ts'],
    ]));
    expect(vi.mocked(readdir).mock.calls.map(([path]) => String(path).replace(/\\/g, '/')))
      .not.toContain('/tmp/source-workspace/.git');
    expect(copiedPaths.flat().some((path) => path.includes('/.git/'))).toBe(false);
  });

  test('retains .git metadata in the baseline-enabled isolated workspace copy', async () => {
    const { readdir, stat, copyFile } = await import('fs/promises');
    vi.mocked(readdir).mockImplementation(async (path: any) => {
      const portablePath = String(path).replace(/\\/g, '/');
      if (portablePath === '/tmp/source-workspace') {
        return [{ name: '.git', isDirectory: () => true }] as any;
      }
      if (portablePath === '/tmp/source-workspace/.git') {
        return [{ name: 'HEAD', isDirectory: () => false }] as any;
      }
      throw new Error(`Unexpected directory scan: ${portablePath}`);
    });
    vi.mocked(stat).mockResolvedValue({ size: 10 } as any);

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).shouldStop = false;
    await (manager as any).copyDirectoryWithProgress(
      '/tmp/source-workspace',
      '/tmp/aceharness-runtime/run-copy',
      'run-copy',
      vi.fn().mockResolvedValue(undefined),
    );

    expect(vi.mocked(copyFile).mock.calls.map(([src]) => String(src).replace(/\\/g, '/')))
      .toContain('/tmp/source-workspace/.git/HEAD');
  });
});

// ============================================================
// State machine execution flow
// ============================================================
describe('state machine execution flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('halts at a real step exception before evaluating downstream transitions', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig();
    const evaluateTransitions = vi.spyOn(manager as any, 'evaluateTransitions');
    (manager as any).executeWorkflowStepDispatch = vi.fn().mockRejectedValue(new Error('agent step execution failed'));

    await expect((manager as any).executeStateMachine(config, 'Build a feature'))
      .rejects.toThrow(/必须先从失败断点恢复并重试/);

    expect(evaluateTransitions).not.toHaveBeenCalled();
    expect((manager as any).currentState).toBe('设计');
    expect((manager as any).failedSteps).toContain('设计-design-step');
    expect((manager as any).stateHistory).toEqual([]);
  });

  test('registers agent queries under the active workflow run', async () => {
    const engine = new MockEngine({ success: true, output: 'query answer' });
    const manager = await createManagerForTest(engine);
    const { processManager } = await import('@/lib/core/process-manager');

    await expect((manager as any).queryAgent('developer', 'What changed?', makeConfig()))
      .resolves.toBe('query answer');

    expect(processManager.registerExternalProcess).toHaveBeenCalledWith(
      expect.stringMatching(/^query-developer-/),
      'developer',
      'query',
      'test-run-001',
      undefined,
    );
  });

  test.each(['opencode', 'acpx'])('does not capture Git snapshots for %s when the run-level baseline gate is disabled', async (engineType) => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).engineType = engineType;
    (manager as any).workflowGitBaselineEnabled = false;
    (manager as any).workflowGit = {
      enabled: true,
      runId: 'stale-run',
      workspacePath: '/runtime/aceharness/stale-run',
      repoRoot: '/runtime/aceharness/stale-run',
      wasGitRepository: false,
      initializedRepository: true,
      snapshots: [],
      stepDiffs: [],
    };

    await expect((manager as any).recordStepGitBefore({
      stepLogId: 'step-1',
      stepName: 'build',
      agent: 'developer',
    })).resolves.toBeUndefined();
    await expect((manager as any).recordStepGitAfter({
      stepLogId: 'step-1',
      stepName: 'build',
      agent: 'developer',
      status: 'completed',
    })).resolves.toBeUndefined();
    await expect((manager as any).recordFinalGitSnapshot('completed')).resolves.toBeUndefined();
    expect((manager as any).workflowGit.snapshots).toEqual([]);
  });

  test('step execution produces output from engine', async () => {
    const engine = new MockEngine({ success: true, output: 'Step completed with results\n{"verdict":"pass","summary":"Step completed"}' });
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

  test('keeps thought and tool events in the complete runtime transcript', async () => {
    const engine = new MockEngine({ success: true, output: '' });
    engine.executeImpl = async () => {
      engine.emitThought('先核对仓库状态。');
      (engine as any).emit('stream', {
        type: 'tool',
        tool: {
          id: 'tool-read-1',
          toolName: 'read',
          title: '读取文件',
          status: 'running',
          input: { filePath: 'README.md' },
        },
      });
      engine.emitStream('最终答复');
      return { success: true, output: '' };
    };
    const manager = await createManagerForTest(engine);

    const result = await (manager as any).executeWithEngine(
      'process-transcript',
      'developer',
      'design-step',
      'Build a feature',
      'You are a developer',
      'test-model',
      { engineType: 'mock-engine', runId: 'test-run-001' },
    );

    expect(result.result).toBe('最终答复');
    expect(result.rawOutput).toContain('先核对仓库状态。');
    expect(result.rawOutput).toContain('tool-read-1');
    expect(result.rawOutput).toContain('最终答复');
  });

  test('cancels a malformed GitCode CI comment before the workflow can accept it', async () => {
    const engine = new MockEngine({ success: true, output: 'posted comment' });
    engine.executeImpl = async () => {
      (engine as any).emit('stream', {
        type: 'tool',
        tool: {
          id: 'tool-gitcode-comment-1',
          toolName: 'bash',
          title: '执行命令',
          status: 'running',
          input: { command: 'gc pr comment 2085 --body start_build' },
        },
      });
      return { success: true, output: 'posted comment' };
    };
    const manager = await createManagerForTest(engine);

    const result = await (manager as any).executeWithEngine(
      'process-gitcode-policy',
      'developer',
      'submit-pr',
      'Submit PR',
      'You are a developer',
      'test-model',
      { engineType: 'mock-engine', runId: 'test-run-001' },
    );

    expect(engine.cancelCalls).toBe(1);
    expect(result.is_error).toBe(true);
    expect(result.result).toContain('start_build');
    expect(result.rawOutput).toContain('GitCode CI policy');
  });

  test('persists each streamed delta only once while observing the running process', async () => {
    const { appendStreamContent } = await import('@/lib/run/state-persistence');
    const { processManager } = await import('@/lib/core/process-manager');
    const streamListeners = new Set<(event: any) => void>();
    const proc: any = {
      status: 'running',
      sessionId: null,
      streamContent: '',
    };

    vi.mocked(appendStreamContent).mockClear();
    vi.mocked(processManager.registerExternalProcess).mockImplementation(() => proc);
    vi.mocked(processManager.getProcess).mockImplementation(() => proc);
    vi.mocked(processManager.getProcessRaw).mockImplementation(() => proc);
    vi.mocked(processManager.appendStreamContent).mockImplementation((_id, chunk) => {
      proc.streamContent += chunk;
      return proc.streamContent;
    });
    vi.mocked(processManager.on).mockImplementation((event, listener) => {
      if (event === 'stream') streamListeners.add(listener as (payload: any) => void);
      return processManager as any;
    });
    vi.mocked(processManager.off).mockImplementation((event, listener) => {
      if (event === 'stream') streamListeners.delete(listener as (payload: any) => void);
      return processManager as any;
    });
    vi.mocked(processManager.emit).mockImplementation((event, ...args) => {
      if (event === 'stream') {
        for (const listener of streamListeners) listener(args[0]);
      }
      return true;
    });

    try {
      const engine = new MockEngine({ success: true, output: '' });
      engine.executeImpl = async () => {
        engine.emitStream('single streamed delta');
        return { success: true, output: '' };
      };
      const manager = await createManagerForTest(engine);
      const config = makeConfig();
      const step = config.workflow.states[0].steps[0];
      (manager as any).currentState = '设计';

      await (manager as any).runAgentStep(step, 'Build a feature', config, 'stream-once-test');

      expect(appendStreamContent).toHaveBeenCalledTimes(1);
      expect(appendStreamContent).toHaveBeenCalledWith(
        'test-run-001',
        '设计-design-step',
        'single streamed delta',
      );
    } finally {
      vi.mocked(processManager.registerExternalProcess).mockReset().mockReturnValue({
        status: 'running',
        sessionId: null,
        streamContent: '',
      } as any);
      vi.mocked(processManager.getProcess).mockReset().mockReturnValue(undefined);
      vi.mocked(processManager.getProcessRaw).mockReset().mockReturnValue(undefined);
      vi.mocked(processManager.appendStreamContent).mockReset().mockReturnValue('');
      vi.mocked(processManager.on).mockReset();
      vi.mocked(processManager.off).mockReset();
      vi.mocked(processManager.emit).mockReset();
    }
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

  test('does not write a first-turn timestamp marker before the runtime emits output', async () => {
    const { appendStreamContent } = await import('@/lib/run/state-persistence');
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      expect(appendStreamContent).not.toHaveBeenCalled();
      return { success: true, output: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"done"}\n```' };
    };
    const manager = await createManagerForTest(engine);
    const config = makeConfig();
    (manager as any).currentState = '设计';
    vi.mocked(appendStreamContent).mockClear();

    await (manager as any).executeStep(
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Build a feature',
    );

    expect(engine.calls).toHaveLength(1);
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
    expect(finalJudgePrompt).toContain('# GitCode CI 触发规则（强制）');
    expect(finalJudgePrompt).toContain('`start build`');
    expect(finalJudgePrompt).toContain('GitCode 门禁恢复流转（强制）');
    expect(finalJudgePrompt).toContain('gitcode-ci-retry.json');
    expect(finalJudgePrompt).toContain('failureKind');
  });

  test('human help prompt is injected only when workflow option is enabled', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).buildStepContext = Object.getPrototypeOf(manager).buildStepContext.bind(manager);
    const config = makeConfig({
      workflow: {
        humanHelp: { enabled: true },
      },
    });

    const prompt = await (manager as any).buildStepContext(
      config.workflow.states[0].steps[0],
      config.workflow.states[0],
      config,
      'Build a feature',
    );

    expect(prompt).toContain('# 人工客服请求协议');
    expect(prompt).toContain('步骤内人工答疑');
    expect(prompt).toContain('需求目标或验收标准存在疑问');
    expect(prompt).toContain('Agent 已完成必要排查后仍无法解决的问题');
    expect(prompt).toContain('当前步骤需要“人类确认/人工确认/用户确认/人工反馈/人工审查/人工复核/人工审批/人工验收”');
    expect(prompt).toContain('执行到需要人工介入的时点立即输出');
    expect(prompt).toContain('<human-help>');
  });

  test('human help request creates a human question, waits, and resumes the same step', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      if (engine.calls.filter((call) => call.options.step === 'design-step').length === 1) {
        return {
          success: true,
          output: '<human-help>{"title":"缺少配置","question":"请提供 API_KEY","reason":"没有 API_KEY 无法继续","answerType":"text","placeholder":"API_KEY=..."}</human-help>',
          sessionId: 'session-design-step',
        };
      }
      expect(options.prompt).toContain('人工客服回复');
      expect(options.prompt).toContain('API_KEY=test-key');
      return {
        success: true,
        output: '```json\n{"verdict":"pass","summary":"continued after human help"}\n```\n<step-conclusion>完成</step-conclusion>',
        sessionId: 'session-design-step',
      };
    };
    const manager = await createManagerForTest(engine);
    (manager as any).buildStepContext = Object.getPrototypeOf(manager).buildStepContext.bind(manager);
    (manager as any).waitForHumanQuestionAnswer = vi.fn().mockImplementation(async (questionId: string) => {
      await manager.answerHumanQuestion(questionId, { text: 'API_KEY=test-key' } as any);
      return (manager as any).humanQuestions.find((question: any) => question.id === questionId);
    });

    const config = makeConfig({
      workflow: {
        humanHelp: { enabled: true },
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(engine.calls.filter((call) => call.options.step === 'design-step')).toHaveLength(2);
    expect((manager as any).humanQuestions[0]).toMatchObject({
      status: 'answered',
      source: expect.objectContaining({ type: 'human-help', stateName: '设计', stepName: 'design-step' }),
      answerSchema: expect.objectContaining({ type: 'text' }),
    });
    expect((manager as any).currentState).not.toBe('__human_approval__');
  });

  test('human help request can be dismissed by supervisor without creating a human question', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      if (engine.calls.filter((call) => call.options.step === 'design-step').length === 1) {
        return {
          success: true,
          output: '<human-help>{"title":"想问用户","question":"信息在哪？","reason":"我还没查找","answerType":"text"}</human-help>',
          sessionId: 'session-design-step',
        };
      }
      expect(options.prompt).toContain('Supervisor 复核人工客服请求');
      expect(options.prompt).toContain('自行检查仓库、配置文件');
      return {
        success: true,
        output: '```json\n{"verdict":"pass","summary":"continued after supervisor"}\n```\n<step-conclusion>完成</step-conclusion>',
        sessionId: 'session-design-step',
      };
    };
    const manager = await createManagerForTest(engine);
    (manager as any).buildStepContext = Object.getPrototypeOf(manager).buildStepContext.bind(manager);
    const createHumanQuestion = vi.spyOn(manager as any, 'createHumanQuestion');

    const config = makeConfig({
      workflow: {
        humanHelp: { enabled: true },
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(createHumanQuestion).not.toHaveBeenCalled();
    expect(engine.calls.filter((call) => call.options.step === 'design-step')).toHaveLength(2);
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

  test('serial steps use agentInstanceId as the isolated runtime identity in the main flow', async () => {
    const engine = new MockEngine({ success: true, output: 'Step completed by base role\n{"verdict":"pass","summary":"base role"}' });
    const manager = await createManagerForTest(engine);
    (manager as any).agents.push(makeAgentState('developer-1'));

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
    expect(engine.calls[0].options.agent).toBe('developer-1');
    expect((manager as any).stepLogs[0].agent).toBe('developer-1');
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

  test('parallel any join passes when at least one branch passes', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => ({
      success: true,
      output: options.prompt.includes('branch-b')
        ? '```json\n{"verdict":"fail","issues":[{"type":"implementation","severity":"major","description":"branch b failed"}]}\n```'
        : '```json\n{"verdict":"pass","summary":"branch a passed"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              {
                name: 'branch-a',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch A',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-a', joinPolicy: { mode: 'any' } },
              },
              {
                name: 'branch-b',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch B',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-b', joinPolicy: { mode: 'any' } },
              },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(result.stepOutputs).toHaveLength(2);
    expect((manager as any).activeConcurrencyGroups.at(-1).status).toBe('completed');
  });

  test('marks a rejected parallel agent branch as a failed execution even when any join passes', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).executeWorkflowStepDispatch = vi.fn().mockImplementation(async (step: any) => {
      if (step.name === 'branch-b') {
        throw new Error('branch agent process failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 1));
      return '```json\n{"verdict":"pass","summary":"branch a passed"}\n```';
    });
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              {
                name: 'branch-a',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch A',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-a', joinPolicy: { mode: 'any' } },
              },
              {
                name: 'branch-b',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch B',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-b', joinPolicy: { mode: 'any' } },
              },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.executionFailed).toBe(true);
    expect((manager as any).failedSteps).toContain('设计-branch-b');
  });

  test('parallel quorum join requires the configured successful branch count', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => ({
      success: true,
      output: options.prompt.includes('branch-c')
        ? '```json\n{"verdict":"fail","issues":[{"type":"test","severity":"major","description":"branch c failed"}]}\n```'
        : '```json\n{"verdict":"pass","summary":"branch passed"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              {
                name: 'branch-a',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch A',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-a', joinPolicy: { mode: 'quorum', quorum: 2 } },
              },
              {
                name: 'branch-b',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch B',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-b', joinPolicy: { mode: 'quorum', quorum: 2 } },
              },
              {
                name: 'branch-c',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch C',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-c', joinPolicy: { mode: 'quorum', quorum: 2 } },
              },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect((manager as any).activeConcurrencyGroups.at(-1).joinPolicy.quorum).toBe(2);
  });

  test('parallel quorum join fails when successful branches are below quorum', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => ({
      success: true,
      output: options.prompt.includes('branch-a')
        ? '```json\n{"verdict":"pass","summary":"branch a passed"}\n```'
        : '```json\n{"verdict":"fail","issues":[{"type":"implementation","severity":"major","description":"branch failed"}]}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              {
                name: 'branch-a',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch A',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-a', joinPolicy: { mode: 'quorum', quorum: 2 } },
              },
              {
                name: 'branch-b',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch B',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-b', joinPolicy: { mode: 'quorum', quorum: 2 } },
              },
              {
                name: 'branch-c',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch C',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-c', joinPolicy: { mode: 'quorum', quorum: 2 } },
              },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('fail');
    expect((manager as any).activeConcurrencyGroups.at(-1).status).toBe('failed');
  });

  test('parallel manual join creates a human approval question and waits for approve', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict":"pass","summary":"branch passed"}\n```',
    });
    const manager = await createManagerForTest(engine);
    const approvalEvents: any[] = [];
    manager.on('human-approval-required', (data: any) => approvalEvents.push(data));
    (manager as any).waitForHumanQuestionAnswer = vi.fn().mockImplementation(async (questionId: string) => {
      await manager.answerHumanQuestion(questionId, { selectedOption: 'approve', instruction: 'continue' } as any);
      return (manager as any).humanQuestions.find((question: any) => question.id === questionId);
    });

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              {
                name: 'branch-a',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch A',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-a', joinPolicy: { mode: 'manual' } },
              },
              {
                name: 'branch-b',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch B',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-b', joinPolicy: { mode: 'manual' } },
              },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(approvalEvents).toHaveLength(1);
    expect(approvalEvents[0].parallelGroupId).toBe('group-1');
    expect(approvalEvents[0].humanQuestion.answerSchema.type).toBe('single-choice');
    expect(approvalEvents[0].pendingHumanQuestion).toBe(approvalEvents[0].humanQuestion);
    expect((manager as any).humanQuestions[0].source.type).toBe('parallel-manual-join');
    expect((manager as any).activeConcurrencyGroups.at(-1).status).toBe('completed');
  });

  test('human question dedupe keeps different parallel groups distinct', async () => {
    const manager = await createManagerForTest(new MockEngine());

    const first = await (manager as any).createHumanQuestion({
      id: 'question-group-1',
      kind: 'approval',
      title: '并发组人工确认：group-1',
      message: 'confirm group 1',
      currentState: '设计',
      requiresWorkflowPause: true,
      answerSchema: { type: 'single-choice', required: true, options: [{ label: '通过', value: 'approve' }] },
      source: { type: 'parallel-manual-join', groupId: 'group-1', stateName: '设计' },
    });
    const second = await (manager as any).createHumanQuestion({
      id: 'question-group-2',
      kind: 'approval',
      title: '并发组人工确认：group-2',
      message: 'confirm group 2',
      currentState: '设计',
      requiresWorkflowPause: true,
      answerSchema: { type: 'single-choice', required: true, options: [{ label: '通过', value: 'approve' }] },
      source: { type: 'parallel-manual-join', groupId: 'group-2', stateName: '设计' },
    });

    expect(second.id).not.toBe(first.id);
    expect((manager as any).humanQuestions).toHaveLength(2);
    expect((manager as any).humanQuestions.map((question: any) => question.source.groupId).sort()).toEqual(['group-1', 'group-2']);
  });

  test('parallel manual join reject marks the group as failed', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict":"pass","summary":"branch passed"}\n```',
    });
    const manager = await createManagerForTest(engine);
    (manager as any).waitForHumanQuestionAnswer = vi.fn().mockImplementation(async (questionId: string) => {
      await manager.answerHumanQuestion(questionId, { selectedOption: 'reject', instruction: 'stop' } as any);
      return (manager as any).humanQuestions.find((question: any) => question.id === questionId);
    });

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              {
                name: 'branch-a',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch A',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-a', joinPolicy: { mode: 'manual' } },
              },
              {
                name: 'branch-b',
                agent: 'developer',
                parallelGroup: 'group-1',
                task: 'Run branch B',
                role: 'defender',
                concurrency: { groupId: 'group-1', branchId: 'branch-b', joinPolicy: { mode: 'manual' } },
              },
            ],
            transitions: [],
          },
        ],
      },
    });

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('fail');
    expect((manager as any).activeConcurrencyGroups.at(-1).status).toBe('failed');
  });

  test('initializeAgents creates the serial agentInstanceId runtime identity', async () => {
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
      'developer-main',
    ]);
  });

  test('lightweight runtime roster and prewarm targets exclude default-supervisor', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeLightweightConfig();
    (manager as any).currentWorkflowConfig = config;
    (manager as any).currentSupervisorAgent = '';

    (manager as any).initializeAgents(config);

    expect((manager as any).agents.map((agent: any) => agent.name)).toEqual(['developer']);
    expect((manager as any).collectWorkflowAgentPrewarmTargets(config).map((target: any) => target.runtimeAgentName))
      .toEqual(['developer']);
    expect(manager.getStatus().supervisorAgent).toBeUndefined();
  });

  test('lightweight formal start persists no supervisor identity and resume keeps it absent', async () => {
    const { loadRunState, saveRunState } = await import('@/lib/run/state-persistence');
    const { parse } = await import('yaml');
    const config = makeLightweightConfig();
    const runState = {
      runId: 'run-lightweight-resume',
      configFile: 'lightweight.yaml',
      mode: 'state-machine',
      status: 'stopped',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: null,
      currentState: 'Execute',
      currentPhase: 'Execute',
      currentStep: null,
      completedSteps: [],
      failedSteps: [],
      stepLogs: [],
      agents: [{ name: 'developer', sessionId: null }],
      iterationStates: {},
      processes: [],
      requirements: 'Run the tasklist',
      workflowFrontendSessionId: null,
      attachedAgentSessions: {},
      stateHistory: [],
      issueTracker: [],
      transitionCount: 0,
      globalContext: '',
      phaseContexts: {},
      workingDirectory: '/tmp/project',
      qualityChecks: [],
      runSpecCoding: {
        id: 'legacy-lightweight-spec',
        workflowName: 'Lightweight Workflow',
        version: 1,
        status: 'confirmed',
        requirements: [],
        phases: [],
        assignments: [],
        checkpoints: [],
        tasks: [],
        artifacts: {},
        progress: { overallStatus: 'pending', completedPhaseIds: [], summary: '' },
        revisions: [],
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
      },
      bindingValidation: { ok: true, bindings: [], errors: [], warnings: [] },
      stepTaskBindingsSnapshot: [{ stepKey: 'state:Execute#1:Run tasklist', taskIds: ['T1.1'] }],
      lightweight: {
        profile: 'lightweight',
        tasklistDirectory: 'tasklist',
        workspaceRoot: '/tmp/project',
        resolvedTasklistDirectory: resolve('/tmp/runs', 'run-lightweight-resume', 'tasklist'),
        stateName: 'Execute',
        stepName: 'Run tasklist',
        effectiveStepSkills: ['aceharness-tasklist'],
      },
    } as any;
    vi.mocked(parse).mockReturnValue(config);
    vi.mocked(loadRunState).mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce(runState);
    vi.mocked(saveRunState).mockClear();

    const manager = await createManagerForTest(new MockEngine());
    (manager as any).status = 'idle';
    (manager as any).loadAgentConfigs = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeEngine = vi.fn().mockResolvedValue(undefined);
    (manager as any).resolveWorkflowMcpServers = vi.fn().mockResolvedValue(undefined);
    (manager as any).initializeMemoryV2 = vi.fn().mockResolvedValue(undefined);
    (manager as any).executeStateMachine = vi.fn().mockResolvedValue(undefined);
    (manager as any).ensureWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).disableWorkflowGitBaseline = vi.fn().mockResolvedValue(undefined);
    (manager as any).readWorkflowConfigContent = vi.fn().mockResolvedValue('lightweight config');
    (manager as any).assertRequiredVerdictTransitions = vi.fn();
    (manager as any).syncSkillsToWorkspace = vi.fn().mockResolvedValue(undefined);
    delete (manager as any).persistState;

    (manager as any).currentWorkflowConfig = config;
    (manager as any).currentSupervisorAgent = '';
    await (manager as any).start('lightweight.yaml', undefined, [], undefined, 'run-lightweight-formal');

    const formalPersistedStates = vi.mocked(saveRunState).mock.calls.map(([state]) => state as any);
    expect(formalPersistedStates.length).toBeGreaterThan(0);
    expect(formalPersistedStates.every((state) => !('supervisorAgent' in state))).toBe(true);
    expect(formalPersistedStates.every((state) => state.supervisorSessionId == null)).toBe(true);
    const { mkdir } = await import('fs/promises');
    expect(mkdir).toHaveBeenCalledWith(resolve('/tmp/runs', 'run-lightweight-formal', 'tasklist'), { recursive: true });

    await (manager as any).resume('run-lightweight-resume');

    expect((manager as any).currentSupervisorAgent).toBe('');
    expect((manager as any).agents.map((agent: any) => agent.name)).toEqual(['developer']);
    expect(manager.getStatus().supervisorAgent).toBeUndefined();
    expect((manager as any).currentRunSpecCoding).toBeNull();
    expect((manager as any).stepTaskBindingsSnapshot).toEqual([]);
  });

  test('lightweight resume rejects legacy workspace tasklist metadata', async () => {
    const manager = await createManagerForTest(new MockEngine());
    await expect((manager as any).restoreLightweightRunMetadata({
      runId: 'run-legacy-tasklist',
      workingDirectory: '/tmp/project',
      lightweight: {
        profile: 'lightweight',
        tasklistDirectory: 'docs/tasklists/legacy',
        workspaceRoot: '/tmp/project',
        resolvedTasklistDirectory: resolve('/tmp/project', 'docs/tasklists/legacy'),
        stateName: 'Execute',
        stepName: 'Run tasklist',
        effectiveStepSkills: ['aceharness-tasklist'],
      },
    })).rejects.toThrow(/legacy|inconsistent/i);
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
    const engine = new MockEngine({
      success: true,
      output: `${supervisorReview}\n\n{"verdict":"pass","summary":"supervisor review text should still be rejected"}`,
    });
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
    expect(result.decision).toMatchObject({
      action: 'advance',
      targetState: '实施',
      source: 'state-machine',
    });
  });

  test('accepts a Supervisor route only when it is a declared transition', async () => {
    const engine = new MockEngine({ success: true, output: 'unused' });
    const manager = await createManagerForTest(engine);
    const config = makeConfig();
    const state = config.workflow.states[0];
    const result = {
      stateName: state.name,
      verdict: 'pass' as const,
      issues: [],
      stepOutputs: [],
      summary: 'checks passed',
      decision: undefined as any,
    };

    const nextState = (manager as any).applySupervisorTransitionDecision(
      JSON.stringify({ decision: {
        action: 'submit_and_monitor_ci',
        targetState: '实施',
        rationale: 'ready',
        blockers: [],
        evidence: ['local gate passed'],
        instruction: 'continue',
      } }),
      state,
      result,
      '实施',
    );
    expect(nextState).toBe('实施');
    expect(result.decision).toMatchObject({ source: 'supervisor', action: 'submit_and_monitor_ci' });

    const fallback = (manager as any).applySupervisorTransitionDecision(
      JSON.stringify({ decision: { action: 'advance', targetState: '未声明状态' } }),
      state,
      result,
      '实施',
    );
    expect(fallback).toBe('实施');
    expect(result.decision).toMatchObject({ source: 'state-machine', targetState: '实施' });
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
      output: 'Partial progress, needs more iterations\n{"verdict":"conditional_pass","summary":"needs more iterations"}',
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

  test('conditional_pass cannot use unconfigured next_state to move forward', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "conditional_pass", "next_state": "实施"}\n```',
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
    expect(nextState).toBe('设计');
  });

  test('conditional_pass may move forward when configured for that verdict', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "conditional_pass", "next_state": "实施"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '设计',
            isInitial: true,
            steps: [
              { name: 'design-step', agent: 'developer', task: 'Design the feature', role: 'judge' },
            ],
            transitions: [
              { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
              { condition: { verdict: 'conditional_pass' }, to: '实施', priority: 2 },
              { condition: { verdict: 'fail' }, to: '设计', priority: 3 },
            ],
          },
          ...makeConfig().workflow.states.slice(1),
        ],
      },
    });
    const state = config.workflow.states[0];
    const result = await (manager as any).executeState(state, config, 'Build a feature');

    expect(result.verdict).toBe('conditional_pass');

    const nextState = await (manager as any).evaluateTransitions(
      state.transitions,
      result,
      config
    );
    expect(nextState).toBe('实施');
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

  test('failed step recovery error includes the latest step error', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).stepLogs = [
      {
        id: 'failed-1',
        stepName: '设计-design-step',
        status: 'failed',
        error: '旧的引擎错误',
      },
      {
        id: 'failed-2',
        stepName: '设计-design-step',
        status: 'failed',
        error: '步骤执行超时：已超过配置上限 30 分钟。',
      },
    ];

    const error = (manager as any).createFailedStepRecoveryRequiredError(
      '设计',
      ['设计-design-step'],
    );

    expect(error.message).toContain('步骤执行超时：已超过配置上限 30 分钟。');
    expect(error.message).not.toContain('旧的引擎错误');
  });

  test('self-transition circuit breaker triggers after maxSelfTransitions', async () => {
    let callCount = 0;
    const engine = new MockEngine();
    engine.executeImpl = async () => {
      callCount++;
      return {
        success: true,
        output: callCount <= 3
          ? '```json\n{"verdict": "conditional_pass"}\n```'
          : '```json\n{"verdict": "pass"}\n```',
      };
    };
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    config.workflow.states[0].maxSelfTransitions = 2;
    config.workflow.states[0].transitions = [
      {
        condition: { verdict: 'conditional_pass' },
        to: '设计',
        priority: 1,
      },
      {
        condition: { verdict: 'conditional_pass' },
        to: '实施',
        priority: 2,
      },
    ];

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(callCount).toBeGreaterThanOrEqual(4);
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

  test('spec revision vote is queued only when the source state enables it', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig();
    (manager as any).currentRunSpecCoding = { id: 'run-spec' };
    const runSpecRevisionVote = vi.fn().mockResolvedValue(undefined);
    (manager as any).runSpecRevisionVote = runSpecRevisionVote;

    (manager as any).queueSpecRevisionVote({
      trigger: 'state-complete',
      stateName: '设计',
      nextState: '实施',
    }, config);
    await (manager as any).specRevisionVoteTail;
    expect(runSpecRevisionVote).not.toHaveBeenCalled();

    config.workflow.states[0].enableSpecRevisionOnComplete = true;
    (manager as any).queueSpecRevisionVote({
      trigger: 'state-complete',
      stateName: '设计',
      nextState: '实施',
    }, config);
    await (manager as any).specRevisionVoteTail;
    expect(runSpecRevisionVote).toHaveBeenCalledTimes(1);
  });
});

// ============================================================
// Force transition
// ============================================================
describe('state-level adversarial runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('serial steps use agentInstanceId as the isolated runtime identity', async () => {
    const engine = new MockEngine({ success: true, output: 'Step completed by base role\n{"verdict":"pass","summary":"base role"}' });
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
    (manager as any).initializeAgents(config);

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.stepOutputs[0]).toContain('base role');
    expect(engine.calls[0].options.agent).toBe('developer-1');
    expect((manager as any).stepLogs[0].agent).toBe('developer-1');
  });

  test('agentInstanceId remains isolated for step-level parallel branches', async () => {
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

  test('terminal summary step does not require or parse verdict JSON, including legacy judge role', async () => {
    const engine = new MockEngine({
      success: true,
      output: '<step-conclusion>Human-readable final summary without workflow verdict.</step-conclusion>',
    });
    const manager = await createManagerForTest(engine);
    const parseVerdict = vi.spyOn(manager as any, 'parseVerdict');
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '完成',
            isInitial: true,
            isFinal: true,
            steps: [
              { name: '汇总结果', agent: 'developer', task: 'Summarize results', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });

    (manager as any).initializeAgents(config);
    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(engine.calls).toHaveLength(1);
    expect(parseVerdict).not.toHaveBeenCalled();
  });

  test('terminal parallel and resumed paths never parse verdict', async () => {
    const engine = new MockEngine({ success: true, output: '<step-conclusion>plain terminal output</step-conclusion>' });
    const manager = await createManagerForTest(engine);
    const parseVerdict = vi.spyOn(manager as any, 'parseVerdict');
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '完成',
            isInitial: true,
            isFinal: true,
            steps: [
              { name: 'summary-a', agent: 'developer', parallelGroup: 'summary-group', task: 'Summary A', role: 'judge' },
              { name: 'summary-b', agent: 'developer', parallelGroup: 'summary-group', task: 'Summary B', role: 'judge' },
              { name: 'final-note', agent: 'developer', task: 'Final note', role: 'judge' },
            ],
            transitions: [],
          },
        ],
      },
    });
    (manager as any).stepLogs = [{
      id: 'summary-a-log',
      stepName: '完成-summary-a',
      agent: 'developer',
      status: 'completed',
      output: '<step-conclusion>resumed terminal summary A</step-conclusion>',
      error: '',
      costUsd: 0,
      durationMs: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
    }];
    (manager as any).resumeStateName = '完成';
    (manager as any).resumeStepKey = '完成-final-note';

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(parseVerdict).not.toHaveBeenCalled();
  });

  test('non-final parallel defenders succeed without verdict and feed all evidence to attacker and judge', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      const outputs: Record<string, string> = {
        'defender-a': '<step-conclusion>DEFENDER-A-CONCLUSION</step-conclusion>\nDEFENDER-A-RAW',
        'defender-b': '<step-conclusion>DEFENDER-B-CONCLUSION</step-conclusion>\nDEFENDER-B-RAW',
        attacker: '<step-conclusion>ATTACKER-CONCLUSION</step-conclusion>\nATTACKER-RAW',
        judge: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"approved"}\n```\n<step-conclusion>JUDGE-CONCLUSION</step-conclusion>',
      };
      return {
        success: true,
        output: outputs[String(options.step)] || 'unexpected step',
        sessionId: `session-${options.agent}`,
      };
    };
    const manager = await createManagerForTest(engine);
    const config = makeAdversarialConfig();
    (manager as any).initializeAgents(config);
    const buildStepContext = (manager as any).buildStepContext as ReturnType<typeof vi.fn>;

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(engine.calls.map((call) => call.options.step).sort()).toEqual(['attacker', 'defender-a', 'defender-b', 'judge']);
    const attackerEvidence = buildStepContext.mock.calls.find((call: any[]) => call[0].name === 'attacker')?.[4];
    const judgeEvidence = buildStepContext.mock.calls.find((call: any[]) => call[0].name === 'judge')?.[4];
    expect(attackerEvidence).toContain('DEFENDER-A-CONCLUSION');
    expect(attackerEvidence).toContain('DEFENDER-B-CONCLUSION');
    expect(attackerEvidence).not.toContain('ATTACKER-CONCLUSION');
    expect(judgeEvidence).toContain('DEFENDER-A-CONCLUSION');
    expect(judgeEvidence).toContain('DEFENDER-B-CONCLUSION');
    expect(judgeEvidence).toContain('ATTACKER-CONCLUSION');
    const adversarialSessions = (manager as any).agents
      .filter((agent: any) => agent.name.startsWith('developer-'))
      .map((agent: any) => agent.sessionId);
    expect(new Set(adversarialSessions).size).toBe(4);
  });

  test('a technical defender branch failure stops the adversarial state before attacker', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeAdversarialConfig();
    (manager as any).initializeAgents(config);
    const dispatch = vi.spyOn(manager as any, 'executeWorkflowStepDispatch').mockImplementation(async (step: any) => {
      if (step.name === 'defender-b') throw new Error('defender branch technical failure');
      if (step.name === 'judge') return '```json\n{"verdict":"pass","remaining_issues":0,"summary":"should not run"}\n```';
      return `<step-conclusion>${step.name} completed without verdict</step-conclusion>`;
    });

    (manager as any).initializeAgents(config);
    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('fail');
    expect(dispatch.mock.calls.map((call: any[]) => call[0].name).sort()).toEqual(['defender-a', 'defender-b']);
  });

  test('adversarial resume reconstructs defender and attacker evidence from completed step logs', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict":"pass","remaining_issues":0,"summary":"resumed"}\n```\n<step-conclusion>resumed judge</step-conclusion>',
    });
    const manager = await createManagerForTest(engine);
    const config = makeAdversarialConfig();
    (manager as any).initializeAgents(config);
    const makeLog = (stepName: string, output: string, outputRef: string) => ({
      id: `log-${stepName}`,
      stepName: `高风险实现-${stepName}`,
      agent: `runtime-${stepName}`,
      status: 'completed',
      output,
      outputRef,
      error: '',
      costUsd: 0,
      durationMs: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
    });
    (manager as any).stepLogs = [
      makeLog('defender-a', '<step-conclusion>RESUME-DEFENDER-A</step-conclusion>', 'outputs/defender-a.md'),
      makeLog('defender-b', '<step-conclusion>RESUME-DEFENDER-B</step-conclusion>', 'outputs/defender-b.md'),
      makeLog('attacker', '<step-conclusion>RESUME-ATTACKER</step-conclusion>', 'outputs/attacker.md'),
    ];
    (manager as any).resumeStateName = '高风险实现';
    (manager as any).resumeStepKey = '高风险实现-judge';
    const buildStepContext = (manager as any).buildStepContext as ReturnType<typeof vi.fn>;

    const result = await (manager as any).executeState(config.workflow.states[0], config, 'Build a feature');

    expect(result.verdict).toBe('pass');
    expect(engine.calls.map((call) => call.options.step)).toEqual(['judge']);
    const judgeEvidence = buildStepContext.mock.calls.find((call: any[]) => call[0].name === 'judge')?.[4];
    expect(judgeEvidence).toContain('RESUME-DEFENDER-A');
    expect(judgeEvidence).toContain('RESUME-DEFENDER-B');
    expect(judgeEvidence).toContain('RESUME-ATTACKER');
    expect(judgeEvidence).toContain('outputs/defender-a.md');
  });

  test('runtime evidence formatting preserves every item under the 32k state budget with stable truncation', async () => {
    const { formatRuntimeEvidenceContext } = await import('@/lib/state-machine/workflow-manager');
    const evidence = Array.from({ length: 6 }, (_, index) => ({
      stepId: `defender-${index}`,
      stepName: `Defender ${index}`,
      role: 'defender' as const,
      agentInstanceId: `defender-instance-${index}`,
      conclusion: `CONCLUSION-${index}-START-${'c'.repeat(3_000)}-CONCLUSION-${index}-TAIL`,
      output: `RAW-${index}-START-${'x'.repeat(12_000)}-RAW-${index}-TAIL`,
      outputRef: `outputs/defender-${index}.md`,
    }));

    const context = formatRuntimeEvidenceContext(evidence);

    expect(context.length).toBeLessThanOrEqual(32_000);
    for (let index = 0; index < evidence.length; index++) {
      expect(context).toContain(`stepId: defender-${index}`);
      expect(context).toContain(`RAW-${index}-TAIL`);
    }
    expect(context).toContain('证据已截断');
  });

  test('runtime evidence budgeting reserves raw output even when conclusions could consume each item budget', async () => {
    const { formatRuntimeEvidenceContext } = await import('@/lib/state-machine/workflow-manager');
    const evidence = Array.from({ length: 18 }, (_, index) => ({
      stepId: `dense-${index}`,
      stepName: `Dense ${index}`,
      role: 'defender' as const,
      agentInstanceId: `dense-instance-${index}`,
      conclusion: `CONCLUSION-${index}-${'c'.repeat(4_000)}`,
      output: `RAW-${index}-START-${'x'.repeat(12_000)}-RAW-${index}-TAIL`,
      outputRef: `outputs/dense-${index}.md`,
    }));

    const context = formatRuntimeEvidenceContext(evidence);

    expect(context.length).toBeLessThanOrEqual(32_000);
    for (let index = 0; index < evidence.length; index++) {
      expect(context).toContain(`stepId: dense-${index}`);
      expect(context).toContain(`RAW-${index}-START`);
    }
  });

  test('runtime evidence budgeting keeps conclusions when dense item budgets fall below the raw-output reserve', async () => {
    const { formatRuntimeEvidenceContext } = await import('@/lib/state-machine/workflow-manager');
    const evidence = Array.from({ length: 90 }, (_, index) => ({
      stepId: `crowded-${index}`,
      stepName: `Crowded ${index}`,
      role: 'defender' as const,
      agentInstanceId: `crowded-instance-${index}`,
      conclusion: `CONCLUSION-${index}-START-${'c'.repeat(4_000)}`,
      output: `RAW-${index}-START-${'x'.repeat(12_000)}`,
      outputRef: `outputs/crowded-${index}.md`,
    }));

    const context = formatRuntimeEvidenceContext(evidence);

    expect(context.length).toBeLessThanOrEqual(32_000);
    for (let index = 0; index < evidence.length; index++) {
      expect(context).toContain(`stepId: crowded-${index}`);
      expect(context).toContain(`CONCLUSION-${index}-START`);
      expect(context).toContain(`RAW-${index}-START`);
    }
  });

  test('adversarial structure validation rejects cross-role instance reuse and non-all defender joins', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeAdversarialConfig();
    const state = config.workflow.states[0];
    state.steps[0].concurrency.joinPolicy = { mode: 'any' };
    state.steps.find((step: any) => step.role === 'attacker').agentInstanceId = 'developer-judge';

    expect(() => (manager as any).initializeAgents(config)).toThrow(/joinPolicy=all/);
    expect(() => (manager as any).initializeAgents(config)).toThrow(/运行实例必须两两不相交/);
  });

  test('adversarial runtime hard-fails if distinct role instances receive the same non-empty session', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async (options) => {
      const isJudge = options.step === 'judge';
      return {
        success: true,
        output: isJudge
          ? '```json\n{"verdict":"pass","remaining_issues":0,"summary":"approved"}\n```'
          : `<step-conclusion>${options.step} complete</step-conclusion>`,
        sessionId: options.step === 'attacker' ? 'session-defender-a' : `session-${options.step}`,
      };
    };
    const manager = await createManagerForTest(engine);
    const config = makeAdversarialConfig();
    (manager as any).initializeAgents(config);

    await expect((manager as any).executeState(config.workflow.states[0], config, 'Build a feature'))
      .rejects.toThrow(/会话隔离失败/);
    expect(engine.calls.some((call) => call.options.step === 'judge')).toBe(false);
  });

  test('initializeAgents creates the serial agentInstanceId runtime identity', async () => {
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
      'developer-main',
    ]);
  });
});

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

  test('forceTransition explicitly clears a failed checkpoint for operator recovery', async () => {
    const manager = await createManagerForTest(new MockEngine());
    (manager as any).failedSteps = ['设计-design-step'];

    (manager as any).forceTransition('实施');

    expect((manager as any).failedSteps).toEqual([]);
    expect((manager as any).pendingForceTransition).toBe('实施');
  });

  test('an explicit force transition wins a race with an already failed state result', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig();
    const originalExecuteState = (manager as any).executeState.bind(manager);
    (manager as any).executeWorkflowStepDispatch = vi.fn().mockRejectedValue(new Error('agent step execution failed'));
    (manager as any).executeState = async function (...args: any[]) {
      const result = await originalExecuteState(...args);
      if (args[0].name === '设计') {
        // The step has failed and recorded its breakpoint before the operator
        // explicitly selects a recovery target.
        (manager as any).forceTransition('完成', 'operator override after failure');
      }
      return result;
    };

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect((manager as any).currentState).toBe('完成');
    expect((manager as any).failedSteps).toEqual([]);
    expect((manager as any).stateHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '设计', to: '完成' }),
    ]));
  });

  test('an explicit force transition from a failing final-state step reaches its target', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '完成',
            isInitial: true,
            isFinal: true,
            steps: [{ name: 'final-check', agent: 'developer', task: 'Verify release', role: 'judge' }],
            transitions: [],
          },
          {
            name: '人工恢复终态',
            isFinal: true,
            steps: [],
            transitions: [],
          },
        ],
      },
    });
    const originalExecuteState = (manager as any).executeState.bind(manager);
    (manager as any).executeWorkflowStepDispatch = vi.fn().mockRejectedValue(new Error('final check failed'));
    (manager as any).executeState = async function (...args: any[]) {
      const result = await originalExecuteState(...args);
      if (args[0].name === '完成') {
        (manager as any).forceTransition('人工恢复终态', 'operator recovery after final failure');
      }
      return result;
    };

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect((manager as any).currentState).toBe('人工恢复终态');
    expect((manager as any).stateHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '完成', to: '人工恢复终态' }),
    ]));
    expect((manager as any).pendingForceTransition).toBeNull();
  });

  test('an unforced failing final-state step remains blocked at its checkpoint', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '完成',
            isInitial: true,
            isFinal: true,
            steps: [{ name: 'final-check', agent: 'developer', task: 'Verify release', role: 'judge' }],
            transitions: [],
          },
        ],
      },
    });
    (manager as any).executeWorkflowStepDispatch = vi.fn().mockRejectedValue(new Error('final check failed'));

    await expect((manager as any).executeStateMachine(config, 'Build a feature'))
      .rejects.toThrow(/必须先从失败断点恢复并重试/);

    expect((manager as any).currentState).toBe('完成');
    expect((manager as any).stateHistory).toEqual([]);
    expect((manager as any).failedSteps).toContain('完成-final-check');
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

  test('uses a matching circuit-breaker route and preserves the transition source', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    // The first conditional_pass route iterates, while the second is an explicit
    // circuit-breaker escape for the same verdict.
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
              { condition: { verdict: 'conditional_pass' }, to: '设计', priority: 1 },
              { condition: { verdict: 'conditional_pass' }, to: '完成', priority: 2 },
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
    const transitionEvents: any[] = [];
    manager.on('circuit-breaker', (data: any) => circuitBreakerEvents.push(data));
    manager.on('transition', (data: any) => transitionEvents.push(data));

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(circuitBreakerEvents.length).toBeGreaterThanOrEqual(1);
    expect(circuitBreakerEvents[0]).toHaveProperty('state', '设计');
    expect(circuitBreakerEvents[0]).toHaveProperty('selfTransitionCount');
    expect(circuitBreakerEvents[0]).toHaveProperty('maxSelfTransitions', 2);
    expect(circuitBreakerEvents[0].message).toContain('自我转换次数超过限制');
    expect(transitionEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '设计', to: '完成', circuitBreaker: true }),
    ]));
  });

  test('pauses for human handling instead of failing when the circuit breaker has no matching route', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    config.workflow.states[0].maxSelfTransitions = 1;
    const approvals: any[] = [];
    manager.on('human-approval-required', (payload: any) => approvals.push(payload));
    (manager as any).createHumanQuestion = vi.fn().mockResolvedValue({ id: 'circuit-question', status: 'unanswered' });
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '设计';
      (manager as any).shouldStop = true;
    });

    await expect((manager as any).executeStateMachine(config, 'Build a feature')).resolves.toBeUndefined();

    expect(approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({ currentState: '__human_approval__' }),
    ]));
    expect((manager as any).stateHistory).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ from: '设计', to: '实施' }),
    ]));
  });

  test('recommends the declared failure route after a retry budget is exhausted', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);
    const config = makeConfig({
      workflow: {
        states: [
          {
            name: '修复与验证',
            isInitial: true,
            maxSelfTransitions: 1,
            transitionContract: {
              completionCriteria: ['repair-verified'],
              selfLoop: { maxAttempts: 1, progressCriteria: ['new-evidence'] },
            },
            steps: [{ name: 'repair-step', agent: 'developer', task: 'Repair', role: 'judge' }],
            transitions: [
              { condition: { verdict: 'pass' }, to: 'PR提交', priority: 1 },
              { condition: { verdict: 'conditional_pass' }, to: '修复与验证', priority: 2 },
              { condition: { verdict: 'fail' }, to: '根因与方案', priority: 3 },
            ],
          },
          { name: '根因与方案', isFinal: true, steps: [], transitions: [] },
          { name: 'PR提交', isFinal: true, steps: [], transitions: [] },
        ],
      },
    });
    const approvals: any[] = [];
    manager.on('human-approval-required', (payload: any) => approvals.push(payload));
    (manager as any).getTransitionContractViolation = vi.fn().mockReturnValue(null);
    (manager as any).createHumanQuestion = vi.fn().mockImplementation(async (input: any) => ({ ...input, id: 'circuit-question', status: 'unanswered' }));
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '根因与方案';
      (manager as any).shouldStop = true;
    });

    await (manager as any).executeStateMachine(config, 'Repair issue');

    expect(approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        suggestedNextState: '根因与方案',
        humanQuestion: expect.objectContaining({
          title: '重试上限已到，需要重新裁决',
          suggestedNextState: '根因与方案',
          source: expect.objectContaining({ escalationTarget: '根因与方案' }),
          result: expect.objectContaining({
            decision: expect.objectContaining({ action: 'needs_human', targetState: '根因与方案' }),
          }),
        }),
      }),
    ]));
  });

  test('conditional-pass external dependency can pause before consuming self-transition retries', async () => {
    const engine = new MockEngine();
    engine.executeImpl = async () => ({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const config = makeConfig();
    config.workflow.states[0].maxSelfTransitions = 5;
    config.workflow.states[0].transitions = [
      { condition: { verdict: 'conditional_pass' }, to: '设计', priority: 1 },
    ];
    config.workflow.states[0].requireHumanApprovalOnConditionalPass = true;
    const approvals: any[] = [];
    manager.on('human-approval-required', (payload: any) => approvals.push(payload));
    (manager as any).createHumanQuestion = vi.fn().mockImplementation(async (input: any) => ({
      id: 'external-question',
      status: 'unanswered',
      title: input.title,
    }));
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '设计';
      (manager as any).shouldStop = true;
    });

    await (manager as any).executeStateMachine(config, 'Build a feature');

    expect(approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        currentState: '__human_approval__',
        humanQuestion: expect.objectContaining({ title: '外部依赖待人工处理' }),
      }),
    ]));
    expect((manager as any).selfTransitionCounts.get('设计') || 0).toBe(0);
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

  test('only auto-resolves an explicitly marked external gate approval onto its declared pass path', async () => {
    const manager = await createManagerForTest(new MockEngine());
    const config = makeConfig();
    config.workflow.states[0].transitions = [
      { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
      { condition: { verdict: 'conditional_pass' }, to: '设计', priority: 2 },
    ];
    (manager as any).currentWorkflowConfig = config;
    (manager as any).taskInput = {
      description: 'PR: https://gitcode.com/Cangjie/cangjie_compiler/pull/2085/discuss',
    };
    const question = {
      id: 'gate-question',
      answerSchema: { type: 'approval-transition' },
      source: {
        type: 'checkpoint-advice',
        reason: 'conditional-pass-needs-human-action',
        fromState: '设计',
      },
      previousState: '设计',
    };

    expect((manager as any).getAutoResolvableGitCodeGateApproval(question)).toEqual({
      fromState: '设计',
      targetState: '实施',
    });
    expect((manager as any).findGitCodePullRequestForApproval(question)).toMatchObject({
      owner: 'Cangjie', repo: 'cangjie_compiler', number: 2085,
    });
    (manager as any).currentRequirements =
      '同一 Issue 下必须包含测试仓 PR：https://gitcode.com/Cangjie/cangjie_test/pull/1514';
    const pullRequests = (manager as any).findGitCodePullRequestsForApproval(question);
    expect(pullRequests).toContainEqual(expect.objectContaining({
      owner: 'Cangjie', repo: 'cangjie_compiler', number: 2085,
    }));
    expect(pullRequests).toContainEqual(expect.objectContaining({
      owner: 'Cangjie', repo: 'cangjie_test', number: 1514,
    }));
    expect((manager as any).requiresJointTestPullRequest(question)).toBe(true);
    expect((manager as any).getAutoResolvableGitCodeGateApproval({
      ...question,
      source: { type: 'checkpoint-advice', reason: 'ordinary-review', fromState: '设计' },
    })).toBeNull();
    expect((manager as any).getAutoResolvableGitCodeGateApproval({
      ...question,
      source: { type: 'human-approval', reason: 'self-transition-circuit-breaker', stateName: '设计' },
      result: { decision: { action: 'submit_and_monitor_ci' } },
    })).toEqual({ fromState: '设计', targetState: '实施' });
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

  test('conditional_pass without a matching route pauses for a human instead of falling through', async () => {
    const engine = new MockEngine({
      success: true,
      output: '```json\n{"verdict": "conditional_pass"}\n```',
    });
    const manager = await createManagerForTest(engine);

    const escalationEvents: any[] = [];
    const approvals: any[] = [];
    manager.on('escalation', (data: any) => escalationEvents.push(data));
    manager.on('human-approval-required', (data: any) => approvals.push(data));

    const config = makeConfig();
    // Remove fail transition, keep only pass — conditional_pass has no matching rule
    config.workflow.states[0].transitions = [
      { condition: { verdict: 'pass' }, to: '实施', priority: 1 },
    ];
    // Set low maxSelfTransitions to avoid long test
    config.workflow.states[0].maxSelfTransitions = 1;
    (manager as any).createHumanQuestion = vi.fn().mockImplementation(async (input: any) => ({ ...input, id: 'q-circuit', status: 'unanswered' }));
    (manager as any).waitForHumanApproval = vi.fn().mockImplementation(async () => {
      (manager as any).pendingForceTransition = '设计';
      (manager as any).shouldStop = true;
    });

    await expect((manager as any).executeStateMachine(config, 'Build a feature')).resolves.toBeUndefined();

    // conditional_pass still emits its escalation, but must not reuse the pass route.
    expect(escalationEvents.length).toBeGreaterThanOrEqual(1);
    expect(escalationEvents[0].reason).toContain('conditional_pass');
    expect(escalationEvents[0].reason).toContain('继续迭代');
    expect(approvals).toEqual(expect.arrayContaining([
      expect.objectContaining({
        suggestedNextState: '设计',
        humanQuestion: expect.objectContaining({ title: '重试上限已到，需要重新裁决' }),
      }),
    ]));
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

describe('startup recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('preserves a durable human approval instead of marking its process-free wait as crashed', async () => {
    const { findActiveRuns, saveRunState } = await import('@/lib/run/state-persistence');
    vi.mocked(findActiveRuns).mockResolvedValue([
      {
        runId: 'run-durable-approval',
        mode: 'state-machine',
        status: 'running',
        currentState: '__human_approval__',
        pendingHumanQuestionId: 'hq-durable-approval',
        pendingCheckpoint: { checkpoint: 'external-gate-wait' },
        processes: [],
        agents: [],
        completedSteps: [],
        failedSteps: [],
      } as any,
    ]);
    const manager = await createManagerForTest(new MockEngine({ success: true, output: 'unused' }));

    await manager.recoverFromCrash();

    expect(saveRunState).not.toHaveBeenCalled();
  });
});
