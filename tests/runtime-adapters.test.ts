import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test, vi } from 'vitest';
import { createRuntimeAdapterRegistry, resolveRuntimeForAgent } from '@/lib/runtime-agent/adapters/adapter-registry';
import { AcpxAdapter, normalizeAcpxRuntimeEvent, resolveAcpxCommand } from '@/lib/runtime-agent/adapters/acpx-adapter';
import { createAcpxRuntimeClient } from '@/lib/runtime-agent/adapters/acpx-runtime-client';
import { getAcpxDebugTraceDirectory, writeAcpxDebugTrace } from '@/lib/runtime-agent/acpx-debug-trace';
import { MagicAdapter, normalizeMagicRuntimeEvent } from '@/lib/runtime-agent/adapters/magic-adapter';
import type {
  AdapterSessionInput,
  AdapterTurnInput,
  ResolvedModelRoute,
  RuntimePermissionPolicyId,
  RuntimeProfileSnapshot,
} from '@/lib/runtime-agent/contracts';
import type { AcpRuntime, AcpRuntimeEnsureInput, AcpRuntimeOptions, AcpRuntimeTurn } from 'acpx/runtime';

const requireFromProject = createRequire(`${process.cwd()}/package.json`);

describe('runtime adapters', () => {
  test('documents current acpx package exports and public runtime APIs', async () => {
    if (!canResolve('acpx')) {
      expect(canResolve('acpx/runtime')).toBe(false);
      expect(canResolve('acpx/flows')).toBe(false);
      return;
    }

    expect(canResolve('acpx/runtime')).toBe(true);
    expect(canResolve('acpx/flows')).toBe(true);
    expect(canResolve('@acpx/runtime')).toBe(false);

    const packageJson = requireFromProject('acpx/package.json') as { exports?: Record<string, unknown> };
    expect(packageJson.exports).toMatchObject({
      '.': './dist/cli.js',
      './runtime': './dist/runtime.js',
      './flows': './dist/flows.js',
    });

    const runtimeExports = await import('acpx/runtime');
    expect(runtimeExports).toMatchObject({
      ACPX_BACKEND_ID: 'acpx',
      AcpxRuntime: expect.any(Function),
      createAcpRuntime: expect.any(Function),
      createAgentRegistry: expect.any(Function),
      createFileSessionStore: expect.any(Function),
      createRuntimeStore: expect.any(Function),
      encodeAcpxRuntimeHandleState: expect.any(Function),
      decodeAcpxRuntimeHandleState: expect.any(Function),
    });

    const flowExports = await import('acpx/flows');
    expect(flowExports).toMatchObject({
      FlowRunner: expect.any(Function),
      acp: expect.any(Function),
      action: expect.any(Function),
      checkpoint: expect.any(Function),
      compute: expect.any(Function),
      decision: expect.any(Function),
      defineFlow: expect.any(Function),
      parseJsonObject: expect.any(Function),
    });
  });

  test('maps NGA and CodeGenie to independent acpx commands', () => {
    expect(resolveAcpxCommand('nga')).toEqual({
      command: 'ngagent',
      args: ['acp'],
      fallbackCommands: ['nga'],
    });
    expect(resolveAcpxCommand('codegenie')).toEqual({
      command: 'codegenie',
      args: ['acp'],
      fallbackCommands: [],
    });
    expect(resolveAcpxCommand('opencode')).toMatchObject({
      command: 'opencode',
      args: ['acp'],
    });
  });

  test('normalizes acpx events without exposing provider or acpx native ids in payload', () => {
    const event = normalizeAcpxRuntimeEvent({
      type: 'message_delta',
      payload: {
        text: 'hello',
        acpxRecordId: 'record-private',
        nested: {
          providerSessionId: 'provider-private',
          keep: 'visible',
        },
      },
      usage: {
        input_tokens: 5,
        output_tokens: 7,
      },
      cost: {
        cost_usd: 0.01,
        estimated: true,
      },
      providerMessageId: 'message-private',
    });

    expect(event.type).toBe('message.delta');
    expect(event.payload).toEqual({
      text: 'hello',
      nested: {
        keep: 'visible',
      },
    });
    expect(JSON.stringify(event.payload)).not.toContain('private');
    expect(event.usage).toMatchObject({
      inputTokens: 5,
      outputTokens: 7,
      missing: false,
      sourceStatus: 'reported',
    });
    expect(event.cost).toMatchObject({
      costUsd: 0.01,
      estimated: true,
      missing: false,
      sourceStatus: 'estimated',
    });
    expect(event.raw).toBeTruthy();
    expect(event.redacted).toBe(true);
  });

  test('normalizes acpx runtime text deltas into chat-readable events', () => {
    const output = normalizeAcpxRuntimeEvent({
      type: 'text_delta',
      text: 'hello from codex',
      stream: 'output',
    });
    const thought = normalizeAcpxRuntimeEvent({
      type: 'text_delta',
      text: 'thinking',
      stream: 'thought',
    });
    const chunk = normalizeAcpxRuntimeEvent({
      type: 'agent_message_chunk',
      content: {
        type: 'text',
        text: 'chunk text',
      },
    });

    expect(output.type).toBe('message.delta');
    expect(output.payload).toEqual({ text: 'hello from codex' });
    expect(thought.type).toBe('thought.delta');
    expect(thought.payload).toEqual({ text: 'thinking' });
    expect(chunk.type).toBe('message.delta');
    expect(chunk.payload).toEqual({ text: 'chunk text' });
  });

  test('normalizes acpx runtime tool and status events with readable payload text', () => {
    const tool = normalizeAcpxRuntimeEvent({
      type: 'tool_call',
      text: 'shell: npm test',
      title: 'shell',
      status: 'running',
      toolCallId: 'tool-1',
    });
    const status = normalizeAcpxRuntimeEvent({
      type: 'status',
      text: 'usage updated',
      tag: 'usage_update',
      used: 12,
      size: 100,
    });

    expect(tool.type).toBe('tool.updated');
    expect(tool.payload).toEqual({
      text: 'shell: npm test',
      title: 'shell',
      status: 'running',
      toolCallId: 'tool-1',
    });
    expect(status.type).toBe('status.changed');
    expect(status.payload).toEqual({
      message: 'usage updated',
      tag: 'usage_update',
      used: 12,
      size: 100,
    });
  });

  test('normalizes acpx tool update output fields without dropping command results', () => {
    const tool = normalizeAcpxRuntimeEvent({
      type: 'tool_call_update',
      toolCallId: 'tool-2',
      status: 'completed',
      command: 'Get-Content README.md',
      aggregated_output: '# README',
      exit_code: 0,
    });

    expect(tool.type).toBe('tool.updated');
    expect(tool.payload).toEqual({
      toolCallId: 'tool-2',
      status: 'completed',
      command: 'Get-Content README.md',
      aggregated_output: '# README',
      exit_code: 0,
    });
  });

  test('normalizes acpx completed tool output fields without dropping command results', () => {
    const tool = normalizeAcpxRuntimeEvent({
      type: 'tool_completed',
      toolCallId: 'tool-3',
      name: 'shell',
      command: 'Get-Content SKILL.md',
      aggregated_output: '# Skill',
      exit_code: 0,
    });

    expect(tool.type).toBe('tool.completed');
    expect(tool.payload).toEqual({
      toolCallId: 'tool-3',
      name: 'shell',
      command: 'Get-Content SKILL.md',
      aggregated_output: '# Skill',
      exit_code: 0,
    });
  });

  test('keeps top-level formatted output and errors in terminal tool payloads', () => {
    const completed = normalizeAcpxRuntimeEvent({
      type: 'tool_call_update',
      toolCallId: 'tool-formatted-output-1',
      status: 'completed',
      kind: 'execute',
      formatted_output: 'src/runtime.ts:42:export function run() {}',
      exit_code: 0,
    });
    const failed = normalizeAcpxRuntimeEvent({
      type: 'tool_call_update',
      toolCallId: 'tool-error-output-1',
      status: 'failed',
      kind: 'execute',
      error: { message: 'command not found' },
      exit_code: 127,
    });

    expect(completed.payload).toEqual(expect.objectContaining({
      formatted_output: 'src/runtime.ts:42:export function run() {}',
      exit_code: 0,
    }));
    expect(failed.payload).toEqual(expect.objectContaining({
      error: { message: 'command not found' },
      exit_code: 127,
    }));
  });

  test('keeps ACPX file-edit metadata while omitting the file body', () => {
    const fileBody = 'line one\nline two';
    const tool = normalizeAcpxRuntimeEvent({
      type: 'tool_call',
      toolCallId: 'tool-edit-1',
      title: 'Editing files',
      status: 'in_progress',
      kind: 'edit',
      content: [{
        type: 'diff',
        path: 'docs/dependency-analysis.md',
        oldText: null,
        newText: fileBody,
        _meta: { kind: 'add' },
      }],
    });

    expect(tool.payload).toMatchObject({
      toolCallId: 'tool-edit-1',
      kind: 'edit',
      rawInput: {
        filePath: 'docs/dependency-analysis.md',
        changes: [{
          filePath: 'docs/dependency-analysis.md',
          kind: 'add',
          addedLines: 2,
        }],
      },
    });
    expect(JSON.stringify(tool.payload)).not.toContain(fileBody);
    expect(JSON.stringify(tool.raw)).not.toContain(fileBody);
  });

  test('normalizes acpx usage_update breakdown into ACEHarness token usage', () => {
    const event = normalizeAcpxRuntimeEvent({
      type: 'status',
      text: 'usage updated: 8/128',
      tag: 'usage_update',
      used: 8,
      size: 128,
      cost: { amount: 0.002, currency: 'USD' },
      breakdown: {
        inputTokens: 3,
        outputTokens: 5,
        cachedReadTokens: 7,
        cachedWriteTokens: 11,
        thoughtTokens: 13,
        totalTokens: 39,
      },
    });

    expect(event.type).toBe('status.changed');
    expect(event.payload).toMatchObject({
      message: 'usage updated: 8/128',
      tag: 'usage_update',
      usage: {
        inputTokens: 3,
        outputTokens: 5,
        cacheReadInputTokens: 7,
        cacheCreationInputTokens: 11,
        thoughtTokens: 13,
        totalTokens: 39,
        missing: false,
        sourceStatus: 'reported',
      },
      cost: { amount: 0.002, currency: 'USD' },
    });
  });

  test('uses missing usage and cost semantics instead of zero defaults', () => {
    const acpxEvent = normalizeAcpxRuntimeEvent({
      type: 'tool_started',
      payload: {
        name: 'shell',
      },
    });
    const magicEvent = normalizeMagicRuntimeEvent({
      type: 'assistant_delta',
      text: 'working',
    });

    expect(acpxEvent.usage).toEqual({
      missing: true,
      sourceStatus: 'missing',
    });
    expect(acpxEvent.cost).toEqual({
      estimated: false,
      missing: true,
      sourceStatus: 'missing',
    });
    expect(magicEvent.usage).toEqual({
      missing: true,
      sourceStatus: 'missing',
    });
    expect(magicEvent.cost).toEqual({
      estimated: false,
      missing: true,
      sourceStatus: 'missing',
    });
  });

  test('creates adapter bindings with native ids kept inside adapter binding only', async () => {
    const acpx = new AcpxAdapter({
      async createOrLoadSession() {
        return {
          externalIds: {
            externalRecordId: 'acpx-record-1',
            externalSessionId: 'acpx-session-1',
            providerSessionId: 'provider-session-1',
          },
          raw: {
            acpxRecordId: 'acpx-record-1',
          },
        };
      },
    });

    const binding = await acpx.createOrLoadSession(createSessionInput('runtime-session-1', 'nga', 'acpx'));

    expect(binding.runtime).toBe('acpx');
    expect(binding.externalIds).toEqual({
      externalRecordId: 'acpx-record-1',
      externalSessionId: 'acpx-session-1',
      providerSessionId: 'provider-session-1',
    });
    expect(binding.raw).toEqual({
      acpxRecordId: 'acpx-record-1',
    });
  });

  test('bridges injected acpx ensureSession and runTurn when no higher-level client is provided', async () => {
    const acpx = new AcpxAdapter({
      async ensureSession(input) {
        return {
          sessionKey: input.session.runtimeSessionId,
          backend: 'acpx',
          runtimeSessionName: 'runtime-session-name',
          acpxRecordId: `record-${input.session.agentId}`,
          backendSessionId: input.session.runtimeSessionId,
          agentSessionId: 'provider-session-1',
          cwd: input.session.profileSnapshot.cwd,
          command: input.command,
        };
      },
      async *runTurn(_binding, input) {
        yield {
          type: 'message_delta',
          payload: {
            text: `turn:${input.turnId}`,
            providerSessionId: 'provider-private',
          },
        };
        yield {
          type: 'turn_completed',
          payload: {
            turnId: input.turnId,
          },
        };
      },
    });

    const binding = await acpx.createOrLoadSession(createSessionInput('runtime-session-2', 'codegenie', 'acpx'));
    const events = await collect(acpx.runTurn(binding, createTurnInput()));

    expect(binding.externalIds).toEqual({
      externalRecordId: 'record-codegenie',
      externalSessionId: 'runtime-session-2',
      providerSessionId: 'provider-session-1',
    });
    expect(binding.raw).toMatchObject({
      agentId: 'codegenie',
      command: {
        command: 'codegenie',
        args: ['acp'],
        fallbackCommands: [],
      },
      handle: {
        acpxRecordId: 'record-codegenie',
        command: {
          command: 'codegenie',
          args: ['acp'],
          fallbackCommands: [],
        },
      },
    });
    expect(events.map((event) => event.type)).toEqual(['turn.started', 'message.delta', 'turn.completed']);
    expect(events[1]?.payload).toEqual({
      text: 'turn:turn-1',
    });
  });

  test('writes acpx debug trace NDJSON only when ACE_ACPX_DEBUG_TRACE is enabled', async () => {
    const previousTrace = process.env.ACE_ACPX_DEBUG_TRACE;
    const traceDir = getAcpxDebugTraceDirectory();
    const offSessionId = `trace-session-off-${Date.now()}`;
    const onSessionId = `trace-session-on-${Date.now()}`;
    const offTraceFile = join(traceDir, `${offSessionId}__turn-1.ndjson`);
    const onTraceFile = join(traceDir, `${onSessionId}__turn-1.ndjson`);
    try {
      rmSync(offTraceFile, { force: true });
      rmSync(onTraceFile, { force: true });
      process.env.ACE_ACPX_DEBUG_TRACE = 'false';

      const acpx = new AcpxAdapter({
        async *runTurn(_binding, input) {
          yield { type: 'message_delta', payload: { text: `off:${input.turnId}` } };
        },
      });
      await collect(acpx.runTurn(await acpx.createOrLoadSession(createSessionInput(offSessionId, 'codex', 'acpx')), createTurnInput()));
      expect(existsSync(offTraceFile)).toBe(false);

      process.env.ACE_ACPX_DEBUG_TRACE = 'true';
      writeAcpxDebugTrace({
        stage: 'acpx.raw_event',
        context: {
          runtimeSessionId: onSessionId,
          turnId: 'turn-1',
        },
        payload: { direct: true, apiKey: 'trace-secret-value' },
      });
      expect(existsSync(onTraceFile)).toBe(true);

      const runtime = {
        ensureSession: vi.fn(async () => ({
          sessionKey: onSessionId,
          backend: 'acpx',
          runtimeSessionName: onSessionId,
          cwd: process.cwd(),
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-1',
          events: eventStream([{ type: 'message_delta', payload: { text: 'hello trace' } }]),
          result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime });
      const binding = await new AcpxAdapter({ ensureSession: client.ensureSession, runTurn: client.runTurn })
        .createOrLoadSession(createSessionInput(onSessionId, 'codex', 'acpx'));

      await collect(new AcpxAdapter({ runTurn: client.runTurn }).runTurn(binding, createTurnInput()));

      const traceText = readFileSync(onTraceFile, 'utf8');
      expect(traceText).not.toContain('trace-secret-value');
      const lines = traceText
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { stage: string });
      expect(lines.map((line) => line.stage)).toEqual(expect.arrayContaining([
        'acpx.raw_event',
        'adapter.normalized_event',
        'acpx.turn_result',
      ]));
    } finally {
      if (previousTrace === undefined) delete process.env.ACE_ACPX_DEBUG_TRACE;
      else process.env.ACE_ACPX_DEBUG_TRACE = previousTrace;
      rmSync(offTraceFile, { force: true });
      rmSync(onTraceFile, { force: true });
    }
  });

  test('acpx runtime client translates ACEHarness session and turn input to acpx runtime contract', async () => {
    let statusCallCount = 0;
    const ensureSession = vi.fn(async () => ({
      sessionKey: 'runtime-session-5',
      backend: 'acpx',
      runtimeSessionName: 'runtime-session-name',
      cwd: process.cwd(),
      acpxRecordId: 'record-5',
      backendSessionId: 'backend-5',
      agentSessionId: 'agent-5',
    }));
    const startTurn = vi.fn((): AcpRuntimeTurn => ({
      requestId: 'request-1',
      events: eventStream([{ type: 'message_delta', payload: { text: 'hello' } }]),
      result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
      cancel: vi.fn(async () => undefined),
      closeStream: vi.fn(async () => undefined),
    }));
    const runtime = {
      ensureSession,
      startTurn,
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      getStatus: vi.fn(async () => {
        statusCallCount += 1;
        return {
          usage: {
            cumulative: statusCallCount === 1
              ? { inputTokens: 10, outputTokens: 20, cachedReadTokens: 30, cachedWriteTokens: 40, totalTokens: 100 }
              : { inputTokens: 13, outputTokens: 25, cachedReadTokens: 37, cachedWriteTokens: 51, totalTokens: 126 },
            cost: statusCallCount === 1
              ? { amount: 0.01, currency: 'USD' }
              : { amount: 0.025, currency: 'USD' },
          },
        };
      }),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const session = createSessionInput('runtime-session-5', 'codegenie', 'acpx');

    const handle = await client.ensureSession?.({
      session,
      command: resolveAcpxCommand('codegenie'),
      existingHandle: {
        sessionKey: 'old-session',
        backend: 'acpx',
        runtimeSessionName: 'old-runtime-session',
        backendSessionId: 'resume-backend-session',
      },
    });

    expect(handle).toMatchObject({ acpxRecordId: 'record-5' });
    expect(ensureSession).toHaveBeenCalledWith({
      sessionKey: 'runtime-session-5',
      agent: 'codegenie',
      mode: 'oneshot',
      cwd: session.profileSnapshot.cwd,
      resumeSessionId: 'resume-backend-session',
      sessionOptions: {
        model: 'test-model',
      },
    });

    const binding = await new AcpxAdapter({ ensureSession: client.ensureSession, runTurn: client.runTurn }).createOrLoadSession(session);
    const events = await collect(client.runTurn!(binding, createTurnInput()));

    expect(startTurn).toHaveBeenCalledWith({
      handle: expect.objectContaining({
        acpxRecordId: 'record-5',
        backendSessionId: 'backend-5',
      }),
      text: 'hello',
      mode: 'prompt',
      requestId: 'request-1',
    });
    expect(events).toEqual([
      { type: 'message_delta', payload: { text: 'hello' } },
      {
        type: 'done',
        stopReason: 'end_turn',
        usage: {
          input_tokens: 3,
          output_tokens: 5,
          cache_read_input_tokens: 7,
          cache_creation_input_tokens: 11,
          total_tokens: 26,
        },
        cost: {
          amount: 0.015,
          currency: 'USD',
        },
      },
    ]);
  });

  test.each(['claude', 'codex', 'opencode', 'gemini'])('passes configured env to %s ACP sessions', async (agentId) => {
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => ({
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
      cwd: process.cwd(),
      backendSessionId: `${input.sessionKey}-backend`,
    }));
    const loadConfiguredEnv = vi.fn(async (options?: { userId?: string }) => {
      expect(options?.userId).toBe('user-env-owner');
      return {
        SHARED_TOKEN: 'personal',
        SYSTEM_ONLY: 'system',
        EMPTY_CONFIG: '',
        UNDEFINED_CONFIG: undefined as unknown as string,
      };
    });
    const runtime = {
      ensureSession,
      startTurn: vi.fn(),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv });
    const session = createSessionInput(
      `runtime-session-env-${agentId}`,
      agentId,
      'acpx',
      'unrestricted',
      'user-env-owner',
    );
    session.profileSnapshot.env = [
      {
        key: 'SHARED_TOKEN',
        value: '',
        source: 'process-env',
        secret: false,
        readiness: 'unknown',
      },
      {
        key: 'PROFILE_ONLY',
        value: 'profile',
        source: 'env-profile',
        secret: false,
        readiness: 'ready',
      },
      {
        key: 'SYSTEM_ONLY',
        value: '',
        source: 'env-profile',
        secret: false,
        readiness: 'unknown',
      },
    ];

    await client.ensureSession?.({ session, command: resolveAcpxCommand(agentId) });

    expect(ensureSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionOptions: {
        model: 'test-model',
        env: {
          SHARED_TOKEN: 'personal',
          SYSTEM_ONLY: 'system',
          PROFILE_ONLY: 'profile',
        },
      },
    }));
  });

  test('injects system values while leaving an unconfigured host value to acpx inheritance', async () => {
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => ({
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
      cwd: process.cwd(),
    }));
    const runtime = {
      ensureSession,
      startTurn: vi.fn(),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({
      runtime,
      loadConfiguredEnv: async () => ({ SYSTEM_ONLY: 'system' }),
    });
    const session = createSessionInput('runtime-session-system-only', 'claude', 'acpx', 'unrestricted', 'user-env-owner');
    session.profileSnapshot.env = [{
      key: 'HOST_ONLY',
      value: 'host-process',
      source: 'process-env',
      secret: false,
      readiness: 'ready',
    }];

    await client.ensureSession?.({ session, command: resolveAcpxCommand('claude') });

    expect(ensureSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionOptions: {
        model: 'test-model',
        env: { SYSTEM_ONLY: 'system' },
      },
    }));
    expect(JSON.stringify(ensureSession.mock.calls[0]?.[0])).not.toContain('host-process');
  });

  test('reconnects ACPX sessions with the current configured env and resume id', async () => {
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => ({
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
      cwd: process.cwd(),
      acpxRecordId: `${input.sessionKey}-record-${ensureSession.mock.calls.length}`,
      backendSessionId: `${input.sessionKey}-backend-${ensureSession.mock.calls.length}`,
    }));
    const runtime = {
      ensureSession,
      startTurn: vi.fn(),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const loadConfiguredEnv = vi.fn(async () => ({
      CLAUDE_CODE_USE_VERTEX: loadConfiguredEnv.mock.calls.length === 1 ? 'initial' : 'latest',
    }));
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv });
    const adapter = new AcpxAdapter(client);
    const session = createSessionInput('runtime-session-reconnect', 'claude', 'acpx', 'unrestricted', 'user-env-owner');

    const first = await adapter.createOrLoadSession(session);
    await adapter.reconnectSession({ ...session, existingBinding: first });

    expect(ensureSession).toHaveBeenCalledTimes(2);
    expect(ensureSession.mock.calls[0]?.[0]).toMatchObject({
      sessionOptions: { env: { CLAUDE_CODE_USE_VERTEX: 'initial' } },
    });
    expect(ensureSession.mock.calls[1]?.[0]).toMatchObject({
      resumeSessionId: 'runtime-session-reconnect-backend-1',
      sessionOptions: {
        env: { CLAUDE_CODE_USE_VERTEX: 'latest' },
      },
    });
    expect(loadConfiguredEnv).toHaveBeenCalledTimes(2);
  });

  test.each(['codex', 'claude', 'opencode', 'gemini'])('starts a fresh ACP session when %s cannot resume a stale session', async (agentId) => {
    const staleSessionId = 'missing-acp-session';
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => {
      if (input.resumeSessionId === staleSessionId) {
        if (agentId === 'codex') {
          throw Object.assign(new Error('Internal error'), {
            code: -32603,
            data: { details: `no rollout found for thread id ${staleSessionId}` },
          });
        }
        throw Object.assign(
          new Error(`Persistent ACP session ${staleSessionId} could not be resumed: Resource not found: ${staleSessionId}`),
          { code: -32603 },
        );
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
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const session = createSessionInput(`runtime-session-recovery-${agentId}`, agentId, 'acpx');

    const handle = await client.ensureSession?.({
      session,
      command: resolveAcpxCommand(agentId),
      existingHandle: {
        sessionKey: session.runtimeSessionId,
        backend: 'acpx',
        runtimeSessionName: session.runtimeSessionId,
        backendSessionId: staleSessionId,
      },
    });

    expect(handle?.backendSessionId).toContain(':recovery:');
    expect(ensureSession).toHaveBeenCalledTimes(2);
    expect(ensureSession.mock.calls[0]?.[0]).toMatchObject({
      sessionKey: session.runtimeSessionId,
      resumeSessionId: staleSessionId,
    });
    expect(ensureSession.mock.calls[1]?.[0]).toMatchObject({
      sessionKey: expect.stringContaining(`${session.runtimeSessionId}:recovery:`),
    });
    expect(ensureSession.mock.calls[1]?.[0]).not.toHaveProperty('resumeSessionId');
  });

  test('keeps configured CLI values ahead of inherited process-env snapshots', async () => {
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => ({
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
      cwd: process.cwd(),
    }));
    const runtime = {
      ensureSession,
      startTurn: vi.fn(),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({
      runtime,
      loadConfiguredEnv: async () => ({
        SHARED_TOKEN: 'personal',
        SYSTEM_ONLY: 'system',
      }),
    });
    const session = createSessionInput('runtime-session-env-precedence', 'claude', 'acpx', 'unrestricted', 'user-env-owner');
    session.profileSnapshot.env = [
      {
        key: 'SHARED_TOKEN',
        value: 'host-process',
        source: 'process-env',
        secret: false,
        readiness: 'ready',
      },
      {
        key: 'TURN_OVERRIDE',
        value: 'explicit',
        source: 'turn-override',
        secret: false,
        readiness: 'ready',
      },
    ];

    await client.ensureSession?.({ session, command: resolveAcpxCommand('claude') });

    expect(ensureSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionOptions: {
        model: 'test-model',
        env: {
          SHARED_TOKEN: 'personal',
          SYSTEM_ONLY: 'system',
          TURN_OVERRIDE: 'explicit',
        },
      },
    }));
  });

  test('acpx runtime client maps legacy Codex bracket models to the ACP model and effort option', async () => {
    const ensureSession = vi.fn(async () => ({
      sessionKey: 'runtime-session-codex',
      backend: 'acpx',
      runtimeSessionName: 'runtime-session-codex',
      cwd: process.cwd(),
    }));
    const runtime = {
      ensureSession,
      setConfigOption: vi.fn(async () => undefined),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-1',
        events: eventStream([]),
        result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const session = createSessionInput('runtime-session-codex', 'codex', 'acpx');
    session.modelRoute = {
      ...session.modelRoute,
      modelRouteId: 'codex__gpt-5-5-low__openai',
      providerModel: 'gpt-5.5',
      configOptions: { low: '' },
    };
    session.profileSnapshot = {
      ...session.profileSnapshot,
      modelRouteId: 'codex__gpt-5-5-low__openai',
    };

    await client.ensureSession?.({
      session,
      command: resolveAcpxCommand('codex'),
    });

    expect(ensureSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionOptions: {
        model: 'gpt-5.5',
      },
    }));
    expect(runtime.setConfigOption).toHaveBeenCalledWith(expect.objectContaining({
      key: 'reasoning_effort',
      value: 'low',
    }));
  });

  test('acpx runtime client exposes ACP session initialization diagnostics', async () => {
    const ensureSession = vi.fn(async () => {
      throw Object.assign(new Error('Internal error'), {
        code: -32603,
        data: { details: 'failed to reload config: config.toml: unknown variant `max`' },
      });
    });
    const runtime = {
      ensureSession,
      startTurn: vi.fn(),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const session = createSessionInput('runtime-session-acpx-error', 'codex', 'acpx');

    await expect(client.ensureSession?.({ session, command: resolveAcpxCommand('codex') }))
      .rejects.toMatchObject({
        code: 'ADAPTER_FAILED',
        message: expect.stringContaining('failed to reload config'),
        details: expect.objectContaining({
          stage: 'session.initialize',
          nativeError: expect.objectContaining({ code: '-32603' }),
        }),
      });
  });

  test('acpx runtime client maps ACEHarness permission policies to acpx runtime options only', async () => {
    const createdOptions: AcpRuntimeOptions[] = [];
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => ({
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
    }));
    const startTurn = vi.fn((): AcpRuntimeTurn => ({
      requestId: 'request-1',
      events: eventStream([]),
      result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
      cancel: vi.fn(async () => undefined),
      closeStream: vi.fn(async () => undefined),
    }));
    const client = createAcpxRuntimeClient({
      loadConfiguredEnv: async () => ({}),
      importRuntime: async () => ({
        createAcpRuntime(runtimeOptions) {
          createdOptions.push(runtimeOptions);
          return {
            ensureSession,
            startTurn,
            cancel: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
          } satisfies AcpRuntime;
        },
        createAgentRegistry: () => ({
          resolve: (agentName: string) => agentName,
          list: () => [],
        }),
        createRuntimeStore: () => ({
          load: vi.fn(async () => undefined),
          save: vi.fn(async () => undefined),
        }),
      }),
    });
    const expectations: Array<{
      policyId: RuntimePermissionPolicyId;
      permissionMode: AcpRuntimeOptions['permissionMode'];
      nonInteractivePermissions: AcpRuntimeOptions['nonInteractivePermissions'];
    }> = [
      { policyId: 'unrestricted', permissionMode: 'approve-all', nonInteractivePermissions: 'deny' },
      { policyId: 'deny-all', permissionMode: 'deny-all', nonInteractivePermissions: 'deny' },
      { policyId: 'approve-reads', permissionMode: 'approve-reads', nonInteractivePermissions: 'deny' },
      { policyId: 'ask', permissionMode: 'approve-reads', nonInteractivePermissions: 'fail' },
      { policyId: 'deny-destructive', permissionMode: 'approve-reads', nonInteractivePermissions: 'deny' },
    ];

    for (const expectation of expectations) {
      const session = createSessionInput(`runtime-session-${expectation.policyId}`, 'codegenie', 'acpx', expectation.policyId);
      await client.ensureSession?.({
        session,
        command: resolveAcpxCommand('codegenie'),
      });
    }

    const createdByMode = new Map(createdOptions.map((option) => [`${option.permissionMode}:${option.nonInteractivePermissions}`, option]));
    for (const expectation of expectations) {
      const runtimeOptions = createdByMode.get(`${expectation.permissionMode}:${expectation.nonInteractivePermissions}`);
      expect(runtimeOptions).toMatchObject({
        permissionMode: expectation.permissionMode,
        nonInteractivePermissions: expectation.nonInteractivePermissions,
      });
      expect(JSON.stringify(runtimeOptions)).not.toContain('permissionPolicyId');
    }
    for (const call of ensureSession.mock.calls) {
      expect(JSON.stringify(call[0])).not.toContain('permissionPolicyId');
      expect(call[0].sessionOptions).toEqual({ model: 'test-model' });
    }
    expect(startTurn).not.toHaveBeenCalled();
  });

  test('acpx runtime client forwards profile MCP servers to acpx runtime options and keys runtime cache by MCP config', async () => {
    const createdOptions: AcpRuntimeOptions[] = [];
    const ensureSession = vi.fn(async (input: AcpRuntimeEnsureInput) => ({
      sessionKey: input.sessionKey,
      backend: 'acpx',
      runtimeSessionName: input.sessionKey,
    }));
    const client = createAcpxRuntimeClient({
      importRuntime: async () => ({
        createAcpRuntime(runtimeOptions) {
          createdOptions.push(runtimeOptions);
          return {
            ensureSession,
            startTurn: vi.fn((): AcpRuntimeTurn => ({
              requestId: 'request-1',
              events: eventStream([]),
              result: Promise.resolve({ status: 'completed' }),
              cancel: vi.fn(async () => undefined),
              closeStream: vi.fn(async () => undefined),
            })),
            cancel: vi.fn(async () => undefined),
            close: vi.fn(async () => undefined),
          } satisfies AcpRuntime;
        },
        createAgentRegistry: () => ({
          resolve: (agentName: string) => agentName,
          list: () => [],
        }),
        createRuntimeStore: () => ({
          load: vi.fn(async () => undefined),
          save: vi.fn(async () => undefined),
        }),
      }),
    });
    const first = createSessionInput('runtime-session-mcp-1', 'codeagent', 'acpx');
    first.profileSnapshot.mcpServers = [{
      name: 'filesystem',
      type: 'stdio',
      command: 'npx -y @modelcontextprotocol/server-filesystem C:\\tmp',
      env: { FOO: 'bar' },
    }];
    const second = createSessionInput('runtime-session-mcp-2', 'codeagent', 'acpx');
    second.profileSnapshot.mcpServers = [{
      name: 'git',
      type: 'stdio',
      command: 'npx -y mcp-git',
    }];

    await client.ensureSession?.({ session: first, command: resolveAcpxCommand('codeagent') });
    await client.ensureSession?.({ session: first, command: resolveAcpxCommand('codeagent') });
    await client.ensureSession?.({ session: second, command: resolveAcpxCommand('codeagent') });

    expect(createdOptions).toHaveLength(2);
    expect(createdOptions[0]?.mcpServers).toEqual([{
      name: 'filesystem',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', 'C:\\tmp'],
      env: [{ name: 'FOO', value: 'bar' }],
    }]);
    expect(createdOptions[1]?.mcpServers).toEqual([{
      name: 'git',
      command: 'npx',
      args: ['-y', 'mcp-git'],
      env: [],
    }]);
    expect(ensureSession).toHaveBeenCalledTimes(3);
  });

  test('acpx runtime client construction path executes ensureSession, startTurn, cancel, status, and close', async () => {
    const calls: string[] = [];
    const getStatus = vi.fn(async () => ({
      status: 'running',
      activeTurnId: 'turn-1',
      metadata: {
        visible: true,
      },
    }));
    const cancel = vi.fn(async () => {
      calls.push('cancel');
    });
    const close = vi.fn(async () => {
      calls.push('close');
    });
    const client = createAcpxRuntimeClient({
      importRuntime: async () => ({
        createAcpRuntime() {
          calls.push('createAcpRuntime');
          return {
            ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => {
              calls.push('ensureSession');
              return {
                sessionKey: input.sessionKey,
                backend: 'acpx',
                runtimeSessionName: input.sessionKey,
                acpxRecordId: 'record-real-path',
                backendSessionId: 'backend-real-path',
                agentSessionId: 'provider-real-path',
              };
            }),
            startTurn: vi.fn((): AcpRuntimeTurn => {
              calls.push('startTurn');
              return {
                requestId: 'request-1',
                events: eventStream([{ type: 'message_delta', payload: { text: 'constructed' } }]),
                result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
                cancel: vi.fn(async () => undefined),
                closeStream: vi.fn(async () => undefined),
              };
            }),
            cancel,
            close,
            getStatus,
          } satisfies AcpRuntime;
        },
        createAgentRegistry: () => ({
          resolve: (agentName: string) => agentName,
          list: () => [],
        }),
        createRuntimeStore: () => ({
          load: vi.fn(async () => undefined),
          save: vi.fn(async () => undefined),
        }),
      }),
    });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-real-path', 'codegenie', 'acpx'));
    const events = await collect(adapter.runTurn(binding, createTurnInput()));
    const status = await adapter.getStatus(binding);

    await adapter.cancel(binding, { turnId: 'turn-after-finish', requestId: 'cancel-1', reason: 'test' });
    await adapter.close(binding);

    expect(calls).toEqual(['createAcpRuntime', 'ensureSession', 'startTurn', 'close', 'cancel']);
    expect(events.map((event) => event.type)).toEqual(['turn.started', 'message.delta', 'turn.completed']);
    expect(status).toMatchObject({
      runtime: 'acpx',
      status: 'running',
      activeTurnId: 'turn-1',
      metadata: {
        visible: true,
      },
    });
    expect(cancel).toHaveBeenCalledWith({
      handle: expect.objectContaining({
        acpxRecordId: 'record-real-path',
      }),
      reason: 'test',
    });
    expect(close).toHaveBeenCalledWith({
      handle: expect.objectContaining({
        backendSessionId: 'backend-real-path',
      }),
      reason: 'aceharness-runtime-turn-complete',
      discardPersistentState: false,
    });
  });

  test('recovers ACPX request token usage from persisted failed terminal turns', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'ace-acpx-terminal-usage-'));
    const recordId = 'record-terminal-failed-usage';
    try {
      process.env.ACE_HOME = aceHome;
      const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
        request_token_usage: {
          'msg-old': {
            input_tokens: 1,
            output_tokens: 1,
            cache_read_input_tokens: 1,
            cache_creation_input_tokens: 1,
            total_tokens: 4,
          },
          'msg-new': {
            input_tokens: 17,
            output_tokens: 19,
            cache_read_input_tokens: 23,
            cache_creation_input_tokens: 29,
            thought_tokens: 31,
            total_tokens: 119,
          },
        },
      }), 'utf8');

      const runtime = {
        ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
          sessionKey: input.sessionKey,
          backend: 'acpx',
          runtimeSessionName: input.sessionKey,
          cwd: process.cwd(),
          acpxRecordId: recordId,
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-terminal-failed-usage',
          events: eventStream([]),
          result: Promise.resolve({
            status: 'failed',
            error: { message: 'provider failed after using tokens', code: 'FAILED' },
          }),
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
      const adapter = new AcpxAdapter(client);
      const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-terminal-failed-usage', 'codegenie', 'acpx'));

      const events = await collect(adapter.runTurn(binding, createTurnInput()));
      const failed = events.find((event) => event.type === 'turn.failed');

      expect(failed).toMatchObject({
        type: 'turn.failed',
        usage: {
          inputTokens: 17,
          outputTokens: 19,
          cacheReadInputTokens: 23,
          cacheCreationInputTokens: 29,
          thoughtTokens: 31,
          totalTokens: 119,
          missing: false,
          sourceStatus: 'reported',
        },
      });
    } finally {
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
      rmSync(aceHome, { recursive: true, force: true });
    }
  });

  test('recovers ACPX cumulative token usage from persisted cancelled terminal turns', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'ace-acpx-terminal-usage-'));
    const recordId = 'record-terminal-cancelled-usage';
    try {
      process.env.ACE_HOME = aceHome;
      const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
        cumulative_token_usage: {
          inputTokens: 11,
          outputTokens: 13,
          cachedReadTokens: 17,
          cachedWriteTokens: 19,
          totalTokens: 60,
        },
        cumulative_cost: {
          amount: 0.061,
          currency: 'USD',
        },
      }), 'utf8');

      const runtime = {
        ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
          sessionKey: input.sessionKey,
          backend: 'acpx',
          runtimeSessionName: input.sessionKey,
          cwd: process.cwd(),
          acpxRecordId: recordId,
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-terminal-cancelled-usage',
          events: eventStream([]),
          result: Promise.resolve({ status: 'cancelled', stopReason: 'cancelled' }),
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
      const adapter = new AcpxAdapter(client);
      const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-terminal-cancelled-usage', 'nga', 'acpx'));

      const events = await collect(adapter.runTurn(binding, createTurnInput()));
      const completed = events.find((event) => event.type === 'turn.completed');

      expect(completed).toMatchObject({
        type: 'turn.completed',
        usage: {
          inputTokens: 11,
          outputTokens: 13,
          cacheReadInputTokens: 17,
          cacheCreationInputTokens: 19,
          totalTokens: 60,
          missing: false,
          sourceStatus: 'reported',
        },
        cost: {
          amount: 0.061,
          currency: 'USD',
          missing: false,
          sourceStatus: 'reported',
        },
      });
    } finally {
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
      rmSync(aceHome, { recursive: true, force: true });
    }
  });

  test('acpx runtime client completes tool events when ACP omits the tool result', async () => {
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-tool-without-result',
        events: eventStream([{
          type: 'tool_call',
          toolCallId: 'tool-edit-1',
          title: 'Edit file',
          kind: 'edit',
          rawInput: { filePath: 'docs/dependency-analysis.md' },
        }]),
        result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-tool-fallback', 'codex', 'acpx'));

    const events = await collect(adapter.runTurn(binding, createTurnInput()));
    const completion = events.find((event) => event.type === 'tool.updated' && (event.payload as any)?.status === 'completed');

    expect(completion).toMatchObject({
      toolCallId: 'tool-edit-1',
      payload: expect.objectContaining({
        status: 'completed',
        rawOutput: expect.objectContaining({
          resultUnavailable: true,
        }),
      }),
    });
  });

  test('acpx runtime client completes an in-progress tool_call_update when ACP omits its result', async () => {
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-tool-update-without-result',
        events: eventStream([{
          type: 'tool_call_update',
          toolCallId: 'tool-command-update-1',
          status: 'in_progress',
          title: 'Run command',
          kind: 'powershell',
          rawInput: { command: "Get-Content 'src/jinja2/runtime.py'" },
        }]),
        result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-tool-update-fallback', 'codex', 'acpx'));

    const events = await collect(adapter.runTurn(binding, createTurnInput()));
    const completion = events.find((event) => event.type === 'tool.updated' && (event.payload as any)?.status === 'completed');

    expect(completion).toMatchObject({
      toolCallId: 'tool-command-update-1',
      payload: expect.objectContaining({
        rawInput: { command: "Get-Content 'src/jinja2/runtime.py'" },
        rawOutput: expect.objectContaining({ resultUnavailable: true }),
      }),
    });
    expect((completion?.payload as any)?.rawOutput).not.toHaveProperty('output');
  });

  test('closes an ACPX tool on an explicit empty terminal status without inventing output', async () => {
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-empty-native-terminal',
        events: eventStream([
          {
            type: 'tool_call_update',
            toolCallId: 'tool-empty-native-terminal-1',
            status: 'in_progress',
            title: 'Run command',
            kind: 'execute',
            rawInput: { command: 'Get-ChildItem' },
          },
          {
            type: 'tool_call_update',
            toolCallId: 'tool-empty-native-terminal-1',
            status: 'completed',
          },
        ]),
        result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-empty-native-terminal', 'codex', 'acpx'));

    const events = await collect(adapter.runTurn(binding, createTurnInput()));
    const terminalEvents = events.filter((event) => (
      event.type === 'tool.updated'
      && (event.payload as any)?.toolCallId === 'tool-empty-native-terminal-1'
      && (event.payload as any)?.status === 'completed'
    ));

    expect(terminalEvents).toHaveLength(1);
    expect(terminalEvents[0]).toMatchObject({
      toolCallId: 'tool-empty-native-terminal-1',
      payload: expect.objectContaining({ status: 'completed' }),
    });
    expect(terminalEvents[0]?.payload).not.toHaveProperty('rawOutput');
  });

  test('does not infer a terminal tool state from ACPX empty persisted placeholders', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'ace-acpx-empty-tool-placeholder-'));
    const recordId = 'record-empty-tool-placeholder';
    let releaseEvents: (() => void) | undefined;
    let resolveResult: ((value: { status: 'completed'; stopReason: string }) => void) | undefined;
    try {
      process.env.ACE_HOME = aceHome;
      const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
        tool_results: {
          'tool-empty-placeholder-1': {
            content: { Text: '' },
          },
        },
      }), 'utf8');

      const nativeEvents = (async function* (): AsyncGenerator<Record<string, unknown>> {
        yield {
          type: 'tool_call_update',
          toolCallId: 'tool-empty-placeholder-1',
          status: 'in_progress',
          title: 'Run command',
          kind: 'execute',
          rawInput: { command: 'Get-ChildItem' },
        };
        await new Promise<void>((resolve) => {
          releaseEvents = resolve;
        });
      })();
      const result = new Promise<{ status: 'completed'; stopReason: string }>((resolve) => {
        resolveResult = resolve;
      });
      const runtime = {
        ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
          sessionKey: input.sessionKey,
          backend: 'acpx',
          runtimeSessionName: input.sessionKey,
          acpxRecordId: recordId,
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-empty-tool-placeholder',
          events: nativeEvents,
          result,
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
      const adapter = new AcpxAdapter(client);
      const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-empty-tool-placeholder', 'codex', 'acpx'));
      const iterator = adapter.runTurn(binding, createTurnInput())[Symbol.asyncIterator]();

      await iterator.next();
      const running = await iterator.next();
      expect(running.value).toMatchObject({
        type: 'tool.updated',
        toolCallId: 'tool-empty-placeholder-1',
        payload: expect.objectContaining({ status: 'in_progress' }),
      });

      const terminal = iterator.next();
      let terminalArrived = false;
      void terminal.then(() => { terminalArrived = true; });
      await new Promise((resolve) => setTimeout(resolve, 320));
      expect(terminalArrived).toBe(false);

      releaseEvents?.();
      resolveResult?.({ status: 'completed', stopReason: 'end_turn' });
      const completed = await terminal;
      expect(completed.value).toMatchObject({
        type: 'tool.updated',
        toolCallId: 'tool-empty-placeholder-1',
        payload: expect.objectContaining({
          status: 'completed',
          rawOutput: { completed: true, resultUnavailable: true },
        }),
      });
      expect((completed.value as any)?.payload?.rawOutput).not.toHaveProperty('output');
    } finally {
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
      rmSync(aceHome, { recursive: true, force: true });
    }
  });

  test('closes unresolved ACPX tools as failed when the turn is cancelled', async () => {
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-cancelled-tool',
        events: eventStream([{
          type: 'tool_call_update',
          toolCallId: 'tool-cancelled-1',
          status: 'in_progress',
          title: 'Run command',
          kind: 'execute',
          rawInput: { command: 'Get-ChildItem' },
        }]),
        result: Promise.resolve({ status: 'cancelled', stopReason: 'cancelled' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-cancelled-tool', 'codex', 'acpx'));

    const events = await collect(adapter.runTurn(binding, createTurnInput()));
    const terminal = events.find((event) => (
      event.type === 'tool.updated'
      && (event.payload as any)?.toolCallId === 'tool-cancelled-1'
      && (event.payload as any)?.status === 'failed'
    ));

    expect(terminal).toMatchObject({
      toolCallId: 'tool-cancelled-1',
      payload: expect.objectContaining({
        status: 'failed',
        rawOutput: expect.objectContaining({ cancelled: true, resultUnavailable: true }),
      }),
    });
    expect((terminal?.payload as any)?.rawOutput).not.toHaveProperty('output');
  });

  test('recovers persisted ACPX tool results after an empty completed update', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'ace-acpx-tool-result-'));
    const recordId = 'record-persisted-tool-result';
    try {
      process.env.ACE_HOME = aceHome;
      const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
        tool_results: {
          'tool-search-result-1': {
            output: {
              formatted_output: 'src/jinja2/exceptions.py:58:class TemplateRuntimeError(TemplateError):',
              exit_code: 0,
            },
          },
        },
      }), 'utf8');

      const runtime = {
        ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
          sessionKey: input.sessionKey,
          backend: 'acpx',
          runtimeSessionName: input.sessionKey,
          acpxRecordId: recordId,
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-persisted-tool-result',
          events: eventStream([
            {
              type: 'tool_call_update',
              toolCallId: 'tool-search-result-1',
              status: 'in_progress',
              title: 'Search source',
              kind: 'execute',
              rawInput: { command: 'rg -n "TemplateRuntimeError" src' },
            },
            {
              type: 'tool_call_update',
              toolCallId: 'tool-search-result-1',
              status: 'completed',
              title: 'tool call',
              kind: 'execute',
              exit_code: 0,
            },
          ]),
          result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
      const adapter = new AcpxAdapter(client);
      const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-persisted-tool-result', 'codex', 'acpx'));

      const events = await collect(adapter.runTurn(binding, createTurnInput()));
      const recovered = events.find((event) => (
        event.type === 'tool.updated'
        && (event.payload as any)?.rawOutput?.output === 'src/jinja2/exceptions.py:58:class TemplateRuntimeError(TemplateError):'
      ));

      expect(recovered).toMatchObject({
        toolCallId: 'tool-search-result-1',
        payload: expect.objectContaining({
          rawOutput: expect.objectContaining({
            output: 'src/jinja2/exceptions.py:58:class TemplateRuntimeError(TemplateError):',
            exitCode: 0,
          }),
        }),
      });
    } finally {
      rmSync(aceHome, { recursive: true, force: true });
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
    }
  });

  test('canonicalizes opaque ACPX orchestration calls from persisted ToolUse metadata across lifecycle updates', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'ace-acpx-orchestration-tools-'));
    const recordId = 'record-opaque-orchestration-tools';
    try {
      process.env.ACE_HOME = aceHome;
      const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
        messages: [{
          Agent: {
            content: [
              {
                ToolUse: {
                  id: 'exec-spawn-agent-1',
                  name: 'spawnAgent',
                  raw_input: '{"prompt":"check dependency graph","receiverThreadIds":["child-1"],"agentsStates":{"child-1":{"status":"pendingInit"}},"model":"gpt-5.6-luna","reasoningEffort":"high"}',
                  input: {
                    prompt: 'check dependency graph',
                    receiverThreadIds: ['child-1'],
                    agentsStates: { 'child-1': { status: 'pendingInit' } },
                    model: 'gpt-5.6-luna',
                    reasoningEffort: 'high',
                  },
                },
              },
              {
                ToolUse: {
                  id: 'exec-wait-agent-1',
                  name: 'wait',
                  raw_input: '{"receiverThreadIds":["child-1"],"agentsStates":{"child-1":{"status":"running"}}}',
                },
              },
            ],
          },
        }],
      }), 'utf8');

      const runtime = {
        ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
          sessionKey: input.sessionKey,
          backend: 'acpx',
          runtimeSessionName: input.sessionKey,
          acpxRecordId: recordId,
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-opaque-orchestration-tools',
          events: eventStream([
            {
              type: 'tool_call',
              id: 'exec-spawn-agent-1',
              toolName: 'other',
              title: 'other',
              kind: 'other',
              status: 'in_progress',
            },
            {
              type: 'tool_call_update',
              data: { tool_call_id: 'exec-spawn-agent-1' },
              toolName: 'other',
              title: 'other',
              kind: 'other',
              status: 'completed',
            },
            {
              type: 'tool_call',
              payload: { id: 'exec-wait-agent-1' },
              toolName: 'other',
              title: 'other',
              kind: 'other',
              status: 'in_progress',
            },
          ] as any),
          result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
      const adapter = new AcpxAdapter(client);
      const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-opaque-orchestration-tools', 'codex', 'acpx'));

      const events = await collect(adapter.runTurn(binding, createTurnInput()));
      const spawnLifecycle = events.filter((event) => (event.payload as any)?.toolCallId === 'exec-spawn-agent-1');
      const waitLifecycle = events.filter((event) => (event.payload as any)?.toolCallId === 'exec-wait-agent-1');

      expect(spawnLifecycle).toHaveLength(2);
      expect(spawnLifecycle).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolCallId: 'exec-spawn-agent-1',
          payload: expect.objectContaining({
            name: 'subagent-dispatch',
            toolName: 'subagent-dispatch',
            rawInput: expect.objectContaining({
              receiverThreadIds: ['child-1'],
              model: 'gpt-5.6-luna',
              reasoningEffort: 'high',
            }),
          }),
        }),
      ]));
      expect(spawnLifecycle.map((event) => (event.payload as any)?.toolName)).toEqual([
        'subagent-dispatch',
        'subagent-dispatch',
      ]);
      expect(waitLifecycle).toEqual(expect.arrayContaining([
        expect.objectContaining({
          toolCallId: 'exec-wait-agent-1',
          payload: expect.objectContaining({
            name: 'subagent-wait',
            toolName: 'subagent-wait',
            rawInput: expect.objectContaining({ receiverThreadIds: ['child-1'] }),
          }),
        }),
      ]));
    } finally {
      rmSync(aceHome, { recursive: true, force: true });
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
    }
  });

  test('does not append a fallback after an error-only terminal update', async () => {
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-error-only-tool-update',
        events: eventStream([
          {
            type: 'tool_call_update',
            toolCallId: 'tool-error-only-1',
            status: 'in_progress',
            title: 'Run command',
            kind: 'execute',
            rawInput: { command: 'missing-command' },
          },
          {
            type: 'tool_call_update',
            toolCallId: 'tool-error-only-1',
            status: 'failed',
            error: { message: 'command not found' },
          },
        ]),
        result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-error-only-tool-update', 'codex', 'acpx'));

    const events = await collect(adapter.runTurn(binding, createTurnInput()));
    const completions = events.filter((event) => (
      event.type === 'tool.updated'
      && (event.payload as any)?.toolCallId === 'tool-error-only-1'
      && ['failed', 'completed'].includes((event.payload as any)?.status)
    ));

    expect(completions).toHaveLength(1);
    expect(completions[0]).toMatchObject({
      toolCallId: 'tool-error-only-1',
      payload: expect.objectContaining({
        status: 'failed',
      }),
      error: expect.objectContaining({ message: 'command not found' }),
    });
  });

  test('recovers persisted failed ACPX tool results after an empty terminal update', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'ace-acpx-failed-tool-result-'));
    const recordId = 'record-persisted-failed-tool-result';
    try {
      process.env.ACE_HOME = aceHome;
      const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
      mkdirSync(sessionsDir, { recursive: true });
      writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
        tool_results: {
          'tool-command-failed-1': {
            is_error: true,
            output: 'command not found',
            exit_code: 127,
          },
        },
      }), 'utf8');

      const runtime = {
        ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
          sessionKey: input.sessionKey,
          backend: 'acpx',
          runtimeSessionName: input.sessionKey,
          acpxRecordId: recordId,
        })),
        startTurn: vi.fn((): AcpRuntimeTurn => ({
          requestId: 'request-persisted-failed-tool-result',
          events: eventStream([
            {
              type: 'tool_call_update',
              toolCallId: 'tool-command-failed-1',
              status: 'in_progress',
              title: 'Run command',
              kind: 'execute',
              rawInput: { command: 'missing-command' },
            },
            {
              type: 'tool_call_update',
              toolCallId: 'tool-command-failed-1',
              status: 'completed',
              title: 'tool call',
              kind: 'execute',
            },
          ]),
          result: Promise.resolve({
            status: 'failed',
            error: { message: 'tool execution failed', code: 'TOOL_FAILED' },
          }),
          cancel: vi.fn(async () => undefined),
          closeStream: vi.fn(async () => undefined),
        })),
        cancel: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
      } satisfies AcpRuntime;
      const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
      const adapter = new AcpxAdapter(client);
      const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-persisted-failed-tool-result', 'codex', 'acpx'));

      const events = await collect(adapter.runTurn(binding, createTurnInput()));
      const recovered = events.find((event) => (
        event.type === 'tool.updated'
        && (event.payload as any)?.rawOutput?.output === 'command not found'
      ));

      expect(recovered).toMatchObject({
        toolCallId: 'tool-command-failed-1',
        payload: expect.objectContaining({
          status: 'failed',
          rawOutput: expect.objectContaining({
            output: 'command not found',
            exitCode: 127,
          }),
        }),
      });
      expect(events.at(-1)).toMatchObject({
        type: 'turn.failed',
        error: expect.objectContaining({
          code: 'ADAPTER_FAILED',
          cause: expect.objectContaining({ code: 'TOOL_FAILED' }),
        }),
      });
    } finally {
      rmSync(aceHome, { recursive: true, force: true });
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
    }
  });

  test('closes the acpx runtime after normal completion and consumer disconnect', async () => {
    const completedClose = vi.fn(async () => undefined);
    const completedRuntime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
        acpxRecordId: 'record-completed',
        backendSessionId: 'backend-completed',
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-completed',
        events: eventStream([{ type: 'message_delta', payload: { text: 'done' } }]),
        result: Promise.resolve({ status: 'completed', stopReason: 'end_turn' }),
        cancel: vi.fn(async () => undefined),
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close: completedClose,
    } satisfies AcpRuntime;
    const completedClient = createAcpxRuntimeClient({ runtime: completedRuntime });
    const completedAdapter = new AcpxAdapter(completedClient);
    const completedBinding = await completedAdapter.createOrLoadSession(createSessionInput('runtime-session-completed', 'codex', 'acpx'));

    await collect(completedClient.runTurn!(completedBinding, createTurnInput()));

    expect(completedClose).toHaveBeenCalledTimes(1);
    expect(completedClose).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'aceharness-runtime-turn-complete',
      discardPersistentState: false,
    }));

    await collect(completedClient.runTurn!(completedBinding, createTurnInput()));
    expect(completedRuntime.startTurn).toHaveBeenCalledTimes(2);
    expect(completedClose).toHaveBeenCalledTimes(2);

    const detachedClose = vi.fn(async () => undefined);
    const detachedCancel = vi.fn(async () => undefined);
    const detachedCloseStream = vi.fn(async () => undefined);
    const detachedRuntime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
        acpxRecordId: 'record-detached',
        backendSessionId: 'backend-detached',
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-detached',
        events: eventStream([{ type: 'message_delta', payload: { text: 'partial' } }]),
        result: new Promise(() => {}),
        cancel: detachedCancel,
        closeStream: detachedCloseStream,
      })),
      cancel: vi.fn(async () => undefined),
      close: detachedClose,
    } satisfies AcpRuntime;
    const detachedClient = createAcpxRuntimeClient({ runtime: detachedRuntime, cleanupTimeoutMs: 20 });
    const detachedAdapter = new AcpxAdapter(detachedClient);
    const detachedBinding = await detachedAdapter.createOrLoadSession(createSessionInput('runtime-session-detached', 'codex', 'acpx'));
    const iterator = detachedClient.runTurn!(detachedBinding, createTurnInput())[Symbol.asyncIterator]();

    await iterator.next();
    await iterator.return?.();

    expect(detachedCancel).toHaveBeenCalledWith({ reason: 'acpx turn consumer detached or failed' });
    expect(detachedCloseStream).toHaveBeenCalledWith({ reason: 'acpx turn consumer detached or failed' });
    expect(detachedClose).toHaveBeenCalledTimes(1);
    expect(detachedClose).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'aceharness-runtime-turn-aborted',
      discardPersistentState: false,
    }));
  });

  test('closes the acpx runtime when startTurn throws', async () => {
    const close = vi.fn(async () => undefined);
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
        acpxRecordId: 'record-start-failed',
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => {
        throw new Error('startTurn failed');
      }),
      cancel: vi.fn(async () => undefined),
      close,
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-start-failed', 'codex', 'acpx'));

    await expect(collect(client.runTurn!(binding, createTurnInput()))).rejects.toThrow('startTurn failed');
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'aceharness-runtime-start-failed',
    }));
  });

  test('does not close an active ACPX turn during cancellation before terminal usage is emitted', async () => {
    let releaseTerminal: (() => void) | undefined;
    let statusCallCount = 0;
    const turnCancel = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
        acpxRecordId: 'record-active-cancel-usage',
      })),
      startTurn: vi.fn((): AcpRuntimeTurn => ({
        requestId: 'request-active-cancel-usage',
        events: (async function* () {
          yield { type: 'message_delta', payload: { text: 'started' } };
          await new Promise<void>((resolve) => {
            releaseTerminal = resolve;
          });
        })(),
        result: Promise.resolve({ status: 'cancelled', stopReason: 'cancelled' }),
        cancel: turnCancel,
        closeStream: vi.fn(async () => undefined),
      })),
      cancel: vi.fn(async () => undefined),
      close,
      getStatus: vi.fn(async () => {
        statusCallCount += 1;
        return {
          usage: {
            cumulative: statusCallCount === 1
              ? { inputTokens: 0, outputTokens: 0 }
              : { inputTokens: 37, outputTokens: 41 },
          },
        };
      }),
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, loadConfiguredEnv: async () => ({}) });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-active-cancel-usage', 'codegenie', 'acpx'));
    const eventsPromise = collect(adapter.runTurn(binding, createTurnInput()));

    await vi.waitFor(() => expect(runtime.startTurn).toHaveBeenCalledTimes(1));
    await adapter.cancel(binding, {
      turnId: 'turn-1',
      requestId: 'cancel-active-usage',
      reason: 'test active cancel',
    });
    expect(turnCancel).toHaveBeenCalledWith({ reason: 'test active cancel' });
    expect(close).not.toHaveBeenCalled();

    releaseTerminal?.();
    const events = await eventsPromise;

    expect(events.at(-1)).toMatchObject({
      type: 'turn.completed',
      usage: {
        inputTokens: 37,
        outputTokens: 41,
      },
    });
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'aceharness-runtime-turn-complete',
      discardPersistentState: false,
    }));
  });

  test('closes a persistent acpx session when cancel succeeds without an active turn', async () => {
    const cancel = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
        acpxRecordId: 'record-idle-cancel',
      })),
      startTurn: vi.fn(),
      cancel,
      close,
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, sessionMode: 'persistent' });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-idle-cancel', 'codex', 'acpx'));

    await adapter.cancel(binding, {
      turnId: 'turn-not-active',
      requestId: 'cancel-idle',
      reason: 'user cancel',
    });

    expect(cancel).toHaveBeenCalledWith({
      handle: expect.objectContaining({ acpxRecordId: 'record-idle-cancel' }),
      reason: 'user cancel',
    });
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'aceharness-runtime-cancel',
      discardPersistentState: false,
    }));
  });

  test('closes after cancel failure while preserving the native cancellation error', async () => {
    const cancel = vi.fn(async () => {
      throw new Error('native cancel failed');
    });
    const close = vi.fn(async () => undefined);
    const runtime = {
      ensureSession: vi.fn(async (input: AcpRuntimeEnsureInput) => ({
        sessionKey: input.sessionKey,
        backend: 'acpx',
        runtimeSessionName: input.sessionKey,
        acpxRecordId: 'record-cancel-failed',
      })),
      startTurn: vi.fn(),
      cancel,
      close,
    } satisfies AcpRuntime;
    const client = createAcpxRuntimeClient({ runtime, sessionMode: 'persistent' });
    const adapter = new AcpxAdapter(client);
    const binding = await adapter.createOrLoadSession(createSessionInput('runtime-session-cancel-failed', 'codex', 'acpx'));

    await expect(adapter.cancel(binding, {
      turnId: 'turn-not-active',
      requestId: 'cancel-failed',
      reason: 'user cancel',
    })).rejects.toThrow('native cancel failed');

    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(expect.objectContaining({
      reason: 'aceharness-runtime-cancel-failed',
      discardPersistentState: false,
    }));
  });

  test('routes cangjie-magic to MagicAdapter and other agents to AcpxAdapter', () => {
    const registry = createRuntimeAdapterRegistry();

    expect(resolveRuntimeForAgent('cangjie-magic')).toBe('magic');
    expect(resolveRuntimeForAgent('nga')).toBe('acpx');
    expect(resolveRuntimeForAgent('custom-agent')).toBe('acpx');
    expect(registry.getAdapterForAgent('cangjie-magic')).toBeInstanceOf(MagicAdapter);
    expect(registry.getAdapterForAgent('codegenie')).toBeInstanceOf(AcpxAdapter);
  });

  test('skeleton adapters yield unavailable failure when no runtime client is configured', async () => {
    const acpx = new AcpxAdapter();
    const magic = new MagicAdapter();
    const acpxEvents = await collect(acpx.runTurn(await acpx.createOrLoadSession(createSessionInput('s1', 'codex', 'acpx')), createTurnInput()));
    const magicEvents = await collect(
      magic.runTurn(await magic.createOrLoadSession(createSessionInput('s2', 'cangjie-magic', 'magic')), createTurnInput()),
    );

    expect(acpxEvents.map((event) => event.type)).toEqual(['turn.started', 'turn.failed']);
    expect(magicEvents.map((event) => event.type)).toEqual(['turn.started', 'turn.failed']);
    expect(acpxEvents[1]?.error?.code).toBe('ADAPTER_UNAVAILABLE');
    expect(magicEvents[1]?.error?.code).toBe('ADAPTER_UNAVAILABLE');
  });

  test('magic adapter executes client run, cancel, status, and close with redacted canonical events', async () => {
    const cancel = vi.fn(async () => undefined);
    const close = vi.fn(async () => undefined);
    const getStatus = vi.fn(async () => ({
      status: 'running',
      activeTurnId: 'turn-1',
      metadata: {
        providerSessionId: 'provider-private',
        visible: 'ok',
      },
    }));
    const magic = new MagicAdapter({
      async createOrLoadSession() {
        return {
          externalIds: {
            providerSessionId: 'provider-private',
          },
          raw: {
            magicSessionId: 'magic-private',
          },
        };
      },
      async *runTurn() {
        yield {
          type: 'assistant_delta',
          payload: {
            text: 'magic',
            providerSessionId: 'provider-private',
          },
        };
        yield {
          type: 'error',
          message: 'redacted failure',
          code: 'MAGIC_BUSY',
          retryable: true,
          providerSessionId: 'provider-private',
        };
      },
      cancel,
      close,
      getStatus,
    });
    const binding = await magic.createOrLoadSession(createSessionInput('magic-session-1', 'cangjie-magic', 'magic'));
    const events = await collect(magic.runTurn(binding, createTurnInput()));
    const status = await magic.getStatus(binding);

    await magic.cancel(binding, { turnId: 'turn-1', requestId: 'cancel-1', reason: 'test' });
    await magic.close(binding);

    expect(events.map((event) => event.type)).toEqual(['turn.started', 'message.delta', 'turn.failed']);
    expect(events[1]?.payload).toEqual({ text: 'magic' });
    expect(events[2]?.error).toMatchObject({
      code: 'ADAPTER_FAILED',
      retryable: true,
      redacted: true,
      cause: {
        code: 'MAGIC_BUSY',
      },
    });
    expect(JSON.stringify(events.map(({ payload, error }) => ({ payload, error })))).not.toContain('provider-private');
    expect(status).toMatchObject({
      runtime: 'magic',
      status: 'running',
      activeTurnId: 'turn-1',
      metadata: {
        visible: 'ok',
      },
    });
    expect(cancel).toHaveBeenCalledWith(binding, {
      turnId: 'turn-1',
      requestId: 'cancel-1',
      reason: 'test',
    });
    expect(close).toHaveBeenCalledWith(binding);
  });

  test('magic adapter closes the runtime when the native stream crashes', async () => {
    const close = vi.fn(async () => undefined);
    const magic = new MagicAdapter({
      async *runTurn() {
        yield { type: 'assistant_delta', payload: { text: 'partial' } };
        throw new Error('native stream failed');
      },
      close,
    });
    const binding = await magic.createOrLoadSession(createSessionInput('magic-session-crash', 'cangjie-magic', 'magic'));

    const iterator = magic.runTurn(binding, createTurnInput())[Symbol.asyncIterator]();
    await iterator.next();
    await iterator.next();
    await expect(iterator.next()).rejects.toThrow('native stream failed');
    expect(close).toHaveBeenCalledWith(binding);
  });

  test('cancel fails explicitly when adapter client cannot cancel a running native turn', async () => {
    const acpx = new AcpxAdapter();
    const magic = new MagicAdapter();

    await expect(acpx.cancel(await acpx.createOrLoadSession(createSessionInput('s3', 'codex', 'acpx')), {
      turnId: 'turn-1',
      requestId: 'cancel-1',
    })).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
      retryable: true,
      redacted: true,
    });

    await expect(magic.cancel(await magic.createOrLoadSession(createSessionInput('s4', 'cangjie-magic', 'magic')), {
      turnId: 'turn-1',
      requestId: 'cancel-1',
    })).rejects.toMatchObject({
      code: 'ADAPTER_UNAVAILABLE',
      retryable: true,
      redacted: true,
    });
  });

  test('runtime adapters do not import preRuntime engines', () => {
    const adapterFiles = listFiles(join(process.cwd(), 'src', 'lib', 'runtime-agent', 'adapters'))
      .filter((file) => file.endsWith('.ts'));

    expect(adapterFiles.length).toBeGreaterThan(0);
    for (const file of adapterFiles) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/['"](?:@\/lib\/engines|(?:\.\.\/)+engines|.*\/lib\/engines)/);
    }
  });
});

