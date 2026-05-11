import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { getRuntimeAgentConfigPath } from '@/lib/runtime-configs';
import { getConfiguredEngine, getOrCreateEngine, type EngineType } from '@/lib/engines/engine-factory';
import { resolveAgentSelection } from '@/lib/agent-engine-selection';
import { getEngineConfigPath } from '@/lib/app-paths';
import type { RoleConfig } from '@/lib/schemas';
import type { Engine } from '@/lib/engines/engine-interface';
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
import {
  extractSpecCodingRevisionCommand,
  stripSpecCodingRevisionCommand,
  type SpecCodingRevisionCommand,
} from '@/lib/spec-coding-revision-protocol';

export interface AgentChatUserContext {
  id: string;
  username: string;
  personalDir: string;
}

export type ChatMode = 'standalone-chat' | 'workflow-chat';

export interface ExecuteAgentChatInput {
  agentName: string;
  message: string;
  mode?: ChatMode;
  sessionId?: string | null;
  workingDirectory?: string;
  workflowContext?: Record<string, any> | null;
  temporaryRoleConfig?: RoleConfig | null;
  userContext: AgentChatUserContext;
}

export interface ExecuteAgentChatResult {
  ok: boolean;
  output: string;
  sessionId?: string | null;
  mode: ChatMode;
  agent: string;
  engine?: string;
  model?: string;
  isError?: boolean;
  error?: string | null;
  specCodingRevision?: {
    applied: boolean;
    summary: string;
    affectedArtifacts: string[];
    impact: string[];
    target: 'run';
  } | null;
  reusePolicy: string;
}

export interface PreparedAgentChat {
  roleConfig: RoleConfig;
  mode: ChatMode;
  resumeSessionId: string;
  workingDirectory: string;
  workflowContext: Record<string, any> | null;
  engine: Engine;
  engineType: EngineType;
  model: string;
  prompt: string;
  sessionReuseKey: string;
}

