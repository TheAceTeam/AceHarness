import { readFile } from 'node:fs/promises';
import { describe, expect, test, vi } from 'vitest';
import {
  applyAcceptedWorkbenchRecovery,
  applyWorkbenchLiveStreamTransportFrame,
  buildWorkflowConfigWithName,
  createStopProgressSteps,
  markStopProgressStatePersisted,
  mergeUserVisibleStopProgressSteps,
  reconstructWorkbenchCachedLiveStreamContent,
  selectCurrentStepAttemptLogs,
  shouldConnectWorkbenchRunStatusStream,
  shouldEnableWorkbenchStatusSync,
  upsertStartedRunInHistory,
  formatLiveOutputTimestamp,
  getWorkflowStatusDotClass,
  resolveSoleConfiguredWorkflowStepName,
  resolveStartPreflightStrategy,
  resolveWorkbenchRuntimeWorkflowConfig,
  resolveWorkbenchStateMapPresentation,
  shouldShowWorkbenchHumanAttention,
  resolveInitialAdversarialIntent,
  buildWorkbenchRunDetailNavItems,
  resolveWorkbenchLiveStreamStepKeys,
  type WorkbenchStopProgressStep,
} from '@/client/pages/workbench/WorkbenchClient';

const initialStopSteps: WorkbenchStopProgressStep[] = [
  { id: 'request', label: '发送停止请求', status: 'running' },
  { id: 'manager-stop', label: '停止运行实例', status: 'pending' },
  { id: 'state-persist', label: '保存停止状态', status: 'pending' },
  { id: 'process-cleanup', label: '清理运行资源', status: 'pending' },
  { id: 'refresh', label: '刷新运行状态', status: 'pending' },
];

