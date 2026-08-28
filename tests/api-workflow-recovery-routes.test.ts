import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  loadRunState: vi.fn(),
  getManagerByRunId: vi.fn(),
  getManager: vi.fn(),
  getRunningManager: vi.fn(),
  getRuntimeWorkflowConfigPath: vi.fn(),
  readFile: vi.fn(),
  parse: vi.fn(),
  canAccessRunState: vi.fn(),
  appendWorkflowAuditEvent: vi.fn(),
  getWorkflowAuditRequestMeta: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: mocks.requireAuth,
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: mocks.loadRunState,
}));

vi.mock('@/lib/workflow/registry', () => ({
  isStateMachineManagerLike: (manager: any) => Boolean(
    manager?.resumeInBackground
    && manager?.forceJumpToStateInBackground
    && manager?.forceTransition
  ),
  workflowRegistry: {
    getManagerByRunId: mocks.getManagerByRunId,
    getManager: mocks.getManager,
    getRunningManager: mocks.getRunningManager,
  },
}));

vi.mock('@/lib/run/runtime-configs', () => ({
  getRuntimeWorkflowConfigPath: mocks.getRuntimeWorkflowConfigPath,
}));

vi.mock('@/lib/workflow/run-access', () => ({
  canAccessRunState: mocks.canAccessRunState,
}));

vi.mock('@/lib/workflow/audit-log', () => ({
  appendWorkflowAuditEvent: mocks.appendWorkflowAuditEvent,
  getWorkflowAuditRequestMeta: mocks.getWorkflowAuditRequestMeta,
}));

vi.mock('fs/promises', () => ({
  readFile: mocks.readFile,
}));

vi.mock('yaml', () => ({
  parse: mocks.parse,
}));

function postRequest(path: string, body: any) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeStoppedRun() {
  return {
    runId: 'run-recovery-1',
    configFile: 'demo.yaml',
    mode: 'state-machine',
    status: 'stopped',
    currentState: 'implementation',
  };
}

