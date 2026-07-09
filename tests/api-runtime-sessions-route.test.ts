import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RuntimeEvent } from '@/lib/runtime-agent/contracts';
import type { CreateRuntimeTurnResult, RuntimeSessionsApiService } from '@/server/runtime/runtime-sessions-api-service';
import {
  createSqliteRuntimeSessionsApiService,
  resetRuntimeSessionsApiServiceForTesting,
  setRuntimeSessionsApiServiceForTesting,
} from '@/server/runtime/runtime-sessions-api-service';
import { resetRuntimeStreamHeartbeatMsForTesting, setRuntimeStreamHeartbeatMsForTesting } from '@/server/api-routes/runtime-sessions/_shared';
import { openRuntimeSqliteDatabase, type RuntimeSqliteDatabase } from '@/lib/runtime-agent/sqlite/database';
import { upsertModelCatalogEntry, upsertModelProvider, upsertModelRoute } from '@/lib/runtime-agent/models/model-routes';
import { makeRequest, responseJson } from './helpers/route-helpers';

const routeMocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  createAcpxRuntimeClient: vi.fn(),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAuth: routeMocks.requireAuth,
}));

vi.mock('@/lib/runtime-agent/adapters/acpx-runtime-client', () => ({
  createAcpxRuntimeClient: routeMocks.createAcpxRuntimeClient,
}));

function idParams<T extends Record<string, string>>(params: T) {
  return { params };
}

function makeEvent(seq: number, payload: Record<string, unknown> = {}): RuntimeEvent {
  return {
    id: `event-${seq}`,
    sessionId: 'runtime-session-1',
    turnId: 'turn-1',
    traceId: 'trace-1',
    seq,
    type: seq >= 3 ? 'turn.completed' : 'message.delta',
    payload,
    redacted: false,
    createdAt: '2026-07-09T00:00:00.000Z',
  };
}

async function* eventStream(events: RuntimeEvent[]) {
  for (const event of events) yield event;
}

async function* delayedEventStream(delayMs: number, events: RuntimeEvent[]) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  for (const event of events) yield event;
}

async function* throwingEventStream(error: Error & { code?: string; retryable?: boolean }) {
  yield makeEvent(1, { text: 'before error' });
  throw error;
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 1000;
  let value = read();
  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    value = read();
  }
  return value;
}

function decodeChunk(chunk: Uint8Array | undefined): string {
  return new TextDecoder().decode(chunk);
}

function makeRuntimeDb(): RuntimeSqliteDatabase {
  const db = openRuntimeSqliteDatabase(':memory:');
  db.prepare('INSERT INTO permission_policies (id) VALUES (?)').run('unrestricted');
  upsertModelCatalogEntry(db, {
    id: 'test-model',
    displayName: 'Test Model',
    now: '2026-07-09T00:00:00.000Z',
  });
  upsertModelProvider(db, {
    id: 'test-provider',
    kind: 'custom',
    displayName: 'Test Provider',
    now: '2026-07-09T00:00:00.000Z',
  });
  upsertModelRoute(db, {
    id: 'route-codex',
    modelId: 'test-model',
    agentId: 'codex',
    providerId: 'test-provider',
    providerModel: 'test-model',
    isDefault: true,
    capabilities: { streaming: true, toolCalls: true, usage: 'missing' },
    now: '2026-07-09T00:00:00.000Z',
  });
  return db;
}

function makeImportedCodexGpt55LowRuntimeDb(): RuntimeSqliteDatabase {
  const db = openRuntimeSqliteDatabase(':memory:');
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
  return db;
}

