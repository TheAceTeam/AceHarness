#!/usr/bin/env node

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

function setupTsRuntime() {
  const root = resolve(__dirname, '..');
  const tsNodeRegister = resolve(root, 'node_modules', 'ts-node', 'register', 'transpile-only.js');
  const tsconfigPathsRegister = resolve(root, 'node_modules', 'tsconfig-paths', 'register.js');

  if (!existsSync(tsNodeRegister)) {
    throw new Error('缺少 ts-node，无法从源码加载 runtime。请先 npm install。');
  }

  process.env.TS_NODE_PROJECT = process.env.TS_NODE_PROJECT || resolve(root, 'tsconfig.json');
  process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'Node',
  });

  require(tsNodeRegister);
  if (existsSync(tsconfigPathsRegister)) {
    require(tsconfigPathsRegister);
  }
}

function parseCommonArgs(argv, defaults = {}) {
  const options = {
    agent: defaults.agent || defaults.engine || 'opencode',
    engine: defaults.engine || defaults.agent || 'opencode',
    model: defaults.model || 'glm-4.7',
    cwd: defaults.cwd || process.cwd(),
    timeoutMs: Number(defaults.timeoutMs) || 180_000,
    runs: Number(defaults.runs) || 1,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--agent' || arg === '--agent-id' || arg === '--engine' || arg === '-e') && argv[index + 1]) {
      options.agent = normalizeAgentId(String(argv[++index] || '').trim()) || options.agent;
      options.engine = options.agent;
    } else if (arg === '--driver' && argv[index + 1]) {
      index += 1;
    } else if (arg === '--model' && argv[index + 1]) {
      options.model = String(argv[++index] || '').trim() || options.model;
    } else if (arg === '--cwd' && argv[index + 1]) {
      options.cwd = argv[++index];
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      options.timeoutMs = Number(argv[++index]) || options.timeoutMs;
    } else if (arg === '--runs' && argv[index + 1]) {
      options.runs = Math.max(1, Number(argv[++index]) || options.runs);
    } else if (arg === '--concurrency' && argv[index + 1]) {
      options.concurrency = Math.max(1, Number(argv[++index]) || 5);
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

function printCommonHelp(scriptName, extra = '') {
  console.log(`
${scriptName}

选项:
  --agent, -e       Agent ID，默认 opencode
  --engine          兼容旧参数，等价于 --agent
  --model           模型 ID，默认 glm-4.7
  --cwd             工作目录，默认当前目录
  --timeout-ms      单次 runtime turn 超时，默认 180000
  --runs            重复执行次数，默认 1
  --json            输出 JSON 汇总
${extra}`.trim());
}

function normalizeAgentId(value) {
  const raw = String(value || '').trim();
  const aliases = {
    'claude-code': 'claude',
    'claude-code-acp': 'claude',
    'kiro-cli': 'kiro',
    'trae-cli': 'trae',
    'magic-cli': 'cangjie-magic',
    'opencode-sdk': 'opencode',
    'nga-sdk': 'nga',
    'codegenie-sdk': 'codegenie',
  };
  return aliases[raw] || raw;
}

function createModelRoute(options) {
  return {
    modelRouteId: `check:${options.agent}:${options.model || 'default'}`,
    agentId: options.agent,
    runtime: options.agent === 'cangjie-magic' ? 'magic' : 'acpx',
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

function createProfile(options) {
  return {
    agentId: options.agent,
    modelRouteId: `check:${options.agent}:${options.model || 'default'}`,
    cwd: options.cwd,
    systemPromptHash: 'sha256:check-wrapper-runner',
    skillsRevision: 'check-wrapper-runner',
    mcpRevision: 'check-wrapper-runner',
    permissionPolicyId: 'unrestricted',
    interruptPolicy: 'queue',
  };
}

async function createRuntimeRunner(options) {
  setupTsRuntime();
  const { createRuntimeAdapterRegistry } = require('../src/lib/runtime-agent/adapters/adapter-registry.ts');
  const { createAcpxRuntimeClient } = require('../src/lib/runtime-agent/adapters/acpx-runtime-client.ts');
  const registry = createRuntimeAdapterRegistry({
    acpxClient: createAcpxRuntimeClient({ cwd: options.cwd }),
  });
  return registry.getAdapterForAgent(options.agent);
}

async function executeRuntimeTurn(adapter, input) {
  const runtimeSessionId = `check:${input.agent}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const profileSnapshot = createProfile(input);
  const binding = await adapter.createOrLoadSession({
    runtimeSessionId,
    agentId: input.agent,
    modelRoute: createModelRoute(input),
    profileSnapshot,
  });

  let output = '';
  let error = '';
  let success = false;
  let stopReason = '';
  const turnId = `${runtimeSessionId}:turn`;

  for await (const event of adapter.runTurn(binding, {
    turnId,
    requestId: `${turnId}:request`,
    traceId: `${turnId}:trace`,
    input: input.prompt,
    interruptPolicy: 'queue',
    profileSnapshot,
  })) {
    if (event.type === 'message.delta') {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      if (typeof payload.text === 'string') output += payload.text;
    }
    if (event.type === 'message.completed') {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      if (typeof payload.text === 'string' && !output.includes(payload.text)) output += payload.text;
    }
    if (event.type === 'turn.completed') {
      success = true;
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
      stopReason = typeof payload.stopReason === 'string' ? payload.stopReason : '';
    }
    if (event.type === 'turn.failed') {
      error = event.error?.message || 'runtime turn failed';
    }
  }

  return {
    success: success || Boolean(output.trim()),
    output,
    error,
    sessionId: runtimeSessionId,
    stopReason,
  };
}

async function runCheckSuite(definition, options) {
  options.agent = normalizeAgentId(options.agent || options.engine || definition.agent);
  options.engine = options.agent;
  const runResults = [];

  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    const adapter = await createRuntimeRunner(options);
    const messages = definition.createInitialMessages();
    let sessionId = '';
    let runOk = false;
    let firstAttemptOk = false;
    let finalParsed = null;
    let finalValidationErrors = [];
    let finalError = '';
    let finalOutput = '';
    const attempts = [];
    const startedAt = Date.now();

    for (let attempt = 1; attempt <= definition.maxRetries + 1; attempt += 1) {
      const turn = messages[messages.length - 1];
      const attemptStart = Date.now();
      const attemptRecord = {
        attempt,
        prompt: turn.content,
        output: '',
        durationMs: 0,
        stage: '',
        error: '',
        validationErrors: [],
      };

      const result = await executeRuntimeTurn(adapter, {
        agent: options.agent,
        step: definition.step,
        prompt: [definition.systemPrompt, turn.content].filter(Boolean).join('\n\n'),
        model: options.model,
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        sessionId,
      });

      sessionId = result.sessionId || sessionId;
      attemptRecord.durationMs = Date.now() - attemptStart;

      if (!result.success) {
        finalError = result.error || 'runtime 返回失败';
        attemptRecord.output = result.output || '';
        attemptRecord.stage = 'execution_error';
        attemptRecord.error = finalError;
        attempts.push(attemptRecord);
        if (attempt > definition.maxRetries) break;
        messages.push({ role: 'assistant', content: result.output || '' });
        messages.push({ role: 'user', content: definition.buildExecutionErrorPrompt(finalError) });
        continue;
      }

      const output = String(result.output || '');
      finalOutput = output;
      attemptRecord.output = output;

      const extracted = definition.extractResult(output);
      if (extracted.error) {
        finalError = extracted.error;
        attemptRecord.stage = 'extract_error';
        attemptRecord.error = extracted.error;
        attempts.push(attemptRecord);
        if (attempt > definition.maxRetries) break;
        messages.push({ role: 'assistant', content: output });
        messages.push({ role: 'user', content: definition.buildRepairPrompt({ stage: 'extract', error: extracted.error, output }) });
        continue;
      }

      const validation = definition.validate(extracted.parsed);
      finalParsed = extracted.parsed;
      if (!validation.valid) {
        finalValidationErrors = validation.errors || [];
        finalError = finalValidationErrors.join('; ');
        attemptRecord.stage = 'validation_error';
        attemptRecord.error = finalError;
        attemptRecord.validationErrors = finalValidationErrors;
        attempts.push(attemptRecord);
        if (attempt > definition.maxRetries) break;
        messages.push({ role: 'assistant', content: output });
        messages.push({
          role: 'user',
          content: definition.buildRepairPrompt({
            stage: 'validate',
            error: finalError,
            output,
            parsed: extracted.parsed,
            errors: finalValidationErrors,
          }),
        });
        continue;
      }

      attemptRecord.stage = 'success';
      attempts.push(attemptRecord);
      runOk = true;
      if (attempt === 1) firstAttemptOk = true;
      finalError = '';
      if (definition.onSuccess) {
        await definition.onSuccess(extracted.parsed, { cwd: options.cwd, run: runIndex + 1, sessionId });
      }
      break;
    }

    runResults.push({
      ok: runOk,
      firstAttemptOk,
      run: runIndex + 1,
      durationMs: Date.now() - startedAt,
      sessionId,
      parsed: finalParsed,
      output: finalOutput,
      validationErrors: finalValidationErrors,
      error: finalError,
      attempts,
    });
  }

  const firstAttemptPassed = runResults.filter((item) => item.firstAttemptOk).length;
  return {
    ok: runResults.every((item) => item.ok),
    passed: runResults.filter((item) => item.ok).length,
    firstAttemptPassed,
    firstAttemptPassRate: runResults.length ? firstAttemptPassed / runResults.length : 0,
    total: runResults.length,
    passRate: runResults.length ? runResults.filter((item) => item.ok).length / runResults.length : 0,
    engine: options.agent,
    agent: options.agent,
    driver: 'runtime',
    model: options.model,
    runs: runResults,
  };
}

function safeParseJson(raw) {
  const text = String(raw || '').trim();
  try {
    return { parsed: JSON.parse(text), error: null };
  } catch {}
  try {
    const fixed = text.replace(/,\s*(}|])/g, '$1');
    return { parsed: JSON.parse(fixed), error: null };
  } catch {}
  try {
    const { jsonrepair } = require('jsonrepair');
    return { parsed: JSON.parse(jsonrepair(text)), error: null };
  } catch (e) {
    return { parsed: null, error: `Invalid JSON: ${e.message}` };
  }
}

function extractResultTag(text) {
  const source = String(text || '');
  const m = source.match(/<result>([\s\S]*?)<\/result>/);
  if (m) return safeParseJson(m[1]);

  const openIndex = source.search(/<result>/i);
  if (openIndex < 0) return { parsed: null, error: 'No <result>...</result> tags found' };
  const contentStart = openIndex + '<result>'.length;
  const bounds = findBalancedJsonObjectBounds(source.slice(contentStart));
  if (!bounds) return { parsed: null, error: 'No balanced JSON after <result> tag' };
  return safeParseJson(source.slice(contentStart + bounds.start, contentStart + bounds.end));
}

function findBalancedJsonObjectBounds(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: index + 1 };
    }
  }
  return null;
}

module.exports = {
  createRuntimeRunner,
  extractResultTag,
  normalizeAgentId,
  parseCommonArgs,
  printCommonHelp,
  runCheckSuite,
  safeParseJson,
  setupTsRuntime,
};
