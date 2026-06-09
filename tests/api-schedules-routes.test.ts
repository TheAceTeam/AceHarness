import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';
import { assertErrorResponse, makeRequest, responseJson } from './helpers/route-helpers';

async function createAuthToken() {
  const { createUser, storeToken } = await import('@/lib/core/user-store');
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const user = await createUser({
    username: `schedule-${suffix}`,
    email: `schedule-${suffix}@example.com`,
    password: 'password',
    question: 'q',
    answer: 'a',
    role: 'user',
    personalDir: '/tmp/project',
  });
  const token = `schedule-token-${suffix}`;
  storeToken(token, user.id);
  return { token, user };
}

async function writeRuntimeConfig(filename: string, content: string) {
  const { getWorkspaceConfigPath } = await import('@/lib/core/app-paths');
  const configPath = getWorkspaceConfigPath(filename);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, content, 'utf-8');
}

describe('schedule API routes', () => {
  test('rejects unauthenticated schedule requests', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { GET, POST } = await import('@/app/api/schedules/route');

      await assertErrorResponse(await GET(makeRequest('/api/schedules')), 401);
      await assertErrorResponse(await POST(makeRequest('/api/schedules', { json: {} })), 401);
    });
  });

  test('creates a schedule for a valid workflow config and stores the owner', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { token, user } = await createAuthToken();
      await writeRuntimeConfig('scheduled-workflow.yaml', [
        'workflow:',
        '  name: Scheduled Workflow',
        '  states:',
        '    - id: start',
        '      name: Start',
      ].join('\n'));

      const { POST, GET } = await import('@/app/api/schedules/route');
      const createResponse = await POST(makeRequest('/api/schedules', {
        token,
        json: {
          name: 'Scheduled run',
          configFile: 'scheduled-workflow.yaml',
          enabled: false,
          mode: 'cron',
          cronExpression: '0 0 * * *',
        },
      }));

      expect(createResponse.status).toBe(200);
      const createJson = await responseJson(createResponse);
      expect(createJson.job.createdBy).toBe(user.id);
      expect(createJson.job.createdByName).toBe(user.username);

      const listResponse = await GET(makeRequest('/api/schedules', { token }));
      expect(listResponse.status).toBe(200);
      const listJson = await responseJson(listResponse);
      expect(listJson.jobs).toHaveLength(1);
      expect(listJson.jobs[0].configFile).toBe('scheduled-workflow.yaml');
    });
  });

  test('rejects schedule creation when config is not a workflow', async () => {
    await withIsolatedAceHome(async () => {
      vi.resetModules();
      const { token } = await createAuthToken();
      await writeRuntimeConfig('not-workflow.yaml', 'name: Not Workflow\n');

      const { POST } = await import('@/app/api/schedules/route');
      const response = await POST(makeRequest('/api/schedules', {
        token,
        json: {
          name: 'Bad schedule',
          configFile: 'not-workflow.yaml',
          enabled: false,
          mode: 'cron',
          cronExpression: '0 0 * * *',
        },
      }));

      const json = await assertErrorResponse(response, 400);
      expect(json.error).toContain('不是有效的工作流配置');
    });
  });
});
