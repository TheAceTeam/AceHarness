import { expect, test } from '@playwright/test';

const endpoints = [
  '/workflows',
  `/dashboard?route=${encodeURIComponent('/workbench/demo.yaml?mode=history')}`,
  '/workbench/demo.yaml?mode=history',
  '/api/workflow/status?compact=1',
];

test.describe('Start production smoke', () => {
  test('client bundle hydrates without uncaught runtime errors', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.stack || error.message));

    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });

    expect(response?.ok()).toBe(true);
    await expect(page.locator('body')).not.toBeEmpty();
    await page.waitForTimeout(1_500);
    expect(pageErrors, pageErrors.join('\n\n')).toEqual([]);
  });

  for (const endpoint of endpoints) {
    test(`${endpoint} is served by the production Start app`, async ({ request }) => {
      const response = await request.get(endpoint);

      expect(response.status(), `${endpoint} must not 404`).not.toBe(404);
      expect(response.ok(), `${endpoint} must return a 2xx response`).toBe(true);
    });
  }
});
