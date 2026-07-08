#!/usr/bin/env node
/**
 * ACEHarness wrapper 对话功能检查。
 *
 * 这个脚本不只检查 CLI 是否存在，而是直接加载当前项目源码中的 engine wrapper，
 * 调用 wrapper.execute() 发一条短对话，并用汇总表展示每个 engine 的结果。
 */

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');

const SUPPORTED_ENGINES = [
  'opencode',
  'nga',
  'codegenie',
  'cursor',
  'trae-cli',
  'kiro-cli',
  'codex',
  'claude-code',
];

const SUPPORTED_DRIVERS = ['sdk', 'stdio', 'all'];

function parseArgs(argv) {
  const options = {
    engines: [],
    cwd: process.cwd(),
    model: '',
    prompt: '请只回复 OK，不要调用工具。',
    systemPrompt: '你是 ACEHarness engine wrapper 健康检查助手。请保持回复极简。',
    timeoutMs: 45_000,
    json: false,
    driver: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if ((arg === '--engine' || arg === '-e') && argv[index + 1]) {
      options.engines.push(argv[++index]);
    } else if (arg === '--all') {
      options.engines = [...SUPPORTED_ENGINES];
    } else if (arg === '--cwd' && argv[index + 1]) {
      options.cwd = argv[++index];
    } else if (arg === '--model' && argv[index + 1]) {
      options.model = argv[++index];
    } else if (arg === '--prompt' && argv[index + 1]) {
      options.prompt = argv[++index];
    } else if (arg === '--system-prompt' && argv[index + 1]) {
      options.systemPrompt = argv[++index];
    } else if (arg === '--timeout-ms' && argv[index + 1]) {
      options.timeoutMs = Number(argv[++index]) || options.timeoutMs;
    } else if (arg === '--driver' && argv[index + 1]) {
      options.driver = String(argv[++index] || '').trim();
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (options.engines.length === 0) {
    options.engines = [...SUPPORTED_ENGINES];
  }

  options.engines = [...new Set(options.engines.map((item) => item.trim()).filter(Boolean))];
  return options;
}

function printHelp() {
  console.log(`
ACEHarness wrapper 对话功能检查

用法:
  npm run check:engine-chat -- --engine opencode
  npm run check:engine-chat -- --engine opencode --timeout-ms 60000
  npm run check:engine-chat -- --all

选项:
  --engine, -e       指定 engine，可重复。支持: ${SUPPORTED_ENGINES.join(', ')}
  --all             检查所有支持的 engine
  --cwd             对话工作目录，默认当前目录
  --model           指定模型；不传则使用 wrapper/CLI 默认模型
  --prompt          健康检查提示词，默认要求只回复 OK
  --system-prompt   额外系统提示
  --timeout-ms      单个 engine 超时时间，默认 45000
  --driver          对支持多驱动的引擎指定 sdk / stdio / all
  --json            输出 JSON
`);
}

function getSupportedEngines() {
  return [...SUPPORTED_ENGINES];
}

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

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function truncate(text, max = 160) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}

function withTimeout(promise, timeoutMs, onTimeout) {
  let timer = null;
  return Promise.race([
    promise.finally(() => {
      if (timer) clearTimeout(timer);
    }),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        try { onTimeout?.(); } catch {}
        reject(new Error(`wrapper.execute 超时 ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

function statusLabel(result) {
  if (result.ok) return 'PASS';
  if (result.available === false) return 'UNAVAILABLE';
  if (result.timedOut) return 'TIMEOUT';
  return 'FAIL';
}

function printTable(rows) {
  const headers = ['Engine', 'Available', 'Chat', 'Duration', 'Session', 'Output / Error'];
  const tableRows = rows.map((row) => [
    row.engine,
    row.available === null ? '-' : row.available ? 'yes' : 'no',
    statusLabel(row),
    formatDuration(row.durationMs),
    row.sessionId || '-',
    truncate(row.ok ? row.output : row.error, 120),
  ]);
  const widths = headers.map((header, index) => Math.max(
    header.length,
    ...tableRows.map((row) => row[index].length),
  ));

  const printRow = (row) => {
    console.log(`| ${row.map((cell, index) => cell.padEnd(widths[index])).join(' | ')} |`);
  };
  printRow(headers);
  console.log(`| ${widths.map((width) => '-'.repeat(width)).join(' | ')} |`);
  for (const row of tableRows) printRow(row);
}

async function runEngine(engineType, options, createEngine) {
  const startedAt = Date.now();
  const row = {
    engine: engineType,
    ok: false,
    available: null,
    durationMs: 0,
    sessionId: '',
    stopReason: '',
    output: '',
    error: '',
    streamChunks: 0,
    timedOut: false,
  };

  let engine = null;
  try {
    engine = await createEngine(engineType);
    if (!engine) {
      row.available = false;
      row.error = 'createEngine 返回 null';
      return row;
    }

    row.available = true;
    engine.on('stream', (event) => {
      if (event?.type === 'text' && event.content) row.streamChunks += 1;
    });

    const executePromise = engine.execute({
      agent: 'health-check',
      step: 'engine-chat-check',
      prompt: options.prompt,
      systemPrompt: options.systemPrompt,
      model: options.model,
      workingDirectory: options.cwd,
      allowedTools: [],
      timeoutMs: options.timeoutMs,
      appendSystemPrompt: true,
    });

    const result = await withTimeout(executePromise, options.timeoutMs, () => {
      row.timedOut = true;
      try { engine?.cancel?.(); } catch {}
    });

    row.ok = Boolean(result?.success && String(result.output || '').trim());
    row.output = String(result?.output || '').trim();
    row.error = result?.error || (row.ok ? '' : 'wrapper 返回失败或空回复');
    row.sessionId = result?.sessionId || '';
    row.stopReason = result?.stopReason || '';
    return row;
  } catch (error) {
    row.error = error instanceof Error ? error.message : String(error);
    return row;
  } finally {
    row.durationMs = Date.now() - startedAt;
    try {
      engine?.cancel?.();
    } catch {
      // ignore
    }
  }
}

function expandEngineTargets(engines, driver, supportsDriverSelection, resolveEffectiveEngine) {
  const normalizedDriver = String(driver || '').trim();
  if (!normalizedDriver) {
    return engines.flatMap((engine) => {
      if (!supportsDriverSelection(engine)) {
        return [{ label: engine, effectiveEngine: engine }];
      }
      return ['sdk', 'stdio'].map((item) => ({
        label: `${engine}/${item}`,
        effectiveEngine: resolveEffectiveEngine(engine, item),
      })).filter((item) => item.effectiveEngine);
    });
  }

  return engines.flatMap((engine) => {
    if (!supportsDriverSelection(engine)) {
      return [{ label: engine, effectiveEngine: engine }];
    }

    if (normalizedDriver === 'all') {
      return ['sdk', 'stdio'].map((item) => ({
        label: `${engine}/${item}`,
        effectiveEngine: resolveEffectiveEngine(engine, item),
      })).filter((item) => item.effectiveEngine);
    }

    return [{
      label: `${engine}/${normalizedDriver}`,
      effectiveEngine: resolveEffectiveEngine(engine, normalizedDriver),
    }].filter((item) => item.effectiveEngine);
  });
}

async function createEngineFromEffectiveType(engineType) {
  switch (engineType) {
    case 'kiro-cli': {
      const { KiroCliEngineWrapper } = require('../src/lib/engines/kiro-cli-wrapper');
      return new KiroCliEngineWrapper();
    }
    case 'claude-code': {
      const { ClaudeCodeEngineWrapper } = require('../src/lib/engines/claude-code-wrapper');
      return new ClaudeCodeEngineWrapper();
    }
    case 'claude-code-acp': {
      const { ClaudeCodeAcpEngineWrapper } = require('../src/lib/engines/claude-code-acp-wrapper');
      return new ClaudeCodeAcpEngineWrapper();
    }
    case 'codex': {
      const { CodexEngineWrapper } = require('../src/lib/engines/codex-wrapper');
      return new CodexEngineWrapper();
    }
    case 'cursor': {
      const { CursorEngineWrapper } = require('../src/lib/engines/cursor-wrapper');
      return new CursorEngineWrapper();
    }
    case 'opencode': {
      const { OpenCodeEngineWrapper } = require('../src/lib/engines/opencode-wrapper');
      return new OpenCodeEngineWrapper();
    }
    case 'opencode-sdk': {
      const { OpenCodeSdkEngineWrapper } = require('../src/lib/engines/opencode-sdk-wrapper');
      return new OpenCodeSdkEngineWrapper();
    }
    case 'nga': {
      const { NgaEngineWrapper } = require('../src/lib/engines/nga-wrapper');
      return new NgaEngineWrapper();
    }
    case 'nga-sdk': {
      const { NgaSdkEngineWrapper } = require('../src/lib/engines/nga-sdk-wrapper');
      return new NgaSdkEngineWrapper();
    }
    case 'codegenie': {
      const { CodegenieEngineWrapper } = require('../src/lib/engines/codegenie-wrapper');
      return new CodegenieEngineWrapper();
    }
    case 'codegenie-sdk': {
      const { CodegenieSdkEngineWrapper } = require('../src/lib/engines/codegenie-sdk-wrapper');
      return new CodegenieSdkEngineWrapper();
    }
    case 'trae-cli': {
      const { TraeCliEngineWrapper } = require('../src/lib/engines/trae-cli-wrapper');
      return new TraeCliEngineWrapper();
    }
    default:
      throw new Error(`不支持的 effective engine: ${engineType}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const unsupported = options.engines.filter((engine) => !SUPPORTED_ENGINES.includes(engine));
  if (unsupported.length > 0) {
    console.error(`不支持的 engine: ${unsupported.join(', ')}`);
    console.error(`支持的 engine: ${SUPPORTED_ENGINES.join(', ')}`);
    process.exit(2);
  }

  if (options.driver && !SUPPORTED_DRIVERS.includes(options.driver)) {
    console.error(`不支持的 driver: ${options.driver}`);
    console.error(`支持的 driver: ${SUPPORTED_DRIVERS.join(', ')}`);
    process.exit(2);
  }

  setupTsRuntime();
  const { supportsDriverSelection, resolveEffectiveEngine } = require('../src/lib/engines/engine-selection');
  const targets = expandEngineTargets(options.engines, options.driver, supportsDriverSelection, resolveEffectiveEngine);

  const rows = [];
  for (const target of targets) {
    const row = await runEngine(
      target.effectiveEngine,
      options,
      createEngineFromEffectiveType,
    );
    row.engine = target.label;
    rows.push(row);
  }

  if (options.json) {
    console.log(JSON.stringify({ ok: rows.every((row) => row.ok), results: rows }, null, 2));
  } else {
    console.log(`\nACEHarness engine wrapper chat check`);
    console.log(`cwd: ${options.cwd}`);
    console.log(`prompt: ${options.prompt}`);
    printTable(rows);
  }

  process.exit(rows.every((row) => row.ok) ? 0 : 1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}

module.exports = {
  SUPPORTED_ENGINES,
  parseArgs,
  statusLabel,
  truncate,
  getSupportedEngines,
};
