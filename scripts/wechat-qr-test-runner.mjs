#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';

const profile = String(process.env.WECHAT_PROFILE || '').trim().toLowerCase();
const loginCommand = String(process.env.WECHAT_LOGIN_COMMAND || '').trim();
const afterLoginCommand = String(process.env.WECHAT_AFTER_LOGIN_COMMAND || '').trim();
const prepCommand = String(process.env.WECHAT_PREP_COMMAND || '').trim();
const finalizeCommand = String(process.env.WECHAT_FINALIZE_COMMAND || '').trim();

function resolveProfileCommands() {
  if (profile === 'openclaw') {
    return {
      prep: prepCommand || [
        'openclaw plugins install "@tencent-weixin/openclaw-weixin"',
        'openclaw config set plugins.entries.openclaw-weixin.enabled true',
      ].join(' && '),
      login: loginCommand || 'openclaw channels login --channel openclaw-weixin',
      finalize: finalizeCommand || 'openclaw gateway restart',
    };
  }

  return {
    prep: prepCommand,
    login: loginCommand,
    finalize: finalizeCommand,
  };
}

const commands = resolveProfileCommands();

if (!commands.login) {
  console.error('Missing login command.');
  console.error('Use either:');
  console.error('  1. WECHAT_PROFILE=openclaw');
  console.error('  2. WECHAT_LOGIN_COMMAND="<your adapter login command>"');
  console.error('Examples:');
  console.error('  WECHAT_PROFILE=openclaw node scripts/wechat-qr-test-runner.mjs');
  console.error('  WECHAT_LOGIN_COMMAND="cd ~/.hermes/hermes-agent && .venv/bin/python /tmp/weixin-login.py" node scripts/wechat-qr-test-runner.mjs');
  process.exit(1);
}

function runCommand(command, label) {
  console.log(`\n[wechat-test] ${label}`);
  console.log(`[wechat-test] command: ${command}\n`);
  const child = spawn(command, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  return child;
}

async function waitForExit(child, name) {
  const [code, signal] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`${name} failed with exit code ${code ?? 'null'}${signal ? `, signal ${signal}` : ''}`);
  }
}

async function main() {
  if (commands.prep) {
    console.log('[wechat-test] Step 0/3: prepare adapter');
    const prepChild = runCommand(commands.prep, 'preparing adapter');
    await waitForExit(prepChild, 'prepare command');
    console.log('[wechat-test] Adapter preparation completed.\n');
  }

  console.log('[wechat-test] Step 1/3: start login flow and wait for QR scan');
  console.log('[wechat-test] The QR code should be printed by your adapter command below.');
  const loginChild = runCommand(commands.login, 'waiting for QR login');
  await waitForExit(loginChild, 'QR login command');

  console.log('\n[wechat-test] QR login finished successfully.');

  if (commands.finalize) {
    console.log('\n[wechat-test] Step 2/3: finalize adapter runtime');
    const finalizeChild = runCommand(commands.finalize, 'finalizing adapter');
    await waitForExit(finalizeChild, 'finalize command');
  }

  if (!afterLoginCommand) {
    console.log('[wechat-test] No WECHAT_AFTER_LOGIN_COMMAND provided. Stopping here.');
    return;
  }

  console.log('\n[wechat-test] Step 3/3: continue post-login test flow');
  const afterChild = runCommand(afterLoginCommand, 'running post-login command');
  await waitForExit(afterChild, 'post-login command');
  console.log('\n[wechat-test] Post-login flow completed.');
}

main().catch((error) => {
  console.error(`\n[wechat-test] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
