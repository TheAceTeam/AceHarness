#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getAcpxAgentRegistryOverrides } from './acpx-agent-overrides.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const AGENT_OVERRIDES = getAcpxAgentRegistryOverrides();
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

const options = parseArgs(process.argv.slice(2));
const agents = options.agentIds.length ? options.agentIds : DEFAULT_AGENTS;
const rows = [];
for (const agent of agents) rows.push(await probe(agent));

const report = {
  ok: rows.some((row) => row.available),
  checkedAt: new Date().toISOString(),
  source: 'acpx/runtime doctor',
  rows,
};

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('Runtime Availability Check');
  console.log(`source: ${report.source}`);
  for (const row of rows) {
    console.log(`- ${row.agentId}: ${row.available ? 'available' : 'missing'} (${row.message || row.code || 'no detail'})`);
  }
}

process.exit(report.ok ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    agentIds: [],
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--agent' || arg === '--agent-id') && argv[index + 1]) parsed.agentIds.push(argv[++index]);
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`
Runtime availability check

Usage:
  npm run check:runtime:availability
  npm run check:runtime:availability -- --agent codex --json

This check uses acpx/runtime doctor probes.
`);
      process.exit(0);
    }
  }
  return parsed;
}

async function probe(agentId) {
  // The standalone OpenMA launcher exposes its own version probe; use it for
  // availability instead of asking the generic ACPX doctor to infer support.
  if (agentId === 'deepseek-harness') return probeDeepseekLauncher();

  const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import('acpx/runtime');
  const runtime = createAcpRuntime({
    cwd: process.cwd(),
    sessionStore: createRuntimeStore({
      stateDir: resolve(root, '.acpx-runtime-availability-cache'),
    }),
    agentRegistry: createAgentRegistry({
      overrides: AGENT_OVERRIDES,
    }),
    permissionMode: 'approve-reads',
    nonInteractivePermissions: 'deny',
    probeAgent: agentId,
    timeoutMs: 15000,
  });
  try {
    const result = await runtime.doctor();
    return {
      agentId,
      runtime: 'acpx',
      available: Boolean(result.ok),
      code: result.code,
      message: result.message,
      installCommand: result.installCommand,
      details: result.details || [],
    };
  } catch (error) {
    return {
      agentId,
      runtime: 'acpx',
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
        agentId: 'deepseek-harness',
        runtime: 'acpx',
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
