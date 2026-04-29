import { NextRequest, NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { workflowRegistry, isStateMachineManagerLike } from '@/lib/workflow-registry';
import { getWorkspaceRunsDir } from '@/lib/app-paths';
import { loadRunState, type HumanQuestion } from '@/lib/run-state-persistence';

async function listPersistedQuestions(filters: {
  status?: string | null;
  runId?: string | null;
  configFile?: string | null;
}): Promise<HumanQuestion[]> {
  const runsDir = getWorkspaceRunsDir();
  if (!existsSync(runsDir)) return [];

  const entries = await readdir(runsDir, { withFileTypes: true });
  const questions: HumanQuestion[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (filters.runId && entry.name !== filters.runId) continue;
    const state = await loadRunState(entry.name);
    if (!state?.humanQuestions?.length) continue;
    if (filters.configFile && state.configFile !== filters.configFile) continue;
    questions.push(...state.humanQuestions);
  }
  return questions;
}

function filterQuestions(questions: HumanQuestion[], filters: {
  status?: string | null;
  runId?: string | null;
  configFile?: string | null;
}) {
  return questions.filter((question) => {
    if (filters.status && question.status !== filters.status) return false;
    if (filters.runId && question.runId !== filters.runId) return false;
    if (filters.configFile && question.configFile !== filters.configFile) return false;
    return true;
  });
}

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get('status');
    const runId = request.nextUrl.searchParams.get('runId');
    const configFile = request.nextUrl.searchParams.get('configFile');
    const limit = Math.max(1, Math.min(200, Number(request.nextUrl.searchParams.get('limit') || 50)));
    const byId = new Map<string, HumanQuestion>();

    for (const { manager } of workflowRegistry.getRunningManagers()) {
      if (!isStateMachineManagerLike(manager)) continue;
      for (const question of manager.getHumanQuestions()) {
        byId.set(question.id, question);
      }
    }

    for (const question of await listPersistedQuestions({ status, runId, configFile })) {
      if (!byId.has(question.id)) byId.set(question.id, question);
    }

    const questions = filterQuestions(Array.from(byId.values()), { status, runId, configFile })
      .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))
      .slice(0, limit);

    return NextResponse.json({ questions });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '获取 Supervisor 消息失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const configFile = typeof body?.configFile === 'string' ? body.configFile : '';
    const runId = typeof body?.runId === 'string' ? body.runId : '';
    if (!configFile && !runId) {
      return NextResponse.json({ error: '缺少 configFile 或 runId 参数' }, { status: 400 });
    }

    const manager = runId
      ? await workflowRegistry.getManagerByRunId(runId)
      : workflowRegistry.getRunningManager(configFile);
    if (!isStateMachineManagerLike(manager)) {
      return NextResponse.json({ error: '没有运行中的状态机工作流' }, { status: 400 });
    }

    const status = manager.getStatus();
    if (runId && status.runId !== runId) {
      return NextResponse.json({ error: '目标工作流运行未处于活动状态' }, { status: 409 });
    }
    if (configFile && status.currentConfigFile !== configFile) {
      return NextResponse.json({ error: '目标工作流配置不匹配' }, { status: 409 });
    }

    const title = String(body?.title || '').trim();
    const message = String(body?.message || '').trim();
    if (!title || !message) {
      return NextResponse.json({ error: '缺少标题或消息内容' }, { status: 400 });
    }

    const question = await manager.createHumanQuestion({
      kind: body?.kind || 'clarification',
      title,
      message,
      supervisorAdvice: typeof body?.supervisorAdvice === 'string' ? body.supervisorAdvice : undefined,
      suggestedNextState: typeof body?.suggestedNextState === 'string' ? body.suggestedNextState : undefined,
      availableStates: Array.isArray(body?.availableStates) ? body.availableStates.filter((item: unknown): item is string => typeof item === 'string') : undefined,
      requiresWorkflowPause: body?.requiresWorkflowPause !== false,
      answerSchema: body?.answerSchema || { type: 'text', required: true },
      source: body?.source || { type: 'manual' },
    });

    return NextResponse.json({ question });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || '创建 Supervisor 消息失败' }, { status: 400 });
  }
}
