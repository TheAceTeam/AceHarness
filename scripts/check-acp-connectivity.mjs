#!/usr/bin/env node
/**
 * ACP 全链路联通性诊断
 *
 * 目标：精确定位失败阶段（命令发现 / 子进程启动 / initialize / newSession / setModel / prompt）
 *
 * 用法：
 *   node scripts/check-acp-connectivity.mjs --engine codegenie
 *   node scripts/check-acp-connectivity.mjs --engine codegenie --model codegenie/glm-4.7
 *   node scripts/check-acp-connectivity.mjs --engine nga --cwd /path/to/workspace --timeout-ms 45000
 *   node scripts/check-acp-connectivity.mjs --engine codegenie --json
 */

import { execSync, spawn } from 'child_process';
import { existsSync, statSync } from 'fs';
import { join, delimiter as pathDelimiter } from 'path';
import { Writable, Readable } from 'node:stream';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from '@agentclientprotocol/sdk';

const isWin = process.platform === 'win32';
const DEFAULT_SCAN_DIRS_POSIX = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];
const SUPPORTED_ACP_ENGINES = ['opencode', 'codegenie', 'nga', 'cursor', 'kiro-cli', 'trae-cli'];

function parseArgs(argv) {
  const options = {
    engine: '',
    cwd: process.cwd(),
    model: '',
    /** 可执行文件绝对/相对路径（覆盖 PATH 解析） */
    commandPath: '',
    /** 仅注入子进程（ACP CLI）的 LD_LIBRARY_PATH，勿用于污染 Node 本身 */
    ldLibraryPath: '',
    prompt: 'ping',
    timeoutMs: 30000,
    json: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--engine' || a === '-e') && argv[i + 1]) {
      options.engine = argv[++i];
    } else if ((a === '--command' || a === '--binary') && argv[i + 1]) {
      options.commandPath = argv[++i];
    } else if ((a === '--ld-library-path' || a === '--ld-path') && argv[i + 1]) {
      options.ldLibraryPath = argv[++i];
    } else if (a === '--cwd' && argv[i + 1]) {
      options.cwd = argv[++i];
    } else if (a === '--model' && argv[i + 1]) {
      options.model = argv[++i];
    } else if (a === '--prompt' && argv[i + 1]) {
      options.prompt = argv[++i];
    } else if (a === '--timeout-ms' && argv[i + 1]) {
      options.timeoutMs = Number(argv[++i]) || 30000;
    } else if (a === '--json') {
      options.json = true;
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }
  return options;
}

function printHelp() {
  const supportList = SUPPORTED_ACP_ENGINES.join(' | ');
  console.log(`
ACP 全链路联通性诊断

用法:
  node scripts/check-acp-connectivity.mjs --engine <engine> [options]

必填:
  --engine, -e   引擎: ${supportList}

可选:
  --cwd          工作目录（默认: 当前目录）
  --command, --binary
                 可执行文件路径（覆盖 PATH，用于测试某目录下的 agent 二进制）
                 与 --engine nga 联用时，不再自动加 --disable-update，与 opencode 相同: acp --cwd
  --ld-library-path, --ld-path
                 (Unix) 仅写给子进程 CLI 的 LD_LIBRARY_PATH（前置拼接）；勿在 npm/node 前 export 整个 LD_LIBRARY_PATH，
                 否则会拖垮 Node。也可用环境变量 ACEH_ACP_LD_LIBRARY_PATH（同样只作用于子进程）。
  --model        指定模型（不传则跳过 setModel 阶段）
  --prompt       最小测试提示词（默认: ping）
  --timeout-ms   每阶段超时（默认: 30000）
  --json         JSON 输出（便于机器处理）

示例:
  node scripts/check-acp-connectivity.mjs --engine codegenie --model codegenie/glm-4.7
  node scripts/check-acp-connectivity.mjs --engine nga --cwd /tmp/ws --timeout-ms 45000
  node scripts/check-acp-connectivity.mjs --engine cursor --command /opt/sdk/agent
  node scripts/check-acp-connectivity.mjs --engine nga --command ./bin/codeagent --ld-library-path ~/OCHOME/bun-musl-dir/musl-lib
`);
}

/** 仅子进程：前置 extra，再接现有 LD_LIBRARY_PATH（使用 OS 路径分隔符，Unix 上即冒号） */
function mergeChildLdLibraryPath(extra, inherited) {
  const parts = [extra?.trim(), inherited].filter(Boolean);
  return parts.join(pathDelimiter);
}

