/**
 * SchedulerService - 定时执行工作流的调度器
 * 单例模式，使用 node-cron 做 cron 调度，持久化到 data/schedules.yaml
 */

import { EventEmitter } from 'events';
import cron from 'node-cron';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { parse, stringify } from 'yaml';
import { randomUUID } from 'crypto';
import { getWorkspaceDataDir, getWorkspaceDataFile } from '@/lib/core/app-paths';
import { getUserById, loadUsers, storeToken } from '@/lib/core/user-store';

export interface ScheduleRunUser {
  id: string;
  username?: string;
  email?: string;
  role?: 'admin' | 'user';
  personalDir?: string;
}

export interface ScheduleExecutionOptions {
  baseUrl?: string;
}

export interface ScheduleExecutionResult {
  runId?: string;
  status: 'started' | 'failed' | 'error';
  error?: string;
}

export interface ScheduleJob {
  id: string;
  name: string;
  configFile: string;
  enabled: boolean;
  mode: 'simple' | 'cron';
  interval?: { value: number; unit: 'hour' | 'day' | 'week' };
  fixedTime?: { hour: number; minute: number; weekday?: number };
  cronExpression?: string;
  lastRunId?: string;
  lastRunTime?: string;
  lastRunStatus?: string;
  lastRunError?: string;
  nextRunTime?: string;
  createdBy?: string;
  createdByName?: string;
  createdAt: string;
  runHistory: { runId: string; time: string; status: string }[];
}

const DATA_DIR = getWorkspaceDataDir();
const SCHEDULES_FILE = getWorkspaceDataFile('schedules.yaml');

