#!/usr/bin/env node
/**
 * ACEHarness — 引擎可用性自检（对齐服务端 commandExists / isAvailable 思路）
 *
 * 用法（仓库根目录）:
 *   node scripts/check-engine-availability.mjs
 *   node scripts/check-engine-availability.mjs --engine nga
 *   node scripts/check-engine-availability.mjs --base-url http://127.0.0.1:3000
 *
 * Windows: commandExists 使用 where.exe；POSIX 使用 bash command -v。请在与 npm run dev 相同环境中运行。
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join, delimiter as pathDelimiter } from 'path';

const isWin = process.platform === 'win32';

/** 与 src/lib/command-exists.ts 一致的额外扫描目录（POSIX） */
const DEFAULT_SCAN_DIRS = ['/root/.local/bin', '/usr/local/bin', '/usr/bin'];

function defaultWindowsScanDirs() {
  const out = [];
  out.push(join(process.cwd(), 'node_modules', '.bin'));
  if (process.env.INIT_CWD) out.push(join(process.env.INIT_CWD, 'node_modules', '.bin'));
  if (process.env.APPDATA) out.push(join(process.env.APPDATA, 'npm'));
  if (process.env.LOCALAPPDATA) out.push(join(process.env.LOCALAPPDATA, 'Programs'));
  out.push('C:\\Program Files\\nodejs');
  return out;
}

function localNodeBinDirs() {
  return [join(process.cwd(), 'node_modules', '.bin'), process.env.INIT_CWD ? join(process.env.INIT_CWD, 'node_modules', '.bin') : ''].filter(Boolean);
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

/** 与 src/lib/command-exists.ts 对齐：Win 用 where.exe；POSIX 用 bash command -v */
function commandExistsLikeServer(name, extraDirs = DEFAULT_SCAN_DIRS) {
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
          /* ignore */
        }
      }
      return false;
    }
  }
  const dirs = extraDirs.length > 0 ? [...localNodeBinDirs(), ...extraDirs] : [...localNodeBinDirs(), ...DEFAULT_SCAN_DIRS];
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
        const bin = join(dir, name);
        if (existsSync(bin)) return true;
      } catch {
        /* ignore */
      }
    }
    return false;
  }
}

