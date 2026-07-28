import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const host = process.env.ACE_HOST || '127.0.0.1';
const port = Number(process.env.PORT || process.env.ACE_PORT || 3217);
const baseUrl = (process.env.SMOKE_BASE_URL || `http://${host}:${port}`).replace(/\/+$/, '');
const shouldStart = process.env.SMOKE_BASE_URL ? false : process.env.SMOKE_SKIP_START !== '1';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 60_000);
const startCommand = process.platform === 'win32' ? 'cmd.exe' : 'npm';
const startArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm start'] : ['start'];
const endpoints = [
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
    if (!response.ok || response.status === 404) {
      const body = await response.text().catch(() => '');
      failures.push(`${endpoint} -> ${response.status}${body ? ` ${body.slice(0, 160)}` : ''}`);
    } else {
      console.log(`[smoke] ${endpoint} -> ${response.status}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`Start production smoke failed:\n${failures.join('\n')}`);
  }
}

try {
  if (shouldStart) {
    child = spawn(startCommand, startArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ACE_HOST: host,
        PORT: String(port),
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
  }

  await runSmoke();
} finally {
  if (child && !child.killed) {
    shuttingDown = true;
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
      await delay(500);
      if (!child.killed) child.kill('SIGKILL');
    }
  }
}