export class SchedulerService extends EventEmitter {
  private jobs: Map<string, ScheduleJob> = new Map();
  private cronTasks: Map<string, ReturnType<typeof cron.schedule>> = new Map();
  private initialized = false;

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    await this._restore();
  }

  // --- CRUD ---

  async createJob(input: Omit<ScheduleJob, 'id' | 'createdAt' | 'runHistory'>): Promise<ScheduleJob> {
    const job: ScheduleJob = {
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      runHistory: [],
    };
    if (job.mode === 'simple') {
      job.cronExpression = this._simpleToCron(job);
    }
    if (job.cronExpression) {
      job.nextRunTime = this._getNextRunTime(job.cronExpression);
    }
    this.jobs.set(job.id, job);
    if (job.enabled) this._scheduleJob(job);
    await this._persist();
    this.emit('job-created', job);
    return job;
  }

  async updateJob(id: string, patch: Partial<ScheduleJob>): Promise<ScheduleJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    Object.assign(job, patch);
    if (job.mode === 'simple') {
      job.cronExpression = this._simpleToCron(job);
    }
    if (job.cronExpression) {
      job.nextRunTime = this._getNextRunTime(job.cronExpression);
    }
    // Reschedule
    this._unscheduleJob(id);
    if (job.enabled) this._scheduleJob(job);
    await this._persist();
    this.emit('job-updated', job);
    return job;
  }

  async deleteJob(id: string): Promise<void> {
    this._unscheduleJob(id);
    this.jobs.delete(id);
    await this._persist();
    this.emit('job-deleted', { id });
  }

  async enableJob(id: string): Promise<ScheduleJob> {
    return this.updateJob(id, { enabled: true });
  }

  async disableJob(id: string): Promise<ScheduleJob> {
    return this.updateJob(id, { enabled: false });
  }

  async toggleJob(id: string): Promise<ScheduleJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    return this.updateJob(id, { enabled: !job.enabled });
  }

  listJobs(): ScheduleJob[] {
    return Array.from(this.jobs.values());
  }

  getJob(id: string): ScheduleJob | undefined {
    return this.jobs.get(id);
  }

  async triggerNow(
    id: string,
    runAsUser?: ScheduleRunUser,
    options?: ScheduleExecutionOptions
  ): Promise<ScheduleExecutionResult> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    return this._executeJob(job, runAsUser, options);
  }

  // --- Internal ---

  private async _executeJob(
    job: ScheduleJob,
    runAsUser?: ScheduleRunUser,
    options?: ScheduleExecutionOptions
  ): Promise<ScheduleExecutionResult> {
    try {
      this.emit('job-executing', { id: job.id, configFile: job.configFile });
      const user = await this._resolveRunUser(job, runAsUser);
      const token = randomUUID();
      storeToken(token, user.id);
      const res = await fetch(`${this._getInternalBaseUrl(options?.baseUrl)}/api/workflow/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ configFile: job.configFile }),
      });
      const data = await this._readJsonResponse(res);
      const runId = data.runId || (res.ok ? `run-${Date.now()}` : '');
      const now = new Date().toISOString();
      const status = res.ok ? 'started' : 'failed';
      const error = res.ok ? undefined : (data.error || data.message || `工作流启动接口返回 ${res.status}`);
      job.lastRunId = runId;
      job.lastRunTime = now;
      job.lastRunStatus = status;
      job.lastRunError = error;
      job.runHistory.push({ runId, time: now, status });
      // Keep last 50 entries
      if (job.runHistory.length > 50) job.runHistory = job.runHistory.slice(-50);
      if (job.cronExpression) {
        job.nextRunTime = this._getNextRunTime(job.cronExpression);
      }
      await this._persist();
      this.emit('job-executed', { id: job.id, runId, status, error });
      return { runId: runId || undefined, status, error };
    } catch (err: any) {
      const now = new Date().toISOString();
      job.lastRunTime = now;
      job.lastRunStatus = 'error';
      job.lastRunError = err?.message || String(err);
      job.runHistory.push({ runId: '', time: now, status: 'error' });
      await this._persist();
      this.emit('job-error', { id: job.id, error: job.lastRunError });
      return { status: 'error', error: job.lastRunError };
    }
  }

  private _scheduleJob(job: ScheduleJob) {
    if (!job.cronExpression || !cron.validate(job.cronExpression)) return;
    this._unscheduleJob(job.id);
    const task = cron.schedule(job.cronExpression, () => {
      void this._executeJob(job);
    });
    this.cronTasks.set(job.id, task);
  }

  private async _resolveRunUser(job: ScheduleJob, runAsUser?: ScheduleRunUser): Promise<ScheduleRunUser> {
    if (runAsUser?.id) return runAsUser;

    if (job.createdBy) {
      const user = await getUserById(job.createdBy);
      if (user?.status === 'active') {
        return {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          personalDir: user.personalDir,
        };
      }
    }

    const fallback = (await loadUsers()).find((user) => user.status === 'active');
    if (fallback) {
      return {
        id: fallback.id,
        username: fallback.username,
        email: fallback.email,
        role: fallback.role,
        personalDir: fallback.personalDir,
      };
    }

    throw new Error('定时任务缺少可用执行用户，无法启动工作流');
  }

  private _getInternalBaseUrl(baseUrl?: string): string {
    const raw = baseUrl?.trim()
      || process.env.ACE_INTERNAL_BASE_URL?.trim()
      || process.env.NEXT_PUBLIC_APP_URL?.trim()
      || `http://127.0.0.1:${process.env.PORT || process.env.ACE_PORT || 3000}`;
    return raw.replace(/\/+$/, '');
  }

  private async _readJsonResponse(response: Response): Promise<any> {
    const text = await response.text().catch(() => '');
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  private _unscheduleJob(id: string) {
    const task = this.cronTasks.get(id);
    if (task) {
      task.stop();
      this.cronTasks.delete(id);
    }
  }

  private _simpleToCron(job: ScheduleJob): string {
    if (job.interval) {
      const { value, unit } = job.interval;
      if (unit === 'hour') return `0 */${value} * * *`;
      if (unit === 'day') {
        const h = job.fixedTime?.hour ?? 0;
        const m = job.fixedTime?.minute ?? 0;
        return `${m} ${h} */${value} * *`;
      }
      if (unit === 'week') {
        const h = job.fixedTime?.hour ?? 0;
        const m = job.fixedTime?.minute ?? 0;
        const w = job.fixedTime?.weekday ?? 1;
        return `${m} ${h} * * ${w}`;
      }
    }
    if (job.fixedTime) {
      const { hour, minute, weekday } = job.fixedTime;
      if (weekday !== undefined) return `${minute} ${hour} * * ${weekday}`;
      return `${minute} ${hour} * * *`;
    }
    return '0 0 * * *'; // default: daily midnight
  }

  private _getNextRunTime(cronExpr: string): string {
    try {
      const now = new Date();
      const parts = cronExpr.split(' ');
      if (parts.length !== 5) return '';
      const [minP, hourP, dayP, , weekdayP] = parts;

      const next = new Date(now);
      next.setSeconds(0, 0);

      // Fixed weekday schedule (e.g. "30 2 * * 3")
      if (weekdayP !== '*') {
        const targetDay = parseInt(weekdayP);
        const h = hourP === '*' ? 0 : parseInt(hourP);
        const m = minP === '*' ? 0 : parseInt(minP);
        next.setHours(h, m);
        while (next.getDay() !== targetDay || next <= now) {
          next.setDate(next.getDate() + 1);
          next.setHours(h, m, 0, 0);
        }
        return next.toISOString();
      }

      // Fixed hour (e.g. "0 3 * * *" or "0 3 */2 * *")
      if (hourP !== '*' && !hourP.startsWith('*/')) {
        const h = parseInt(hourP);
        const m = minP === '*' ? 0 : parseInt(minP);
        next.setHours(h, m, 0, 0);
        if (next <= now) {
          if (dayP.startsWith('*/')) {
            next.setDate(next.getDate() + parseInt(dayP.slice(2)));
          } else {
            next.setDate(next.getDate() + 1);
          }
        }
        return next.toISOString();
      }

      // Interval hours (e.g. "0 */2 * * *")
      if (hourP.startsWith('*/')) {
        const interval = parseInt(hourP.slice(2));
        const m = minP === '*' ? 0 : parseInt(minP);
        next.setMinutes(m, 0, 0);
        const currentHour = next.getHours();
        const nextHour = Math.ceil((currentHour + 1) / interval) * interval;
        if (nextHour >= 24) {
          next.setDate(next.getDate() + 1);
          next.setHours(0, m, 0, 0);
        } else {
          next.setHours(nextHour, m, 0, 0);
        }
        if (next <= now) next.setHours(next.getHours() + interval);
        return next.toISOString();
      }

      // Default: next hour
      next.setMinutes(next.getMinutes() + 60);
      return next.toISOString();
    } catch {
      return '';
    }
  }

  private async _persist() {
    try {
      await mkdir(DATA_DIR, { recursive: true });
      const data = Array.from(this.jobs.values());
      await writeFile(SCHEDULES_FILE, stringify(data), 'utf-8');
    } catch (err) {
      console.error('[Scheduler] Failed to persist:', err);
    }
  }

  private async _restore() {
    try {
      const content = await readFile(SCHEDULES_FILE, 'utf-8');
      const data = parse(content) as ScheduleJob[];
      if (Array.isArray(data)) {
        for (const job of data) {
          this.jobs.set(job.id, job);
          if (job.enabled) this._scheduleJob(job);
        }
      }
    } catch {
      // File doesn't exist yet — that's fine
    }
  }
}

export const scheduler = new SchedulerService();
