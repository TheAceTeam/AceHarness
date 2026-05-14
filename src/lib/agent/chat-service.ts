import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { getRuntimeAgentConfigPath } from '@/lib/run/runtime-configs';
import { getConfiguredEngine, getOrCreateEngine, type EngineType } from '@/lib/engines/engine-factory';
import { resolveAgentSelection } from '@/lib/agent/engine-selection';
import { getEngineConfigPath, getWorkspaceRoot } from '@/lib/core/app-paths';
import type { RoleConfig } from '@/lib/core/schemas';
import type { Engine } from '@/lib/engines/engine-interface';
import {
  appendSpecCodingRevision,
} from '@/lib/spec/coding-store';
import {
  appendMemoryEntries,
  buildMemoryPromptBlock,
  listMemoryEntries,
} from '@/lib/workflow/memory-store';
import {
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
} from '@/lib/workflow/experience-store';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, saveRunState } from '@/lib/run/state-persistence';
import {
  extractSpecCodingRevisionCommand,
  stripSpecCodingRevisionCommand,
  type SpecCodingRevisionCommand,
} from '@/lib/spec/coding-revision-protocol';
import { getRuntimeSkillPath } from '@/lib/run/runtime-skills';
import { extractStructuredResult as extractResultChannelStructuredResult } from '@/lib/ai/result-channel';

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
  rawOutput?: string;
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
  isTemporaryWerewolf: boolean;
}

function isTemporaryWerewolfChat(input: {
  roleConfig?: RoleConfig | null;
  workflowContext?: Record<string, any> | null;
}): boolean {
  return input.workflowContext?.temporaryLab === 'werewolf'
    || input.roleConfig?.category === 'temporary-lab'
    || Boolean(input.roleConfig?.tags?.includes('werewolf-lab'));
}

