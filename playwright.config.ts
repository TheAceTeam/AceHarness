import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/+$/, '');
const e2ePort = Number.parseInt(process.env.PLAYWRIGHT_PORT || '5188', 10);
const baseURL = externalBaseUrl || `http://127.0.0.1:${Number.isFinite(e2ePort) ? e2ePort : 5188}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  webServer: externalBaseUrl ? undefined : {
    command: 'npm run start:start',
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: true,
    env: {
      ...process.env,
      ACE_HOST: '127.0.0.1',
      ACE_PORT: String(Number.isFinite(e2ePort) ? e2ePort : 5188),
      PORT: String(Number.isFinite(e2ePort) ? e2ePort : 5188),
      NODE_ENV: 'production',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
