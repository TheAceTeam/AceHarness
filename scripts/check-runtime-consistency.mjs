#!/usr/bin/env node
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
setupTsRuntime();

const { openRuntimeSqliteDatabase } = require('../src/lib/runtime-agent/sqlite/database.ts');
const { getBuiltinAgentDefinitions, mergeAgentRuntimeState } = require('../src/lib/runtime-agent/agent-registry.ts');
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
  const definitions = getBuiltinAgentDefinitions();
  const selectedAgent = definitions.find((definition) => definition.id === options.agentId) ?? definitions[0];
  const warnings = [];
  const errors = [];

  if (!selectedAgent) errors.push('No builtin runtime agents are registered');
  if (selectedAgent && !selectedAgent.modelConfigSchema?.supportsModelRoute) {
    errors.push(`Agent ${selectedAgent.id} does not advertise modelRoute support`);
  }

  upsertModelProvider(db, {
    id: 'runtime-consistency-provider',
    kind: 'custom',
    displayName: 'Runtime Consistency Provider',
  });
  upsertModelCatalogEntry(db, {
    id: options.model,
    displayName: options.model,
  });
  upsertModelRoute(db, {
    id: options.modelRouteId,
    agentId: selectedAgent?.id ?? options.agentId,
    runtime: selectedAgent?.runtime ?? 'acpx',
    modelId: options.model,
    providerId: 'runtime-consistency-provider',
    providerModel: options.providerModel,
    isDefault: true,
  });

  const resolved = resolveModelRoute(db, { modelRouteId: options.modelRouteId });
  const profileSnapshot = {
    agentId: resolved.agentId,
    modelRouteId: resolved.modelRouteId,
    cwd: process.cwd(),
    systemPromptHash: 'sha256:runtime-consistency',
    skillsRevision: 'runtime-consistency',
    mcpRevision: 'runtime-consistency',
    permissionPolicyId: 'unrestricted',
    interruptPolicy: 'queue',
  };
  const registry = mergeAgentRuntimeState([], definitions);
  const registryEntry = registry.find((entry) => entry.definition.id === resolved.agentId);

  if (!registryEntry) errors.push(`Resolved route agentId ${resolved.agentId} is absent from merged registry`);
  if (registryEntry && registryEntry.definition.runtime !== resolved.runtime) {
    errors.push(`Resolved route runtime ${resolved.runtime} does not match agent registry runtime ${registryEntry.definition.runtime}`);
  }
  if (profileSnapshot.agentId !== resolved.agentId) errors.push('Profile agentId does not match resolved route agentId');
  if (profileSnapshot.modelRouteId !== resolved.modelRouteId) errors.push('Profile modelRouteId does not match resolved route');
  if (!resolved.providerModel) warnings.push(`Route ${resolved.modelRouteId} has no providerModel display bridge`);

  const report = {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    checks: [
      'agent registry contains runtime-capable agent',
      'model route resolves by modelRouteId',
      'profileSnapshot carries agentId/modelRouteId',
      'agent registry runtime matches resolved model route runtime',
    ],
    agent: {
      agentId: resolved.agentId,
      runtime: resolved.runtime,
      tier: registryEntry?.definition.tier ?? null,
    },
    modelRoute: {
      modelRouteId: resolved.modelRouteId,
      modelId: resolved.modelId,
      providerModel: resolved.providerModel,
      capabilities: capabilitiesForResolvedRoute(resolved),
    },
    profileSnapshot,
    warnings,
    errors,
  };

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log('Runtime Consistency Check');
    console.log(`agentId: ${report.agent.agentId}`);
    console.log(`modelRouteId: ${report.modelRoute.modelRouteId}`);
    console.log(`profile: ${report.profileSnapshot.agentId}/${report.profileSnapshot.modelRouteId}`);
    console.log(`warnings: ${warnings.length}`);
    console.log(`errors: ${errors.length}`);
    for (const warning of warnings) console.log(`warning: ${warning}`);
    for (const error of errors) console.log(`error: ${error}`);
  }

  process.exit(report.ok ? 0 : 1);
} finally {
  db.close();
}

function parseArgs(argv) {
  const parsed = {
    agentId: 'codex',
    modelRouteId: 'runtime-consistency-route',
    model: 'runtime-consistency-model',
    providerModel: 'runtime-consistency-provider-model',
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--agent' || arg === '--agent-id') && argv[index + 1]) parsed.agentId = argv[++index];
    else if ((arg === '--model-route' || arg === '--model-route-id') && argv[index + 1]) parsed.modelRouteId = argv[++index];
    else if (arg === '--model' && argv[index + 1]) parsed.model = argv[++index];
    else if (arg === '--provider-model' && argv[index + 1]) parsed.providerModel = argv[++index];
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Runtime consistency check

Usage:
  npm run check:runtime:consistency -- --json

Verifies agent registry, model route resolution, and profileSnapshot identity
using agentId/modelRouteId as runtime keys.
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
