import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { makeRequest, responseJson } from './helpers/route-helpers';

const routeMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  buildChatRequestContext: vi.fn(),
  ensureEngineRuntimeSkillsAvailable: vi.fn(),
  createAcpxRuntimeClient: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: routeMocks.requireAuth,
}));

vi.mock('@/lib/chat/request-options', () => ({
  buildChatRequestContext: routeMocks.buildChatRequestContext,
  ensureEngineRuntimeSkillsAvailable: routeMocks.ensureEngineRuntimeSkillsAvailable,
}));

vi.mock('@/lib/runtime-agent/adapters/acpx-runtime-client', () => ({
  createAcpxRuntimeClient: routeMocks.createAcpxRuntimeClient,
}));

describe('/api/chat runtime model route resolution', () => {
  const previousAceHome = process.env.ACE_HOME;
  let tempRoot: string | null = null;

  afterEach(async () => {
    const { resetRuntimeSessionsApiServiceForTesting } = await import('@/server/runtime/runtime-sessions-api-service');
    resetRuntimeSessionsApiServiceForTesting();
    if (previousAceHome === undefined) delete process.env.ACE_HOME;
    else process.env.ACE_HOME = previousAceHome;
    tempRoot = null;
    vi.resetModules();
    vi.clearAllMocks();
  });

  async function waitFor(assertion: () => void | Promise<void>): Promise<void> {
    const deadline = Date.now() + 1000;
    let lastError: unknown;
    while (Date.now() < deadline) {
      try {
        await assertion();
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    if (lastError) throw lastError;
  }

  async function setupImportedCodexGpt55Low() {
    tempRoot = mkdtempSync(join(tmpdir(), 'ace-chat-runtime-'));
    process.env.ACE_HOME = tempRoot;
    vi.resetModules();

    routeMocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      username: 'Tester',
      email: 'tester@example.com',
      role: 'user',
      personalDir: 'C:/Users/Shawn',
    });
    routeMocks.buildChatRequestContext.mockResolvedValue({
      systemPrompt: 'system prompt',
      resolvedWorkingDirectory: 'C:/workspace',
      runtimeSkillNames: [],
      enabledMcpServers: [],
      runtimeDatabaseEnv: {},
    });
    routeMocks.ensureEngineRuntimeSkillsAvailable.mockResolvedValue(undefined);
    const ensureSession = vi.fn(async (input: any) => ({
      sessionKey: input.session.runtimeSessionId,
      backend: 'acpx',
      runtimeSessionName: input.session.runtimeSessionId,
      cwd: input.session.profileSnapshot.cwd,
      acpxRecordId: `record-${input.session.runtimeSessionId}`,
      backendSessionId: `backend-${input.session.runtimeSessionId}`,
      agentSessionId: `agent-${input.session.agentId}`,
    }));
    const runTurn = vi.fn(async function* (_binding: any, input: any) {
      yield { type: 'text_delta', text: `echo:${input.input.includes('hello')}`, stream: 'output' };
      yield {
        type: 'status',
        text: 'usage updated: 6/100',
        tag: 'usage_update',
        used: 6,
        size: 100,
        breakdown: {
          inputTokens: 2,
          outputTokens: 4,
          cachedReadTokens: 8,
          cachedWriteTokens: 16,
        },
      };
      yield { type: 'turn_completed', payload: {} };
    });
    routeMocks.createAcpxRuntimeClient.mockReturnValue({
      ensureSession,
      runTurn,
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    });

    const { getWorkspaceDataFile } = await import('@/lib/core/app-paths');
    const { openRuntimeSqliteDatabase } = await import('@/lib/runtime-agent/sqlite/database');
    const { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } = await import('@/lib/runtime-agent/models/model-routes');
    const db = openRuntimeSqliteDatabase(getWorkspaceDataFile('runtime-agent.sqlite'));
    db.prepare('INSERT INTO permission_policies (id) VALUES (?)').run('unrestricted');
    upsertModelCatalogEntry(db, {
      id: 'gpt-5.5[low]',
      displayName: 'GPT 5.5 Low',
      now: '2026-07-09T00:00:00.000Z',
    });
    upsertModelProvider(db, {
      id: 'codex',
      kind: 'custom',
      displayName: 'Codex',
      now: '2026-07-09T00:00:00.000Z',
    });
    upsertModelRoute(db, {
      id: 'codex__gpt-5.5-low',
      modelId: 'gpt-5.5[low]',
      agentId: 'codex',
      providerId: 'codex',
      providerModel: 'gpt-5.5[low]',
      isDefault: true,
      capabilities: { streaming: true, toolCalls: true, usage: 'missing' },
      now: '2026-07-09T00:00:00.000Z',
    });
    db.close();

    return { ensureSession, runTurn };
  }

  test('codex with imported gpt-5.5[low] model sends hello through its model route', async () => {
    const { ensureSession, runTurn } = await setupImportedCodexGpt55Low();

    const { POST } = await import('@/server/api-routes/chat/route');
    const response = await POST(makeRequest('/api/chat', {
      json: {
        message: 'hello',
        engine: 'codex',
        model: 'gpt-5.5[low]',
      },
    }));
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      engine: 'codex',
      isError: false,
    });
    expect(ensureSession).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({
        agentId: 'codex',
        modelRoute: expect.objectContaining({
          modelRouteId: 'codex__gpt-5.5-low',
          providerModel: 'gpt-5.5[low]',
        }),
      }),
    }));
    expect(runTurn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      input: expect.stringContaining('hello'),
    }));
    expect(body.result).toBe('echo:true');
    expect(body.usage).toEqual({
      input_tokens: 2,
      output_tokens: 4,
      cache_creation_input_tokens: 16,
      cache_read_input_tokens: 8,
    });
  });

  test('streaming chat with imported codex gpt-5.5[low] model starts through its model route', async () => {
    const { ensureSession, runTurn } = await setupImportedCodexGpt55Low();

    const { GET, POST } = await import('@/server/api-routes/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: {
        message: 'hello',
        engine: 'codex',
        model: 'gpt-5.5[low]',
      },
    }));
    const body = await responseJson(response);

    expect(response.status).toBe(200);
    expect(body.chatId).toMatch(/^chat-/);
    const streamResponse = await GET(makeRequest(`/api/chat/stream?id=${body.chatId}`));
    const events = await readSseEvents(streamResponse);

    expect(events).toContainEqual({
      event: 'done',
      data: expect.objectContaining({
        result: 'echo:true',
        usage: {
          input_tokens: 2,
          output_tokens: 4,
          cache_creation_input_tokens: 16,
          cache_read_input_tokens: 8,
        },
        isError: false,
      }),
    });
    await waitFor(() => {
      expect(ensureSession).toHaveBeenCalledWith(expect.objectContaining({
        session: expect.objectContaining({
          agentId: 'codex',
          modelRoute: expect.objectContaining({
            modelRouteId: 'codex__gpt-5.5-low',
            providerModel: 'gpt-5.5[low]',
          }),
        }),
      }));
      expect(runTurn).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
        input: expect.stringContaining('hello'),
      }));
    });
  });

  test('streaming chat wraps acpx tool events as ace-process blocks', async () => {
    const { runTurn } = await setupImportedCodexGpt55Low();
    runTurn.mockImplementation(async function* (_binding: any, input: any) {
      yield { type: 'text_delta', text: '我会先读取这个 skill 的入口说明。', stream: 'output' };
      yield {
        type: 'tool_call',
        text: "Get-Content 'C:\\Users\\Shawn\\Documents\\ACEHarness\\skills\\werewolf-tabletalk\\SKILL.md' (in_progress): Get-Content 'C:\\Users\\Shawn\\Documents\\ACEHarness\\skills\\werewolf-tabletalk\\SKILL.md'",
        title: 'shell',
        status: 'in_progress',
        toolCallId: 'tool-1',
      };
      yield {
        type: 'tool_call_update',
        status: 'completed',
        toolCallId: 'tool-1',
        output: '# Werewolf Tabletalk',
        exit_code: 0,
      };
      yield { type: 'turn_completed', payload: {} };
    });

    const { GET, POST } = await import('@/server/api-routes/chat/stream/route');
    const response = await POST(makeRequest('/api/chat/stream', {
      json: {
        message: 'hello',
        engine: 'codex',
        model: 'gpt-5.5[low]',
      },
    }));
    const body = await responseJson(response);
    const streamResponse = await GET(makeRequest(`/api/chat/stream?id=${body.chatId}`));
    const events = await readSseEvents(streamResponse);
    const deltaContent = events
      .filter((event) => event.event === 'delta')
      .map((event) => String(event.data.content || ''))
      .join('');
    const done = events.find((event) => event.event === 'done');

    expect(deltaContent).toContain('<ace-process>');
    expect(deltaContent).toContain('"kind":"tool-call"');
    expect(deltaContent).toContain('"kind":"tool-result"');
    expect(deltaContent).toContain('"toolId":"tool-1"');
    expect(deltaContent).toContain('"toolName":"skill"');
    expect(deltaContent).toContain('Werewolf Tabletalk');
    expect(deltaContent).not.toContain('(in_progress): Get-Content');
    expect(String(done?.data.result || '')).toContain('<ace-process>');
    expect(String(done?.data.result || '')).not.toContain('(in_progress): Get-Content');
  });
});

async function readSseEvents(response: Response): Promise<Array<{ event: string; data: any }>> {
  expect(response.status).toBe(200);
  const text = await response.text();
  return text
    .trim()
    .split(/\n\n+/)
    .filter(Boolean)
    .map((block) => {
      const event = block.match(/^event: (.+)$/m)?.[1] || '';
      const dataText = block.match(/^data: (.+)$/m)?.[1] || '{}';
      return { event, data: JSON.parse(dataText) };
    });
}
