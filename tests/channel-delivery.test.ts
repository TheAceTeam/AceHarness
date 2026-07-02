import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('channel delivery bridge', () => {
  let aceHome: string;

  beforeEach(() => {
    vi.resetModules();
    aceHome = mkdtempSync(join(tmpdir(), 'aceharness-channel-delivery-'));
    process.env.ACE_HOME = aceHome;
  });

  afterEach(async () => {
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    workflowRegistry.removeAllListeners();
    rmSync(aceHome, { recursive: true, force: true });
    delete process.env.ACE_HOME;
    vi.restoreAllMocks();
  });

  it('delivers human approval required events to bound workflow channels', async () => {
    const channelStore = await import('@/lib/channel/store');
    const delivery = await import('@/lib/channel/delivery');
    const { workflowRegistry } = await import('@/lib/workflow/registry');
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const integration = await channelStore.createChannelIntegration({
      name: 'Approval webhook',
      provider: 'generic-webhook',
      createdBy: 'user-1',
      capabilities: ['workflow-runtime'],
      providerConfig: {
        outboundWebhookUrl: 'https://example.test/outbound',
      },
    });

    await channelStore.saveChannelBinding({
      id: 'binding-approval-1',
      integrationId: integration.id,
      bindingType: 'workflow-run',
      createdBy: 'user-1',
      createdAt: Date.now(),
      externalConversationId: 'conv-approval',
      configFile: 'approval.yaml',
      runId: 'run-approval-1',
      workflowMode: 'full-control',
    });

    delivery.ensureChannelEventBridgeRegistered();
    workflowRegistry.emit('human-approval-required', {
      __configFile: 'approval.yaml',
      runId: 'run-approval-1',
      currentState: '__human_approval__',
      suggestedNextState: '实现',
      availableStates: ['实现', '结束'],
      humanQuestion: { id: 'hq-1' },
    });

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const init = (fetchMock.mock.calls as any[])[0]?.[1] as RequestInit;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.type).toBe('channel-outbound');
    expect(body.conversationId).toBe('conv-approval');
    expect(body.text).toContain('等待人工审查');
    expect(body.text).toContain('/approve');
    expect(body.metadata.eventType).toBe('human-approval-required');
    expect(body.metadata.runId).toBe('run-approval-1');
  });

  it('falls back to the owner home WeChat conversation for human approval events', async () => {
    const notifyMock = vi.fn(async (_input: any) => ({ ok: true }));
    vi.doMock('@/lib/channel/wechat/session-notifier', () => ({
      sendWeChatNotificationToFrontendSession: notifyMock,
    }));

    const channelStore = await import('@/lib/channel/store');
    const delivery = await import('@/lib/channel/delivery');
    const { workflowRegistry } = await import('@/lib/workflow/registry');

    const integration = await channelStore.createChannelIntegration({
      name: 'WeChat bridge',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['agent-chat', 'workflow-runtime'],
      providerConfig: {
        wechatOfficialAccountId: 'wechat-bot',
      },
    });

    await channelStore.saveChannelBinding({
      id: 'binding-home-wechat-1',
      integrationId: integration.id,
      bindingType: 'agent-chat',
      createdBy: 'user-1',
      createdAt: 100,
      updatedAt: 200,
      externalConversationId: 'wechat-conv-1',
      frontendSessionId: 'home-session-1',
      metadata: { source: 'home-session-bind' },
    });

    delivery.ensureChannelEventBridgeRegistered();
    workflowRegistry.emit('human-approval-required', {
      __configFile: 'approval.yaml',
      runId: 'run-approval-2',
      runOwnerId: 'user-1',
      currentState: '__human_approval__',
      suggestedNextState: '实现',
      availableStates: ['实现', '结束'],
      humanQuestion: { id: 'hq-2' },
    });

    await vi.waitFor(() => {
      expect(notifyMock).toHaveBeenCalledTimes(1);
    });
    expect(notifyMock).toHaveBeenCalledWith(expect.objectContaining({
      frontendSessionId: 'home-session-1',
      sourceLabel: '微信审查提醒',
      syncToChat: true,
      text: expect.stringContaining('等待人工审查'),
    }));
    const firstCall = notifyMock.mock.calls[0]?.[0] as any;
    expect(firstCall.text).toContain('/approve');
  });
});
