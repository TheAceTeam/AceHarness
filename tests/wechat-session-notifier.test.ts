import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

describe('wechat session notifier', () => {
  let aceHome: string;

  beforeEach(() => {
    vi.resetModules();
    aceHome = mkdtempSync(join(tmpdir(), 'aceharness-wechat-notifier-'));
    process.env.ACE_HOME = aceHome;
  });

  afterEach(async () => {
    try {
      const { closeChatSessionDatabaseForTests } = await import('@/lib/chat/persistence');
      closeChatSessionDatabaseForTests();
    } finally {
      await rm(aceHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      delete process.env.ACE_HOME;
      vi.restoreAllMocks();
    }
  });

  it('resolves delivery target from channel binding when chat session has no wechatBinding snapshot', async () => {
    const sendMock = vi.fn(async () => ({ ok: true, text: '等待人工审查' }));
    vi.doMock('@/lib/channel/wechat/official-client', () => ({
      sendWeChatOfficialText: sendMock,
    }));

    const channelStore = await import('@/lib/channel/store');
    const chatPersistence = await import('@/lib/chat/persistence');
    const notifier = await import('@/lib/channel/wechat/session-notifier');

    const integration = await channelStore.createChannelIntegration({
      name: 'WeChat bridge',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['agent-chat', 'workflow-runtime'],
      providerConfig: {
        wechatOfficialAccountId: 'bot-1@im.bot',
      },
    });

    await channelStore.saveChannelBinding({
      id: 'binding-home-wechat-1',
      integrationId: integration.id,
      bindingType: 'agent-chat',
      createdBy: 'user-1',
      createdAt: 100,
      updatedAt: 200,
      externalConversationId: 'wx-conv-1',
      externalUserId: 'wx-user-1',
      frontendSessionId: 'home-session-1',
      metadata: { source: 'home-session-bind' },
    });

    await chatPersistence.saveChatSession({
      id: 'home-session-1',
      title: '新对话',
      model: 'gpt-5.5',
      messages: [],
      createdAt: 100,
      updatedAt: 100,
      createdBy: 'user-1',
      conversationMode: 'plain',
      sessionWorkbenchState: {},
    });

    const result = await notifier.sendWeChatNotificationToFrontendSession({
      frontendSessionId: 'home-session-1',
      text: '等待人工审查',
      syncToChat: false,
    });

    expect(result.ok).toBe(true);
    expect(sendMock).toHaveBeenCalledWith({
      accountId: 'bot-1@im.bot',
      userId: 'wx-user-1',
      text: '等待人工审查',
    });
  });
});
