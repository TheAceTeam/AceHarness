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
  shouldShowWorkbenchHumanAttention,
  isActionableWorkbenchHumanQuestion,
  resolveInitialAdversarialIntent,
  getRunReviewIntentPresentation,
  buildWorkbenchRunDetailNavItems,
  buildWorkbenchHumanApprovalPresentation,
  shouldClearCurrentStepForHumanApproval,
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

  test('names an adversarial design as inherited instead of asking to enable it again', () => {
    expect(getRunReviewIntentPresentation('on-demand', 'on-demand')).toMatchObject({
      followsDesign: true,
      title: '按工作流设计执行（含对抗审查）',
    });
    expect(getRunReviewIntentPresentation('on-demand', 'disabled')).toMatchObject({
      followsDesign: false,
      title: '本次临时改为标准审查',
    });
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

  test('turns blocking human approval advice into a short, checkable decision', () => {
    expect(buildWorkbenchHumanApprovalPresentation({
      advice: [
        '## 是否建议人工放行',
        '**不建议无条件放行**。关键硬阻塞待确认。',
        '- **R1（最高优先级，硬阻塞）**：确认 codecheck 修正已提交，工作区干净。',
      ].join('\n'),
    })).toEqual({
      recommendation: 'verify-first',
      headline: '先完成以下核验，再决定是否继续',
      supportingText: '让 Agent 在隔离工作区完成这些核验；不要在此处把历史风险当作已解决。',
      checklist: ['R1（最高优先级，硬阻塞）：确认 codecheck 修正已提交，工作区干净。'],
    });
  });

  test('routes a resolved codecheck report to PR submission instead of looping back to repair', () => {
    expect(buildWorkbenchHumanApprovalPresentation({
      advice: [
        '## 是否建议人工放行',
        '有条件建议放行。R1 硬阻塞（未提交改动）已解除——codecheck 重构提交为 ffe4b34，worktree 干净。',
        '- R2（codecheck 预验证）：放行前确认本地检查已通过。',
      ].join('\n'),
    })).toEqual({
      recommendation: 'submit-and-monitor-ci',
      headline: '修复已具备放行证据；下一步应推送 PR 并触发 CI',
      supportingText: '让 Agent 在隔离工作区复核剩余证据后进入 PR 提交；若复核仍失败，会自动回到修复与验证，不再要求你重复做终端核验。',
      checklist: ['R2（codecheck 预验证）：放行前确认本地检查已通过。'],
    });
  });

  test('uses the persisted state-boundary decision before historic review prose', () => {
    expect(buildWorkbenchHumanApprovalPresentation({
      advice: '历史记录中仍引用：硬阻塞待确认。',
      decision: {
        action: 'submit_and_monitor_ci',
        targetState: 'PR提交',
        rationale: '本轮 codecheck 与回归均已通过。',
        blockers: [],
        evidence: ['commit ffe4b34', 'codecheck passed'],
        instruction: '推送 PR 分支并确认 CI 已创建。',
      },
    })).toEqual({
      recommendation: 'submit-and-monitor-ci',
      headline: '已裁决进入「PR提交」核验 PR 与 CI 状态',
      supportingText: 'Agent 会先确认当前 PR head 是否已推送及 CI 是否已创建。CI 已运行时只监控结果，不会再次发送触发评论；只有当前 head 尚未触发且机器人明确要求时，才会按授权进行一次精确触发。',
      checklist: ['commit ffe4b34', 'codecheck passed', '确认当前 PR head 已推送，并确认 CI 已创建或正在运行。'],
    });
  });

  test('makes a recovered repair decision explain that it continues review feedback work', () => {
    expect(buildWorkbenchHumanApprovalPresentation({
      decision: {
        action: 'repair',
        targetState: '修复与验证',
        rationale: '运行在修复与验证中断。',
        blockers: [],
        evidence: ['中断状态：修复与验证'],
        instruction: '让 Agent 从「修复与验证」继续处理已路由到该状态的代码、测试或检视意见；完成后由状态机继续 PR 与评审跟踪。',
      },
    })).toEqual({
      recommendation: 'verify-first',
      headline: '继续处理已归类的检视意见',
      supportingText: '让 Agent 从「修复与验证」继续处理已路由到该状态的代码、测试或检视意见；完成后由状态机继续 PR 与评审跟踪。',
      checklist: ['中断状态：修复与验证'],
    });
  });

  test('clears stale step text while the workflow waits for a human decision', () => {
    expect(shouldClearCurrentStepForHumanApproval('__human_approval__')).toBe(true);
    expect(shouldClearCurrentStepForHumanApproval('修复与验证')).toBe(false);
  });

  test('keeps full human-approval evidence accessible from the decision card', async () => {
    const [workbenchSource, questionCardSource] = await Promise.all([
      readFile(new URL('../src/client/pages/workbench/WorkbenchClient.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../src/components/workflow/HumanQuestionCard.tsx', import.meta.url), 'utf8'),
    ]);

    expect(questionCardSource).toContain('aria-label="完整审批依据"');
    expect(questionCardSource).toContain('查看完整审批依据');
    expect(questionCardSource).toContain("presentation === 'decision'");
    expect(workbenchSource).toContain('presentation="decision"');
    expect(workbenchSource).toContain('让 Agent 继续处理检视意见');
    expect(workbenchSource).toContain('让 Agent 核验 PR 与 CI 状态');
    expect(workbenchSource).toContain('我已人工确认，继续');
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

  test('does not restore a transition approval after the run has left the approval state', () => {
    const question = {
      id: 'hq-stale',
      runId: 'run-stale',
      configFile: 'workflow.yaml',
      status: 'unanswered' as const,
      kind: 'approval' as const,
      title: '等待人工审查',
      message: '请选择下一状态',
      createdAt: '2026-08-30T00:00:00.000Z',
      answerSchema: { type: 'approval-transition' as const },
    };
    expect(isActionableWorkbenchHumanQuestion(question, '__human_approval__')).toBe(true);
    expect(isActionableWorkbenchHumanQuestion(question, '修复与验证')).toBe(false);
    expect(isActionableWorkbenchHumanQuestion({
      ...question,
      kind: 'clarification',
      answerSchema: { type: 'text' },
    }, '修复与验证')).toBe(true);
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