function stripHtmlTags(text: string): string {
  return String(text || '')
    .replace(/<\/p>\s*<p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(strong|b)>/gi, '')
    .replace(/<\/?(em|i)>/gi, '')
    .replace(/<\/?(p|div|span|ul|ol|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripToolNarrationBlocks(text: string): string {
  return String(text || '')
    .replace(/\n{0,2}\*\*(?:📖 读取文件|💻 执行命令|🔍 搜索内容|🔍 搜索文件|📂 列出目录|🤖 子任务|🌐 获取网页|🔎 搜索网页|✏️ 编辑文件|📝 写入文件|📋 任务列表)[\s\S]*?(?=\n{2}\*\*|$)/g, '\n')
    .replace(/(?:^|\n)技能文件不在这个相对位置[^\n]*/g, '\n')
    .replace(/(?:^|\n)我先(?:看一下|缩小范围找|把)[^\n]*/g, '\n')
    .replace(/(?:^|\n)我没在默认技能目录里找到它[^\n]*/g, '\n')
    .trim();
}

function extractAnyWerewolfResult(rawOutput: string): Record<string, any> | null {
  return extractResultChannelStructuredResult<Record<string, any>>(
    rawOutput,
    (value: any): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value)),
  );
}

function hasWerewolfResult(rawOutput: string): boolean {
  return Boolean(extractAnyWerewolfResult(rawOutput));
}

function buildVisibleWerewolfOutput(rawOutput: string): string {
  const resultPayload = extractAnyWerewolfResult(rawOutput);
  if (typeof resultPayload?.display === 'string' && resultPayload.display.trim().length > 0) {
    return stripHtmlTags(resultPayload.display);
  }
  return '';
}

async function executeWerewolfTurnWithResultEnforcement(input: {
  prepared: PreparedAgentChat;
  prompt: string;
}): Promise<{
  success: boolean;
  output?: string;
  error?: string | null;
  sessionId?: string | null;
}> {
  const maxAttempts = 3;
  let latestSessionId = input.prepared.resumeSessionId || undefined;
  let lastResult: {
    success: boolean;
    output?: string;
    error?: string | null;
    sessionId?: string | null;
  } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const isRetry = attempt > 0;
    const result = await input.prepared.engine.execute({
      agent: input.prepared.roleConfig.name,
      step: isRetry ? `${input.prepared.mode}-result-retry-${attempt}` : input.prepared.mode,
      prompt: isRetry
        ? [
            '你上一条回复不合规：缺少 `<result>JSON</result>` 结果块。',
            '不要重复过程说明，不要展示任何工具、规则、草稿或解释。',
            '现在仅基于同一回合补发一个合规的 `<result>JSON</result>`。',
            '如果需要给人看的内容，把它放进 `display` 字段；如果这是机器决策回合，也把 action / target / save / poisonTarget / reason 等字段一起放进同一个 JSON。',
          ].join('\n')
        : input.prompt,
      systemPrompt: input.prepared.roleConfig.systemPrompt || `你是 ${input.prepared.roleConfig.name}。`,
      model: input.prepared.model,
      workingDirectory: input.prepared.workingDirectory,
      allowedTools: input.prepared.roleConfig.allowedTools,
      sessionId: latestSessionId,
      appendSystemPrompt: false,
      mcpServers: input.prepared.roleConfig.mcpServers,
    });
    lastResult = result;
    latestSessionId = result.sessionId || latestSessionId;
    if (hasWerewolfResult(result.output || '')) return result;
  }

  return lastResult || { success: false, output: '', error: 'missing werewolf result', sessionId: latestSessionId || null };
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
  const visibleOutput = prepared.isTemporaryWerewolf
    ? buildVisibleWerewolfOutput(cleanedOutput)
    : cleanedOutput;

  if (finalSessionId) {
    await appendMemoryEntries([
      {
        scope: 'chat',
        key: `${prepared.roleConfig.name}:${finalSessionId}`,
        kind: 'session',
        title: `${prepared.roleConfig.name} ${prepared.mode}`,
        content: `用户: ${input.userMessage}\n助手: ${visibleOutput.slice(0, 1600)}`,
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
    output: visibleOutput || '',
    rawOutput: cleanedOutput || '',
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

  const result = prepared.isTemporaryWerewolf
    ? await executeWerewolfTurnWithResultEnforcement({
        prepared,
        prompt: prepared.prompt,
      })
    : await prepared.engine.execute({
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
  const isTemporaryWerewolf = isTemporaryWerewolfChat({ roleConfig, workflowContext });
  const workingDirectory = isTemporaryWerewolf
    ? getWorkspaceRoot()
    : (typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
      ? input.workingDirectory.trim()
      : input.userContext.personalDir);
  const werewolfSkillPath = isTemporaryWerewolf
    ? await getRuntimeSkillPath('werewolf-tabletalk', 'SKILL.md').catch(() => '')
    : '';
  const isWerewolfInit = isTemporaryWerewolf && !resumeSessionId;
  const effectiveRoleConfig = isTemporaryWerewolf
    ? {
        ...roleConfig,
        systemPrompt: [
          roleConfig.systemPrompt || '',
          isWerewolfInit
            ? (werewolfSkillPath
              ? `狼人杀专用技能文件绝对路径：\`${werewolfSkillPath}\`。这次是会话初始化阶段，只在现在静默读取并内化这个文件一次即可。读取后，后续所有轮次直接按已内化的规则、术语和固定发言格式执行，不要再次读取，不要提到自己读过规则，也不要展示读取过程、查找路径过程或工具执行过程。若需要结构化输出，只使用一个 <result>JSON</result> 结果块；给人看的最终发言放进 JSON 的 display 字段，并且 display 只能写纯文本或 Markdown，不要输出任何 HTML 标签。如果当前回合还要求机器决策，就把 action/target/reason 等字段和 display 一起放进同一个 result JSON，系统只认 result 做结算。`
              : '这次是狼人杀会话初始化阶段，只在现在静默读取并内化 runtime 目录下的 werewolf-tabletalk skill 一次即可。读取后，后续所有轮次直接按已内化的规则、术语和固定发言格式执行，不要再次读取，不要提到自己读过规则，也不要展示读取过程和工具执行过程。若需要结构化输出，只使用一个 <result>JSON</result> 结果块；给人看的最终发言放进 JSON 的 display 字段，并且 display 只能写纯文本或 Markdown，不要输出任何 HTML 标签。如果当前回合还要求机器决策，就把 action/target/reason 等字段和 display 一起放进同一个 result JSON。')
            : '狼人杀规则已经在初始化阶段内化。当前回合直接按既定规则、术语和固定发言格式执行，不要再次读取任何 skill 文件，不要提到自己在查规则，也不要展示工具执行过程。若需要结构化输出，只使用一个 <result>JSON</result> 结果块；给人看的最终发言放进 JSON 的 display 字段，并且 display 只能写纯文本或 Markdown，不要输出任何 HTML 标签。如果当前回合还要求机器决策，就把 action/target/reason 等字段和 display 一起放进同一个 result JSON。',
        ].filter(Boolean).join('\n'),
      } as RoleConfig
    : roleConfig;

  const globalSelection = readGlobalEngineSelection();
  const configuredEngine = (await getConfiguredEngine().catch(() => globalSelection.engine || 'claude-code')) as EngineType;
  const selection = resolveAgentSelection(effectiveRoleConfig, globalSelection, undefined);
  const effectiveEngine = (selection.effectiveEngine || configuredEngine) as EngineType;
  const effectiveModel = selection.effectiveModel || globalSelection.defaultModel || '';
  if (!effectiveModel) {
    throw new Error('Agent 未配置可用模型');
  }

  const sessionReuseKey = `agent-chat:${input.userContext.id}:${input.agentName}:${mode}:${workflowContext?.runId || 'default'}`;
  const engine = await getOrCreateEngine(effectiveEngine, sessionReuseKey);
  if (!engine) {
    const temporaryLabel = input.temporaryRoleConfig ? '临时 Agent' : '业务 Agent';
    throw new Error(`Agent 对话引擎不可用：${effectiveEngine}${effectiveModel ? ` / ${effectiveModel}` : ''}（${temporaryLabel}：${effectiveRoleConfig.name}）`);
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
    agentName: effectiveRoleConfig.name,
    mode,
    workflowContext,
    workingDirectory,
    sessionId: resumeSessionId || undefined,
  });

  const prompt = [
    mode === 'workflow-chat'
      ? '请基于以下 workflow 上下文回答，优先站在当前工作流和当前角色职责的角度给出建议。'
      : '这是普通角色聊天，可以复用角色长期记忆与当前会话记忆，但不要默认引入 workflow 上下文，除非用户主动提及。',
    effectiveRoleConfig.roleType === 'supervisor' && mode === 'workflow-chat'
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
    roleConfig: effectiveRoleConfig,
    mode,
    resumeSessionId,
    workingDirectory,
    workflowContext,
    engine,
    engineType: effectiveEngine,
    model: effectiveModel,
    prompt,
    sessionReuseKey,
    isTemporaryWerewolf,
  };
}