function canResolve(packageName: string): boolean {
  try {
    requireFromProject.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

function createSessionInput(
  runtimeSessionId: string,
  agentId: string,
  runtime: 'acpx' | 'magic',
  permissionPolicyId: RuntimePermissionPolicyId = 'unrestricted',
  ownerUserId?: string,
): AdapterSessionInput {
  const profileSnapshot: RuntimeProfileSnapshot = {
    agentId,
    ownerUserId,
    modelRouteId: `route-${agentId}`,
    cwd: process.cwd(),
    systemPromptHash: 'sha256:test',
    skillsRevision: 'skills-test',
    mcpRevision: 'mcp-test',
    permissionPolicyId,
    interruptPolicy: 'queue',
  };
  const modelRoute: ResolvedModelRoute = {
    modelRouteId: profileSnapshot.modelRouteId,
    agentId,
    runtime,
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

  return {
    runtimeSessionId,
    agentId,
    modelRoute,
    profileSnapshot,
  };
}

function createTurnInput(): AdapterTurnInput {
  return {
    turnId: 'turn-1',
    requestId: 'request-1',
    traceId: 'trace-1',
    input: 'hello',
    interruptPolicy: 'queue',
    profileSnapshot: {
      agentId: 'codex',
      modelRouteId: 'route-codex',
      cwd: process.cwd(),
      systemPromptHash: 'sha256:test',
      skillsRevision: 'skills-test',
      mcpRevision: 'mcp-test',
      permissionPolicyId: 'unrestricted',
      interruptPolicy: 'queue',
    },
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

async function* eventStream<T>(events: T[]): AsyncIterable<T> {
  for (const event of events) yield event;
}

function listFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...listFiles(path));
    } else {
      files.push(path);
    }
  }
  return files;
}