function createMockService(): RuntimeSessionsApiService {
  return {
    createSession: vi.fn(async (input) => ({
      runtimeSessionId: 'runtime-session-1',
      agentId: input.agentId,
      kind: input.kind,
      status: 'active' as const,
      modelRouteId: input.modelRouteId,
      runtimeProfileId: input.runtimeProfileId,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    })),
    getSession: vi.fn(async (runtimeSessionId) => ({
      runtimeSessionId,
      agentId: 'codex',
      kind: 'chat' as const,
      status: 'active' as const,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    })),
    getSessionAccess: vi.fn(async (runtimeSessionId) => ({
      runtimeSessionId,
      ownerUserId: 'user-1',
    })),
    createTurn: vi.fn(async (input): Promise<CreateRuntimeTurnResult> => {
      return {
        created: true,
        turn: {
          turnId: 'turn-1',
          runtimeSessionId: input.runtimeSessionId,
          requestId: input.requestId,
          traceId: 'trace-1',
          status: 'queued',
          queuedAt: '2026-07-09T00:00:00.000Z',
        },
        events: eventStream([makeEvent(1, { text: 'hi', providerSessionId: 'hidden' }), makeEvent(3)]),
      };
    }),
    readEvents: vi.fn(async ({ afterSeq }) => ({
      events: [makeEvent(afterSeq + 1, { text: 'delta', raw: { secret: true } })],
      nextSeq: afterSeq + 1,
    })),
    readTraces: vi.fn(async () => ({
      traces: [{
        id: 'trace-row-1',
        traceId: 'trace-1',
        runtimeSessionId: 'runtime-session-1',
        turnId: 'turn-1',
        level: 'info' as const,
        source: 'orchestrator',
        payload: { text: 'visible', raw: { token: 'hidden' }, providerSessionId: 'hidden' },
        redacted: false,
        createdAt: '2026-07-09T00:00:00.000Z',
      }],
    })),
    readDiagnostics: vi.fn(async () => ({
      session: {
        runtimeSessionId: 'runtime-session-1',
        agentId: 'codex',
        kind: 'chat' as const,
        status: 'active' as const,
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
      },
      events: [
        makeEvent(1, {
          text: 'visible',
          authorization: 'Bearer bearer-secret-token',
          stderr: 'fatal TOKEN=stderr-secret',
          proposedDiff: '+ API_KEY=diff-secret',
          command: 'run --api-key command-secret',
          toolOutput: 'raw tool output secret',
        }),
      ],
      traces: [{
        id: 'trace-row-secret',
        traceId: 'trace-1',
        runtimeSessionId: 'runtime-session-1',
        turnId: 'turn-1',
        level: 'error' as const,
        source: 'adapter',
        payload: {
          apiKey: 'sk_test_secret123456789',
          pem: '-----BEGIN PRIVATE KEY-----\nprivate-key-secret\n-----END PRIVATE KEY-----',
          unknownCredentialValue: 'unknown-secret',
          nested: { bearer: 'Bearer nested-secret-token' },
        },
        redacted: false,
        createdAt: '2026-07-09T00:00:00.000Z',
      }],
      bindings: [{
        id: 'binding-1',
        runtimeSessionId: 'runtime-session-1',
        runtime: 'acpx' as const,
        role: 'primary' as const,
        generation: 1,
        raw: {
          handle: { providerSessionId: 'provider-session-secret' },
          rawJson: { API_KEY: 'raw-json-secret', token: 'raw-token-secret' },
        },
        rawRedacted: true as const,
        externalIdsRedacted: true as const,
        createdAt: '2026-07-09T00:00:00.000Z',
        updatedAt: '2026-07-09T00:00:00.000Z',
      }],
    })),
    compactSession: vi.fn(async (input) => ({
      runtimeSessionId: input.runtimeSessionId,
      status: 'completed' as const,
    })),
    forkSession: vi.fn(async (input) => ({
      runtimeSessionId: input.runtimeSessionId,
      forkedSessionId: 'runtime-session-fork',
      status: 'completed' as const,
    })),
    cancelTurn: vi.fn(async () => undefined),
    cancelSession: vi.fn(async () => undefined),
  };
}

