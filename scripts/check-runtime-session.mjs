#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
setupTsRuntime();

const { openRuntimeSqliteDatabase } = require('../src/lib/runtime-agent/sqlite/database.ts');
const { RuntimeSqliteStore } = require('../src/lib/runtime-agent/sqlite/runtime-store.ts');
const {
  upsertModelCatalogEntry,
  upsertModelProvider,
  upsertModelRoute,
} = require('../src/lib/runtime-agent/models/model-routes.ts');

const options = parseArgs(process.argv.slice(2));
const db = openRuntimeSqliteDatabase(':memory:');

try {
  const store = new RuntimeSqliteStore(db);
  upsertModelProvider(db, {
    id: 'runtime-check-provider',
    kind: 'custom',
    displayName: 'Runtime Check Provider',
  });
  upsertModelCatalogEntry(db, {
    id: options.model,
    displayName: options.model,
  });
  upsertModelRoute(db, {
    id: options.modelRouteId,
    agentId: options.agentId,
    modelId: options.model,
    providerId: 'runtime-check-provider',
    providerModel: options.model,
    isDefault: true,
  });
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO runtime_sessions (
      id, kind, agent_id, model_route_id, status, working_directory, created_at, updated_at
    )
    VALUES (?, 'chat', ?, ?, 'active', ?, ?, ?)
  `).run(options.runtimeSessionId, options.agentId, options.modelRouteId, options.cwd, now, now);

  const first = store.enqueueTurn({
    sessionId: options.runtimeSessionId,
    requestId: options.requestId,
    traceId: options.traceId,
    inputText: options.prompt,
  });
  const idempotent = store.enqueueTurn({
    sessionId: options.runtimeSessionId,
    requestId: options.requestId,
    inputText: 'ignored',
  });
  const claimed = store.claimNextTurn({
    leaseOwner: 'runtime-check',
    leaseToken: 'runtime-check-lease',
    now: new Date(),
  });
  const event = store.appendEvent({
    sessionId: options.runtimeSessionId,
    turnId: first.id,
    traceId: options.traceId,
    type: 'turn.started',
    payload: { source: 'runtime-check' },
  });

  const report = {
    ok: first.id === idempotent.id && claimed?.id === first.id && event.seq === 1,
    sessionId: options.runtimeSessionId,
    turnId: first.id,
    idempotentTurn: first.id === idempotent.id,
    claimedStatus: claimed?.status,
    firstEventSeq: event.seq,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Runtime Session Check');
    console.log(`sessionId: ${report.sessionId}`);
    console.log(`turnId: ${report.turnId}`);
    console.log(`idempotentTurn: ${report.idempotentTurn}`);
    console.log(`claimedStatus: ${report.claimedStatus}`);
    console.log(`firstEventSeq: ${report.firstEventSeq}`);
  }

  process.exit(report.ok ? 0 : 1);
} finally {
  db.close();
}

function parseArgs(argv) {
  const parsed = {
    agentId: 'codex',
    modelRouteId: 'runtime-check-route',
    model: 'runtime-check-model',
    cwd: process.cwd(),
    prompt: 'ping',
    runtimeSessionId: 'runtime-check-session',
    requestId: 'runtime-check-request',
    traceId: 'runtime-check-trace',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--agent' || arg === '--agent-id') && argv[index + 1]) parsed.agentId = argv[++index];
    else if ((arg === '--model-route' || arg === '--model-route-id') && argv[index + 1]) parsed.modelRouteId = argv[++index];
    else if (arg === '--model' && argv[index + 1]) parsed.model = argv[++index];
    else if (arg === '--cwd' && argv[index + 1]) parsed.cwd = argv[++index];
    else if (arg === '--prompt' && argv[index + 1]) parsed.prompt = argv[++index];
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Runtime session check

Usage:
  npm run check:runtime:session
  npm run check:runtime:session -- --agent codex --model-route route-codex --json
`);
      process.exit(0);
    }
  }

  return parsed;
}

function setupTsRuntime() {
  const tsNodeRegister = resolve(root, 'node_modules', 'ts-node', 'register', 'transpile-only.js');
  const tsconfigPathsRegister = resolve(root, 'node_modules', 'tsconfig-paths', 'register.js');
  if (!existsSync(tsNodeRegister)) {
    throw new Error('Missing ts-node. Run npm install before runtime checks.');
  }
  process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || resolve(root, 'tsconfig.json');
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'Node',
  });
  require(tsNodeRegister);
  if (existsSync(tsconfigPathsRegister)) require(tsconfigPathsRegister);
}
