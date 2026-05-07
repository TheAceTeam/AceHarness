import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { requireAuth } from '@/lib/auth-middleware';
import { getRuntimeAgentConfigPath } from '@/lib/runtime-configs';
import { getConfiguredEngine, getOrCreateEngine, type EngineType } from '@/lib/engines/engine-factory';
import { resolveAgentSelection } from '@/lib/agent-engine-selection';
import { getEngineConfigPath } from '@/lib/app-paths';
import type { RoleConfig } from '@/lib/schemas';
import { existsSync, readFileSync } from 'fs';
import {
  appendSpecCodingRevision,
} from '@/lib/spec-coding-store';
import {
  appendMemoryEntries,
  buildMemoryPromptBlock,
  listMemoryEntries,
} from '@/lib/workflow-memory-store';
import {
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
} from '@/lib/workflow-experience-store';
import { workflowRegistry } from '@/lib/workflow-registry';
import { loadRunState, saveRunState } from '@/lib/run-state-persistence';

function readGlobalEngineSelection(): { engine?: string; defaultModel?: string } {
  try {
    if (!existsSync(getEngineConfigPath())) return {};
    const raw = JSON.parse(readFileSync(getEngineConfigPath(), 'utf-8'));
    return {
      engine: raw.engine || undefined,
      defaultModel: raw.defaultModel || undefined,
    };
  } catch {
    return {};
  }
}

type ChatMode = 'standalone-chat' | 'workflow-chat';

type SpecCodingRevisionCommand = {
  type: 'spec-coding-revision';
  apply?: boolean;
  summary?: string;
  affectedArtifacts?: string[];
  impact?: string[];
};

function extractSpecCodingRevisionCommand(text: string): SpecCodingRevisionCommand | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const tagged = text.match(/<spec-coding-revision>\s*([\s\S]*?)\s*<\/spec-coding-revision>/i)?.[1];
  const candidate = (fenced || tagged || text).trim();
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;

  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    if (parsed?.type !== 'spec-coding-revision') return null;
    return {
      type: 'spec-coding-revision',
      apply: parsed.apply !== false,
      summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
      affectedArtifacts: Array.isArray(parsed.affectedArtifacts)
        ? parsed.affectedArtifacts.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4)
        : [],
      impact: Array.isArray(parsed.impact)
        ? parsed.impact.filter((item: unknown): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
        : [],
    };
  } catch {
    return null;
  }
}

async function applySupervisorSpecCodingRevision(input: {
  workflowContext: Record<string, any>;
  supervisorAgent: string;
  command: SpecCodingRevisionCommand;
}) {
  const summary = (input.command.summary || '').trim();
  if (!summary) return null;

  const reviewContent = [
    summary,
    input.command.affectedArtifacts?.length ? `影响制品: ${input.command.affectedArtifacts.join('、')}` : '',
    input.command.impact?.length ? `影响范围: ${input.command.impact.join('；')}` : '',
  ].filter(Boolean).join('\n');

  let target: 'run' = 'run';
  let applied = false;

  const configFile = typeof input.workflowContext.configFile === 'string' ? input.workflowContext.configFile : '';
  const runId = typeof input.workflowContext.runId === 'string' ? input.workflowContext.runId : '';
  if (runId) {
    const manager = await workflowRegistry.getRunningManager(configFile);
    const managerStatus = manager?.getStatus?.();
    if (manager && managerStatus?.runId === runId && 'applySupervisorChatSpecCodingRevision' in manager && typeof (manager as any).applySupervisorChatSpecCodingRevision === 'function') {
      await (manager as any).applySupervisorChatSpecCodingRevision({
        supervisorAgent: input.supervisorAgent,
        summary,
        content: reviewContent,
        affectedArtifacts: input.command.affectedArtifacts || [],
        impact: input.command.impact || [],
      });
      target = 'run';
      applied = true;
    } else {
      const runState = await loadRunState(runId);
      if (runState?.runSpecCoding) {
        runState.runSpecCoding = appendSpecCodingRevision(runState.runSpecCoding, {
          summary,
          createdBy: input.supervisorAgent,
          status: runState.runSpecCoding.status,
          progressSummary: summary,
        });
        runState.latestSupervisorReview = {
          type: 'chat-revision',
          stateName: runState.currentPhase || '全局',
          content: reviewContent,
          timestamp: new Date().toISOString(),
          affectedArtifacts: input.command.affectedArtifacts || [],
          impact: input.command.impact || [],
        };
        await saveRunState(runState);
        target = 'run';
        applied = true;
      }
    }
  }

  if (!applied) return null;
  return {
    applied: true,
    summary,
    affectedArtifacts: input.command.affectedArtifacts || [],
    impact: input.command.impact || [],
    target,
  };
}

