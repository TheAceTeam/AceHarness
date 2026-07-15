#!/usr/bin/env node
/**
 * ACPX connectivity diagnostic.
 *
 * This script intentionally uses acpx/runtime instead of speaking ACP JSON-RPC
 * directly. It exercises the same runtime path used by ACEHarness model
 * discovery and runtime sessions.
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
  codeagent: 'codeagent',
  'kiro-cli': 'kiro',
  'trae-cli': 'trae',
  'opencode-sdk': 'opencode',
  'nga-sdk': 'nga',
  'codegenie-sdk': 'codegenie',
};

const SUPPORTED_AGENTS = [
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

function applyProcessEnvForAgent(agent) {
  if (agent === 'opencode' || agent === 'nga' || agent === 'codegenie') {
    process.env.OPENCODE_SKIP_SAFE_CHECK = process.env.OPENCODE_SKIP_SAFE_CHECK || '1';
  }
}

function parseArgs(argv) {
  const options = {
    engine: '',
    cwd: process.cwd(),
    model: '',
    prompt: 'ping',
    timeoutMs: 30000,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if ((arg === '--engine' || arg === '-e' || arg === '--agent') && argv[i + 1]) options.engine = argv[++i];
    else if (arg === '--cwd' && argv[i + 1]) options.cwd = argv[++i];
    else if (arg === '--model' && argv[i + 1]) options.model = argv[++i];
    else if (arg === '--prompt' && argv[i + 1]) options.prompt = argv[++i];
    else if (arg === '--timeout-ms' && argv[i + 1]) options.timeoutMs = Number(argv[++i]) || options.timeoutMs;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  console.log(`
ACPX connectivity diagnostic

Usage:
  node scripts/check-acp-connectivity.mjs --engine <agent> [options]

Options:
  --engine, --agent  Agent name: ${SUPPORTED_AGENTS.join(' | ')}
  --cwd             Working directory, default current directory
  --model           Optional model/config name passed through acpx sessionOptions
  --prompt          Minimal prompt, default "ping"
  --timeout-ms      Per-operation timeout, default 30000
  --json            Print machine-readable JSON

Examples:
  node scripts/check-acp-connectivity.mjs --engine codex --json
  node scripts/check-acp-connectivity.mjs --engine nga --cwd C:\\repo --timeout-ms 45000
`);
}

function normalizeAgent(value) {
  const raw = String(value || '').trim();
  return ENGINE_ALIASES[raw] || raw;
}

function pushPhase(report, phase, status, detail = {}) {
  report.phases.push({
    phase,
    status,
    time: new Date().toISOString(),
    ...detail,
  });
}

function withTimeout(promise, timeoutMs, phase) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const error = new Error(`阶段超时 ${timeoutMs}ms`);
        error.phase = phase;
        reject(error);
      }, timeoutMs).unref?.();
    }),
  ]);
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function valuesFromUnknown(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function addModel(target, seen, modelId, name) {
  const id = stringValue(modelId);
  if (!id || seen.has(id)) return;
  seen.add(id);
  target.push({ modelId: id, name: stringValue(name) || id });
}

function looksLikeModelConfigOption(option) {
  const id = stringValue(option?.id).toLowerCase();
  if (id === 'model' || id === 'models' || id.endsWith('.model')) return true;
  const label = [option?.name, option?.title, option?.label, option?.description]
    .map((value) => stringValue(value).toLowerCase())
    .filter(Boolean)
    .join(' ');
  return /\bmodels?\b/.test(label);
}

function extractModelsFromStatus(status) {
  const target = [];
  const seen = new Set();
  if (!status || typeof status !== 'object') return target;
  const models = status.models && typeof status.models === 'object' ? status.models : {};
  for (const modelId of valuesFromUnknown(models.availableModelIds)) addModel(target, seen, modelId);
  for (const item of valuesFromUnknown(models.availableModels)) {
    if (typeof item === 'string') {
      addModel(target, seen, item);
    } else if (item && typeof item === 'object') {
      addModel(target, seen, item.modelId ?? item.value ?? item.id, item.name ?? item.label ?? item.title);
    }
  }
  const options = [
    ...valuesFromUnknown(status.configOptions),
    ...valuesFromUnknown(status.details?.configOptions),
  ];
  for (const option of options) {
    if (!option || typeof option !== 'object' || !looksLikeModelConfigOption(option)) continue;
    for (const choice of [
      ...valuesFromUnknown(option.options),
      ...valuesFromUnknown(option.choices),
      ...valuesFromUnknown(option.items),
      ...valuesFromUnknown(option.values),
    ]) {
      if (typeof choice === 'string') {
        addModel(target, seen, choice);
      } else if (choice && typeof choice === 'object') {
        addModel(target, seen, choice.value ?? choice.modelId ?? choice.id ?? choice.key, choice.name ?? choice.label ?? choice.title);
      }
    }
  }
  return target;
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const agent = normalizeAgent(options.engine);
  if (!agent) {
    printHelp();
    process.exit(2);
  }

  const report = {
    ok: false,
    engine: options.engine,
    agent,
    cwd: options.cwd,
    source: 'acpx/runtime',
    phases: [],
    availableModels: [],
    modelRequested: options.model || null,
    stopReason: null,
    failure: null,
  };

  let runtime;
  let handle;
  try {
    const { createAcpRuntime, createAgentRegistry, createRuntimeStore } = await import('acpx/runtime');
    applyProcessEnvForAgent(agent);
    runtime = createAcpRuntime({
      cwd: options.cwd,
      sessionStore: createRuntimeStore({
        stateDir: resolve(root, '.acpx-connectivity-cache'),
      }),
      agentRegistry: createAgentRegistry({
        overrides: AGENT_OVERRIDES,
      }),
      permissionMode: 'approve-all',
      nonInteractivePermissions: 'deny',
      timeoutMs: options.timeoutMs,
    });
    pushPhase(report, 'runtime', 'ok');

    handle = await withTimeout(runtime.ensureSession({
      sessionKey: `connectivity:${agent}:${Date.now()}`,
      agent,
      mode: 'oneshot',
      cwd: options.cwd,
      sessionOptions: {
        ...(options.model ? { model: options.model } : {}),
      },
    }), options.timeoutMs, 'ensureSession');
    pushPhase(report, 'ensureSession', 'ok', {
      acpxRecordId: handle.acpxRecordId,
      backendSessionId: handle.backendSessionId,
    });

    const status = await withTimeout(runtime.getStatus?.({ handle }), options.timeoutMs, 'getStatus');
    const models = extractModelsFromStatus(status);
    report.availableModels = models.slice(0, 80).map((model) => model.modelId);
    pushPhase(report, 'getStatus', 'ok', { modelCount: models.length });

    const turn = runtime.startTurn({
      handle,
      text: options.prompt,
      mode: 'prompt',
      requestId: `connectivity:${Date.now()}`,
      timeoutMs: options.timeoutMs,
    });
    pushPhase(report, 'prompt.start', 'ok');
    for await (const event of turn.events) {
      if (event.type === 'error') {
        const error = new Error(event.message || 'ACPX turn error');
        error.phase = 'prompt';
        throw error;
      }
    }
    const result = await withTimeout(turn.result, options.timeoutMs, 'prompt.result');
    if (result.status === 'failed') {
      const error = new Error(result.error?.message || 'ACPX turn failed');
      error.phase = 'prompt';
      throw error;
    }
    report.stopReason = result.stopReason || null;
    pushPhase(report, 'prompt', result.status === 'cancelled' ? 'cancelled' : 'ok', {
      stopReason: report.stopReason,
    });
    report.ok = result.status === 'completed';
  } catch (error) {
    const phase = error?.phase || 'unknown';
    const message = error instanceof Error ? error.message : String(error);
    report.failure = {
      phase,
      message,
    };
    pushPhase(report, phase, 'failed', { message });
  } finally {
    if (runtime && handle) {
      await runtime.close({
        handle,
        reason: 'connectivity-check-complete',
        discardPersistentState: true,
      }).catch(() => undefined);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== ACPX Connectivity Check: ${report.agent} ===`);
    console.log(`source: ${report.source}`);
    console.log(`cwd: ${report.cwd}`);
    for (const phase of report.phases) {
      console.log(`- [${phase.status}] ${phase.phase}${phase.message ? `: ${phase.message}` : ''}`);
      if (phase.modelCount !== undefined) console.log(`    models: ${phase.modelCount}`);
      if (phase.stopReason) console.log(`    stopReason: ${phase.stopReason}`);
    }
    console.log(`\n结果: ${report.ok ? 'SUCCESS' : 'FAILED'}`);
    if (report.failure) {
      console.log(`失败阶段: ${report.failure.phase}`);
      console.log(`失败原因: ${report.failure.message}`);
    }
  }
  process.exit(report.ok ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
