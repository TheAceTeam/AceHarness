#!/usr/bin/env node
const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

setupTsRuntime();

const { createRuntimeAdapterRegistry } = require('../src/lib/runtime-agent/adapters/adapter-registry.ts');
const { createAcpxRuntimeClient } = require('../src/lib/runtime-agent/adapters/acpx-runtime-client.ts');

const options = parseArgs(process.argv.slice(2));
const registry = createRuntimeAdapterRegistry({
  acpxClient: createAcpxRuntimeClient({
    cwd: options.cwd,
  }),
});
const adapter = registry.getAdapterForAgent(options.agentId);

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function run() {
  const binding = await adapter.createOrLoadSession({
    runtimeSessionId: options.runtimeSessionId,
    agentId: options.agentId,
    modelRoute: createModelRoute(options),
    profileSnapshot: createProfile(options),
  });

  const events = [];
  for await (const event of adapter.runTurn(binding, {
    turnId: options.turnId,
    requestId: options.requestId,
    traceId: options.traceId,
    input: options.prompt,
    interruptPolicy: 'queue',
    profileSnapshot: createProfile(options),
  })) {
    events.push(event);
  }

  const report = {
    ok: events.some((event) => event.type === 'turn.started'),
    executable: !events.some((event) => event.error?.code === 'ADAPTER_UNAVAILABLE'),
    mode: 'acpx/runtime',
    agentId: options.agentId,
    runtime: binding.runtime,
    eventTypes: events.map((event) => event.type),
    terminalError: events.find((event) => event.error)?.error ?? null,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Runtime Chat Check');
    console.log(`agentId: ${report.agentId}`);
    console.log(`runtime: ${report.runtime}`);
    console.log(`mode: ${report.mode}`);
    console.log(`events: ${report.eventTypes.join(', ') || '(none)'}`);
    if (report.terminalError) {
      console.log(`terminal: ${report.terminalError.code} - ${report.terminalError.message}`);
    }
  }

  process.exit(report.ok ? 0 : 1);
}

function parseArgs(argv) {
  const parsed = {
    agentId: 'codex',
    modelRouteId: 'runtime-check-route',
    model: 'runtime-check-model',
    cwd: process.cwd(),
    prompt: 'ping',
    runtimeSessionId: 'runtime-check-session',
    turnId: 'runtime-check-turn',
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
Runtime chat check

Usage:
  npm run check:runtime:chat
  npm run check:runtime:chat -- --agent cangjie-magic --json

This skeleton exercises runtime adapters through runtime-agent contracts.
This check uses the real acpx/runtime client.
`);
      process.exit(0);
    }
  }

  return parsed;
}

function createProfile(options) {
  return {
    agentId: options.agentId,
    modelRouteId: options.modelRouteId,
    cwd: options.cwd,
    systemPromptHash: 'sha256:runtime-check',
    skillsRevision: 'runtime-check',
    mcpRevision: 'runtime-check',
    permissionPolicyId: 'unrestricted',
    interruptPolicy: 'queue',
  };
}

function createModelRoute(options) {
  return {
    modelRouteId: options.modelRouteId,
    agentId: options.agentId,
    runtime: options.agentId === 'cangjie-magic' ? 'magic' : 'acpx',
    providerModel: options.model,
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
}

function setupTsRuntime() {
  const root = resolve(__dirname, '..');
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
