import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
describe('channel gateway', () => {
  let aceHome: string;

  beforeEach(() => {
    aceHome = mkdtempSync(join(tmpdir(), 'aceharness-channel-gateway-'));
    process.env.ACE_HOME = aceHome;
  });

  afterEach(() => {
    rmSync(aceHome, { recursive: true, force: true });
    delete process.env.ACE_HOME;
    vi.restoreAllMocks();
  });

  it('auto-creates workflow binding and returns status summary for /status', async () => {
    vi.resetModules();
    const channelStore = await import('../src/lib/channel-store');
    const gateway = await import('../src/lib/channel-gateway');
    const registryModule = await import('../src/lib/workflow-registry');

    const integration = await channelStore.createChannelIntegration({
      name: 'Webhook',
      provider: 'generic-webhook',
      createdBy: 'user-1',
      capabilities: ['workflow-runtime'],
      defaultBinding: {
        bindingType: 'workflow-run',
        configFile: 'demo.yaml',
        workflowMode: 'full-control',
      },
    });

    vi.spyOn(registryModule.workflowRegistry, 'getRunningManager').mockReturnValue({
      getStatus: () => ({
        status: 'running',
        currentPhase: '实现',
        currentStep: 'fix-bug',
        runId: 'run-1',
        humanQuestions: [],
      }),
    } as any);

    const result = await gateway.handleChannelInbound(integration.id, {
      secret: integration.secret,
      message: {
        conversationId: 'conv-1',
        userId: 'external-u1',
        text: '/status',
      },
    });

    expect('challenge' in result).toBe(false);
    if ('challenge' in result) return;
    expect(result.ok).toBe(true);
    expect(result.binding?.configFile).toBe('demo.yaml');
    expect(result.replies[0]).toContain('状态：running');
    expect(result.replies[0]).toContain('步骤：fix-bug');
  });

  it('auto-binds to an owned running workflow even without default binding', async () => {
    vi.resetModules();
    const channelStore = await import('../src/lib/channel-store');
    const gateway = await import('../src/lib/channel-gateway');
    const registryModule = await import('../src/lib/workflow-registry');
    const runStateModule = await import('../src/lib/run-state-persistence');

    const integration = await channelStore.createChannelIntegration({
      name: 'WeChat',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['workflow-runtime'],
    });

    vi.spyOn(registryModule.workflowRegistry, 'getRunningManagers').mockReturnValue([{
      configFile: 'demo.yaml',
      manager: {
        getStatus: () => ({
          status: 'running',
          currentPhase: 'review',
          currentStep: 'validate',
          runId: 'run-42',
        }),
      } as any,
      isStateMachine: false,
    }]);

    vi.spyOn(runStateModule, 'loadRunState').mockImplementation(async (runId: string) => {
      if (runId !== 'run-42') return null;
      return {
        runId: 'run-42',
        configFile: 'demo.yaml',
        runOwnerId: 'user-1',
        status: 'running',
        startTime: new Date().toISOString(),
        endTime: null,
        currentPhase: 'review',
        currentStep: 'validate',
        completedSteps: [],
        failedSteps: [],
        stepLogs: [],
        agents: [],
        iterationStates: {},
        processes: [],
      } as any;
    });

    vi.spyOn(registryModule.workflowRegistry, 'getManagerByRunId').mockResolvedValue(null);

    const result = await gateway.handleChannelInbound(integration.id, {
      secret: integration.secret,
      message: {
        conversationId: 'conv-2',
        userId: 'wx-user-1',
        text: '/status',
      },
    });

    expect('challenge' in result).toBe(false);
    if ('challenge' in result) return;
    expect(result.ok).toBe(true);
    expect(result.binding?.runId).toBe('run-42');
    expect(result.binding?.configFile).toBe('demo.yaml');
    expect(result.replies[0]).toContain('状态：running');
  });

  it('switches the conversation binding to roundtable after /roundtable start', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/user-store', () => ({
      getUserById: vi.fn(async () => ({ id: 'user-1', username: 'alice', personalDir: aceHome })),
    }));
    vi.doMock('../src/lib/roundtable-manager', () => ({
      startRoundtable: vi.fn(async () => ({
        id: 'roundtable-1',
        topic: '讨论当前风险',
        status: 'completed',
        participants: ['default-supervisor', 'architect'],
        messages: [
          { speakerName: 'default-supervisor', content: '先确认当前阻塞。' },
          { speakerName: 'architect', content: '我建议先收敛接口范围。' },
        ],
      })),
      continueRoundtable: vi.fn(),
    }));

    const channelStore = await import('../src/lib/channel-store');
    const gateway = await import('../src/lib/channel-gateway');
    const registryModule = await import('../src/lib/workflow-registry');

    const integration = await channelStore.createChannelIntegration({
      name: 'Webhook',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['workflow-runtime', 'roundtable'],
      defaultBinding: {
        bindingType: 'workflow-run',
        configFile: 'demo.yaml',
        workflowMode: 'full-control',
      },
    });

    vi.spyOn(registryModule.workflowRegistry, 'getRunningManager').mockReturnValue({
      getStatus: () => ({
        status: 'running',
        currentPhase: '实现',
        currentStep: 'fix-bug',
        runId: 'run-1',
        supervisorAgent: 'default-supervisor',
        attachedAgentSessions: { architect: 'session-1' },
      }),
    } as any);

    const result = await gateway.handleChannelInbound(integration.id, {
      secret: integration.secret,
      message: {
        conversationId: 'conv-rt',
        userId: 'external-u1',
        text: '/roundtable start 讨论当前风险',
      },
    });

    expect('challenge' in result).toBe(false);
    if ('challenge' in result) return;
    expect(result.ok).toBe(true);
    expect(result.binding?.bindingType).toBe('roundtable');
    expect(result.binding?.roundtableId).toBe('roundtable-1');
    expect(result.replies[0]).toContain('default-supervisor');
  });
});
