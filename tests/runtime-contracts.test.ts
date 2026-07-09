import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { defaultPermissionPolicy } from '../src/lib/runtime-agent';
import type {
  AdapterRuntimeEvent,
  RuntimeAdapter,
  RuntimeEvent,
  RuntimePermissionRequest,
  RuntimeProfileSnapshot,
  TokenUsage,
} from '../src/lib/runtime-agent';

const projectRoot = resolve(__dirname, '..');

type ExpectTrue<T extends true> = T;
type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

type RuntimeEventEnvelopeAssertions = [
  ExpectTrue<HasKey<RuntimeEvent, 'traceId'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'seq'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'correlationId'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'parentEventId'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'messageId'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'toolCallId'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'payload'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'redacted'>>,
  ExpectTrue<HasKey<RuntimeEvent, 'createdAt'>>,
];

type RuntimeAdapterOptionalMethodAssertions = [
  ExpectTrue<undefined extends RuntimeAdapter['invokeCommand'] ? true : false>,
  ExpectTrue<undefined extends RuntimeAdapter['compact'] ? true : false>,
  ExpectTrue<undefined extends RuntimeAdapter['fork'] ? true : false>,
  ExpectTrue<undefined extends RuntimeAdapter['handoff'] ? true : false>,
];

const _runtimeEventEnvelopeAssertions: RuntimeEventEnvelopeAssertions = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

const _runtimeAdapterOptionalMethodAssertions: RuntimeAdapterOptionalMethodAssertions = [
  true,
  true,
  true,
  true,
];

void _runtimeEventEnvelopeAssertions;
void _runtimeAdapterOptionalMethodAssertions;

describe('runtime contracts', () => {
  test('runtime event envelope exposes trace and projection correlation fields', () => {
    const event = {
      id: 'event-1',
      sessionId: 'runtime-session-1',
      turnId: 'turn-1',
      traceId: 'trace-1',
      seq: 1,
      type: 'tool.started',
      correlationId: 'corr-1',
      parentEventId: 'event-0',
      messageId: 'message-1',
      toolCallId: 'tool-1',
      payload: { name: 'read-file' },
      redacted: false,
      createdAt: '2026-07-09T00:00:00.000Z',
    } satisfies RuntimeEvent<{ name: string }>;

    expect(event.traceId).toBe('trace-1');
    expect(event.seq).toBe(1);
    expect(event.payload.name).toBe('read-file');
  });

  test('adapter events are separate from persisted runtime events', () => {
    const adapterEvent = {
      type: 'usage.updated',
      payload: { phase: 'stream' },
      usage: { inputTokens: 12, missing: false },
      cost: { estimated: true, missing: true, sourceStatus: 'missing' },
      correlationId: 'corr-usage',
      redacted: true,
      raw: { provider: 'adapter-private' },
    } satisfies AdapterRuntimeEvent<{ phase: string }>;

    expect(adapterEvent.usage?.inputTokens).toBe(12);
    expect(adapterEvent.cost?.missing).toBe(true);
  });

  test('adapter command, compact, fork, and handoff hooks are optional', () => {
    const adapter: RuntimeAdapter = {
      async createOrLoadSession() {
        return {
          id: 'binding-1',
          runtimeSessionId: 'runtime-session-1',
          runtime: 'acpx',
          role: 'primary',
          generation: 1,
          externalIds: {},
          raw: {},
          createdAt: '2026-07-09T00:00:00.000Z',
          updatedAt: '2026-07-09T00:00:00.000Z',
        };
      },
      async *runTurn() {
        yield {
          type: 'turn.started',
          payload: {},
          redacted: false,
        };
      },
      async cancel() {},
      async close() {},
      async getCapabilities() {
        return {
          streaming: true,
          cancel: true,
          commands: false,
          compact: false,
          fork: false,
          handoff: false,
          permissions: true,
          toolCalls: true,
          usage: 'missing',
        };
      },
      async getStatus() {
        return {
          runtime: 'acpx',
          status: 'idle',
        };
      },
    };

    expect(adapter.invokeCommand).toBeUndefined();
    expect(adapter.compact).toBeUndefined();
    expect(adapter.fork).toBeUndefined();
    expect(adapter.handoff).toBeUndefined();
  });

  test('profiles, usage, and permission DTOs use runtime names instead of engine names', () => {
    const profile = {
      agentId: 'codex',
      modelRouteId: 'route-codex-gpt-5',
      cwd: '/workspace',
      systemPromptHash: 'sha256:abc',
      skillsRevision: 'skills-1',
      mcpRevision: 'mcp-1',
      permissionPolicyId: defaultPermissionPolicy,
      interruptPolicy: 'queue',
    } satisfies RuntimeProfileSnapshot;

    const usage = {
      missing: true,
      sourceStatus: 'missing',
    } satisfies TokenUsage;

    const permission = {
      id: 'permission-1',
      sessionId: 'runtime-session-1',
      turnId: 'turn-1',
      agentId: 'codex',
      operation: 'execute',
      proposedCommand: 'npm test',
      risk: 'medium',
      raw: { adapter: 'redact before diagnostics export' },
    } satisfies RuntimePermissionRequest;

    expect(profile.permissionPolicyId).toBe('unrestricted');
    expect(usage.missing).toBe(true);
    expect(permission.operation).toBe('execute');
  });

  test('runtime-agent boundary does not import legacy engines', async () => {
    const files = [
      'src/lib/runtime-agent/contracts.ts',
      'src/lib/runtime-agent/index.ts',
    ];

    for (const file of files) {
      const source = await readFile(resolve(projectRoot, file), 'utf8');
      expect(source, `${file} must not import src/lib/engines`).not.toMatch(/from\s+['"].*(?:@\/lib\/engines|src\/lib\/engines|\.\.\/engines)/);
      expect(source, `${file} must not import src/lib/engines`).not.toMatch(/import\s*\(\s*['"].*(?:@\/lib\/engines|src\/lib\/engines|\.\.\/engines)/);
    }
  });
});
