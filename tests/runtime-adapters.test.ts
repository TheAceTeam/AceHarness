import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { createRuntimeAdapterRegistry, resolveRuntimeForAgent } from '@/lib/runtime-agent/adapters/adapter-registry';
import { AcpxAdapter, normalizeAcpxRuntimeEvent, resolveAcpxCommand } from '@/lib/runtime-agent/adapters/acpx-adapter';
import { MagicAdapter, normalizeMagicRuntimeEvent } from '@/lib/runtime-agent/adapters/magic-adapter';
import type {
  AdapterSessionInput,
  AdapterTurnInput,
  ResolvedModelRoute,
  RuntimeProfileSnapshot,
} from '@/lib/runtime-agent/contracts';

const requireFromProject = createRequire(`${process.cwd()}/package.json`);

describe('runtime adapters', () => {
  test('documents current acpx package exports and public runtime APIs', async () => {
    // Inspection for Task 6 phase 1:
    // acpx@0.12.0 is installed and package.json exports real runtime and flow
    // entrypoints. This adapter remains an injectable wrapper until ACEHarness
    // wires AcpRuntime construction and session stores deliberately.
    expect(canResolve('acpx')).toBe(true);
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
});

function canResolve(packageName: string): boolean {
  try {
    requireFromProject.resolve(packageName);
    return true;
  } catch {
    return false;
  }
}

function createSessionInput(runtimeSessionId: string, agentId: string, runtime: 'acpx' | 'magic'): AdapterSessionInput {
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
