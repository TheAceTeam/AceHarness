import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import {
  applyAcceptedWorkbenchRecovery,
  mergeUserVisibleStopProgressSteps,
  selectCurrentStepAttemptLogs,
  shouldConnectWorkbenchRunStatusStream,
  shouldEnableWorkbenchStatusSync,
  formatLiveOutputTimestamp,
  type WorkbenchStopProgressStep,
} from '@/client/pages/workbench/WorkbenchClient';

const initialStopSteps: WorkbenchStopProgressStep[] = [
  { id: 'request', label: '发送停止请求', status: 'running' },
  { id: 'manager-stop', label: '停止运行实例', status: 'pending' },
  { id: 'process-cleanup', label: '清理运行资源', status: 'pending' },
  { id: 'state-persist', label: '保存停止状态', status: 'pending' },
  { id: 'refresh', label: '刷新运行状态', status: 'pending' },
];

describe('Workbench historical run live sync', () => {
  test('formats live-output separators with the complete Chinese date and time', () => {
    expect(formatLiveOutputTimestamp('2026-05-06T07:08:09')).toBe('2026/5/6 07:08:09');
    expect(formatLiveOutputTimestamp('')).toBeNull();
    expect(formatLiveOutputTimestamp('not-a-timestamp')).toBeNull();
  });

  test('does not commit recovery UI state when the launch request is rejected', async () => {
    const applyAcceptedState = vi.fn();

    await expect(applyAcceptedWorkbenchRecovery(
      () => Promise.reject(new Error('launch rejected')),
      applyAcceptedState,
    )).rejects.toThrow('launch rejected');

    expect(applyAcceptedState).not.toHaveBeenCalled();
  });

  test('commits recovery UI state only after the launch request succeeds', async () => {
    const applyAcceptedState = vi.fn();

    await expect(applyAcceptedWorkbenchRecovery(
      () => Promise.resolve({ accepted: true }),
      applyAcceptedState,
    )).resolves.toEqual({ accepted: true });

    expect(applyAcceptedState).toHaveBeenCalledTimes(1);
  });

  test('keeps an explicitly addressed active history run eligible for status refresh', async () => {
    const scopedHistoryRun = {
      viewMode: 'run' as const,
      isHistoryRunView: true,
      configFile: 'workflow.yaml',
      runId: 'run-active-history',
    };

    expect(shouldEnableWorkbenchStatusSync(scopedHistoryRun)).toBe(true);
    expect(shouldConnectWorkbenchRunStatusStream(scopedHistoryRun)).toBe(true);
    expect(shouldEnableWorkbenchStatusSync({ ...scopedHistoryRun, runId: '' })).toBe(false);
    expect(shouldConnectWorkbenchRunStatusStream({ ...scopedHistoryRun, viewMode: 'design' })).toBe(false);

    const source = await readFile(new URL('../src/client/pages/workbench/WorkbenchClient.tsx', import.meta.url), 'utf8');
    expect(source).toContain('enabled: shouldSyncWorkbenchStatus');
    expect(source).toContain('workflowApi.connectStatusStream(');
    expect(source).toContain('{ configFile, runId: requestedRunId }');
    expect(source).toContain('syncWorkflowEventLogUntil(snapshotRunId, snapshotEventSeq);');
  });

  test('binds the explicit state-machine rerun action to the workbench handler', async () => {
    const source = await readFile(new URL('../src/client/pages/workbench/WorkbenchClient.tsx', import.meta.url), 'utf8');

    expect(source).toContain('onRerunFromStep={handleRerunFromStep}');
    expect(source).toContain('() => workflowApi.rerunFromStep(rid, stepName)');
    expect(source).toContain('await applyAcceptedWorkbenchRecovery(');
  });

  test('retains superseded attempts in history without restoring them as current step results', () => {
    const attempts = [
      { id: 'old-complete', superseded: true },
      { id: 'old-failed', superseded: true },
      { id: 'current', superseded: false },
    ];

    expect(selectCurrentStepAttemptLogs(attempts)).toEqual([
      { id: 'current', superseded: false },
    ]);
  });
});

describe('Workbench stop progress', () => {
  test('keeps only user-facing phases and discards ACP/session diagnostics', () => {
    const steps = mergeUserVisibleStopProgressSteps(initialStopSteps, [
      {
        id: 'agent-sweep-session-scope',
        label: '跳过 agent 进程清理（未能解析出待停止 run 的 ACP 会话，避免按目录误伤其他 run）',
        status: 'skipped',
        detail: 'ACP session was not resolved',
      },
      {
        id: 'agent-sweep-empty',
        label: '未匹配到 agent 进程',
        status: 'skipped',
        detail: '0 ACPX processes matched',
      },
      {
        id: 'process-cleanup',
        label: 'internal process sweep',
        status: 'success',
        detail: 'resolved ACP record and session details',
        durationMs: 42,
      },
    ]);

    expect(steps.map((step) => step.id)).toEqual([
      'request',
      'manager-stop',
      'process-cleanup',
      'state-persist',
      'refresh',
    ]);
    expect(steps.find((step) => step.id === 'process-cleanup')).toMatchObject({
      label: '清理运行资源',
      status: 'success',
      durationMs: 42,
    });
    expect(steps.every((step) => step.detail === undefined)).toBe(true);
    expect(JSON.stringify(steps)).not.toMatch(/ACP|session|agent-sweep/i);
  });
});