async function buildAgentMemoryContext(input: {
  agentName: string;
  mode: ChatMode;
  workflowContext?: Record<string, any> | null;
  workingDirectory?: string;
  sessionId?: string;
}): Promise<string> {
  const sections: string[] = [];

  const roleMemories = await listMemoryEntries({
    scope: 'role',
    key: input.agentName,
    limit: 3,
  }).catch(() => []);
  const roleBlock = buildMemoryPromptBlock(`${input.agentName} 长期角色记忆`, roleMemories, { maxItems: 3 });
  if (roleBlock) sections.push(roleBlock);

  if (input.mode === 'workflow-chat' && input.workflowContext?.configFile) {
    const workflowMemories = await listMemoryEntries({
      scope: 'workflow',
      key: String(input.workflowContext.configFile),
      limit: 3,
    }).catch(() => []);
    const workflowBlock = buildMemoryPromptBlock('当前工作流记忆', workflowMemories, { maxItems: 3 });
    if (workflowBlock) sections.push(workflowBlock);

    const relatedExperiences = await findRelevantWorkflowExperiences({
      configFile: String(input.workflowContext.configFile || ''),
      workflowName: String(input.workflowContext.workflowName || ''),
      requirements: String(input.workflowContext.requirements || ''),
      projectRoot: input.workingDirectory,
      agentName: input.agentName,
      excludeRunId: typeof input.workflowContext.runId === 'string' ? input.workflowContext.runId : undefined,
      limit: 2,
    }).catch(() => []);
    const experienceBlock = buildWorkflowExperiencePromptBlock(relatedExperiences, '相关历史经验');
    if (experienceBlock) sections.push(experienceBlock);
  }

  if (input.workingDirectory) {
    const projectMemories = await listMemoryEntries({
      scope: 'project',
      key: input.workingDirectory,
      limit: 3,
    }).catch(() => []);
    const projectBlock = buildMemoryPromptBlock('项目级共享记忆', projectMemories, { maxItems: 3 });
    if (projectBlock) sections.push(projectBlock);
  }

  if (input.sessionId) {
    const chatMemories = await listMemoryEntries({
      scope: 'chat',
      key: `${input.agentName}:${input.sessionId}`,
      limit: 4,
    }).catch(() => []);
    const chatBlock = buildMemoryPromptBlock('当前会话补充记忆', chatMemories, { maxItems: 4 });
    if (chatBlock) sections.push(chatBlock);
  }

  if (sections.length === 0) return '';

  return [
    '## 多层记忆注入规则',
    '- 角色长期记忆：可跨 run 沉淀这个 Agent 的稳定协作偏好与复盘结果。',
    '- 项目级共享记忆：仅代表当前工程的长期经验，不可误用到其他工程。',
    '- 工作流记忆：只适用于当前 workflow/run 的设计与执行上下文。',
    '- 会话补充记忆：只适用于当前 chat session，不要把它提升为长期事实，除非用户再次确认。',
    ...sections,
  ].join('\n\n');
}

