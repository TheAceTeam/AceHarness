import { NextRequest, NextResponse } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';
import { requireAuth } from '@/lib/auth-middleware';
import { runWorkflowPreflight } from '@/lib/workflow-preflight';
import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { parse } from 'yaml';
import { getRuntimeWorkflowConfigPath } from '@/lib/runtime-configs';
import { createRun } from '@/lib/run-store';
import { saveRunState, type PersistedRunState } from '@/lib/run-state-persistence';
import { loadLatestCreationSessionByFilename, cloneOpenSpecForRun } from '@/lib/openspec-store';
import { updateChatSessionCreationBinding, updateChatSessionWorkflowBinding } from '@/lib/chat-persistence';

function countWorkflowSteps(config: any): number {
  const phases = Array.isArray(config?.workflow?.phases) ? config.workflow.phases : [];
  const states = Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
  const items = phases.length > 0 ? phases : states;
  return items.reduce((sum: number, item: any) => sum + (Array.isArray(item?.steps) ? item.steps.length : 0), 0);
}

async function startRehearsalRun(input: {
  configFile: string;
  frontendSessionId?: string;
  userId: string;
  preflightChecks: any[];
}) {
  const configPath = await getRuntimeWorkflowConfigPath(input.configFile);
  const raw = await readFile(configPath, 'utf-8');
  const config = parse(raw) as any;
  const runId = `run-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const totalSteps = countWorkflowSteps(config);
  const creationSession = await loadLatestCreationSessionByFilename(input.configFile).catch(() => null);
  const runOpenSpec = creationSession?.openSpec
    ? cloneOpenSpecForRun(creationSession.openSpec, { runId, filename: input.configFile })
    : null;
  const summary = '演练模式未执行真实项目改动，仅生成 OpenSpec / workflow 编排推演与风险提示。';
  const recommendedNextSteps = [
    '检查 OpenSpec 阶段拆分与 Agent 编队是否合理',
    '确认 preflight 检查、风险点和人工检查点是否齐全',
    '如方案可行，关闭演练模式后再正式启动工作流',
  ];

  await createRun({
    id: runId,
    configFile: input.configFile,
    configName: config?.workflow?.name || input.configFile,
    startTime: now,
    endTime: now,
    status: 'completed',
    currentPhase: '演练模式',
    totalSteps,
    completedSteps: 0,
  });

  const state: PersistedRunState = {
    runId,
    configFile: input.configFile,
    status: 'completed',
    startTime: now,
    endTime: now,
    currentPhase: '演练模式',
    currentStep: '输出推演总结',
    completedSteps: [],
    failedSteps: [],
    stepLogs: [],
    agents: [],
    iterationStates: {},
    processes: [],
    mode: config?.workflow?.mode === 'state-machine' ? 'state-machine' : 'phase-based',
    requirements: config?.context?.requirements || '',
    workingDirectory: config?.context?.projectRoot || undefined,
    supervisorAgent: config?.workflow?.supervisor?.agent || 'default-supervisor',
    supervisorSessionId: null,
    attachedAgentSessions: {},
    qualityChecks: input.preflightChecks,
    latestSupervisorReview: {
      type: 'state-review',
      stateName: '演练模式',
      content: summary,
      timestamp: now,
    },
    runOpenSpec: runOpenSpec ? {
      ...runOpenSpec,
      status: 'completed',
      summary,
      updatedAt: now,
      progress: {
        ...runOpenSpec.progress,
        overallStatus: 'completed',
        summary,
      },
    } : null,
    rehearsal: {
      enabled: true,
      summary,
      recommendedNextSteps,
    },
  };
  await saveRunState(state);

  if (input.frontendSessionId) {
    await updateChatSessionWorkflowBinding(input.frontendSessionId, {
      configFile: input.configFile,
      runId,
      supervisorAgent: state.supervisorAgent || 'default-supervisor',
      supervisorSessionId: null,
      attachedAgentSessions: {},
    }).catch(() => {});
    await updateChatSessionCreationBinding(input.frontendSessionId, {
      filename: input.configFile,
      status: 'run-bound',
    }).catch(() => {});
  }

  return { runId, summary, recommendedNextSteps };
}

export async function POST(request: NextRequest) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const body = await request.json();
    const { configFile, frontendSessionId, skipPreflight, rehearsal, preflightChecks: inputPreflightChecks } = body;

    if (!configFile) {
      return NextResponse.json(
        { error: '缺少配置文件参数' },
        { status: 400 }
      );
    }

    let preflightChecks = Array.isArray(inputPreflightChecks) ? inputPreflightChecks : undefined;
    if (!skipPreflight) {
      const preflight = await runWorkflowPreflight(configFile, user.personalDir || '');
      if (!preflight.ok) {
        return NextResponse.json(
          {
            error: `启动前检查未通过：${preflight.failedCount} 项失败`,
            checks: preflight.checks,
            cwd: preflight.cwd,
          },
          { status: 412 }
        );
      }
      preflightChecks = preflight.checks;
    }

    if (rehearsal) {
      const result = await startRehearsalRun({
        configFile,
        frontendSessionId: typeof frontendSessionId === 'string' ? frontendSessionId : undefined,
        userId: user.id,
        preflightChecks: preflightChecks || [],
      });
      return NextResponse.json({
        success: true,
        message: '演练模式已完成',
        rehearsal: {
          enabled: true,
          runId: result.runId,
          summary: result.summary,
          recommendedNextSteps: result.recommendedNextSteps,
        },
      });
    }

    const manager = await workflowRegistry.getManager(configFile);

    // Check if this specific config is already running
    const currentStatus = manager.getStatus();
    if (currentStatus.status === 'running' || currentStatus.status === 'preparing') {
      return NextResponse.json(
        { error: '该配置的工作流已在运行中' },
        { status: 409 }
      );
    }

    // Pass userId for createdBy tracking
    (manager as any)._createdBy = user.id;
    (manager as any)._userPersonalDir = user.personalDir;
    (manager as any)._frontendSessionId = typeof frontendSessionId === 'string' ? frontendSessionId : undefined;
    (manager as any).start(configFile, undefined, preflightChecks).catch((err: any) => {
      console.error(`[Workflow] start failed for ${configFile}:`, err?.message || err);
      // Ensure status reflects the failure so frontend can detect it
      try {
        (manager as any).status = 'failed';
        (manager as any).statusReason = err?.message || '启动失败';
        manager.emit('status', { status: 'failed', message: err?.message || '启动失败' });
      } catch { /* best effort */ }
    });

    return NextResponse.json({
      success: true,
      message: '工作流已启动',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: '启动工作流失败', message: error.message },
      { status: 500 }
    );
  }
}
