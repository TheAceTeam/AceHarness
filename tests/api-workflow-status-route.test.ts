import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRunningManager: vi.fn(),
  getManager: vi.fn(),
  loadRunState: vi.fn(),
  loadWorkflowFinalReview: vi.fn(),
  loadCreationSession: vi.fn(),
  loadLatestCreationSessionByFilename: vi.fn(),
  getRuntimeWorkflowConfigPath: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock('@/lib/workflow/registry', () => ({
  workflowRegistry: {
    getRunningManager: mocks.getRunningManager,
    getManager: mocks.getManager,
    getRunningManagers: vi.fn(() => []),
    getAllManagers: vi.fn(() => []),
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock('@/lib/run/state-persistence', () => ({ loadRunState: mocks.loadRunState }));
vi.mock('@/lib/workflow/experience-store', () => ({ loadWorkflowFinalReview: mocks.loadWorkflowFinalReview }));
vi.mock('@/lib/spec/coding-store', () => ({
  loadCreationSession: mocks.loadCreationSession,
  loadLatestCreationSessionByFilename: mocks.loadLatestCreationSessionByFilename,
}));
vi.mock('@/lib/run/runtime-configs', () => ({ getRuntimeWorkflowConfigPath: mocks.getRuntimeWorkflowConfigPath }));
vi.mock('fs/promises', () => ({ readFile: mocks.readFile }));

describe('workflow status route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadRunState.mockResolvedValue(null);
    mocks.getRunningManager.mockReturnValue({
      getStatus: vi.fn(() => ({ status: 'running', runId: 'other-live-run', currentConfigFile: 'demo.yaml' })),
    });
    mocks.getManager.mockReturnValue({
      getStatus: vi.fn(() => ({ status: 'running', runId: 'other-live-run', currentConfigFile: 'demo.yaml' })),
    });
    mocks.loadWorkflowFinalReview.mockResolvedValue(null);
    mocks.loadCreationSession.mockResolvedValue(null);
    mocks.loadLatestCreationSessionByFilename.mockResolvedValue(null);
    mocks.getRuntimeWorkflowConfigPath.mockRejectedValue(new Error('not needed'));
  });

  test('does not substitute another live run for a scoped history runId in compact or normal responses', async () => {
    const { GET } = await import('@/server/api-routes/workflow/status/route');

    for (const compactQuery of ['', '&compact=1']) {
      const response = await GET(new Request(
        `http://localhost/api/workflow/status?configFile=demo.yaml&runId=missing-history-run${compactQuery}`,
      ));

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        status: 'idle',
        statusReason: '未找到指定运行记录',
        runId: 'missing-history-run',
        currentConfigFile: 'demo.yaml',
      });
    }
    expect(mocks.getManager).not.toHaveBeenCalled();
  });

  test('does not expose an approval question after the persisted run left its approval state', async () => {
    mocks.loadRunState.mockResolvedValue({
      runId: 'run-stale-approval',
      configFile: 'demo.yaml',
      status: 'running',
      currentState: '修复与验证',
      currentPhase: '修复与验证',
      pendingHumanQuestionId: 'hq-old-approval',
      humanQuestions: [{
        id: 'hq-old-approval',
        status: 'unanswered',
        answerSchema: { type: 'approval-transition' },
      }],
      agents: [],
      stepLogs: [],
      completedSteps: [],
      failedSteps: [],
      iterationStates: {},
    });
    const { GET } = await import('@/server/api-routes/workflow/status/route');

    for (const compactQuery of ['', '&compact=1']) {
      const response = await GET(new Request(
        `http://localhost/api/workflow/status?configFile=demo.yaml&runId=run-stale-approval${compactQuery}`,
      ));

      await expect(response.json()).resolves.toMatchObject({
        runId: 'run-stale-approval',
        currentState: '修复与验证',
        pendingHumanQuestion: null,
      });
    }
  });
});
