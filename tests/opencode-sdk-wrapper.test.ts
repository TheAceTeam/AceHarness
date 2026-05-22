import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { stringify } from 'yaml';
import type { EngineOptions } from '@/lib/engines/engine-interface';

const sdkMocks = vi.hoisted(() => ({
  createOpencodeServer: vi.fn(),
  createOpencodeClient: vi.fn(),
  sessionCreate: vi.fn(),
}));

const adapterMocks = vi.hoisted(() => ({
  sendPromptWithOpenCodeHttp: vi.fn(),
}));

vi.mock('@opencode-ai/sdk', () => ({
  createOpencodeServer: sdkMocks.createOpencodeServer,
  createOpencodeClient: sdkMocks.createOpencodeClient,
}));

vi.mock('@/lib/engines/opencode-http-adapter', () => ({
  buildFullPrompt: vi.fn(() => 'hello from test'),
  getSessionId: vi.fn((data?: { id?: string }) => data?.id || 'session-test'),
  sendPromptWithOpenCodeHttp: adapterMocks.sendPromptWithOpenCodeHttp,
  ZERO_USAGE_METADATA: {},
}));

const BASE_OPTIONS: EngineOptions = {
  agent: 'test-agent',
  step: 'test-step',
  prompt: 'test prompt',
  systemPrompt: 'test system prompt',
  model: 'openai/gpt-4.1',
  workingDirectory: process.cwd(),
};

let tempAceHome = '';
const originalAceHome = process.env.ACE_HOME;
const originalLowerCaseKey = process.env.lower_case_key;
const originalSdkToken = process.env.opencode_sdk_token;

function writeSystemEnvVars(vars: Array<{ key: string; value: string; enabled: boolean }>): void {
  const envPath = join(tempAceHome, 'data', 'env-vars.yaml');
  mkdirSync(join(tempAceHome, 'data'), { recursive: true });
  writeFileSync(envPath, stringify({ vars }), 'utf8');
}

describe('OpenCodeSdkEngineWrapper', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    tempAceHome = mkdtempSync(join(tmpdir(), 'aceharness-opencode-sdk-'));
    process.env.ACE_HOME = tempAceHome;
    delete process.env.lower_case_key;
    delete process.env.opencode_sdk_token;

    sdkMocks.createOpencodeClient.mockImplementation(({ baseUrl }: { baseUrl: string }) => ({
      session: {
        create: sdkMocks.sessionCreate,
      },
      baseUrl,
    }));
    sdkMocks.sessionCreate.mockImplementation(async () => ({
      data: {
        id: `session-${sdkMocks.sessionCreate.mock.calls.length}`,
      },
    }));
    adapterMocks.sendPromptWithOpenCodeHttp.mockResolvedValue('mocked output');
  });

  afterEach(async () => {
    try {
      const { OpenCodeSdkEngineWrapper } = await import('@/lib/engines/opencode-sdk-wrapper');
      OpenCodeSdkEngineWrapper.shutdown();
    } catch {
      // ignore cleanup import failures
    }

    if (originalAceHome === undefined) {
      delete process.env.ACE_HOME;
    } else {
      process.env.ACE_HOME = originalAceHome;
    }

    if (originalLowerCaseKey === undefined) {
      delete process.env.lower_case_key;
    } else {
      process.env.lower_case_key = originalLowerCaseKey;
    }

    if (originalSdkToken === undefined) {
      delete process.env.opencode_sdk_token;
    } else {
      process.env.opencode_sdk_token = originalSdkToken;
    }

    if (tempAceHome) {
      rmSync(tempAceHome, { recursive: true, force: true });
    }
  });

  test('injects configured system env vars into opencode server startup without leaking them globally', async () => {
    writeSystemEnvVars([
      { key: 'lower_case_key', value: 'from-settings', enabled: true },
    ]);

    let capturedValue: string | undefined;
    sdkMocks.createOpencodeServer.mockImplementation(async () => {
      capturedValue = process.env.lower_case_key;
      return {
        url: 'http://127.0.0.1:4101',
        close: vi.fn(),
      };
    });

    const { OpenCodeSdkEngineWrapper } = await import('@/lib/engines/opencode-sdk-wrapper');
    const wrapper = new OpenCodeSdkEngineWrapper();
    const result = await wrapper.execute(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(capturedValue).toBe('from-settings');
    expect(process.env.lower_case_key).toBeUndefined();
    expect(sdkMocks.createOpencodeServer).toHaveBeenCalledTimes(1);
  });

  test('restarts the managed server after configured system env vars change', async () => {
    writeSystemEnvVars([
      { key: 'opencode_sdk_token', value: 'first-token', enabled: true },
    ]);

    const seenValues: string[] = [];
    const closeFns: Array<ReturnType<typeof vi.fn>> = [];
    sdkMocks.createOpencodeServer.mockImplementation(async () => {
      seenValues.push(String(process.env.opencode_sdk_token || ''));
      const close = vi.fn();
      closeFns.push(close);
      return {
        url: `http://127.0.0.1:${4100 + closeFns.length}`,
        close,
      };
    });

    const { OpenCodeSdkEngineWrapper } = await import('@/lib/engines/opencode-sdk-wrapper');
    const firstWrapper = new OpenCodeSdkEngineWrapper();
    const secondWrapper = new OpenCodeSdkEngineWrapper();

    const firstResult = await firstWrapper.execute(BASE_OPTIONS);
    writeSystemEnvVars([
      { key: 'opencode_sdk_token', value: 'second-token', enabled: true },
    ]);
    const secondResult = await secondWrapper.execute(BASE_OPTIONS);

    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(true);
    expect(seenValues).toEqual(['first-token', 'second-token']);
    expect(sdkMocks.createOpencodeServer).toHaveBeenCalledTimes(2);
    expect(closeFns[0]).toHaveBeenCalledTimes(1);
  });
});
