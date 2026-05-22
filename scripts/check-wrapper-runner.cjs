#!/usr/bin/env node

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

function setupTsRuntime() {
  const root = resolve(__dirname, '..');
  const tsNodeRegister = resolve(root, 'node_modules', 'ts-node', 'register', 'transpile-only.js');
  const tsconfigPathsRegister = resolve(root, 'node_modules', 'tsconfig-paths', 'register.js');

  if (!existsSync(tsNodeRegister)) {
    throw new Error('缺少 ts-node，无法从源码加载 wrapper。请先 npm install。');
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
    engine: defaults.engine || 'opencode',
    driver: defaults.driver || 'sdk',
    model: defaults.model || 'glm-4.7',
    cwd: defaults.cwd || process.cwd(),
    timeoutMs: Number(defaults.timeoutMs) || 180_000,
    runs: Number(defaults.runs) || 1,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--engine' || arg === '-e') && argv[index + 1]) {
      options.engine = String(argv[++index] || '').trim() || options.engine;
    } else if (arg === '--driver' && argv[index + 1]) {
      options.driver = String(argv[++index] || '').trim() || options.driver;
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
  --engine, -e      引擎类型，默认 opencode
  --driver          sdk / stdio，默认 sdk
  --model           模型 ID，默认 glm-4.7
  --cwd             工作目录，默认当前目录
  --timeout-ms      单次 wrapper.execute 超时，默认 180000
  --runs            重复执行次数，默认 1
  --json            输出 JSON 汇总
${extra}`.trim());
}

// SDK 模式下 model 不含 '/' 时不加前缀——SDK wrapper 的 parseProviderModel
// 遇到无 '/' 的 model 会跳过 model override，让服务端使用已配置的默认模型。
// 加 openai/ 前缀会导致 providerID 错误（实际 provider 是 volcengine），请求直接失败。
function normalizeModel(engine, driver, model) {
  const raw = String(model || '').trim();
  return raw;
}

async function createEngineRunner(engine, driver) {
  setupTsRuntime();
  const { createEngine, createEngineForDriver, supportsDriverSelection } = require('../src/lib/engines/engine-factory');
  const normalizedEngine = String(engine || '').trim();
  const normalizedDriver = String(driver || '').trim();

  if (!normalizedEngine) {
    throw new Error('缺少 engine');
  }

  if (normalizedDriver && supportsDriverSelection(normalizedEngine)) {
    return createEngineForDriver(normalizedEngine, normalizedDriver);
  }
  return createEngine(normalizedEngine);
}

async function executeWrapperTurn(engine, input) {
  return engine.execute({
    agent: input.agent,
    step: input.step,
    prompt: input.prompt,
    systemPrompt: input.systemPrompt,
    model: input.model,
    workingDirectory: input.cwd,
    allowedTools: [],
    timeoutMs: input.timeoutMs,
    sessionId: input.sessionId,
    appendSystemPrompt: input.appendSystemPrompt,
  });
}

async function runCheckSuite(definition, options) {
  const normalizedModel = normalizeModel(options.engine, options.driver, options.model);
  const runResults = [];

  for (let runIndex = 0; runIndex < options.runs; runIndex += 1) {
    const engine = await createEngineRunner(options.engine, options.driver);
    if (!engine) {
      runResults.push({
        ok: false,
        firstAttemptOk: false,
        run: runIndex + 1,
        error: 'createEngine returned null',
        attempts: [],
      });
      continue;
    }

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

    try {
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

        const result = await executeWrapperTurn(engine, {
          agent: definition.agent,
          step: definition.step,
          prompt: turn.content,
          systemPrompt: definition.systemPrompt,
          model: normalizedModel,
          cwd: options.cwd,
          timeoutMs: options.timeoutMs,
          sessionId,
          appendSystemPrompt: !sessionId,
        });

        sessionId = result.sessionId || sessionId;
        attemptRecord.durationMs = Date.now() - attemptStart;

        if (!result.success) {
          finalError = result.error || 'wrapper 返回失败';
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
    } finally {
      try {
        engine.cancel();
      } catch {}
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
    engine: options.engine,
    driver: options.driver,
    model: normalizedModel,
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
  const m = String(text || '').match(/<result>([\s\S]*?)<\/result>/);
  if (!m) return { parsed: null, error: 'No <result>...</result> tags found' };
  return safeParseJson(m[1]);
}

module.exports = {
  createEngineRunner,
  extractResultTag,
  normalizeModel,
  parseCommonArgs,
  printCommonHelp,
  runCheckSuite,
  safeParseJson,
  setupTsRuntime,
};
