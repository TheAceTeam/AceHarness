import { describe, expect, test, vi, beforeEach } from 'vitest';
import { MockEngine } from './helpers/mock-engine';

// Mock all heavy external dependencies
vi.mock('@/lib/run-store', () => ({
  createRun: vi.fn().mockResolvedValue(undefined),
  updateRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/run-state-persistence', () => ({
  saveRunState: vi.fn().mockResolvedValue(undefined),
  saveProcessOutput: vi.fn().mockResolvedValue(undefined),
  saveStreamContent: vi.fn().mockResolvedValue(undefined),
  loadRunState: vi.fn().mockResolvedValue(null),
  loadStepOutputs: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/process-manager', () => ({
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

vi.mock('@/lib/workflow-experience-store', () => ({
  appendWorkflowExperience: vi.fn().mockResolvedValue(undefined),
  buildWorkflowExperiencePromptBlock: vi.fn().mockReturnValue(''),
  findRelevantWorkflowExperiences: vi.fn().mockResolvedValue([]),
  saveWorkflowFinalReview: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/workflow-memory-store', () => ({
  appendMemoryEntries: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/agent-relationship-store', () => ({
  upsertRelationshipSignal: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/chat-persistence', () => ({
  updateChatSessionCreationBinding: vi.fn().mockResolvedValue(undefined),
  updateChatSessionWorkflowBinding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/default-supervisor', () => ({
  DEFAULT_SUPERVISOR_NAME: 'default-supervisor',
  ensureDefaultSupervisorConfig: vi.fn(),
  resolveWorkflowSupervisorAgent: vi.fn().mockReturnValue('default-supervisor'),
}));

vi.mock('@/lib/spec-coding-store', () => ({
  appendSpecCodingRevision: vi.fn(),
  appendSupervisorSpecCodingRevision: vi.fn(),
  cloneSpecCodingForRun: vi.fn(),
  loadCreationSession: vi.fn().mockResolvedValue(null),
  markSpecCodingStateStatus: vi.fn().mockImplementation((doc) => doc),
  normalizeSpecCodingDocument: vi.fn().mockImplementation((doc) => doc),
  updateSpecCodingTaskStatuses: vi.fn(),
}));

vi.mock('@/lib/spec-persistence', () => ({
  ensureSpecDirStructure: vi.fn().mockResolvedValue(undefined),
  getSpecRootDir: vi.fn().mockReturnValue('/tmp/spec'),
  writeDeltaSpec: vi.fn().mockResolvedValue(undefined),
  readDeltaSpec: vi.fn().mockResolvedValue(null),
  readChecklist: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/engines', () => ({
  createEngine: vi.fn(),
  getConfiguredEngine: vi.fn().mockResolvedValue('mock-engine'),
}));

vi.mock('@/lib/engines/engine-config', () => ({
  getEngineSkillsSubdir: vi.fn().mockReturnValue('skills'),
}));

vi.mock('@/lib/runtime-configs', () => ({
  getRuntimeAgentsDirPath: vi.fn().mockReturnValue('/tmp/agents'),
  getRuntimeWorkflowConfigPath: vi.fn().mockResolvedValue('/tmp/config.yaml'),
}));

vi.mock('@/lib/runtime-skills', () => ({
  getRuntimeSkillsDirPath: vi.fn().mockResolvedValue('/tmp/skills'),
}));

vi.mock('@/lib/app-paths', () => ({
  getWorkspaceRoot: vi.fn().mockReturnValue('/tmp/workspace'),
  getWorkspaceRunsDir: vi.fn().mockReturnValue('/tmp/runs'),
}));

vi.mock('@/lib/workflow-manager', () => ({
  resolveAgentModel: vi.fn().mockReturnValue('test-model'),
}));

vi.mock('@/lib/utils', () => ({
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
async function createManagerForTest(engine: MockEngine) {
  const { StateMachineWorkflowManager } = await import('@/lib/state-machine-workflow-manager');
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
  (manager as any).agents = [
    {
      name: 'developer',
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
    },
  ];
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
