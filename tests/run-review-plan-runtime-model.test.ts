import { beforeEach, describe, expect, test, vi } from 'vitest';

const runtimeMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  getEngine: vi.fn(),
  resolveModel: vi.fn(),
}));

vi.mock('@/lib/chat/chat-engine-runtime', () => ({
  executeChatRuntimeWithContextRecovery: runtimeMocks.execute,
  getOrCreateChatRuntimeEngine: runtimeMocks.getEngine,
  resolveRequestedChatRuntimeModel: runtimeMocks.resolveModel,
}));

describe('run review planner runtime selection', () => {
  beforeEach(() => {
    runtimeMocks.execute.mockReset();
    runtimeMocks.getEngine.mockReset().mockResolvedValue({});
    runtimeMocks.resolveModel.mockReset().mockReturnValue('configured-model-route');
  });

  test('uses the configured default model instead of an implicit engine/default route', async () => {
    runtimeMocks.execute.mockResolvedValue({
      success: true,
      output: '<result>{"suggestions":[{"kind":"lightweight","configFile":"lightweight.yaml","requiresAdversarial":false,"confidence":"high","riskSignals":[],"rationale":"low risk"}]}</result>',
    });
    const { evaluateRunReviewCandidatesWithAi } = await import('@/lib/workflow/run-review-plan');

    const result = await evaluateRunReviewCandidatesWithAi([{
      kind: 'lightweight',
      configFile: 'lightweight.yaml',
      workflowName: 'Lightweight',
      task: 'Inspect project',
      agent: 'analyst',
      workflowDescription: 'Read-only inspection',
    }], { userId: 'user-1' });

    expect(runtimeMocks.resolveModel).toHaveBeenCalledWith();
    expect(runtimeMocks.execute).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ model: 'configured-model-route' }),
    );
    expect(result['lightweight.yaml::lightweight']).toMatchObject({ requiresAdversarial: false });
  });
});