function bashAvailable() {
  try {
    execSync('bash -lc "echo ok"', { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

/** Windows 原生：where.exe */
function whereExe(name) {
  if (!isWin) return [];
  try {
    const out = execSync(`where.exe ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    return out
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** 使用当前进程 PATH + OS 分隔符，模拟「PATH 正确」时能否找到 */
function commandInPathOsNative(name) {
  try {
    if (isWin) {
      const r = whereExe(name);
      return r.length > 0 ? r[0] : null;
    }
    execSync(`command -v ${name}`, {
      stdio: 'pipe',
      encoding: 'utf-8',
      shell: '/bin/bash',
      env: process.env,
    });
    const p = execSync(`command -v ${name}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: '/bin/bash',
      env: process.env,
    }).trim();
    return p || null;
  } catch {
    return null;
  }
}

/** NGA：与 nga-wrapper / api 路由一致 —— ngagent 优先 */
function resolveNgaCommand() {
  if (commandExistsLikeServer('ngagent')) return { bin: 'ngagent', via: 'commandExists(ngagent)' };
  if (commandExistsLikeServer('nga')) return { bin: 'nga', via: 'commandExists(nga)' };
  return { bin: null, via: 'none' };
}

const ENGINE_BINARIES = {
  opencode: ['opencode'],
  nga: null, // special
  codegenie: ['codegenie'],
  cursor: ['cursor-agent', 'agent'],
  'trae-cli': ['trae-cli'],
  'kiro-cli': ['kiro-cli'],
  codex: ['codex'],
};

async function fetchAvailability(baseUrl, engine) {
  const url = `${baseUrl.replace(/\/$/, '')}/api/engine/availability?engine=${encodeURIComponent(engine)}`;
  try {
    const ctl =
      typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
        ? AbortSignal.timeout(8000)
        : undefined;
    const res = await fetch(url, ctl ? { signal: ctl } : {});
    const j = await res.json();
    return { ok: res.ok, body: j };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function tryClaudeSdk() {
  try {
    const r = spawnSync(process.execPath, ['-e', "require('@anthropic-ai/claude-agent-sdk'); console.log('ok')"], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function tryOpenCodeSdk() {
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', "import('@opencode-ai/sdk').then(()=>console.log('ok'))"], {
      cwd: process.cwd(),
      encoding: 'utf-8',
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function printHeader(title) {
  console.log(`\n${'='.repeat(60)}\n${title}\n${'='.repeat(60)}`);
}

async function main() {
  const args = process.argv.slice(2);
  let onlyEngine = null;
  let baseUrl = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--engine' && args[i + 1]) {
      onlyEngine = args[++i];
    } else if (args[i] === '--base-url' && args[i + 1]) {
      baseUrl = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
用法:
  node scripts/check-engine-availability.mjs
  node scripts/check-engine-availability.mjs --engine nga
  node scripts/check-engine-availability.mjs --base-url http://127.0.0.1:3000

说明:
  --base-url  若 ACEHarness 已启动，会请求 /api/engine/availability 对比本地检测与服务端结果。
`);
      process.exit(0);
    }
  }

  printHeader('环境与 PATH');
  console.log(`platform: ${process.platform}`);
  console.log(`cwd: ${process.cwd()}`);
  console.log(`bash 可用 (bash -lc): ${bashAvailable() ? '是' : '否'} —— POSIX 检测会使用 bash；Windows 检测使用 where.exe`);
  if (isWin) {
    console.log(
      '\n提示: Windows 上服务端优先使用 where.exe 检测 CLI；若服务端与当前终端不一致，请检查启动 Node 的 PATH。',
    );
  }
  const pathPreview = (process.env.PATH || '').slice(0, 400);
  console.log(`\nPATH (截断): ${pathPreview}${(process.env.PATH || '').length > 400 ? '...' : ''}`);

  const engines = onlyEngine
    ? [onlyEngine]
    : ['opencode', 'nga', 'codegenie', 'cursor', 'trae-cli', 'kiro-cli', 'codex', 'claude-code'];

  printHeader('各引擎 CLI 检测');

  for (const engine of engines) {
    console.log(`\n--- ${engine} ---`);

    if (engine === 'claude-code') {
      const sdk = tryClaudeSdk();
      const stdio = commandExistsLikeServer('claude-agent-acp');
      console.log(`  claude-code (sdk): ${sdk ? '可用 @anthropic-ai/claude-agent-sdk' : '不可用（未安装依赖或无法 require）'}`);
      console.log(`  claude-code (stdio): ${stdio ? '可用 claude-agent-acp' : '不可用（未找到 claude-agent-acp）'}`);
      if (isWin) console.log(`  where.exe claude-agent-acp: ${whereExe('claude-agent-acp').join(' | ') || '(未找到)'}`);
      continue;
    }

    if (engine === 'opencode') {
      const sdk = tryOpenCodeSdk();
      const stdio = commandExistsLikeServer('opencode');
      console.log(`  opencode (sdk): ${sdk ? '可用 @opencode-ai/sdk' : '不可用（未安装依赖或无法 require）'}`);
      console.log(`  opencode (stdio): ${stdio ? '可用 opencode CLI' : '不可用（未找到 opencode CLI）'}`);
      continue;
    }

    if (engine === 'nga') {
      const serverStyle = resolveNgaCommand();
      const nga = whereExe('nga');
      const ngagent = whereExe('ngagent');
      console.log(`  commandExists 风格 (bash / 扫描目录): ngagent=${commandExistsLikeServer('ngagent')}, nga=${commandExistsLikeServer('nga')}`);
      console.log(`  解析命令 (与 wrapper 一致): ${serverStyle.bin ?? '(无)'} (${serverStyle.via})`);
      if (isWin) {
        console.log(`  where.exe ngagent: ${ngagent.length ? ngagent.join(' | ') : '(未找到)'}`);
        console.log(`  where.exe nga: ${nga.length ? nga.join(' | ') : '(未找到)'}`);
      }
      console.log(`  OS PATH 下首个路径: ngagent=${commandInPathOsNative('ngagent') ?? '无'}, nga=${commandInPathOsNative('nga') ?? '无'}`);
      continue;
    }

    const bins = ENGINE_BINARIES[engine];
    if (!bins) {
      console.log('  (未配置映射，跳过)');
      continue;
    }
    for (const bin of bins) {
      const ce = commandExistsLikeServer(bin);
      const native = commandInPathOsNative(bin);
      const wh = isWin ? whereExe(bin) : [];
      console.log(`  二进制: ${bin}`);
      console.log(`    commandExists(与仓库一致): ${ce ? '是' : '否'}`);
      console.log(`    当前 shell PATH 解析: ${native ?? '否'}`);
      if (isWin) console.log(`    where.exe: ${wh.length ? wh.join(' | ') : '(未找到)'}`);
    }
  }

  if (baseUrl) {
    printHeader(`服务端对比 ${baseUrl}`);
    const list = onlyEngine
      ? [onlyEngine]
      : ['opencode', 'nga', 'codegenie', 'cursor', 'trae-cli', 'kiro-cli', 'codex', 'claude-code'];
    for (const eng of list) {
      const r = await fetchAvailability(baseUrl, eng);
      if (r.body && typeof r.body.available === 'boolean') {
        console.log(`  ${eng}: available=${r.body.available} (HTTP ${r.ok ? 'OK' : 'err'})`);
      } else if (r.error) {
        console.log(`  ${eng}: 请求失败 — ${r.error}`);
      } else {
        console.log(`  ${eng}:`, r);
      }
    }
    console.log('\n若本地 CLI 已找到但服务端 available=false：多为启动 Node 的 PATH 与当前终端不一致。\n');
  } else {
    console.log('\n提示: 加上 --base-url http://127.0.0.1:3000 可与运行中的 ACEHarness 对比 /api/engine/availability。\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
