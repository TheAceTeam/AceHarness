#!/usr/bin/env node
/**
 * ACEHarness engine availability check backed by acpx/runtime.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { getAcpxAgentRegistryOverrides } from './acpx-agent-overrides.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

const AGENT_OVERRIDES = getAcpxAgentRegistryOverrides();

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
  'deepseek-harness',
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
  // The standalone OpenMA launcher exposes its own version probe; use it for
  // availability instead of asking the generic ACPX doctor to infer support.
  if (agent === 'deepseek-harness') return probeDeepseekLauncher();

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

function probeDeepseekLauncher() {
  const configured = AGENT_OVERRIDES['deepseek-harness'];
  const executable = configured?.[0] || 'aceharness-deepseek-acp';
  const args = ['--version'];
  return new Promise((resolveReport) => {
    let output = '';
    let settled = false;
    const child = spawn(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const finish = (report) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveReport({
        agent: 'deepseek-harness',
        ...report,
        details: [`command=${executable} ${args.join(' ')}`, 'standalone OpenMA ACP launcher; DSH_HOME is reused at session start'],
      });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({ available: false, code: 'COMMAND_TIMEOUT', message: 'launcher --version timed out' });
    }, 15000);
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', (error) => {
      finish({ available: false, code: 'COMMAND_UNAVAILABLE', message: error instanceof Error ? error.message : String(error) });
    });
    child.once('close', (code, signal) => {
      const message = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      finish(code === 0
        ? { available: true, code: 'COMMAND_AVAILABLE', message: message || 'launcher is available' }
        : { available: false, code: 'COMMAND_FAILED', message: message || `launcher exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}` });
    });
  });
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
    source: 'acpx/runtime doctor + DeepSeek launcher --version',
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