function makeStateMachineManager(overrides: Record<string, any> = {}) {
  return {
    getStatus: vi.fn(() => ({ status: 'stopped', runId: 'run-recovery-1' })),
    getPendingHumanQuestion: vi.fn(() => null),
    setQueuedApprovalAction: vi.fn(),
    forceTransition: vi.fn(),
    answerHumanQuestion: vi.fn(),
    resumeInBackground: vi.fn().mockResolvedValue(undefined),
    rerunFromStepInBackground: vi.fn().mockResolvedValue(undefined),
    forceJumpToStateInBackground: vi.fn().mockResolvedValue(undefined),
    recoverFailedRunToHumanApprovalInBackground: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('workflow recovery routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAuth.mockResolvedValue({ id: 'user-1', username: 'Tester' });
    mocks.loadRunState.mockResolvedValue(makeStoppedRun());
    mocks.getRuntimeWorkflowConfigPath.mockResolvedValue('/tmp/demo.yaml');
    mocks.readFile.mockResolvedValue('workflow: {}');
    mocks.parse.mockReturnValue({
      workflow: {
        mode: 'state-machine',
        states: [{ name: 'implementation' }],
      },
    });
    mocks.canAccessRunState.mockReturnValue(true);
    mocks.appendWorkflowAuditEvent.mockResolvedValue(undefined);
    mocks.getWorkflowAuditRequestMeta.mockReturnValue({ requestId: 'test-request' });
  });

  test('returns startup failure from resume instead of acknowledging it as success', async () => {
    const manager = makeStateMachineManager({
      resumeInBackground: vi.fn().mockRejectedValue(new Error('模型 API 不可用')),
    });
    mocks.getManagerByRunId.mockResolvedValue(manager);

    const { POST } = await import('@/server/api-routes/workflow/resume/route');
    const response = await POST(postRequest('/api/workflow/resume', { runId: 'run-recovery-1' }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: '恢复工作流失败',
      message: '模型 API 不可用',
    });
    expect(manager.resumeInBackground).toHaveBeenCalledWith('run-recovery-1');
  });

  test('acknowledges resume only after state-machine startup completes', async () => {
    const manager = makeStateMachineManager();
    mocks.getManagerByRunId.mockResolvedValue(manager);

    const { POST } = await import('@/server/api-routes/workflow/resume/route');
    const response = await POST(postRequest('/api/workflow/resume', { runId: 'run-recovery-1' }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(manager.resumeInBackground).toHaveBeenCalledWith('run-recovery-1');
  });

  test('preserves the legacy asynchronous resume fallback for non-state-machine managers', async () => {
    const phaseManager = {
      getStatus: vi.fn(() => ({ status: 'stopped', runId: 'run-recovery-1' })),
      setQueuedApprovalAction: vi.fn(),
      setIterationFeedback: vi.fn(),
      resume: vi.fn().mockResolvedValue(undefined),
    };
    mocks.getManagerByRunId.mockResolvedValue(phaseManager);

    const { POST } = await import('@/server/api-routes/workflow/resume/route');
    const response = await POST(postRequest('/api/workflow/resume', { runId: 'run-recovery-1' }));

    expect(response.status).toBe(200);
    expect(phaseManager.resume).toHaveBeenCalledWith('run-recovery-1');
  });

  test('returns conflict when a concurrent resume wins the startup race', async () => {
    const manager = makeStateMachineManager({
      resumeInBackground: vi.fn().mockRejectedValue(new Error('已有工作流正在运行')),
    });
    mocks.getManagerByRunId.mockResolvedValue(manager);

    const { POST } = await import('@/server/api-routes/workflow/resume/route');
    const response = await POST(postRequest('/api/workflow/resume', { runId: 'run-recovery-1' }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: '该配置的工作流已在运行中' });
  });

  test('returns force-recovery startup errors to the caller', async () => {
    const manager = makeStateMachineManager({
      forceJumpToStateInBackground: vi.fn().mockRejectedValue(new Error('执行引擎初始化失败')),
    });
    mocks.getManagerByRunId.mockResolvedValue(manager);

    const { POST } = await import('@/server/api-routes/workflow/force-transition/route');
    const response = await POST(postRequest('/api/workflow/force-transition', {
      runId: 'run-recovery-1',
      targetState: 'implementation',
    }));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({
      error: '强制恢复工作流失败',
      message: '执行引擎初始化失败',
    });
    expect(manager.forceJumpToStateInBackground).toHaveBeenCalledWith(
      'run-recovery-1',
      'implementation',
      undefined,
      { id: 'user-1', name: 'Tester' },
    );
  });

  test('allows an explicit force jump while the target run has unresolved failed steps', async () => {
    const manager = makeStateMachineManager();
    mocks.getManagerByRunId.mockResolvedValue(manager);
    mocks.loadRunState.mockResolvedValue({
      ...makeStoppedRun(),
      failedSteps: ['implementation-build'],
    });

    const { POST } = await import('@/server/api-routes/workflow/force-transition/route');
    const response = await POST(postRequest('/api/workflow/force-transition', {
      runId: 'run-recovery-1',
      targetState: 'implementation',
    }));

    expect(response.status).toBe(200);
    expect(manager.forceJumpToStateInBackground).toHaveBeenCalledWith(
      'run-recovery-1',
      'implementation',
      undefined,
      { id: 'user-1', name: 'Tester' },
    );
  });

  test('moves a failed run into the durable human-approval checkpoint without selecting a state', async () => {
    const manager = makeStateMachineManager();
    mocks.getManagerByRunId.mockResolvedValue(manager);
    mocks.loadRunState.mockResolvedValue({
      ...makeStoppedRun(),
      status: 'failed',
      currentState: 'gate-check',
    });

    const { POST } = await import('@/server/api-routes/workflow/force-transition/route');
    const response = await POST(postRequest('/api/workflow/force-transition', {
      runId: 'run-recovery-1',
      targetState: '__human_approval__',
      instruction: '等待人工确认门禁命令',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
    expect(manager.recoverFailedRunToHumanApprovalInBackground).toHaveBeenCalledWith(
      'run-recovery-1',
      '等待人工确认门禁命令',
      { id: 'user-1', name: 'Tester' },
    );
    expect(mocks.appendWorkflowAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: 'recover-to-human-approval',
      after: { status: 'running', currentState: '__human_approval__' },
    }));
  });

  test('keeps normal resume separate from the explicit force-transition endpoint', async () => {
    const manager = makeStateMachineManager();
    mocks.getManagerByRunId.mockResolvedValue(manager);
    mocks.loadRunState.mockResolvedValue({
      ...makeStoppedRun(),
      failedSteps: ['implementation-build'],
    });

    const { POST } = await import('@/server/api-routes/workflow/resume/route');
    const response = await POST(postRequest('/api/workflow/resume', {
      runId: 'run-recovery-1',
      action: 'force-transition',
      targetState: 'implementation',
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: '强制跳转请使用专用接口',
    });
    expect(manager.resumeInBackground).not.toHaveBeenCalled();
    expect(manager.forceTransition).not.toHaveBeenCalled();
  });

  test('returns startup failures from rerun-from-step instead of acknowledging a dropped background error', async () => {
    const manager = makeStateMachineManager({
      rerunFromStepInBackground: vi.fn().mockRejectedValue(new Error('步骤不存在')),
    });
    mocks.getManager.mockResolvedValue(manager);

    const { POST } = await import('@/server/api-routes/workflow/rerun-from-step/route');
    const response = await POST(postRequest('/api/workflow/rerun-from-step', {
      runId: 'run-recovery-1',
      stepName: 'implementation-build',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: '重新运行失败',
      message: '步骤不存在',
    });
    expect(mocks.appendWorkflowAuditEvent).not.toHaveBeenCalled();
  });

  test('acknowledges rerun only after its background startup is ready', async () => {
    const manager = makeStateMachineManager();
    mocks.getManager.mockResolvedValue(manager);

    const { POST } = await import('@/server/api-routes/workflow/rerun-from-step/route');
    const response = await POST(postRequest('/api/workflow/rerun-from-step', {
      runId: 'run-recovery-1',
      stepName: 'implementation-build',
    }));

    expect(response.status).toBe(200);
    expect(manager.rerunFromStepInBackground).toHaveBeenCalledWith(
      'run-recovery-1',
      'implementation-build',
      { id: 'user-1', name: 'Tester' },
    );
    expect(mocks.appendWorkflowAuditEvent).toHaveBeenCalledTimes(1);
  });
});