export async function finalizeAgentChatExecution(input: {
  prepared: PreparedAgentChat;
  userMessage: string;
  rawOutput: string;
  success: boolean;
  error?: string | null;
  sessionId?: string | null;
}): Promise<ExecuteAgentChatResult> {
  const { prepared } = input;
  const finalSessionId = input.sessionId || prepared.resumeSessionId || null;
  const specCodingRevisionCommand = prepared.roleConfig.roleType === 'supervisor' && prepared.mode === 'workflow-chat'
    ? extractSpecCodingRevisionCommand(input.rawOutput || '')
    : null;
  const specCodingRevision = specCodingRevisionCommand && specCodingRevisionCommand.apply !== false && prepared.workflowContext
    ? await applySupervisorSpecCodingRevision({
        workflowContext: prepared.workflowContext,
        supervisorAgent: prepared.roleConfig.name,
        command: specCodingRevisionCommand,
      })
    : null;
  const cleanedOutput = specCodingRevisionCommand
    ? stripSpecCodingRevisionCommand(input.rawOutput || '')
    : (input.rawOutput || '');

  if (finalSessionId) {
    await appendMemoryEntries([
      {
        scope: 'chat',
        key: `${prepared.roleConfig.name}:${finalSessionId}`,
        kind: 'session',
        title: `${prepared.roleConfig.name} ${prepared.mode}`,
        content: `用户: ${input.userMessage}\n助手: ${cleanedOutput.slice(0, 1600)}`,
        source: prepared.mode,
        runId: typeof prepared.workflowContext?.runId === 'string' ? prepared.workflowContext.runId : undefined,
        configFile: typeof prepared.workflowContext?.configFile === 'string' ? prepared.workflowContext.configFile : undefined,
        agent: prepared.roleConfig.name,
        tags: [prepared.mode],
      },
    ]).catch(() => {});
  }

  return {
    ok: input.success || Boolean(cleanedOutput),
    output: cleanedOutput || '',
    sessionId: finalSessionId,
    mode: prepared.mode,
    agent: prepared.roleConfig.name,
    engine: prepared.engineType,
    model: prepared.model,
    isError: !input.success,
    error: input.error || null,
    specCodingRevision,
    reusePolicy: prepared.mode === 'workflow-chat'
      ? 'workflow-chat 优先复用 run 绑定会话；standalone-chat 不自动继承 workflow 记忆。'
      : 'standalone-chat 仅复用该角色的独立会话与长期角色记忆。',
  };
}

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

  let applied = false;
  const target: 'run' = 'run';

  const configFile = typeof input.workflowContext.configFile === 'string' ? input.workflowContext.configFile : '';
  const runId = typeof input.workflowContext.runId === 'string' ? input.workflowContext.runId : '';
  if (runId) {
    const manager = workflowRegistry.getRunningManager(configFile);
    const managerStatus = manager?.getStatus?.();
    if (manager && managerStatus?.runId === runId && 'applySupervisorChatSpecCodingRevision' in manager && typeof (manager as any).applySupervisorChatSpecCodingRevision === 'function') {
      await (manager as any).applySupervisorChatSpecCodingRevision({
        supervisorAgent: input.supervisorAgent,
        summary,
        content: reviewContent,
        affectedArtifacts: input.command.affectedArtifacts || [],
        impact: input.command.impact || [],
      });
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

export async function executeAgentChat(input: ExecuteAgentChatInput): Promise<ExecuteAgentChatResult> {
  const message = String(input.message || '').trim();
  const prepared = await prepareAgentChat(input);

  const result = await prepared.engine.execute({
    agent: prepared.roleConfig.name,
    step: prepared.mode,
    prompt: prepared.prompt,
    systemPrompt: prepared.roleConfig.systemPrompt || `你是 ${prepared.roleConfig.name}。`,
    model: prepared.model,
    workingDirectory: prepared.workingDirectory,
    allowedTools: prepared.roleConfig.allowedTools,
    sessionId: prepared.resumeSessionId || undefined,
    appendSystemPrompt: Boolean(prepared.resumeSessionId),
    mcpServers: prepared.roleConfig.mcpServers,
  });

  if (!result.success && !result.output && result.error) {
    return finalizeAgentChatExecution({
      prepared,
      userMessage: message,
      rawOutput: '',
      success: false,
      error: result.error || 'Agent 对话失败',
      sessionId: result.sessionId || prepared.resumeSessionId || null,
    });
  }
  return finalizeAgentChatExecution({
    prepared,
    userMessage: message,
    rawOutput: result.output || '',
    success: result.success,
    error: result.error || null,
    sessionId: result.sessionId || prepared.resumeSessionId || null,
  });
}

export async function prepareAgentChat(input: ExecuteAgentChatInput): Promise<PreparedAgentChat> {
  const message = String(input.message || '').trim();
  const mode = (input.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat') as ChatMode;
  const resumeSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const workingDirectory = typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
    ? input.workingDirectory.trim()
    : input.userContext.personalDir;
  const workflowContext = input.workflowContext && typeof input.workflowContext === 'object'
    ? input.workflowContext as Record<string, any>
    : null;

  if (!message) {
    throw new Error('消息不能为空');
  }

  const roleConfig = input.temporaryRoleConfig
    ? input.temporaryRoleConfig
    : parse(await readFile(await getRuntimeAgentConfigPath(input.agentName), 'utf-8')) as RoleConfig;
  if (!roleConfig?.name) {
    throw new Error('Agent 配置无效');
  }

  const globalSelection = readGlobalEngineSelection();
  const configuredEngine = (await getConfiguredEngine().catch(() => globalSelection.engine || 'claude-code')) as EngineType;
  const selection = resolveAgentSelection(roleConfig, globalSelection, undefined);
  const effectiveEngine = (selection.effectiveEngine || configuredEngine) as EngineType;
  const effectiveModel = selection.effectiveModel || globalSelection.defaultModel || '';
  if (!effectiveModel) {
    throw new Error('Agent 未配置可用模型');
  }

  const sessionReuseKey = `agent-chat:${input.userContext.id}:${input.agentName}:${mode}:${workflowContext?.runId || 'default'}`;
  const engine = await getOrCreateEngine(effectiveEngine, sessionReuseKey);
  if (!engine) {
    const temporaryLabel = input.temporaryRoleConfig ? '临时 Agent' : '业务 Agent';
    throw new Error(`Agent 对话引擎不可用：${effectiveEngine}${effectiveModel ? ` / ${effectiveModel}` : ''}（${temporaryLabel}：${roleConfig.name}）`);
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
        '- 当用户明确要求你刷新、修订、更新、收敛 Spec Coding 制品 / 方案 / 任务分解时，正常回答后，额外单独输出一个 `<result>...</result>` 机器结果块。',
        '- 推荐 JSON 格式: {"kind":"spec_coding_revision","payload":{"apply":true,"summary":"一句话修订摘要","affectedArtifacts":["requirements.md","design.md","tasks.md"],"impact":["影响1","影响2"]}}',
        '- 兼容旧格式: {"type":"spec-coding-revision","apply":true,"summary":"一句话修订摘要","affectedArtifacts":["requirements.md","design.md","tasks.md"],"impact":["影响1","影响2"]} 或 `<spec-coding-revision>...</spec-coding-revision>`。',
        '- 只有你判断需要真正落盘修订时才输出该块；否则不要输出。',
      ].join('\n')
      : '',
    workflowContextBlock,
    memoryContextBlock,
    '',
    '# 用户消息',
    message,
  ].filter(Boolean).join('\n\n');

  return {
    roleConfig,
    mode,
    resumeSessionId,
    workingDirectory,
    workflowContext,
    engine,
    engineType: effectiveEngine,
    model: effectiveModel,
    prompt,
    sessionReuseKey,
  };
}
