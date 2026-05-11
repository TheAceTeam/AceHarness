#!/usr/bin/env node

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

const hermesHome = resolve(process.env.HERMES_HOME || join(homedir(), '.hermes'));
const hermesAgentDir = resolve(process.env.HERMES_AGENT_DIR || join(hermesHome, 'hermes-agent'));
const sourceDir = resolve(process.env.HERMES_WECHAT_SOURCE || 'C:\\tmp\\hermes-wechat');
const platformDir = join(hermesAgentDir, 'gateway', 'platforms');
const weixinSource = join(sourceDir, 'references', 'weixin.py');
const weixinTarget = join(platformDir, 'weixin.py');
const configPyPath = join(hermesAgentDir, 'gateway', 'config.py');
const runPyPath = join(hermesAgentDir, 'gateway', 'run.py');

const commands = new Set(process.argv.slice(2));
const shouldInstallDeps = commands.size === 0 || commands.has('install') || commands.has('--install-deps');
const shouldPatch = commands.size === 0 || commands.has('install') || commands.has('--patch');
const shouldLogin = commands.has('login') || commands.has('--login');

function run(command, cwd = process.cwd()) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, { shell: true, stdio: 'inherit', cwd, env: process.env });
    child.on('exit', (code) => {
      if (code === 0) resolvePromise(undefined);
      else rejectPromise(new Error(`Command failed: ${command} (${code ?? 'null'})`));
    });
    child.on('error', rejectPromise);
  });
}

async function ensureExists(path, label) {
  if (!existsSync(path)) {
    throw new Error(`${label} not found: ${path}`);
  }
}

async function patchConfigPy() {
  let content = await readFile(configPyPath, 'utf8');
  if (content.includes('WEIXIN = "weixin"')) return false;

  const marker = 'WECOM = "wecom"';
  if (!content.includes(marker)) {
    throw new Error(`Could not find marker in ${configPyPath}: ${marker}`);
  }

  content = content.replace(marker, `${marker}\n    WEIXIN = "weixin"`);
  await writeFile(configPyPath, content, 'utf8');
  return true;
}

async function patchRunPy() {
  let content = await readFile(runPyPath, 'utf8');
  if (content.includes('elif platform == Platform.WEIXIN:')) return false;

  const marker = `elif platform == Platform.WECOM:`;
  const insertBlock = [
    'elif platform == Platform.WEIXIN:',
    '    from gateway.platforms.weixin import WeixinAdapter, check_weixin_requirements',
    '    if not check_weixin_requirements():',
    '        logger.warning("WeChat: aiohttp/cryptography not installed")',
    '        return None',
    '    return WeixinAdapter(config)',
    '',
    'elif platform == Platform.WECOM:',
  ].join('\n');

  if (!content.includes(marker)) {
    throw new Error(`Could not find marker in ${runPyPath}: ${marker}`);
  }

  content = content.replace(marker, insertBlock);
  await writeFile(runPyPath, content, 'utf8');
  return true;
}

async function copyAdapter() {
  await mkdir(dirname(weixinTarget), { recursive: true });
  await copyFile(weixinSource, weixinTarget);
}

async function writeLoginHelper() {
  const helperPath = join(hermesHome, 'weixin-login.py');
  const helper = [
    'import asyncio, json, os, sys',
    `sys.path.insert(0, ${JSON.stringify(hermesAgentDir)})`,
    'from gateway.platforms.weixin import qr_login',
    '',
    `result = asyncio.run(qr_login(${JSON.stringify(hermesHome)}))`,
    'if result:',
    `    out = ${JSON.stringify(join(hermesHome, 'weixin_login_result.json'))}`,
    '    with open(out, "w", encoding="utf-8") as f:',
    '        json.dump(result, f, indent=2, ensure_ascii=False)',
    '    print(json.dumps(result, indent=2, ensure_ascii=False))',
    'else:',
    '    sys.exit(1)',
    '',
  ].join('\n');
  await writeFile(helperPath, helper, 'utf8');
  return helperPath;
}

async function main() {
  await ensureExists(hermesAgentDir, 'Hermes agent dir');
  await ensureExists(weixinSource, 'hermes-wechat source adapter');
  await ensureExists(configPyPath, 'Hermes gateway config.py');
  await ensureExists(runPyPath, 'Hermes gateway run.py');

  console.log(`[hermes-wechat-setup] Hermes home: ${hermesHome}`);
  console.log(`[hermes-wechat-setup] Hermes agent: ${hermesAgentDir}`);
  console.log(`[hermes-wechat-setup] Source repo: ${sourceDir}`);

  if (shouldInstallDeps) {
    console.log('\n[1/4] Installing Hermes WeChat dependencies...');
    await run('uv add aiohttp cryptography qrcode pillow', hermesAgentDir);
  }

  console.log('\n[2/4] Copying weixin.py adapter...');
  await copyAdapter();

  if (shouldPatch) {
    console.log('\n[3/4] Patching Hermes gateway...');
    const configChanged = await patchConfigPy();
    const runChanged = await patchRunPy();
    console.log(`[hermes-wechat-setup] config.py ${configChanged ? 'patched' : 'already patched'}`);
    console.log(`[hermes-wechat-setup] run.py ${runChanged ? 'patched' : 'already patched'}`);
  }

  const helperPath = await writeLoginHelper();
  console.log(`\n[4/4] Login helper written to: ${helperPath}`);
  console.log(`[hermes-wechat-setup] Run this to print QR code and login:`);
  console.log(`cd ${JSON.stringify(hermesAgentDir)} && .venv/bin/python ${JSON.stringify(helperPath)}`);

  if (shouldLogin) {
    console.log('\n[login] Starting QR login now...');
    await run(`.venv/bin/python ${JSON.stringify(helperPath)}`, hermesAgentDir);
  }
}

main().catch((error) => {
  console.error(`[hermes-wechat-setup] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
