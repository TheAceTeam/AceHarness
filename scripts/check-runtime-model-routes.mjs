#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
setupTsRuntime();

const { openRuntimeSqliteDatabase } = require('../src/lib/runtime-agent/sqlite/database.ts');
const { ensureModelRouteSchema } = require('../src/lib/runtime-agent/models/model-route-schema.ts');
const {
  capabilitiesForResolvedRoute,
  resolveModelRoute,
  upsertModelCatalogEntry,
  upsertModelProvider,
  upsertModelRoute,
} = require('../src/lib/runtime-agent/models/model-routes.ts');

const options = parseArgs(process.argv.slice(2));
const db = openRuntimeSqliteDatabase(':memory:');

try {
  ensureModelRouteSchema(db);
  upsertModelProvider(db, {
    id: 'runtime-check-provider',
    kind: 'custom',
    displayName: 'Runtime Check Provider',
  });
  upsertModelCatalogEntry(db, {
    id: options.model,
    providerId: 'runtime-check-provider',
    displayName: options.model,
  });
  upsertModelRoute(db, {
    id: options.modelRouteId,
    agentId: options.agentId,
    providerId: 'runtime-check-provider',
    modelId: options.model,
    providerModel: options.model,
    isDefault: true,
  });

  const resolved = resolveModelRoute(db, {
    modelRouteId: options.modelRouteId,
  });
  const report = {
    ok: resolved.modelRouteId === options.modelRouteId,
    resolved,
    capabilities: capabilitiesForResolvedRoute(resolved),
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Runtime Model Route Check');
    console.log(`modelRouteId: ${resolved.modelRouteId}`);
    console.log(`agentId: ${resolved.agentId}`);
    console.log(`providerModel: ${resolved.providerModel}`);
    console.log(`usage: ${report.capabilities.usage}`);
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
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--agent' || arg === '--agent-id') && argv[index + 1]) parsed.agentId = argv[++index];
    else if ((arg === '--model-route' || arg === '--model-route-id') && argv[index + 1]) parsed.modelRouteId = argv[++index];
    else if (arg === '--model' && argv[index + 1]) parsed.model = argv[++index];
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Runtime model route check

Usage:
  npm run check:runtime:model-routes
  npm run check:runtime:model-routes -- --agent codex --model-route route-codex --model gpt-5
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
