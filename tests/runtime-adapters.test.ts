import { createRequire } from 'node:module';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import projectPackageJson from '../package.json';
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
    // Inspection for Task 6 phase 1:
    // acpx@0.12.0 is installed and package.json exports real runtime and flow
    // entrypoints. This adapter remains an injectable wrapper until ACEHarness
    // wires AcpRuntime construction and session stores deliberately.
    expect(projectPackageJson.dependencies.acpx).toBe('^0.12.0');

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
      delete process.env.ACE_ACPX_DEBUG_TRACE;

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
        payload: { direct: true },
      });
      expect(existsSync(onTraceFile)).toBe(true);
      rmSync(onTraceFile, { force: true });

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

      const lines = readFileSync(onTraceFile, 'utf8')
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
    const client = createAcpxRuntimeClient({ runtime });
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
      mode: 'persistent',
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

  test('acpx runtime client preserves codex advertised bracket model names', async () => {
    const ensureSession = vi.fn(async () => ({
      sessionKey: 'runtime-session-codex',
      backend: 'acpx',
      runtimeSessionName: 'runtime-session-codex',
      cwd: process.cwd(),
    }));
    const runtime = {
      ensureSession,
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
    const client = createAcpxRuntimeClient({ runtime });
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
        model: 'gpt-5.5[low]',
      },
    }));
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

    expect(calls).toEqual(['createAcpRuntime', 'ensureSession', 'startTurn', 'cancel', 'close']);
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
      reason: 'aceharness-runtime-close',
      discardPersistentState: false,
    });
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
): AdapterSessionInput {
  const profileSnapshot: RuntimeProfileSnapshot = {
    agentId,
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
