import { describe, expect, test, vi, afterEach } from 'vitest';
import { withIsolatedAceHome } from './helpers/module-helpers';

describe('SchedulerService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('triggers workflow start with an internal auth token for the job owner', async () => {
    await withIsolatedAceHome(async () => {
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

      const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ runId: 'run-1' }), { status: 200 }));
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
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:3001/api/workflow/start');
      expect(JSON.parse(init.body as string)).toEqual({ configFile: 'workflow.yaml' });
      const headers = init.headers as Record<string, string>;
      const token = headers.Authorization.replace('Bearer ', '');
      expect(validateToken(token)?.userId).toBe(user.id);
    });
  });

  test('records workflow start failures without throwing from the scheduler loop', async () => {
    await withIsolatedAceHome(async () => {
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
    });
  });
});
