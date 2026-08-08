import { describe, expect, test, vi, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withIsolatedAceHome } from './helpers/module-helpers';

async function writeScheduledWorkflow(
  aceHome: string,
  reviewPolicy?: { mode: 'standard' | 'adversarial'; source: 'user' | 'ai'; locked: boolean },
): Promise<void> {
  const configsDir = path.join(aceHome, 'configs');
  await mkdir(configsDir, { recursive: true });
  await writeFile(path.join(configsDir, 'workflow.yaml'), JSON.stringify({
    workflow: {
      name: 'Scheduled workflow',
      mode: 'state-machine',
      states: [
        { name: 'Work', isInitial: true, isFinal: false, steps: [], transitions: [], ...(reviewPolicy ? { reviewPolicy } : {}) },
        { name: 'Done', isInitial: false, isFinal: true, steps: [], transitions: [] },
      ],
    },
  }), 'utf-8');
}

describe('SchedulerService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('triggers workflow start with an internal auth token for the job owner', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await writeScheduledWorkflow(aceHome, { mode: 'standard', source: 'user', locked: true });
      vi.resetModules();
      const { createUser, validateToken } = await import('@/lib/core/user-store');
      const user = await createUser({
        username: 'scheduler-user',
        email: 'scheduler-user@example.com',
        password: 'password',
        question: 'q',
        answer: 'a',
        role: 'user',
        personalDir: '/tmp/project',
      });

      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan: { id: 'plan-1' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-1' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const { SchedulerService } = await import('@/lib/core/scheduler');
      const scheduler = new SchedulerService();
      await scheduler.init();
      const job = await scheduler.createJob({
        name: 'Nightly workflow',
        configFile: 'workflow.yaml',
        enabled: false,
        mode: 'cron',
        cronExpression: '0 0 * * *',
        createdBy: user.id,
        createdByName: user.username,
      });

      const result = await scheduler.triggerNow(job.id, undefined, { baseUrl: 'http://127.0.0.1:3001/' });

      expect(result).toMatchObject({ runId: 'run-1', status: 'started' });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const [planUrl, planInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(planUrl).toBe('http://127.0.0.1:3001/api/workflow/start/plan');
      expect(JSON.parse(planInit.body as string)).toEqual({ configFile: 'workflow.yaml', intent: 'disabled' });
      const [startUrl, startInit] = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(startUrl).toBe('http://127.0.0.1:3001/api/workflow/start');
      expect(JSON.parse(startInit.body as string)).toEqual({
        configFile: 'workflow.yaml',
        startPlanId: 'plan-1',
        adversarialIntent: 'disabled',
      });
      const headers = startInit.headers as Record<string, string>;
      const token = headers.Authorization.replace('Bearer ', '');
      expect(validateToken(token)?.userId).toBe(user.id);
      expect((planInit.headers as Record<string, string>).Authorization).toBe(headers.Authorization);
    });
  });

  test('uses the reviewed baseline intent for unattended scheduled runs', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await writeScheduledWorkflow(aceHome, { mode: 'adversarial', source: 'ai', locked: false });
      vi.resetModules();
      const { createUser } = await import('@/lib/core/user-store');
      const user = await createUser({
        username: 'scheduler-reviewed-user',
        email: 'scheduler-reviewed-user@example.com',
        password: 'password',
        question: 'q',
        answer: 'a',
        role: 'user',
        personalDir: '/tmp/project',
      });
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(new Response(JSON.stringify({ plan: { id: 'plan-reviewed' } }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ runId: 'run-reviewed' }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const { SchedulerService } = await import('@/lib/core/scheduler');
      const scheduler = new SchedulerService();
      await scheduler.init();
      const job = await scheduler.createJob({
        name: 'Reviewed workflow',
        configFile: 'workflow.yaml',
        enabled: false,
        mode: 'cron',
        cronExpression: '0 0 * * *',
        createdBy: user.id,
      });

      await expect(scheduler.triggerNow(job.id, undefined, { baseUrl: 'http://127.0.0.1:3001' }))
        .resolves.toMatchObject({ runId: 'run-reviewed', status: 'started' });
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({ intent: 'on-demand' });
      expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
        startPlanId: 'plan-reviewed',
        adversarialIntent: 'on-demand',
      });
    });
  });

  test('records workflow start failures without throwing from the scheduler loop', async () => {
    await withIsolatedAceHome(async (aceHome) => {
      await writeScheduledWorkflow(aceHome);
      vi.resetModules();
      const { createUser } = await import('@/lib/core/user-store');
      const user = await createUser({
        username: 'scheduler-failure-user',
        email: 'scheduler-failure-user@example.com',
        password: 'password',
        question: 'q',
        answer: 'a',
        role: 'user',
        personalDir: '/tmp/project',
      });

      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: '启动前检查未通过' }), { status: 412 })
      ));

      const { SchedulerService } = await import('@/lib/core/scheduler');
      const scheduler = new SchedulerService();
      await scheduler.init();
      const job = await scheduler.createJob({
        name: 'Failing workflow',
        configFile: 'workflow.yaml',
        enabled: false,
        mode: 'cron',
        cronExpression: '0 0 * * *',
        createdBy: user.id,
      });

      const result = await scheduler.triggerNow(job.id);
      const updated = scheduler.getJob(job.id);

      expect(result).toMatchObject({ status: 'failed', error: '启动前检查未通过' });
      expect(updated?.lastRunStatus).toBe('failed');
      expect(updated?.lastRunError).toBe('启动前检查未通过');
      expect(updated?.runHistory.at(-1)?.status).toBe('failed');
      const fetchMock = vi.mocked(fetch);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/workflow\/start\/plan$/);
      expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
        configFile: 'workflow.yaml',
        intent: 'disabled',
      });
    });
  });
});
