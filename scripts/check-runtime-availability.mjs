#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { delimiter, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
setupTsRuntime();

const {
  getBuiltinAgentDefinitions,
  mergeAgentRuntimeState,
} = require('../src/lib/runtime-agent/agent-registry.ts');

const options = parseArgs(process.argv.slice(2));
const definitions = getBuiltinAgentDefinitions(options.tiers);
const agents = options.agentIds.length
  ? definitions.filter((definition) => options.agentIds.includes(definition.id))
  : definitions;

const rows = agents.map((definition) => {
  const commands = [
    definition.command,
    ...(definition.fallbackCommands ?? []),
  ].filter(Boolean);
  const resolved = commands.find((command) => commandExists(command));
  return {
    agentId: definition.id,
    runtime: definition.runtime,
    tier: definition.tier,
    command: definition.command ?? '',
    fallbackCommands: definition.fallbackCommands ?? [],
    available: Boolean(resolved),
    resolvedCommand: resolved ?? null,
  };
});

const merged = mergeAgentRuntimeState(
  rows.map((row) => ({
    agentId: row.agentId,
    availability: {
      status: row.available ? 'available' : 'missing',
      checkedAt: new Date().toISOString(),
      message: row.available ? `Resolved ${row.resolvedCommand}` : 'No command found in PATH',
    },
  })),
  definitions,
);

const report = {
  ok: rows.length > 0,
  checkedAt: new Date().toISOString(),
  source: 'runtime-agent registry',
  rows,
  mergedCount: merged.length,
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Runtime Availability Check');
  console.log(`source: ${report.source}`);
  for (const row of rows) {
    const status = row.available ? 'available' : 'missing';
    const command = row.resolvedCommand ?? ([row.command, ...row.fallbackCommands].filter(Boolean).join(' | ') || '(none)');
    console.log(`- ${row.agentId} [${row.runtime}/${row.tier}]: ${status} (${command})`);
  }
}

process.exit(report.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    agentIds: [],
    tiers: undefined,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--agent' || arg === '--agent-id') && argv[index + 1]) {
      parsed.agentIds.push(argv[++index]);
    } else if (arg === '--tier' && argv[index + 1]) {
      parsed.tiers = [...(parsed.tiers ?? []), argv[++index]];
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Runtime availability check

Usage:
  npm run check:runtime:availability
  npm run check:runtime:availability -- --agent codex
  npm run check:runtime:availability -- --tier core --json

This runtime-first check reads the agent registry and probes agent commands.
It does not import the old architecture engine factory.
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

function commandExists(command) {
  if (!command || !/^[\w.-]+$/.test(command)) return false;
  if (process.platform === 'win32') {
    try {
      execFileSync('where.exe', [command], { stdio: 'ignore' });
      return true;
    } catch {
      return windowsFallbackDirs().some((dir) => existsNamedInDir(dir, command));
    }
  }

  const env = {
    ...process.env,
    PATH: [join(root, 'node_modules', '.bin'), process.env.PATH ?? ''].filter(Boolean).join(delimiter),
  };
  try {
    execFileSync('bash', ['-lc', `command -v ${command}`], { stdio: 'ignore', env });
    return true;
  } catch {
    return false;
  }
}

function windowsFallbackDirs() {
  return [
    join(root, 'node_modules', '.bin'),
    process.env.INIT_CWD ? join(process.env.INIT_CWD, 'node_modules', '.bin') : '',
    process.env.APPDATA ? join(process.env.APPDATA, 'npm') : '',
    'C:\\Program Files\\nodejs',
  ].filter(Boolean);
}

function existsNamedInDir(dir, command) {
  return ['.exe', '.cmd', '.bat', ''].some((ext) => existsSync(join(dir, `${command}${ext}`)));
}
