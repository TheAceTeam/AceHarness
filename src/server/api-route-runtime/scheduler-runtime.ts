import { scheduler } from '@/lib/core/scheduler';

let schedulerInitPromise: Promise<void> | null = null;

export function ensureSchedulerInitialized(): Promise<void> {
  schedulerInitPromise ??= scheduler.init();
  return schedulerInitPromise;
}