describe('/api/runtime-sessions routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.createAcpxRuntimeClient.mockReturnValue({
      async ensureSession(input: {
        session: { runtimeSessionId: string; agentId: string; profileSnapshot: { cwd: string } };
      }) {
        return {
          sessionKey: input.session.runtimeSessionId,
          backend: 'acpx',
          runtimeSessionName: input.session.runtimeSessionId,
          cwd: input.session.profileSnapshot.cwd,
          acpxRecordId: `record-${input.session.runtimeSessionId}`,
          backendSessionId: `backend-${input.session.runtimeSessionId}`,
          agentSessionId: `agent-${input.session.agentId}`,
        };
      },
      async *runTurn() {
        yield {
          type: 'turn_completed',
          payload: {},
        };
      },
      async cancel() {},
      async close() {},
    });
    routeMocks.requireAuth.mockResolvedValue({
      id: 'user-1',
      username: 'Tester',
      email: 'tester@example.com',
      role: 'user',
    });
  });

  afterEach(() => {
    resetRuntimeStreamHeartbeatMsForTesting();
    resetRuntimeSessionsApiServiceForTesting();
  });

  test('POST creates a runtime session through the injected service', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const route = await import('@/server/api-routes/runtime-sessions/route');

    const response = await route.POST(makeRequest('/api/runtime-sessions', {
      json: {
        agentId: 'codex',
        kind: 'chat',
        cwd: 'C:/workspace',
        modelRouteId: 'route-1',
      },
    }));

    expect(response.status).toBe(201);
    const json = await responseJson(response);
    expect(json.session).toMatchObject({
      runtimeSessionId: 'runtime-session-1',
      agentId: 'codex',
      kind: 'chat',
    });
    expect(service.createSession).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'codex',
      ownerUserId: 'user-1',
    }));
  });

  test('imported codex gpt-5.5[low] route id can create a session and send hello', async () => {
    const db = makeImportedCodexGpt55LowRuntimeDb();
    setRuntimeSessionsApiServiceForTesting(createSqliteRuntimeSessionsApiService({ db }));
    const sessionRoute = await import('@/server/api-routes/runtime-sessions/route');
    const turnsRoute = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    try {
      const sessionResponse = await sessionRoute.POST(makeRequest('/api/runtime-sessions', {
        json: {
          agentId: 'codex',
          kind: 'chat',
          cwd: 'C:/workspace',
          modelRouteId: 'codex__gpt-5.5-low',
          title: 'Chat',
        },
      }));

      const sessionJson = await responseJson(sessionResponse);
      expect(sessionResponse.status).toBe(201);
      expect(sessionJson.session).toMatchObject({
        agentId: 'codex',
        kind: 'chat',
        modelRouteId: 'codex__gpt-5.5-low',
      });

      const turnResponse = await turnsRoute.POST(
        makeRequest(`/api/runtime-sessions/${sessionJson.session.runtimeSessionId}/turns`, {
          json: {
            requestId: 'hello-1',
            input: 'hello',
            interruptPolicy: 'cancel-and-send',
          },
        }),
        idParams({ id: sessionJson.session.runtimeSessionId }),
      );

      expect(turnResponse.status).toBe(201);
      const turnJson = await responseJson(turnResponse);
      expect(turnJson.turn).toMatchObject({
        runtimeSessionId: sessionJson.session.runtimeSessionId,
        requestId: 'hello-1',
      });
    } finally {
      db.close();
    }
  });

  test('GET returns a runtime session and POST /turns is idempotency-aware via created flag', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const sessionRoute = await import('@/server/api-routes/runtime-sessions/[id]/route');
    const turnsRoute = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    const getResponse = await sessionRoute.GET(
      makeRequest('/api/runtime-sessions/runtime-session-1'),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(getResponse.status).toBe(200);
    expect(await responseJson(getResponse)).toMatchObject({
      session: { runtimeSessionId: 'runtime-session-1', status: 'active' },
    });

    const postResponse = await turnsRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns', {
        json: {
          requestId: 'request-1',
          input: 'hello',
          interruptPolicy: 'queue',
        },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(postResponse.status).toBe(201);
    expect(await responseJson(postResponse)).toMatchObject({
      turn: {
        turnId: 'turn-1',
        runtimeSessionId: 'runtime-session-1',
        requestId: 'request-1',
      },
    });
  });

  test('GET /events supports cursor precedence, limit bounds, and payload sanitizing', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const route = await import('@/server/api-routes/runtime-sessions/[id]/events/route');
    const cursor = Buffer.from(JSON.stringify({ sessionId: 'runtime-session-1', seq: 8 }), 'utf8').toString('base64url');

    const response = await route.GET(
      makeRequest(`/api/runtime-sessions/runtime-session-1/events?afterSeq=2&cursor=${cursor}&limit=5`),
      idParams({ id: 'runtime-session-1' }),
    );

    expect(response.status).toBe(200);
    expect(service.readEvents).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      afterSeq: 8,
      limit: 5,
    });
    const json = await responseJson(response);
    expect(json.events[0]).toMatchObject({
      runtimeSessionId: 'runtime-session-1',
      seq: 9,
      payload: { text: 'delta' },
    });
    expect(json.cursor).toBeTruthy();

    const exceeded = await route.GET(
      makeRequest('/api/runtime-sessions/runtime-session-1/events?limit=1001'),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(exceeded.status).toBe(422);
    expect(await responseJson(exceeded)).toMatchObject({
      error: { code: 'LIMIT_EXCEEDED' },
    });
  });

  test('POST /turns streams SSE seq ids, flushes terminal event, and closes', async () => {
    const service = createMockService();
    const pulledSeqs: number[] = [];
    vi.mocked(service.createTurn).mockResolvedValueOnce({
      created: true,
      turn: {
        turnId: 'turn-1',
        runtimeSessionId: 'runtime-session-1',
        requestId: 'request-1',
        traceId: 'trace-1',
        status: 'queued',
        queuedAt: '2026-07-09T00:00:00.000Z',
      },
      events: (async function* () {
        for (const event of [makeEvent(1, { text: 'hi', providerSessionId: 'hidden' }), makeEvent(3), makeEvent(4)]) {
          pulledSeqs.push(event.seq);
          yield event;
        }
      })(),
    });
    setRuntimeSessionsApiServiceForTesting(service);
    const route = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    const response = await route.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns?stream=sse', {
        json: {
          requestId: 'request-1',
          input: 'hello',
        },
      }),
      idParams({ id: 'runtime-session-1' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const text = await response.text();
    expect(text).toContain('id: 1');
    expect(text).toContain('event: message.delta');
    expect(text).toContain('id: 3');
    expect(text).toContain('event: turn.completed');
    expect(text).not.toContain('id: 4');
    expect(text).not.toContain('providerSessionId');
    expect(pulledSeqs).toEqual([1, 3]);
  });

  test('POST /turns streams NDJSON rows and closes after terminal flush', async () => {
    const service = createMockService();
    const pulledSeqs: number[] = [];
    vi.mocked(service.createTurn).mockResolvedValueOnce({
      created: true,
      turn: {
        turnId: 'turn-1',
        runtimeSessionId: 'runtime-session-1',
        requestId: 'request-ndjson',
        traceId: 'trace-1',
        status: 'queued',
        queuedAt: '2026-07-09T00:00:00.000Z',
      },
      events: (async function* () {
        for (const event of [makeEvent(1, { text: 'hi' }), makeEvent(3), makeEvent(4)]) {
          pulledSeqs.push(event.seq);
          yield event;
        }
      })(),
    });
    setRuntimeSessionsApiServiceForTesting(service);
    const route = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    const response = await route.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns?stream=ndjson', {
        json: {
          requestId: 'request-ndjson',
          input: 'hello',
        },
      }),
      idParams({ id: 'runtime-session-1' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/x-ndjson');
    const text = await response.text();
    const lines = text.trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      expect.objectContaining({ seq: 1, type: 'message.delta', payload: { text: 'hi' } }),
      expect.objectContaining({ seq: 3, type: 'turn.completed' }),
    ]);
    expect(pulledSeqs).toEqual([1, 3]);
  });

  test('POST /turns emits keepalive heartbeat while SSE stream is waiting', async () => {
    const service = createMockService();
    vi.mocked(service.createTurn).mockResolvedValueOnce({
      created: true,
      turn: {
        turnId: 'turn-1',
        runtimeSessionId: 'runtime-session-1',
        requestId: 'request-heartbeat',
        traceId: 'trace-1',
        status: 'queued',
        queuedAt: '2026-07-09T00:00:00.000Z',
      },
      events: delayedEventStream(50, [makeEvent(3)]),
    });
    setRuntimeSessionsApiServiceForTesting(service);
    setRuntimeStreamHeartbeatMsForTesting(5);
    const route = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    const response = await route.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns?stream=sse', {
        json: {
          requestId: 'request-heartbeat',
          input: 'hello',
        },
      }),
      idParams({ id: 'runtime-session-1' }),
    );

    const reader = response.body!.getReader();
    const first = await reader.read();
    await reader.cancel();

    expect(first.done).toBe(false);
    expect(decodeChunk(first.value)).toContain(': {"type":"heartbeat"');
  });

  test('POST /turns emits structured runtime error events for SSE and NDJSON stream failures', async () => {
    const service = createMockService();
    const streamError = Object.assign(new Error('adapter failed with token secret'), {
      code: 'ADAPTER_FAILED',
      retryable: false,
    });
    vi.mocked(service.createTurn)
      .mockResolvedValueOnce({
        created: true,
        turn: {
          turnId: 'turn-1',
          runtimeSessionId: 'runtime-session-1',
          requestId: 'request-error-sse',
          traceId: 'trace-1',
          status: 'queued',
          queuedAt: '2026-07-09T00:00:00.000Z',
        },
        events: throwingEventStream(streamError),
      })
      .mockResolvedValueOnce({
        created: true,
        turn: {
          turnId: 'turn-1',
          runtimeSessionId: 'runtime-session-1',
          requestId: 'request-error-ndjson',
          traceId: 'trace-1',
          status: 'queued',
          queuedAt: '2026-07-09T00:00:00.000Z',
        },
        events: throwingEventStream(streamError),
      });
    setRuntimeSessionsApiServiceForTesting(service);
    const route = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    const sseResponse = await route.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns?stream=sse', {
        json: {
          requestId: 'request-error-sse',
          input: 'hello',
        },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(sseResponse.status).toBe(200);
    const sseText = await sseResponse.text();
    expect(sseText).toContain('event: turn.failed');
    expect(sseText).toContain('id: 2');
    expect(sseText).toContain('"code":"ADAPTER_FAILED"');
    expect(sseText).toContain('"status":500');

    const ndjsonResponse = await route.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns?stream=ndjson', {
        json: {
          requestId: 'request-error-ndjson',
          input: 'hello',
        },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(ndjsonResponse.status).toBe(200);
    const lines = (await ndjsonResponse.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(lines).toEqual([
      expect.objectContaining({ seq: 1, type: 'message.delta' }),
      expect.objectContaining({
        seq: 2,
        type: 'turn.failed',
        payload: expect.objectContaining({
          status: 500,
          error: expect.objectContaining({
            code: 'ADAPTER_FAILED',
            retryable: false,
            redacted: true,
          }),
        }),
      }),
    ]);
  });

  test('cancel routes pass requestId and reason to the service', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const turnCancelRoute = await import('@/server/api-routes/runtime-sessions/[id]/turns/[turnId]/cancel/route');
    const sessionCancelRoute = await import('@/server/api-routes/runtime-sessions/[id]/cancel/route');

    const turnResponse = await turnCancelRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/turns/turn-1/cancel', {
        json: { requestId: 'cancel-1', reason: 'user-stop' },
      }),
      idParams({ id: 'runtime-session-1', turnId: 'turn-1' }),
    );
    expect(turnResponse.status).toBe(200);
    expect(service.cancelTurn).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      turnId: 'turn-1',
      requestId: 'cancel-1',
      reason: 'user-stop',
    });

    const sessionResponse = await sessionCancelRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/cancel', {
        json: { requestId: 'cancel-session-1', reason: 'stop-active' },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(sessionResponse.status).toBe(200);
    expect(service.cancelSession).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      requestId: 'cancel-session-1',
      reason: 'stop-active',
    });
  });

  test('compact, fork, and traces routes validate auth and parameters', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const compactRoute = await import('@/server/api-routes/runtime-sessions/[id]/compact/route');
    const forkRoute = await import('@/server/api-routes/runtime-sessions/[id]/fork/route');
    const tracesRoute = await import('@/server/api-routes/runtime-sessions/[id]/traces/route');

    routeMocks.requireAuth.mockResolvedValueOnce(Response.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 }));
    const unauthorized = await compactRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/compact', {
        json: { requestId: 'compact-1' },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(unauthorized.status).toBe(401);
    expect(service.compactSession).not.toHaveBeenCalled();

    const invalidCompact = await compactRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/compact', {
        json: { requestId: 'compact-1', strategy: 'invalid' },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(invalidCompact.status).toBe(422);
    expect(await responseJson(invalidCompact)).toMatchObject({
      error: { code: 'VALIDATION_FAILED' },
    });

    const invalidFork = await forkRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/fork', {
        json: {},
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(invalidFork.status).toBe(422);

    const invalidTraces = await tracesRoute.GET(
      makeRequest('/api/runtime-sessions/runtime-session-1/traces?limit=1001'),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(invalidTraces.status).toBe(422);
  });

  test('compact, fork, and traces routes return successful runtime-first responses', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const compactRoute = await import('@/server/api-routes/runtime-sessions/[id]/compact/route');
    const forkRoute = await import('@/server/api-routes/runtime-sessions/[id]/fork/route');
    const tracesRoute = await import('@/server/api-routes/runtime-sessions/[id]/traces/route');

    const compactResponse = await compactRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/compact', {
        json: { requestId: 'compact-1', atTurnId: 'turn-1', strategy: 'summary' },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(compactResponse.status).toBe(200);
    expect(service.compactSession).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      requestId: 'compact-1',
      atTurnId: 'turn-1',
      strategy: 'summary',
    });
    expect(await responseJson(compactResponse)).toMatchObject({
      compact: { runtimeSessionId: 'runtime-session-1', status: 'completed' },
    });

    const forkResponse = await forkRoute.POST(
      makeRequest('/api/runtime-sessions/runtime-session-1/fork', {
        json: { requestId: 'fork-1', atTurnId: 'turn-1', atMessageId: 'message-1', title: 'Forked' },
      }),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(forkResponse.status).toBe(200);
    expect(service.forkSession).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      requestId: 'fork-1',
      atTurnId: 'turn-1',
      atMessageId: 'message-1',
      title: 'Forked',
    });
    expect(await responseJson(forkResponse)).toMatchObject({
      fork: { runtimeSessionId: 'runtime-session-1', forkedSessionId: 'runtime-session-fork', status: 'completed' },
    });

    const tracesResponse = await tracesRoute.GET(
      makeRequest('/api/runtime-sessions/runtime-session-1/traces?limit=5&traceId=trace-1&turnId=turn-1'),
      idParams({ id: 'runtime-session-1' }),
    );
    expect(tracesResponse.status).toBe(200);
    expect(service.readTraces).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      limit: 5,
      traceId: 'trace-1',
      turnId: 'turn-1',
    });
    const tracesJson = await responseJson(tracesResponse);
    expect(tracesJson.traces[0]).toMatchObject({
      traceId: 'trace-1',
      payload: { text: 'visible' },
      redacted: true,
    });
    expect(JSON.stringify(tracesJson)).not.toContain('hidden');
  });

  test('GET /diagnostics returns a fail-closed redacted diagnostics bundle', async () => {
    const service = createMockService();
    setRuntimeSessionsApiServiceForTesting(service);
    const route = await import('@/server/api-routes/runtime-sessions/[id]/diagnostics/route');

    const response = await route.GET(
      makeRequest('/api/runtime-sessions/runtime-session-1/diagnostics'),
      idParams({ id: 'runtime-session-1' }),
    );

    expect(response.status).toBe(200);
    expect(service.readDiagnostics).toHaveBeenCalledWith({
      runtimeSessionId: 'runtime-session-1',
      eventLimit: 1000,
      traceLimit: 1000,
    });

    const json = await responseJson(response);
    expect(json.diagnostics).toMatchObject({
      session: { runtimeSessionId: 'runtime-session-1', status: 'active' },
      redacted: true,
    });
    expect(json.diagnostics.events[0].payload).toMatchObject({
      text: 'visible',
      stderr: '[REDACTED]',
      command: '[REDACTED]',
      toolOutput: '[REDACTED]',
    });
    expect(json.diagnostics.events[0].payload.authorization).toBeUndefined();
    expect(json.diagnostics.traces[0].payload).toMatchObject({
      apiKey: '[REDACTED]',
      pem: '[REDACTED]',
      unknownCredentialValue: '[REDACTED]',
      nested: { bearer: '[REDACTED]' },
    });
    expect(json.diagnostics.bindings[0]).toMatchObject({
      externalIdsRedacted: true,
      rawRedacted: true,
    });
    const text = JSON.stringify(json);
    for (const leaked of [
      'bearer-secret-token',
      'stderr-secret',
      'diff-secret',
      'command-secret',
      'raw tool output secret',
      'sk_test_secret123456789',
      'private-key-secret',
      'unknown-secret',
      'nested-secret-token',
      'provider-session-secret',
      'raw-json-secret',
      'raw-token-secret',
    ]) {
      expect(text).not.toContain(leaked);
    }
  });

  test('sqlite-backed default service creates a runtime session through the route', async () => {
    const db = makeRuntimeDb();
    setRuntimeSessionsApiServiceForTesting(createSqliteRuntimeSessionsApiService({ db }));
    const route = await import('@/server/api-routes/runtime-sessions/route');

    try {
      const response = await route.POST(makeRequest('/api/runtime-sessions', {
        json: {
          agentId: 'codex',
          kind: 'chat',
          cwd: 'C:/workspace',
          modelRouteId: 'route-codex',
        },
      }));

      expect(response.status).toBe(201);
      const json = await responseJson(response);
      expect(json.session).toMatchObject({
        agentId: 'codex',
        kind: 'chat',
        status: 'active',
        modelRouteId: 'route-codex',
      });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_sessions').get()).toMatchObject({ count: 1 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_bindings').get()).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  test('sqlite-backed session routes allow owner and admin but reject non-owner users', async () => {
    const db = makeRuntimeDb();
    setRuntimeSessionsApiServiceForTesting(createSqliteRuntimeSessionsApiService({ db }));
    const createRoute = await import('@/server/api-routes/runtime-sessions/route');
    const sessionRoute = await import('@/server/api-routes/runtime-sessions/[id]/route');
    const turnsRoute = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    try {
      routeMocks.requireAuth.mockResolvedValue({
        id: 'owner-user',
        username: 'Owner',
        email: 'owner@example.com',
        role: 'user',
      });
      const createResponse = await createRoute.POST(makeRequest('/api/runtime-sessions', {
        json: {
          agentId: 'codex',
          kind: 'chat',
          cwd: 'C:/workspace',
          modelRouteId: 'route-codex',
        },
      }));
      expect(createResponse.status).toBe(201);
      const runtimeSessionId = (await responseJson(createResponse)).session.runtimeSessionId;

      const ownerGet = await sessionRoute.GET(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}`),
        idParams({ id: runtimeSessionId }),
      );
      expect(ownerGet.status).toBe(200);
      expect(await responseJson(ownerGet)).toMatchObject({
        session: { runtimeSessionId, status: 'active' },
      });

      routeMocks.requireAuth.mockResolvedValue({
        id: 'admin-user',
        username: 'Admin',
        email: 'admin@example.com',
        role: 'admin',
      });
      const adminGet = await sessionRoute.GET(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}`),
        idParams({ id: runtimeSessionId }),
      );
      expect(adminGet.status).toBe(200);
      expect(await responseJson(adminGet)).toMatchObject({
        session: { runtimeSessionId, status: 'active' },
      });

      routeMocks.requireAuth.mockResolvedValue({
        id: 'other-user',
        username: 'Other',
        email: 'other@example.com',
        role: 'user',
      });
      const deniedGet = await sessionRoute.GET(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}`),
        idParams({ id: runtimeSessionId }),
      );
      expect(deniedGet.status).toBe(403);
      expect(await responseJson(deniedGet)).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });

      const deniedTurn = await turnsRoute.POST(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/turns`, {
          json: {
            requestId: 'request-denied',
            input: 'hello',
          },
        }),
        idParams({ id: runtimeSessionId }),
      );
      expect(deniedTurn.status).toBe(403);
      expect(await responseJson(deniedTurn)).toMatchObject({
        error: { code: 'FORBIDDEN' },
      });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_turns').get()).toMatchObject({ count: 0 });
    } finally {
      db.close();
    }
  });

  test('sqlite-backed POST /turns starts non-stream execution and is idempotent by requestId', async () => {
    const db = makeRuntimeDb();
    const runTurn = vi.fn(async function* () {
      yield {
        type: 'turn_started',
        payload: { ok: true },
      };
      yield {
        type: 'message_delta',
        payload: { text: 'hello' },
      };
      yield {
        type: 'turn_completed',
        payload: { ok: true },
      };
    });
    routeMocks.createAcpxRuntimeClient.mockReturnValue({
      async ensureSession(input: {
        session: { runtimeSessionId: string; agentId: string; profileSnapshot: { cwd: string } };
      }) {
        return {
          sessionKey: input.session.runtimeSessionId,
          backend: 'acpx',
          runtimeSessionName: input.session.runtimeSessionId,
          cwd: input.session.profileSnapshot.cwd,
          acpxRecordId: `record-${input.session.runtimeSessionId}`,
          backendSessionId: `backend-${input.session.runtimeSessionId}`,
          agentSessionId: `agent-${input.session.agentId}`,
        };
      },
      runTurn,
      async cancel() {},
      async close() {},
    });
    setRuntimeSessionsApiServiceForTesting(createSqliteRuntimeSessionsApiService({ db }));
    const sessionRoute = await import('@/server/api-routes/runtime-sessions/route');
    const turnsRoute = await import('@/server/api-routes/runtime-sessions/[id]/turns/route');

    try {
      const sessionResponse = await sessionRoute.POST(makeRequest('/api/runtime-sessions', {
        json: {
          agentId: 'codex',
          kind: 'chat',
          cwd: 'C:/workspace',
          modelRouteId: 'route-codex',
        },
      }));
      expect(sessionResponse.status).toBe(201);
      const sessionJson = await responseJson(sessionResponse);
      const runtimeSessionId = sessionJson.session.runtimeSessionId;

      const firstResponse = await turnsRoute.POST(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/turns`, {
          json: {
            requestId: 'request-1',
            input: 'hello',
          },
        }),
        idParams({ id: runtimeSessionId }),
      );
      expect(firstResponse.status).toBe(201);
      const firstJson = await responseJson(firstResponse);
      expect(firstJson.turn).toMatchObject({
        runtimeSessionId,
        requestId: 'request-1',
      });
      expect(['queued', 'running', 'completed']).toContain(firstJson.turn.status);

      const completed = await waitFor(
        () => db.prepare('SELECT id, status FROM runtime_turns WHERE request_id = ?').get('request-1') as { id: string; status: string } | undefined,
        (row) => row?.status === 'completed',
      );
      expect(completed).toMatchObject({ status: 'completed' });
      expect(db.prepare('SELECT type FROM runtime_events WHERE turn_id = ? ORDER BY seq ASC').all(completed!.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'turn.started' }),
          expect.objectContaining({ type: 'turn.completed' }),
        ]),
      );

      const secondResponse = await turnsRoute.POST(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/turns`, {
          json: {
            requestId: 'request-1',
            input: 'ignored duplicate',
          },
        }),
        idParams({ id: runtimeSessionId }),
      );
      expect(secondResponse.status).toBe(200);
      const secondJson = await responseJson(secondResponse);
      expect(secondJson.turn.turnId).toBe(firstJson.turn.turnId);
      expect(secondJson.turn.status).toBe('completed');
      expect(runTurn).toHaveBeenCalledTimes(1);
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_turns WHERE request_id = ?').get('request-1')).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  test('sqlite-backed compact, fork, and traces use orchestrator operations and redacted trace reads', async () => {
    const db = makeRuntimeDb();
    setRuntimeSessionsApiServiceForTesting(createSqliteRuntimeSessionsApiService({ db }));
    const sessionRoute = await import('@/server/api-routes/runtime-sessions/route');
    const compactRoute = await import('@/server/api-routes/runtime-sessions/[id]/compact/route');
    const forkRoute = await import('@/server/api-routes/runtime-sessions/[id]/fork/route');
    const tracesRoute = await import('@/server/api-routes/runtime-sessions/[id]/traces/route');

    try {
      const sessionResponse = await sessionRoute.POST(makeRequest('/api/runtime-sessions', {
        json: {
          agentId: 'codex',
          kind: 'chat',
          cwd: 'C:/workspace',
          modelRouteId: 'route-codex',
        },
      }));
      expect(sessionResponse.status).toBe(201);
      const sessionJson = await responseJson(sessionResponse);
      const runtimeSessionId = sessionJson.session.runtimeSessionId;

      const compactResponse = await compactRoute.POST(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/compact`, {
          json: { requestId: 'compact-sqlite-1', strategy: 'summary' },
        }),
        idParams({ id: runtimeSessionId }),
      );
      expect(compactResponse.status).toBe(200);
      expect(await responseJson(compactResponse)).toMatchObject({
        compact: { runtimeSessionId, status: 'completed' },
      });

      const forkResponse = await forkRoute.POST(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/fork`, {
          json: { requestId: 'fork-sqlite-1', title: 'Forked sqlite session' },
        }),
        idParams({ id: runtimeSessionId }),
      );
      expect(forkResponse.status).toBe(200);
      const forkJson = await responseJson(forkResponse);
      expect(forkJson.fork).toMatchObject({
        runtimeSessionId,
        status: 'completed',
      });
      expect(forkJson.fork.forkedSessionId).toBeTruthy();

      db.prepare(`
        INSERT INTO runtime_traces (id, trace_id, session_id, turn_id, level, source, payload_json, redacted, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
      `).run(
        'trace-row-secret',
        'trace-secret',
        runtimeSessionId,
        'info',
        'test',
        JSON.stringify({ text: 'visible', secret: 'hidden', raw: { token: 'hidden' } }),
        0,
        '2026-07-09T00:00:00.000Z',
      );

      const tracesResponse = await tracesRoute.GET(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/traces?traceId=trace-secret`),
        idParams({ id: runtimeSessionId }),
      );
      expect(tracesResponse.status).toBe(200);
      const tracesJson = await responseJson(tracesResponse);
      expect(tracesJson.traces).toEqual([
        expect.objectContaining({
          traceId: 'trace-secret',
          runtimeSessionId,
          payload: { text: 'visible' },
          redacted: true,
        }),
      ]);
      expect(JSON.stringify(tracesJson)).not.toContain('hidden');
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_session_operations').get()).toMatchObject({ count: 2 });
      expect(db.prepare('SELECT COUNT(*) AS count FROM runtime_session_edges WHERE kind = ?').get('fork')).toMatchObject({ count: 1 });
    } finally {
      db.close();
    }
  });

  test('sqlite-backed diagnostics bundle redacts persisted events, traces, and bindings', async () => {
    const db = makeRuntimeDb();
    setRuntimeSessionsApiServiceForTesting(createSqliteRuntimeSessionsApiService({ db }));
    const sessionRoute = await import('@/server/api-routes/runtime-sessions/route');
    const diagnosticsRoute = await import('@/server/api-routes/runtime-sessions/[id]/diagnostics/route');

    try {
      const sessionResponse = await sessionRoute.POST(makeRequest('/api/runtime-sessions', {
        json: {
          agentId: 'codex',
          kind: 'chat',
          cwd: 'C:/workspace',
          modelRouteId: 'route-codex',
        },
      }));
      expect(sessionResponse.status).toBe(201);
      const runtimeSessionId = (await responseJson(sessionResponse)).session.runtimeSessionId;

      db.prepare(`
        UPDATE runtime_bindings
        SET external_record_id = ?, external_session_id = ?, provider_session_id = ?, raw_json = ?
        WHERE session_id = ?
      `).run(
        'external-record-secret',
        'external-session-secret',
        'provider-session-secret',
        JSON.stringify({
          handle: { nativeId: 'native-secret', providerSessionId: 'provider-raw-secret' },
          config: { apiKey: 'sk_test_sqlite_secret123456789', customCredential: 'credential-secret' },
        }),
        runtimeSessionId,
      );

      db.prepare(`
        INSERT INTO runtime_events (
          id, session_id, turn_id, trace_id, seq, type, correlation_id, parent_event_id,
          message_id, tool_call_id, payload_json, redacted, created_at
        )
        VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?)
      `).run(
        'diagnostic-event-secret',
        runtimeSessionId,
        'trace-diagnostics',
        1,
        'tool.output',
        JSON.stringify({
          stdout: 'TOKEN=stdout-secret',
          diff: '+ password=diff-secret',
          note: 'Bearer bearer-sqlite-secret',
        }),
        0,
        '2026-07-09T00:00:00.000Z',
      );

      db.prepare(`
        INSERT INTO runtime_traces (id, trace_id, session_id, turn_id, level, source, payload_json, redacted, created_at)
        VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
      `).run(
        'diagnostic-trace-secret',
        'trace-diagnostics',
        runtimeSessionId,
        'error',
        'adapter',
        JSON.stringify({
          privateKey: '-----BEGIN PRIVATE KEY-----\nprivate-sqlite-secret\n-----END PRIVATE KEY-----',
          stderr: 'API_KEY=trace-stderr-secret',
        }),
        0,
        '2026-07-09T00:00:01.000Z',
      );

      const diagnosticsResponse = await diagnosticsRoute.GET(
        makeRequest(`/api/runtime-sessions/${runtimeSessionId}/diagnostics`),
        idParams({ id: runtimeSessionId }),
      );
      expect(diagnosticsResponse.status).toBe(200);
      const diagnosticsJson = await responseJson(diagnosticsResponse);
      expect(diagnosticsJson.diagnostics.bindings[0]).toMatchObject({
        runtimeSessionId,
        externalIdsRedacted: true,
        rawRedacted: true,
      });
      expect(diagnosticsJson.diagnostics.events[0].payload).toMatchObject({
        stdout: '[REDACTED]',
        diff: '[REDACTED]',
        note: 'Bearer [REDACTED]',
      });
      expect(diagnosticsJson.diagnostics.traces[0].payload).toMatchObject({
        privateKey: '[REDACTED]',
        stderr: '[REDACTED]',
      });

      const text = JSON.stringify(diagnosticsJson);
      for (const leaked of [
        'external-record-secret',
        'external-session-secret',
        'provider-session-secret',
        'native-secret',
        'provider-raw-secret',
        'sk_test_sqlite_secret123456789',
        'credential-secret',
        'stdout-secret',
        'diff-secret',
        'bearer-sqlite-secret',
        'private-sqlite-secret',
        'trace-stderr-secret',
      ]) {
        expect(text).not.toContain(leaked);
      }
    } finally {
      db.close();
    }
  });
});