describe('Workbench historical run live sync', () => {
  test('preselects a run review intent when the config carries no baseline', () => {
    // Lightweight and pre-protocol configs report no baseline. Without a preselected
    // option the start dialog's primary button is disabled by a choice that sits
    // below the fold, so it reads as broken rather than blocked.
    expect(resolveInitialAdversarialIntent(null)).toBe('disabled');
    expect(resolveInitialAdversarialIntent(undefined)).toBe('disabled');
    expect(resolveInitialAdversarialIntent('on-demand')).toBe('on-demand');
    expect(resolveInitialAdversarialIntent('disabled')).toBe('disabled');
  });

  test('uses consistent semantic colors for run status dots', () => {
    expect(getWorkflowStatusDotClass('running', true)).toBe('bg-blue-500');
    expect(getWorkflowStatusDotClass('completed', false)).toBe('bg-emerald-500');
    expect(getWorkflowStatusDotClass('failed', false)).toBe('bg-red-500');
    expect(getWorkflowStatusDotClass('stopped', false)).toBe('bg-slate-400');
  });

  test('uses the matching run snapshot workflow instead of the reusable base config', () => {
    const baseConfig = { workflow: { name: 'Reusable', mode: 'lightweight', states: [{ name: '执行' }] }, context: { keep: true } };
    const projected = resolveWorkbenchRuntimeWorkflowConfig({
      baseConfig,
      activeRunId: 'run-promoted',
      runDetail: {
        runId: 'run-promoted',
        workflow: { name: 'Reusable', mode: 'state-machine', states: [{ name: '执行与对抗' }, { name: '完成' }] },
      },
    });

    expect(projected).toEqual({
      workflow: { name: 'Reusable', mode: 'state-machine', states: [{ name: '执行与对抗' }, { name: '完成' }] },
      context: { keep: true },
    });
    expect(resolveWorkbenchRuntimeWorkflowConfig({
      baseConfig,
      activeRunId: 'run-other',
      runDetail: { runId: 'run-promoted', workflow: projected.workflow },
    })).toBe(baseConfig);
  });

  test('labels the state map as a run snapshot only when a matching runtime workflow exists', () => {
    const baseConfig = { workflow: { mode: 'state-machine', states: [{ name: '配置对抗' }] } };
    const runtime = resolveWorkbenchStateMapPresentation({
      baseConfig,
      activeRunId: 'run-disabled',
      statusSnapshot: {
        runId: 'run-disabled',
        workflow: { mode: 'state-machine', states: [{ name: '本次标准' }] },
      },
    });

    expect(runtime.source).toBe('run');
    expect(runtime.config.workflow.states).toEqual([{ name: '本次标准' }]);
    expect(resolveWorkbenchStateMapPresentation({
      baseConfig,
      activeRunId: 'run-other',
      statusSnapshot: { runId: 'run-disabled', workflow: runtime.config.workflow },
    })).toEqual({ config: baseConfig, source: 'configuration' });
  });

  test('keeps structured tasks and runtime output navigation for a promoted lightweight run', () => {
    const items = buildWorkbenchRunDetailNavItems({
      isLightweightWorkflow: false,
      runtimeSpecAvailable: true,
      includeStructuredTasklist: true,
    });

    expect(items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'state', label: '状态图' }),
      expect.objectContaining({ id: 'tasklist', label: '任务清单', documentSource: 'tasklist' }),
      expect.objectContaining({ id: 'documents', label: '步骤文档', documentSource: 'runtime-output' }),
    ]));
  });

  test('executes project preflight exactly once and honors a planned-run skip', () => {
    expect(resolveStartPreflightStrategy({ plannedStart: false, skipRequested: false })).toEqual({
      runInClient: true,
      skipOnServer: true,
    });
    expect(resolveStartPreflightStrategy({ plannedStart: true, skipRequested: false })).toEqual({
      runInClient: false,
      skipOnServer: false,
    });
    expect(resolveStartPreflightStrategy({ plannedStart: true, skipRequested: true })).toEqual({
      runInClient: false,
      skipOnServer: true,
    });
  });

  test('keeps a newly started run locally selectable before history refresh completes', () => {
    const startedRun = { id: 'run-new', status: 'preparing' };

    expect(upsertStartedRunInHistory([
      { id: 'run-old', status: 'completed' },
      { id: 'run-new', status: 'failed' },
    ], startedRun)).toEqual([
      startedRun,
      { id: 'run-old', status: 'completed' },
    ]);
  });

  test('builds an immutable workflow-name save draft from the active edit value', () => {
    const config = { workflow: { name: 'Before', mode: 'lightweight' }, context: { keep: true } };

    expect(buildWorkflowConfigWithName(config, '  After  ')).toEqual({
      workflow: { name: 'After', mode: 'lightweight' },
      context: { keep: true },
    });
    expect(config.workflow.name).toBe('Before');
    expect(buildWorkflowConfigWithName(config, '   ')).toBeNull();
  });

  test('formats live-output separators with the complete Chinese date and time', () => {
    expect(formatLiveOutputTimestamp('2026-05-06T07:08:09')).toBe('2026/5/6 07:08:09');
    expect(formatLiveOutputTimestamp('')).toBeNull();
    expect(formatLiveOutputTimestamp('not-a-timestamp')).toBeNull();
  });

  test('reassembles cached transport frames without manufacturing Markdown paragraphs', () => {
    const content = reconstructWorkbenchCachedLiveStreamContent([
      {
        id: 'workflow:run-live:step-live:live',
        chunks: ['。', '由于', '本', '次', '目标', '我将使用 aceharness-tasklist'],
      },
    ], 'run-live', 'step-live');

    expect(content).toBe('。由于本次目标我将使用 aceharness-tasklist');
    expect(content).not.toContain('\n\n');
  });

  test('replaces stale cached transcript with the authoritative snapshot before appending deltas', () => {
    const staleCache = 'runningrunningrunning\n旧开场文本';
    const snapshot = '<!-- timestamp: 2026-08-01T10:35:58.818Z -->\n首条真实消息';
    const current = applyWorkbenchLiveStreamTransportFrame(staleCache, { kind: 'snapshot', content: snapshot });

    expect(current).toBe(snapshot);
    expect(applyWorkbenchLiveStreamTransportFrame(current, { kind: 'delta', content: '，后续增量' }))
      .toBe(`${snapshot}，后续增量`);
    expect(reconstructWorkbenchCachedLiveStreamContent([
      { id: 'workflow:run-live:step-live:live', content: '' },
      { id: 'workflow:run-live:step-live:status', content: 'running' },
    ], 'run-live', 'step-live')).toBe('');
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

  test('retains completed and failed terminal steps as live-output sources', () => {
    expect(resolveWorkbenchLiveStreamStepKeys({
      activeSteps: [],
      currentStep: 'review',
      completedSteps: ['implement', 'test'],
      failedSteps: ['review'],
      terminal: true,
    })).toEqual(['implement', 'test', 'review']);
  });

  test('falls back to the sole lightweight execution step when terminal status has no runtime step keys', () => {
    const workflow = {
      states: [
        { name: 'execute', steps: [{ name: 'execute-task' }] },
      ],
    };

    expect(resolveSoleConfiguredWorkflowStepName(workflow)).toBe('execute-task');
    expect(resolveWorkbenchLiveStreamStepKeys({
      activeSteps: [],
      completedSteps: [],
      failedSteps: [],
      terminal: true,
      fallbackStepName: resolveSoleConfiguredWorkflowStepName(workflow),
    })).toEqual(['execute-task']);
  });
});

