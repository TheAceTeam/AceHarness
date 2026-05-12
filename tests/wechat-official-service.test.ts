import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('wechat official service', () => {
  let aceHome: string;

  beforeEach(() => {
    aceHome = mkdtempSync(join(tmpdir(), 'aceharness-wechat-service-'));
    process.env.ACE_HOME = aceHome;
  });

  afterEach(() => {
    rmSync(aceHome, { recursive: true, force: true });
    delete process.env.ACE_HOME;
    vi.restoreAllMocks();
  });

  it('persists the official account on a user-owned QR login session', async () => {
    vi.resetModules();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('get_bot_qrcode')) {
        return new Response(JSON.stringify({
          qrcode: 'qr-1',
          qrcode_img_content: 'https://wechat.example/qr-1',
        }), { status: 200 });
      }
      if (String(url).includes('get_qrcode_status')) {
        return new Response(JSON.stringify({
          ilink_bot_id: 'bot-user-1',
          bot_token: 'token-user-1',
          ilink_user_id: 'wx-user-1',
          baseurl: 'https://ilinkai.weixin.qq.com',
        }), { status: 200 });
      }
      return new Response('{}', { status: 404 });
    }));

    const service = await import('../src/lib/wechat-official-service');
    const store = await import('../src/lib/wechat-official-store');

    const session = await service.createWeChatOfficialLoginSession({ createdBy: 'user-1' });
    const confirmed = await service.getWeChatOfficialLoginSession(session.id, { createdBy: 'user-1' });
    const account = await store.getWeChatOfficialAccount('bot-user-1');

    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.createdBy).toBe('user-1');
    expect(account?.createdBy).toBe('user-1');
  });

  it('restores only valid bridges and removes invalid restore channels', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/wechat-official-client', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/wechat-official-client')>();
      return {
        ...actual,
        runWeChatOfficialBridge: vi.fn(() => new Promise<void>(() => {})),
      };
    });

    const channelStore = await import('../src/lib/channel-store');
    const accountStore = await import('../src/lib/wechat-official-store');
    const client = await import('../src/lib/wechat-official-client');
    const service = await import('../src/lib/wechat-official-service');

    await accountStore.saveWeChatOfficialAccount({
      accountId: 'bot-owned',
      token: 'token-owned',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      userId: 'wx-user',
      createdBy: 'user-1',
    });

    const first = await channelStore.createChannelIntegration({
      name: 'first',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['agent-chat'],
      providerConfig: {
        wechatOfficialAccountId: 'bot-owned',
        wechatOfficialAutoStart: true,
        wechatOfficialStartedAt: 200,
      },
    });
    const duplicate = await channelStore.createChannelIntegration({
      name: 'second',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['agent-chat'],
      providerConfig: {
        wechatOfficialAccountId: 'bot-owned',
        wechatOfficialAutoStart: true,
        wechatOfficialStartedAt: 100,
      },
    });
    const otherUser = await channelStore.createChannelIntegration({
      name: 'other user',
      provider: 'wechat-bridge',
      createdBy: 'user-2',
      capabilities: ['agent-chat'],
      providerConfig: {
        wechatOfficialAccountId: 'bot-owned',
        wechatOfficialAutoStart: true,
        wechatOfficialStartedAt: 300,
      },
    });
    const missingAccount = await channelStore.createChannelIntegration({
      name: 'ambiguous',
      provider: 'wechat-bridge',
      createdBy: 'user-1',
      capabilities: ['agent-chat'],
      providerConfig: {
        wechatOfficialAutoStart: true,
        wechatOfficialStartedAt: 50,
      },
    });
    await channelStore.saveChannelBinding({
      id: 'binding-missing-account',
      integrationId: missingAccount.id,
      bindingType: 'agent-chat',
      createdBy: 'user-1',
      createdAt: Date.now(),
      externalConversationId: 'wechat-old-session',
      metadata: { source: 'home-session-bind' },
    });

    const result = await service.restoreWeChatOfficialBridges({ origin: 'http://localhost:3000' });

    expect(result.restored).toHaveLength(1);
    expect(result.restored[0].integrationId).toBe(first.id);
    expect(client.runWeChatOfficialBridge).toHaveBeenCalledTimes(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.cleaned.map((item) => item.reason)).toEqual(expect.arrayContaining([
      'account-owner-mismatch',
      'account-already-restored',
      'missing-account-id',
    ]));

    await expect(channelStore.getChannelIntegration(first.id)).resolves.toBeTruthy();
    await expect(channelStore.getChannelIntegration(duplicate.id)).resolves.toBeNull();
    await expect(channelStore.getChannelIntegration(otherUser.id)).resolves.toBeNull();
    await expect(channelStore.getChannelIntegration(missingAccount.id)).resolves.toBeNull();
    await expect(channelStore.listChannelBindings()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ integrationId: missingAccount.id })]),
    );

    const secondRun = await service.restoreWeChatOfficialBridges({ origin: 'http://localhost:3000' });
    expect(secondRun.cleaned.map((item) => item.integrationId)).not.toContain(missingAccount.id);
  });

  it('rejects starting the same official account on multiple integrations in one process', async () => {
    vi.resetModules();
    vi.doMock('../src/lib/wechat-official-client', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../src/lib/wechat-official-client')>();
      return {
        ...actual,
        runWeChatOfficialBridge: vi.fn(() => new Promise<void>(() => {})),
      };
    });

    const accountStore = await import('../src/lib/wechat-official-store');
    const service = await import('../src/lib/wechat-official-service');

    await accountStore.saveWeChatOfficialAccount({
      accountId: 'bot-single',
      token: 'token-single',
      baseUrl: 'https://ilinkai.weixin.qq.com',
      userId: 'wx-user',
      createdBy: 'user-1',
    });

    await service.startWeChatOfficialBridge({
      accountId: 'bot-single',
      integrationId: 'integration-1',
      webhookUrl: 'http://localhost:3000/api/channels/inbound/integration-1',
      secret: 'secret-1',
      createdBy: 'user-1',
    });

    await expect(service.startWeChatOfficialBridge({
      accountId: 'bot-single',
      integrationId: 'integration-2',
      webhookUrl: 'http://localhost:3000/api/channels/inbound/integration-2',
      secret: 'secret-2',
      createdBy: 'user-1',
    })).rejects.toThrow('请勿重复启动同一账号');
  });
});
