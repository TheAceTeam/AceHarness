import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeRequest, responseJson } from './helpers/route-helpers';

describe('channel test-send route', () => {
  let aceHome: string;

  beforeEach(() => {
    aceHome = mkdtempSync(join(tmpdir(), 'aceharness-channel-test-send-'));
    process.env.CSIHARNESS_HOME = aceHome;
  });

  afterEach(() => {
    rmSync(aceHome, { recursive: true, force: true });
    delete process.env.CSIHARNESS_HOME;
    vi.restoreAllMocks();
  });

  it('sends an outbound test payload through the configured webhook', async () => {
    vi.resetModules();
    const userStore = await import('@/lib/core/user-store');
    const channelStore = await import('@/lib/channel/store');
    const route = await import('../src/app/api/channels/integrations/[id]/test-send/route');

    await userStore.createUser({
      username: 'tester',
      email: 'tester@example.com',
      password: 'pass123',
      question: 'q',
      answer: 'a',
      role: 'user',
      personalDir: aceHome,
      status: 'active',
    });
    const login = await userStore.login('tester@example.com', 'pass123');
    expect(login.success).toBe(true);
    const token = login.success ? login.token : '';

    const integration = await channelStore.createChannelIntegration({
      name: 'Outbound',
      provider: 'generic-webhook',
      createdBy: login.success ? login.user.id : 'unknown',
      capabilities: ['workflow-runtime'],
      providerConfig: {
        outboundWebhookUrl: 'https://example.test/hook',
      },
    });
    await channelStore.saveChannelBinding({
      id: 'binding-1',
      integrationId: integration.id,
      bindingType: 'workflow-run',
      createdBy: integration.createdBy,
      createdAt: Date.now(),
      externalConversationId: 'conv-1',
      configFile: 'demo.yaml',
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));

    const response = await route.POST(
      makeRequest(`/api/channels/integrations/${integration.id}/test-send`, {
        method: 'POST',
        token,
        json: { text: 'hello channel' },
      }),
      { params: Promise.resolve({ id: integration.id }) }
    );

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.test/hook');
    expect(String(init?.body || '')).toContain('hello channel');
  });
});