describe('Workbench stop progress', () => {
  test('moves past request submission immediately while the manager is stopping', () => {
    expect(createStopProgressSteps()).toEqual([
      { id: 'request', label: '发送停止请求', status: 'success' },
      { id: 'manager-stop', label: '停止运行实例', status: 'running' },
      { id: 'state-persist', label: '保存停止状态', status: 'pending' },
      { id: 'process-cleanup', label: '清理运行资源', status: 'pending' },
      { id: 'refresh', label: '刷新运行状态', status: 'pending' },
    ]);
  });

  test('advances to background cleanup as soon as stopped state is persisted', () => {
    expect(markStopProgressStatePersisted(createStopProgressSteps())).toEqual([
      { id: 'request', label: '发送停止请求', status: 'success' },
      { id: 'manager-stop', label: '停止运行实例', status: 'success' },
      { id: 'state-persist', label: '保存停止状态', status: 'success' },
      { id: 'process-cleanup', label: '清理运行资源', status: 'running' },
      { id: 'refresh', label: '刷新运行状态', status: 'pending' },
    ]);
  });

  test('uses neutral startup preflight wording', async () => {
    const source = await readFile(new URL('../src/client/pages/workbench/WorkbenchClient.tsx', import.meta.url), 'utf8');
    expect(source).not.toContain('权威');
    expect(source).toContain('正在执行启动前检查并创建正式运行');
  });

  test('keeps long human-approval summaries inside a bounded scroll region', async () => {
    const source = await readFile(new URL('../src/client/pages/workbench/WorkbenchClient.tsx', import.meta.url), 'utf8');

    expect(source).toContain('aria-label="审批说明"');
    expect(source).toContain('max-h-48 overflow-y-auto overscroll-contain');
  });

  test('does not present stale human approval as actionable after a run stops', () => {
    expect(shouldShowWorkbenchHumanAttention({
      workflowStatus: 'stopped',
      hasPendingQuestion: true,
      hasApproval: false,
      isHumanReviewLocation: true,
    })).toBe(false);
    expect(shouldShowWorkbenchHumanAttention({
      workflowStatus: 'running',
      hasPendingQuestion: true,
      hasApproval: false,
      isHumanReviewLocation: true,
    })).toBe(true);
  });

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
      'state-persist',
      'process-cleanup',
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
