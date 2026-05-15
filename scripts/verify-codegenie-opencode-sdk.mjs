/**
 * Verify CodeGenie `serve` HTTP API vs @opencode-ai/sdk client.
 * Run: node scripts/verify-codegenie-opencode-sdk.mjs
 */
import { spawn } from 'child_process';
import { createOpencodeClient } from '@opencode-ai/sdk';

const PORT = 18766 + Math.floor(Math.random() * 200);
const HOST = '127.0.0.1';
const baseUrl = `http://${HOST}:${PORT}`;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/global/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await sleep(150);
  }
  throw new Error(`Health check timeout (${timeoutMs}ms) at ${baseUrl}/global/health`);
}

const codegeniePath = process.env.CODEGENIE_BIN || 'codegenie';
const proc = spawn(codegeniePath, ['serve', `--hostname=${HOST}`, `--port=${String(PORT)}`], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env },
  cwd: process.cwd(),
});

let bootLog = '';
proc.stdout?.on('data', (c) => {
  bootLog += c.toString();
});
proc.stderr?.on('data', (c) => {
  bootLog += c.toString();
});

const kill = () => {
  try {
    proc.kill('SIGTERM');
  } catch {
    /* ignore */
  }
};

let exitCode = null;
proc.on('exit', (code) => {
  exitCode = code;
});

try {
  await sleep(800);
  const healthJson = await waitForHealth(20_000);

  const hasOpencodePrefix = /opencode server listening/i.test(bootLog);
  const hasCodegeniePrefix = /codegenie server listening/i.test(bootLog);

  const client = createOpencodeClient({ baseUrl });

  console.log('--- Results ---');
  console.log('1) Boot log contains "opencode server listening"?', hasOpencodePrefix);
  console.log('2) Boot log contains "codegenie server listening"?', hasCodegeniePrefix);
  console.log('3) fetch GET /global/health:', JSON.stringify(healthJson));

  const cfg = await client.config.get({});
  console.log('4) createOpencodeClient().config.get():', cfg.error ? JSON.stringify(cfg.error) : 'ok (has data)');

  const session = await client.session.create({
    body: {},
    query: { directory: process.cwd() },
  });
  if (session.error) {
    console.log('5) session.create: ERROR', JSON.stringify(session.error));
  } else {
    console.log('5) session.create: ok id=', session.data?.id ?? session.data);
  }

  console.log('\nConclusion:');
  if (!hasOpencodePrefix && hasCodegeniePrefix) {
    console.log(
      '- @opencode-ai/sdk createOpencodeServer() waits for a line starting with "opencode server listening";',
    );
    console.log('  CodeGenie prints "codegenie server listening ..." => createOpencode() cannot bootstrap CodeGenie without SDK fork or wrapper.');
  }
  console.log('- createOpencodeClient({ baseUrl }) against CodeGenie serve: WORKS if steps 3–5 succeeded.');
} catch (e) {
  console.error('VERIFY_FAILED:', e?.message || e);
  console.error('Boot log tail:\n', bootLog.slice(-4000));
  process.exitCode = 1;
} finally {
  kill();
  await sleep(300);
}

if (exitCode !== null && exitCode !== 0) {
  console.log('child exit code:', exitCode);
}
