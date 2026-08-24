import { describe, expect, test, vi } from 'vitest';
import { resolveAcpxCommand } from '@/lib/runtime-agent/adapters/acpx-adapter';
import { createAcpxRuntimeClient } from '@/lib/runtime-agent/adapters/acpx-runtime-client';
import type {
  AdapterSessionInput,
  ResolvedModelRoute,
  RuntimeProfileSnapshot,
} from '@/lib/runtime-agent/contracts';
import type { AcpRuntime, AcpRuntimeEnsureInput } from 'acpx/runtime';

function createSessionInput(runtimeSessionId: string, agentId: string): AdapterSessionInput {
  const profileSnapshot: RuntimeProfileSnapshot = {
    agentId,
    modelRouteId: `route-${agentId}`,
    cwd: process.cwd(),
    systemPromptHash: 'sha256:test',
    skillsRevision: 'skills-test',
    mcpRevision: 'mcp-test',
    permissionPolicyId: 'unrestricted',
    interruptPolicy: 'queue',
  };
  const modelRoute: ResolvedModelRoute = {
    modelRouteId: profileSnapshot.modelRouteId,
    agentId,
    runtime: 'acpx',
    providerModel: 'test-model',
    configOptions: {},
    envRequirements: [],
    capabilities: {
      streaming: true,
      cancel: true,
      commands: true,
      compact: false,
      fork: false,
      handoff: false,
      permissions: true,
      toolCalls: true,
      usage: 'missing',
    },
  };
  return { runtimeSessionId, agentId, modelRoute, profileSnapshot };
}

const STALE_SESSION_ID = 'missing-acp-session';

function createRuntimeThatFailsResumeWith(diagnostic: string) {
  const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => {
    if (input.resumeSessionId === STALE_SESSION_ID) {
      throw Object.assign(new Error('Internal error'), {
        code: -32603,
        data: { details: diagnostic },
      });
    }
    return {
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
      cwd: process.cwd(),
      acpxRecordId: `${input.sessionKey}-record`,
      backendSessionId: `${input.sessionKey}-backend`,
    };
  });
  const runtime = {
    ensureSession,
    startTurn: vi.fn(),
    cancel: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
  } satisfies AcpRuntime;
  return { runtime, ensureSession };
}

async function ensureWithStaleHandle(runtime: AcpRuntime, agentId: string, label: string) {
  const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
  const session = createSessionInput(`runtime-session-${label}`, agentId);
  return client.ensureSession?.({
    session,
    command: resolveAcpxCommand(agentId),
    existingHandle: {
      sessionKey: session.runtimeSessionId,
      backend: 'acpx',
      runtimeSessionName: session.runtimeSessionId,
      backendSessionId: STALE_SESSION_ID,
    },
  });
}

describe('ACP resume 的 not-found 判定', () => {
  // 这些是 agent 只回一句「找不到」、完全不提 resume / session-load 的措辞。
  // 判定收窄时会把它们漏成「未知错误」直接抛出，而失效的会话编号仍留在
  // runtime_bindings 里，此后每次尝试都撞同一堵墙。
  test.each([
    ['resource not found', 'Resource not found'],
    ['session not found + id', `Session not found: ${STALE_SESSION_ID}`],
    ['unknown session', 'Unknown session'],
    ['does not exist', `The session ${STALE_SESSION_ID} does not exist`],
  ])('agent 只回「%s」时也应降级为全新会话', async (label, diagnostic) => {
    const { runtime, ensureSession } = createRuntimeThatFailsResumeWith(diagnostic);

    const handle = await ensureWithStaleHandle(runtime, 'claude', label.replace(/[^a-z]+/gi, '-'));

    expect(handle?.backendSessionId).toContain(':recovery:');
    expect(ensureSession).toHaveBeenCalledTimes(2);
    expect(ensureSession.mock.calls[0]?.[0]).toMatchObject({ resumeSessionId: STALE_SESSION_ID });
    expect(ensureSession.mock.calls[1]?.[0]).not.toHaveProperty('resumeSessionId');
  });

  // 反向保险：与会话无关的错误必须照常抛出，不能被这次放宽顺带吞掉。
  test.each([
    ['模型不被支持', 'The agent did not advertise that model'],
    ['配置读取失败', 'failed to reload config from config.toml'],
    ['权限被拒', 'permission denied while starting the agent'],
  ])('与会话无关的错误（%s）仍应原样抛出', async (_label, diagnostic) => {
    const { runtime, ensureSession } = createRuntimeThatFailsResumeWith(diagnostic);

    await expect(ensureWithStaleHandle(runtime, 'claude', 'unrelated')).rejects.toThrow();
    expect(ensureSession).toHaveBeenCalledTimes(1);
  });

  // 压根没在续接时，任何失败都不该触发「重开一个」—— 那会是同一个调用，必然同样失败。
  test('没有可续接的会话编号时不做降级重试', async () => {
    const ensureSession = vi.fn(async () => {
      throw Object.assign(new Error('Internal error'), {
        code: -32603,
        data: { details: 'Resource not found' },
      });
    });
    const runtime = {
      ensureSession,
      startTurn: vi.fn(),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const session = createSessionInput('runtime-session-no-resume', 'claude');

    await expect(client.ensureSession?.({
      session,
      command: resolveAcpxCommand('claude'),
    })).rejects.toThrow();
    expect(ensureSession).toHaveBeenCalledTimes(1);
  });
});
