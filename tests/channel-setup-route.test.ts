import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { makeRequest, responseJson } from './helpers/route-helpers';

describe('channel setup route', () => {
  let aceHome: string;

  beforeEach(() => {
    aceHome = mkdtempSync(join(tmpdir(), 'aceharness-channel-setup-'));
    process.env.ACE_HOME = aceHome;
  });

  it('creates a one-click integration with webhook secret and default binding', async () => {
    vi.resetModules();
    const userStore = await import('../src/lib/user-store');
    const route = await import('../src/app/api/channels/setup/route');

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

    const response = await route.POST(makeRequest('/api/channels/setup', {
      method: 'POST',
      token,
      json: {
        provider: 'generic-webhook',
        name: 'Runtime Bridge',
        defaultBinding: {
          bindingType: 'workflow-run',
          configFile: 'demo.yaml',
          workflowMode: 'full-control',
        },
      },
    }));

    expect(response.status).toBe(200);
    const json = await responseJson(response);
    expect(json.integration.name).toBe('Runtime Bridge');
    expect(json.integration.provider).toBe('generic-webhook');
    expect(json.integration.secret).toMatch(/[a-f0-9]{32,}/);
    expect(json.onboarding.webhookUrl).toContain(`/api/channels/inbound/${json.integration.id}`);
    expect(json.integration.defaultBinding.configFile).toBe('demo.yaml');
  });

  afterEach(() => {
    rmSync(aceHome, { recursive: true, force: true });
    delete process.env.ACE_HOME;
  });
});
