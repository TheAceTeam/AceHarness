import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { withIsolatedAceHome, withTempDir } from './helpers/module-helpers';

async function loadEventStore() {
  vi.resetModules();
  return import('@/lib/workflow/event-store');
}

describe('workflow event store', () => {
  test('appends events, reads by sequence, and stores snapshots', async () => {
    await withIsolatedAceHome(async () => {
      const { getWorkflowEventStore } = await loadEventStore();
      const store = getWorkflowEventStore();
      const runId = 'run-event-store-test';

      const first = await store.append(runId, 'workflow.step-start', { step: 'Analyze' });
      const second = await store.append(runId, 'workflow.step-complete', { step: 'Analyze', outputSize: 42 });

      expect(first.seq).toBe(1);
      expect(second.seq).toBe(2);

      const all = await store.read(runId);
      expect(all.map((event) => event.type)).toEqual(['workflow.step-start', 'workflow.step-complete']);
      expect(all[1].payload).toMatchObject({ step: 'Analyze', outputSize: 42 });

      const afterFirst = await store.read(runId, { afterSeq: first.seq });
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0].seq).toBe(second.seq);

      await store.saveSnapshot(runId, { runId, status: 'running', currentPhase: 'Analyze' }, { seq: second.seq });
      const snapshot = await store.getSnapshot(runId);
      expect(snapshot?.runId).toBe(runId);
      expect(snapshot?.seq).toBe(second.seq);
      expect(snapshot?.snapshot).toMatchObject({ status: 'running', currentPhase: 'Analyze' });
    });
  });

  test('appendBatch assigns contiguous sequence numbers', async () => {
    await withIsolatedAceHome(async () => {
      const { getWorkflowEventStore } = await loadEventStore();
      const store = getWorkflowEventStore();
      const runId = 'run-event-store-batch';

      const records = await store.appendBatch(runId, [
        { type: 'workflow.state-change', payload: { to: 'A' } },
        { type: 'workflow.state-change', payload: { to: 'B' } },
        { type: 'workflow.state-change', payload: { to: 'C' } },
      ]);

      expect(records.map((record) => record.seq)).toEqual([1, 2, 3]);
      const events = await store.read(runId, { limit: 2 });
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.payload.to)).toEqual(['A', 'B']);
    });
  });

  test('uses sqlite event store by default when better-sqlite3 is available', async () => {
    await withTempDir('aceharness-sqlite-event-store-', async (baseDir) => {
      const aceHome = path.join(baseDir, process.platform === 'win32' ? 'ACEHarness' : 'aceharness');
      await mkdir(aceHome, { recursive: true });
      const previousAceHome = process.env.CSIHARNESS_HOME;
      const previousAppData = process.env.APPDATA;
      const previousXdgDataHome = process.env.XDG_DATA_HOME;
      const previousWorkflowEventStore = process.env.CSIHARNESS_WORKFLOW_EVENT_STORE;
      process.env.CSIHARNESS_HOME = aceHome;
      process.env.APPDATA = baseDir;
      process.env.XDG_DATA_HOME = baseDir;
      delete process.env.CSIHARNESS_WORKFLOW_EVENT_STORE;

      try {
        const { getWorkflowEventStore, resetWorkflowEventStoreForTests } = await loadEventStore();
        const store = getWorkflowEventStore();
        const event = await store.append('run-sqlite-default', 'workflow.step-start', { step: 'Analyze' });
        expect(event.seq).toBe(1);
        expect(await store.read('run-sqlite-default')).toHaveLength(1);
        resetWorkflowEventStoreForTests();
        expect(existsSync(path.join(aceHome, 'data', 'workflow-events.sqlite'))).toBe(true);
      } finally {
        try {
          const { resetWorkflowEventStoreForTests } = await import('@/lib/workflow/event-store');
          resetWorkflowEventStoreForTests();
        } catch {}
        if (previousAceHome === undefined) delete process.env.CSIHARNESS_HOME;
        else process.env.CSIHARNESS_HOME = previousAceHome;
        if (previousAppData === undefined) delete process.env.APPDATA;
        else process.env.APPDATA = previousAppData;
        if (previousXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
        else process.env.XDG_DATA_HOME = previousXdgDataHome;
        if (previousWorkflowEventStore === undefined) delete process.env.CSIHARNESS_WORKFLOW_EVENT_STORE;
        else process.env.CSIHARNESS_WORKFLOW_EVENT_STORE = previousWorkflowEventStore;
      }
    });
  });
});