function buildWorkflowSpecCodingBlock(workflowContext: Record<string, any>): string {
  const summary = workflowContext.specCodingSummary;
  const details = workflowContext.specCodingDetails;
  if (!summary && !details) return '';

  const activePhase = details?.phases?.find((phase: any) => phase.id === summary?.progress?.activePhaseId)
    || details?.phases?.find((phase: any) => phase.title === workflowContext.currentPhase);

  return [
    '## 当前 Run Spec Coding 投影',
    summary?.version ? `- 版本: v${summary.version}` : '',
    summary?.source ? `- 来源: ${summary.source === 'run' ? 'run snapshot' : 'creation baseline'}` : '',
    summary?.status ? `- 状态: ${summary.status}` : '',
    summary?.summary ? `- 摘要: ${summary.summary}` : '',
    summary?.progress?.summary ? `- 进度: ${summary.progress.summary}` : '',
    activePhase?.title ? `- 当前阶段: ${activePhase.title}` : '',
    activePhase?.objective ? `- 阶段目标: ${activePhase.objective}` : '',
    Array.isArray(activePhase?.ownerAgents) && activePhase.ownerAgents.length
      ? `- 阶段责任 Agent: ${activePhase.ownerAgents.join(', ')}`
      : '',
    '- 规则: 普通 Agent 只能基于 Spec Coding 投影更新状态认知，非状态修订由 Supervisor 负责。',
  ].filter(Boolean).join('\n');
}