function defaultWindowsScanDirs() {
  const roots = [process.env.SystemRoot, process.env.windir, 'C:\\Windows']
    .map((item) => item?.trim())
    .filter(Boolean);
  const out = [];
  for (const root of roots) {
    out.push(join(root, 'System32'));
    out.push(join(root, 'Sysnative'));
    out.push(root);
  }
  if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'npm'));
  if (process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, 'Programs'));
  out.push('C:\\Program Files\\nodejs');
  return out;
}

function resolveWindowsCmdShell() {
  const candidates = [
    process.env.ComSpec?.trim(),
    ...defaultWindowsScanDirs().map((dir) => join(dir, 'cmd.exe')),
    'C:\\Windows\\System32\\cmd.exe',
    'cmd.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => candidate.toLowerCase().endsWith('cmd.exe') && existsSync(candidate)) || candidates[0];
}

function existsNamedInDir(dir, name) {
  const candidates = [
    join(dir, `${name}.exe`),
    join(dir, `${name}.cmd`),
    join(dir, `${name}.bat`),
    join(dir, name),
  ];
  return candidates.some((p) => existsSync(p));
}

function commandExistsLikeServer(name, extraDirs = DEFAULT_SCAN_DIRS_POSIX) {
  if (!/^[\w.-]+$/.test(name)) return false;
  if (isWin) {
    try {
      execSync(`where.exe ${name}`, {
        stdio: 'ignore',
        shell: process.env.ComSpec || true,
      });
      return true;
    } catch {
      const dirs = [...(extraDirs?.length ? extraDirs : []), ...defaultWindowsScanDirs()];
      const seen = new Set();
      for (const dir of dirs) {
        if (!dir || seen.has(dir)) continue;
        seen.add(dir);
        try {
          if (existsSync(dir) && existsNamedInDir(dir, name)) return true;
        } catch {
          // ignore
        }
      }
      return false;
    }
  }

  const dirs = extraDirs.length > 0 ? extraDirs : DEFAULT_SCAN_DIRS_POSIX;
  const pathAugmented = [...dirs, process.env.PATH || ''].filter(Boolean).join(pathDelimiter);
  try {
    execSync(`command -v ${name}`, {
      stdio: 'ignore',
      shell: '/bin/bash',
      env: { ...process.env, PATH: pathAugmented },
    });
    return true;
  } catch {
    for (const dir of dirs) {
      try {
        if (existsSync(join(dir, name))) return true;
      } catch {
        // ignore
      }
    }
    return false;
  }
}

function resolveEngineCommand(engine) {
  if (engine === 'nga') {
    if (commandExistsLikeServer('ngagent')) return 'ngagent';
    return 'nga';
  }
  if (engine === 'cursor') return commandExistsLikeServer('cursor-agent') ? 'cursor-agent' : 'agent';
  return engine;
}

/**
 * @param {boolean} [explicitBinary] 为 true 时，nga 不附加 --disable-update（自定义路径下的二进制往往与官方 nga 参数集不一致）
 */
function buildArgs(engine, cwd, explicitBinary = false) {
  switch (engine) {
    case 'opencode':
    case 'codegenie':
      return ['acp', '--cwd', cwd];
    case 'nga':
      if (explicitBinary) {
        return ['acp', '--cwd', cwd];
      }
      return ['--disable-update', 'acp', '--cwd', cwd];
    case 'kiro-cli':
      return ['acp'];
    case 'cursor':
      return ['acp'];
    case 'trae-cli':
      return ['acp', 'serve'];
    default:
      throw new Error(`不支持的 engine: ${engine}`);
  }
}

function augmentPathForSpawn(existingPath) {
  const extra = isWin ? defaultWindowsScanDirs() : ['/root/.local/bin', '/usr/local/bin'];
  return [existingPath || '', ...extra].filter(Boolean).join(pathDelimiter);
}

function escapeWinCmdToken(s) {
  if (s === '') return '""';
  if (/[\s"]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function spawnAcp(engine, command, argv, cwd, env) {
  if (!isWin) {
    return spawn(command, argv, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
  const line = [command, ...argv].map(escapeWinCmdToken).join(' ');
  return spawn(line, {
    shell: resolveWindowsCmdShell(),
    windowsHide: true,
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function withTimeout(promise, timeoutMs, phase, getDiag) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => {
        const info = getDiag ? getDiag() : {};
        reject(makePhaseError(phase, `阶段超时 ${timeoutMs}ms`, info));
      }, timeoutMs);
    }),
  ]);
}

function makePhaseError(phase, message, extra = {}) {
  const e = new Error(message);
  e.phase = phase;
  e.extra = extra;
  return e;
}

function topModelIds(models, limit = 20) {
  return (models || []).slice(0, limit).map((m) => m.modelId || m.name || '<unknown>');
}

function stringValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function addModel(models, seen, modelId, name) {
  const id = stringValue(modelId);
  if (!id || seen.has(id)) return;
  seen.add(id);
  models.push({ modelId: id, name: stringValue(name) || id });
}

function arrayFromUnknown(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function looksLikeModelConfigOption(option) {
  const id = stringValue(option?.id).toLowerCase();
  if (id === 'model' || id === 'models' || id.endsWith('.model')) return true;
  const label = [
    option?.name,
    option?.title,
    option?.label,
    option?.description,
  ].map((value) => stringValue(value).toLowerCase()).filter(Boolean).join(' ');
  return /\bmodels?\b/.test(label);
}

function extractModelsFromConfigOption(option, models, seen) {
  const choices = [
    ...arrayFromUnknown(option.options),
    ...arrayFromUnknown(option.choices),
    ...arrayFromUnknown(option.items),
    ...arrayFromUnknown(option.values),
  ];

  for (const choice of choices) {
    if (typeof choice === 'string') {
      addModel(models, seen, choice);
      continue;
    }
    if (!choice || typeof choice !== 'object') continue;
    addModel(
      models,
      seen,
      choice.value ?? choice.modelId ?? choice.id ?? choice.key,
      choice.name ?? choice.label ?? choice.title ?? choice.description,
    );
  }
}

function normalizeModelsFromSessionResult(result) {
  const models = [];
  const seen = new Set();
  if (!result || typeof result !== 'object') return models;

  const modelRecord = result.models && typeof result.models === 'object' ? result.models : null;
  for (const item of arrayFromUnknown(modelRecord?.availableModels)) {
    if (typeof item === 'string') {
      addModel(models, seen, item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    addModel(models, seen, item.modelId ?? item.value ?? item.id, item.name ?? item.label ?? item.title);
  }

  for (const option of arrayFromUnknown(result.configOptions)) {
    if (!option || typeof option !== 'object') continue;
    if (!looksLikeModelConfigOption(option)) continue;
    extractModelsFromConfigOption(option, models, seen);
  }

  return models;
}

function pickModel(modelInput, availableModels) {
  if (!modelInput) return '';
  const list = availableModels || [];
  const exact = list.find((m) => m.modelId === modelInput);
  if (exact) return exact.modelId;
  if (modelInput.includes('/')) return '';
  const suffix = list.find((m) => (m.modelId || '').endsWith('/' + modelInput));
  if (suffix) return suffix.modelId;
  const normalize = (s) => String(s).toLowerCase().replace(/[._-]/g, '-');
  const normalized = normalize(modelInput);
  const normalizedMatch = list.find((m) => {
    const tail = (m.modelId || '').split('/').pop() || '';
    return normalize(tail) === normalized;
  });
  return normalizedMatch?.modelId || '';
}

function classifyHints(phase, payload) {
  const hints = [];
  if (phase === 'preflight') {
    if (payload?.explicitBinary) {
      hints.push('请确认 --command 指向存在的可执行文件，并具有执行权限 (chmod +x)。');
    } else {
      hints.push('CLI 未找到：先在同一终端执行 `<command> --help` 验证。');
      hints.push('若终端可用但脚本不可用，通常是启动进程的 PATH 不一致。');
    }
  } else if (phase === 'spawn') {
    hints.push('子进程无法拉起：检查命令名是否正确、cwd 是否存在、权限是否足够。');
    hints.push('Windows 下优先确认 npm 全局 .cmd shim 在 PATH 中。');
  } else if (phase === 'initialize') {
    hints.push('ACP 握手失败：重点看 CLI stderr 与是否支持 `acp` 子命令。');
    hints.push('可手动运行 `<command> ...args` 看是否立即退出或报参数错误。');
  } else if (phase === 'newSession') {
    hints.push('握手成功但会话创建失败：通常与工作目录权限、引擎登录态或配置损坏相关。');
  } else if (phase === 'setModel') {
    hints.push('模型设置失败：多为模型 ID 不匹配。请用 availableModels 中的 modelId。');
  } else if (phase === 'prompt') {
    hints.push('发送提示失败：检查账户额度/限流/网络代理，以及引擎侧运行日志。');
  }
  if (payload?.lastStderr) hints.push(`stderr 尾部：${String(payload.lastStderr).slice(0, 240)}`);
  return hints;
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.engine) {
    printHelp();
    process.exit(2);
  }

  const engine = opts.engine;
  if (!SUPPORTED_ACP_ENGINES.includes(engine)) {
    const supportList = SUPPORTED_ACP_ENGINES.join(', ');
    const isClaudeCode = engine === 'claude-code';
    console.error(`不支持的 ACP 引擎: ${engine}`);
    console.error(`支持的 ACP 引擎: ${supportList}`);
    if (isClaudeCode) {
      console.error('说明: claude-code 走 SDK 路径，不走 ACP 协议。');
      console.error('建议: 使用 `npm run check:engines -- --engine claude-code` 做可用性检测。');
    } else {
      console.error('提示: 可先运行 `node scripts/check-acp-connectivity.mjs --help` 查看完整用法。');
    }
    process.exit(2);
  }
  const explicitBinary = (opts.commandPath || '').trim();
  const command = explicitBinary || resolveEngineCommand(engine);
  const argv = buildArgs(engine, opts.cwd, Boolean(explicitBinary));

  const report = {
    ok: false,
    engine,
    command,
    commandOverride: explicitBinary || null,
    argv,
    cwd: opts.cwd,
    /** 实际注入子进程的 LD_LIBRARY_PATH 前缀（Unix）；勿给 Node 进程设置同名全局变量 */
    childLdLibraryPathPrefix: null,
    phases: [],
    availableModels: [],
    modelRequested: opts.model || null,
    modelResolved: null,
    stopReason: null,
    failure: null,
  };

  let child = null;
  let connection = null;
  let lastStderr = '';

  const pushPhase = (name, status, detail = {}) => {
    report.phases.push({
      phase: name,
      status,
      time: new Date().toISOString(),
      ...detail,
    });
  };

  try {
    let commandFound = false;
    if (explicitBinary) {
      try {
        if (existsSync(command) && statSync(command).isFile()) commandFound = true;
      } catch {
        commandFound = false;
      }
      if (!commandFound) {
        throw makePhaseError('preflight', `可执行文件不可用（不存在或非文件）: ${command}`, {
          command,
          explicitBinary: true,
        });
      }
    } else {
      commandFound = commandExistsLikeServer(command);
      if (!commandFound) {
        throw makePhaseError('preflight', `命令不可用: ${command}`, { command });
      }
    }
    pushPhase('preflight', 'ok', { commandFound: true, explicitBinary: Boolean(explicitBinary) });

    const ldFromCli = (opts.ldLibraryPath || '').trim();
    const ldFromEnv = (process.env.ACEH_ACP_LD_LIBRARY_PATH || '').trim();
    const ldExtra = ldFromCli || ldFromEnv;
    report.childLdLibraryPathPrefix = !isWin && ldExtra ? ldExtra : null;

    const childEnv = {
      ...process.env,
      PATH: augmentPathForSpawn(process.env.PATH),
    };
    if (!isWin && ldExtra) {
      childEnv.LD_LIBRARY_PATH = mergeChildLdLibraryPath(ldExtra, process.env.LD_LIBRARY_PATH);
    }

    child = spawnAcp(engine, command, argv, opts.cwd, childEnv);
    if (!child.stdin || !child.stdout || !child.stderr) {
      throw makePhaseError('spawn', '进程 stdio 不可用', {});
    }

    const exitedEarly = new Promise((_, reject) => {
      child.once('exit', (code, signal) => {
        reject(
          makePhaseError('spawn', `子进程提前退出 code=${code} signal=${signal}`, {
            code,
            signal,
            lastStderr,
          }),
        );
      });
      child.once('error', (err) => {
        reject(
          makePhaseError('spawn', `子进程启动错误: ${err.message}`, {
            error: err.message,
          }),
        );
      });
    });

    child.stderr.on('data', (buf) => {
      const text = buf.toString();
      lastStderr = text.trim() || lastStderr;
    });
    pushPhase('spawn', 'ok');

    const output = Writable.toWeb(child.stdin);
    const input = Readable.toWeb(child.stdout);
    const stream = ndJsonStream(output, input);

    connection = new ClientSideConnection(
      () => ({
        async requestPermission(params) {
          const optionId = params.options?.[0]?.optionId ?? 'always';
          return { outcome: { outcome: 'selected', optionId } };
        },
        async sessionUpdate() {},
        async extMethod() {
          return {};
        },
        async extNotification() {},
      }),
      stream,
    );

    await withTimeout(
      Promise.race([
        connection.initialize({
          protocolVersion: PROTOCOL_VERSION,
          clientInfo: { name: 'aceharness-acp-checker', version: '1.0.0' },
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: true },
            terminal: true,
          },
        }),
        exitedEarly,
      ]),
      opts.timeoutMs,
      'initialize',
      () => ({ lastStderr }),
    );
    pushPhase('initialize', 'ok');

    if (engine === 'cursor') {
      try {
        await withTimeout(connection.authenticate({ methodId: 'cursor_login' }), opts.timeoutMs, 'authenticate');
        pushPhase('authenticate', 'ok');
      } catch (e) {
        pushPhase('authenticate', 'warn', { message: e instanceof Error ? e.message : String(e) });
      }
    }

    const sess = await withTimeout(
      Promise.race([
        connection.newSession({ cwd: opts.cwd, mcpServers: [] }),
        exitedEarly,
      ]),
      opts.timeoutMs,
      'newSession',
      () => ({ lastStderr }),
    );
    const sessionId = sess.sessionId;
    const availableModels = normalizeModelsFromSessionResult(sess);
    report.availableModels = topModelIds(availableModels, 40);
    pushPhase('newSession', 'ok', {
      sessionId,
      modelCount: availableModels.length,
    });

    if (opts.model) {
      const resolved = pickModel(opts.model, availableModels);
      if (!resolved) {
        throw makePhaseError('setModel', `模型未匹配: ${opts.model}`, {
          requested: opts.model,
          availableModels: topModelIds(availableModels, 80),
        });
      }
      report.modelResolved = resolved;
      await withTimeout(
        Promise.race([
          connection.unstable_setSessionModel({ sessionId, modelId: resolved }),
          exitedEarly,
        ]),
        opts.timeoutMs,
        'setModel',
        () => ({ lastStderr }),
      );
      pushPhase('setModel', 'ok', { requested: opts.model, resolved });
    } else {
      pushPhase('setModel', 'skip', { reason: '未提供 --model' });
    }

    const promptResult = await withTimeout(
      Promise.race([
        connection.prompt({
          sessionId,
          prompt: [{ type: 'text', text: opts.prompt }],
        }),
        exitedEarly,
      ]),
      opts.timeoutMs,
      'prompt',
      () => ({ lastStderr }),
    );
    report.stopReason = promptResult.stopReason || null;
    pushPhase('prompt', 'ok', { stopReason: report.stopReason });

    report.ok = true;
  } catch (error) {
    const phase = error?.phase || 'unknown';
    const extra = error?.extra || {};
    const message = error instanceof Error ? error.message : String(error);
    report.failure = {
      phase,
      message,
      ...extra,
      lastStderr,
      hints: classifyHints(phase, { ...extra, lastStderr }),
    };
    pushPhase(phase, 'failed', { message, ...extra });
  } finally {
    try {
      if (connection?.close) await connection.close();
    } catch {
      // ignore
    }
    try {
      if (child && !child.killed) child.kill();
    } catch {
      // ignore
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`\n=== ACP Connectivity Check: ${report.engine} ===`);
    console.log(`command: ${report.command}`);
    if (report.commandOverride) console.log(`  (由 --command/--binary 指定，不经 PATH 解析)`);
    console.log(`argv: ${report.argv.join(' ')}`);
    console.log(`cwd: ${report.cwd}`);
    if (report.childLdLibraryPathPrefix) {
      console.log(`子进程 LD_LIBRARY_PATH 前缀: ${report.childLdLibraryPathPrefix}`);
    }
    for (const p of report.phases) {
      console.log(`- [${p.status}] ${p.phase}`);
      if (p.message) console.log(`    message: ${p.message}`);
      if (p.modelCount !== undefined) console.log(`    models: ${p.modelCount}`);
      if (p.stopReason) console.log(`    stopReason: ${p.stopReason}`);
    }
    if (report.ok) {
      console.log('\n结果: SUCCESS (ACP 全链路通过)');
      if (report.modelResolved) {
        console.log(`模型解析: ${report.modelRequested} -> ${report.modelResolved}`);
      }
    } else {
      console.log('\n结果: FAILED');
      console.log(`失败阶段: ${report.failure?.phase}`);
      console.log(`失败原因: ${report.failure?.message}`);
      if (report.failure?.hints?.length) {
        console.log('定位建议:');
        for (const h of report.failure.hints) console.log(`  - ${h}`);
      }
    }
  }

  process.exit(report.ok ? 0 : 1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});

