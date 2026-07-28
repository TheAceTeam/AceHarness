import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.CSIHARNESS_HOST || '127.0.0.1';
const rawPort = process.env.CSIHARNESS_PORT || process.env.PORT || '3217';
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`[CSIHarness smoke] Invalid port: ${rawPort}`);
}
const baseUrl = (process.env.SMOKE_BASE_URL || `http://${host}:${port}`).replace(/\/+$/, '');
const shouldStart = process.env.SMOKE_BASE_URL ? false : process.env.SMOKE_SKIP_START !== '1';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 60_000);
const startCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const startArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm start'] : ['start'];
const temporaryRuntimeBase = shouldStart && !process.env.CSIHARNESS_HOME
  ? mkdtempSync(path.join(os.tmpdir(), 'csiharness-smoke-'))
  : null;
const runtimeHome = process.env.CSIHARNESS_HOME
  || (temporaryRuntimeBase ? path.join(temporaryRuntimeBase, 'runtime') : '');
const endpoints = [
  '/',
  '/workflows',
  `/dashboard?route=${encodeURIComponent('/workbench/demo.yaml?mode=history')}`,
  '/workbench/demo.yaml?mode=history',
  '/api/workflow/status?compact=1',
];

let child = null;
let shuttingDown = false;

function endpointUrl(endpoint) {
  return `${baseUrl}${endpoint}`;
}

async function fetchWithTimeout(url, timeout = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer() {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetchWithTimeout(endpointUrl('/api/workflow/status?compact=1'), 3_000);
      if (response.status !== 404) return;
      lastError = new Error(`readiness endpoint returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(750);
  }

  throw new Error(`Start server did not become ready within ${timeoutMs}ms: ${lastError?.message || lastError}`);
}

async function runSmoke() {
  const failures = [];

  for (const endpoint of endpoints) {
    const response = await fetchWithTimeout(endpointUrl(endpoint), 10_000);
    const body = endpoint === '/' || !response.ok || response.status === 404
      ? await response.text().catch(() => '')
      : '';
    if (!response.ok || response.status === 404) {
      failures.push(`${endpoint} -> ${response.status}${body ? ` ${body.slice(0, 160)}` : ''}`);
    } else if (endpoint === '/' && !body.includes('CSIHarness Power By ACE/AET')) {
      failures.push(`${endpoint} -> ${response.status} missing CSIHarness product title`);
    } else {
      console.log(`[smoke] ${endpoint} -> ${response.status}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Start production smoke failed:\n${failures.join('\n')}`);
  }
}

async function waitForChildExit(timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child?.off('close', onClose);
      resolve(false);
    }, timeoutMs);
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once('close', onClose);
  });
}

async function stopChildProcessTree() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    await waitForChildExit(5_000);
    return;
  }

  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  if (await waitForChildExit(5_000)) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
  await waitForChildExit(2_000);
}

function assertRuntimeMarker() {
  if (!runtimeHome) return;
  const markerPath = path.join(runtimeHome, '.csiharness-root.json');
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  if (marker.product !== 'CSIHarness' || marker.packageName !== 'csiharness') {
    throw new Error(`Unexpected CSIHarness runtime marker: ${markerPath}`);
  }
}

try {
  if (shouldStart) {
    child = spawn(startCommand, startArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        CSIHARNESS_HOST: host,
        CSIHARNESS_HOME: runtimeHome,
        CSIHARNESS_PORT: String(port),
        NODE_ENV: 'production',
      },
    });

    child.stdout.on('data', (chunk) => process.stdout.write(chunk));
    child.stderr.on('data', (chunk) => process.stderr.write(chunk));
    child.on('exit', (code, signal) => {
      if (shuttingDown) return;
      if (code !== null && code !== 0) {
        console.error(`[smoke] npm start exited with code ${code}`);
      } else if (signal) {
        console.error(`[smoke] npm start exited from signal ${signal}`);
      }
    });

    await waitForServer();
    assertRuntimeMarker();
  }

  await runSmoke();
} finally {
  if (child) {
    shuttingDown = true;
    await stopChildProcessTree();
  }
  if (temporaryRuntimeBase) {
    rmSync(temporaryRuntimeBase, { recursive: true, force: true });
  }
}
