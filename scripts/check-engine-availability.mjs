#!/usr/bin/env node
/**
 * ACEHarness engine availability check backed by acpx/runtime.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const AGENT_OVERRIDES = {
  nga: 'ngagent --disable-update acp',
  codeagent: 'codeagent acp',
  codegenie: 'codegenie acp',
};

const ENGINE_ALIASES = {
  'claude-code': 'claude',
  'claude-code-acp': 'claude',
  'kiro-cli': 'kiro',
  'trae-cli': 'trae',
  'opencode-sdk': 'opencode',
  'nga-sdk': 'nga',
  'codegenie-sdk': 'codegenie',
};

const DEFAULT_AGENTS = [
  'codex',
  'claude',
  'opencode',
  'nga',
  'codeagent',
  'codegenie',
  'cursor',
  'kiro',
  'trae',
  'pi',
  'openclaw',
  'gemini',
  'copilot',
  'kilocode',
  'kimi',
  'mux',
  'qoder',
  'qwen',
];

function parseArgs(argv) {
  const parsed = {
    agents: [],
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--engine' || arg === '--agent') && argv[index + 1]) {
      parsed.agents.push(normalizeAgent(argv[++index]));
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Usage:
  node scripts/check-engine-availability.mjs
  node scripts/check-engine-availability.mjs --engine codex --json

This check uses acpx/runtime doctor probes. It does not import provider SDKs.
`);
      process.exit(0);
    }
  }
  return parsed;
}

function normalizeAgent(value) {
  const raw = String(value || '').trim();
  return ENGINE_ALIASES[raw] || raw;
}

async function probeAgent(agent) {
  const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import('acpx/runtime');
  const runtime = createAcpRuntime({
    cwd: process.cwd(),
    sessionStore: createRuntimeStore({
      stateDir: resolve(root, '.acpx-availability-cache'),
    }),
    agentRegistry: createAgentRegistry({
      overrides: AGENT_OVERRIDES,
    }),
    permissionMode: 'approve-reads',
    nonInteractivePermissions: 'deny',
    probeAgent: agent,
    timeoutMs: 15000,
  });
  try {
    const report = await runtime.doctor();
    return {
      agent,
      available: Boolean(report.ok),
      code: report.code,
      message: report.message,
      installCommand: report.installCommand,
      details: report.details || [],
    };
  } catch (error) {
    return {
      agent,
      available: false,
      message: error instanceof Error ? error.message : String(error),
      details: [],
    };
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const agents = options.agents.length ? options.agents : DEFAULT_AGENTS;
  const rows = [];
  for (const agent of agents) {
    rows.push(await probeAgent(agent));
  }

  const report = {
    ok: rows.some((row) => row.available),
    checkedAt: new Date().toISOString(),
    source: 'acpx/runtime doctor',
    rows,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('Engine Availability Check');
    console.log(`source: ${report.source}`);
    for (const row of rows) {
      console.log(`- ${row.agent}: ${row.available ? 'available' : 'missing'} (${row.message || row.code || 'no detail'})`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