function formatLatestSupervisorReview(raw: unknown): string {
  if (!raw) return '';
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object') {
    const review = raw as Record<string, any>;
    return [
      review.type ? `类型: ${review.type}` : '',
      review.stateName ? `阶段: ${review.stateName}` : '',
      review.content ? `内容: ${review.content}` : '',
    ].filter(Boolean).join('；');
  }
  return String(raw);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const user = await requireAuth(request);
  if (user instanceof NextResponse) return user;

  try {
    const { name } = await params;
    const body = await request.json();
    const message = String(body?.message || '').trim();
    const mode = (body?.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat') as ChatMode;
    const resumeSessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim() : '';
    const workingDirectory = typeof body?.workingDirectory === 'string' && body.workingDirectory.trim()
      ? body.workingDirectory.trim()
      : user.personalDir;
    const workflowContext = body?.workflowContext && typeof body.workflowContext === 'object'
      ? body.workflowContext as Record<string, any>
      : null;

    if (!message) {
      return NextResponse.json({ error: '消息不能为空' }, { status: 400 });
    }

    const filepath = await getRuntimeAgentConfigPath(name);
    const content = await readFile(filepath, 'utf-8');
    const roleConfig = parse(content) as RoleConfig;
    if (!roleConfig?.name) {
      return NextResponse.json({ error: 'Agent 配置无效' }, { status: 400 });
    }

    const globalSelection = readGlobalEngineSelection();
    const configuredEngine = (await getConfiguredEngine().catch(() => globalSelection.engine || 'claude-code')) as EngineType;
    const selection = resolveAgentSelection(roleConfig, globalSelection, undefined);
    const effectiveEngine = (selection.effectiveEngine || configuredEngine) as EngineType;
    const effectiveModel = selection.effectiveModel || globalSelection.defaultModel || '';
    if (!effectiveModel) {
      return NextResponse.json({ error: 'Agent 未配置可用模型' }, { status: 400 });
    }

    const engine = await getOrCreateEngine(
      effectiveEngine,
      `agent-chat:${user.id}:${name}:${mode}:${workflowContext?.runId || 'default'}`
    );
    if (!engine) {
      return NextResponse.json({ error: 'Agent 对话引擎不可用' }, { status: 500 });
    }

    const workflowContextBlock = mode === 'workflow-chat' && workflowContext
      ? [
        '## 当前 Workflow 上下文',
        workflowContext.workflowName ? `- 工作流: ${workflowContext.workflowName}` : '',
        workflowContext.configFile ? `- 配置文件: ${workflowContext.configFile}` : '',
        workflowContext.runId ? `- Run ID: ${workflowContext.runId}` : '',
        workflowContext.status ? `- 运行状态: ${workflowContext.status}` : '',
        workflowContext.currentPhase ? `- 当前阶段: ${workflowContext.currentPhase}` : '',
        workflowContext.currentStep ? `- 当前步骤: ${workflowContext.currentStep}` : '',
        workflowContext.selectedStepName ? `- 当前选中步骤: ${workflowContext.selectedStepName}` : '',
        workflowContext.requirements ? `- 需求: ${workflowContext.requirements}` : '',
        formatLatestSupervisorReview(workflowContext.latestSupervisorReview)
          ? `- 最近 Supervisor 审阅: ${formatLatestSupervisorReview(workflowContext.latestSupervisorReview)}`
          : '',
        buildWorkflowSpecCodingBlock(workflowContext),
      ].filter(Boolean).join('\n')
      : '';
    const memoryContextBlock = await buildAgentMemoryContext({
      agentName: roleConfig.name,
      mode,
      workflowContext,
      workingDirectory,
      sessionId: resumeSessionId || undefined,
    });

    const prompt = [
      mode === 'workflow-chat'
        ? '请基于以下 workflow 上下文回答，优先站在当前工作流和当前角色职责的角度给出建议。'
        : '这是普通角色聊天，可以复用角色长期记忆与当前会话记忆，但不要默认引入 workflow 上下文，除非用户主动提及。',
      roleConfig.roleType === 'supervisor' && mode === 'workflow-chat'
        ? [
          '## Supervisor Spec Coding 修订协议',
          '- 当用户明确要求你刷新、修订、更新、收敛 Spec Coding 制品 / 方案 / 任务分解时，正常回答后，额外单独输出一个 `<spec-coding-revision>...</spec-coding-revision>` JSON 块。',
          '- JSON 格式: {"type":"spec-coding-revision","apply":true,"summary":"一句话修订摘要","affectedArtifacts":["requirements.md","design.md","tasks.md"],"impact":["影响1","影响2"]}',
          '- 只有你判断需要真正落盘修订时才输出该块；否则不要输出。',
        ].join('\n')
        : '',
      workflowContextBlock,
      memoryContextBlock,
      '',
      '# 用户消息',
      message,
    ].filter(Boolean).join('\n\n');

    const result = await engine.execute({
      agent: roleConfig.name,
      step: mode,
      prompt,
      systemPrompt: roleConfig.systemPrompt || `你是 ${roleConfig.name}。`,
      model: effectiveModel,
      workingDirectory,
      allowedTools: roleConfig.allowedTools,
      sessionId: resumeSessionId || undefined,
      appendSystemPrompt: Boolean(resumeSessionId),
      mcpServers: roleConfig.mcpServers,
    });

    if (!result.success && !result.output && result.error) {
      return NextResponse.json(
        { error: result.error || 'Agent 对话失败', sessionId: result.sessionId || resumeSessionId || null },
        { status: 500 }
      );
    }

    const finalSessionId = result.sessionId || resumeSessionId || null;
    const specCodingRevisionCommand = roleConfig.roleType === 'supervisor' && mode === 'workflow-chat'
      ? extractSpecCodingRevisionCommand(result.output || '')
      : null;
    const specCodingRevision = specCodingRevisionCommand && specCodingRevisionCommand.apply !== false && workflowContext
      ? await applySupervisorSpecCodingRevision({
          workflowContext,
          supervisorAgent: roleConfig.name,
          command: specCodingRevisionCommand,
        })
      : null;
    const cleanedOutput = specCodingRevisionCommand
      ? (result.output || '')
        .replace(/<spec-coding-revision>[\s\S]*?<\/spec-coding-revision>/gi, '')
        .trim()
      : (result.output || '');
    if (finalSessionId) {
      await appendMemoryEntries([
        {
          scope: 'chat',
          key: `${roleConfig.name}:${finalSessionId}`,
          kind: 'session',
          title: `${roleConfig.name} ${mode}`,
          content: `用户: ${message}\n助手: ${cleanedOutput.slice(0, 1600)}`,
          source: mode,
          runId: typeof workflowContext?.runId === 'string' ? workflowContext.runId : undefined,
          configFile: typeof workflowContext?.configFile === 'string' ? workflowContext.configFile : undefined,
          agent: roleConfig.name,
          tags: [mode],
        },
      ]).catch(() => {});
    }

    return NextResponse.json({
      ok: true,
      output: cleanedOutput || '',
      sessionId: finalSessionId,
      mode,
      agent: roleConfig.name,
      engine: effectiveEngine,
      model: effectiveModel,
      isError: !result.success,
      error: result.error || null,
      specCodingRevision,
      reusePolicy: mode === 'workflow-chat'
        ? 'workflow-chat 优先复用 run 绑定会话；standalone-chat 不自动继承 workflow 记忆。'
        : 'standalone-chat 仅复用该角色的独立会话与长期角色记忆。',
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Agent 对话失败' },
      { status: 500 }
    );
  }
}
