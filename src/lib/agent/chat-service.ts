import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { getRuntimeAgentConfigPath, getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { getConfiguredEngine, getOrCreateEngine, type EngineType } from '@/lib/engines/engine-factory';
import { resolveAgentSelection } from '@/lib/agent/engine-selection';
import { getEngineConfigPath, getWorkspaceRoot } from '@/lib/core/app-paths';
import type { RoleConfig } from '@/lib/core/schemas';
import type { Engine } from '@/lib/engines/engine-interface';
import { executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';
import {
  appendSpecCodingRevision,
} from '@/lib/spec/coding-store';
import {
  appendMemoryEntries,
} from '@/lib/workflow/memory-store';
import { resolveAgentMemoryContext } from '@/lib/agent/memory-resolver';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, saveRunState } from '@/lib/run/state-persistence';
import { stripAceProcessBlocks } from '@/lib/chat/ai-process-blocks';
import {
  extractSpecCodingRevisionCommand,
  stripSpecCodingRevisionCommand,
  type SpecCodingRevisionCommand,
} from '@/lib/spec/coding-revision-protocol';
import { getRuntimeSkillPath } from '@/lib/run/runtime-skills';
import { extractStructuredResult as extractResultChannelStructuredResult } from '@/lib/ai/result-channel';
import {
  ensureEngineRuntimeSkillsAvailable,
  resolveChatRequestedMcpServers,
  type RequestedMcpServersInput,
} from '@/lib/chat/request-options';
import {
  mergeMcpServers,
  resolveMcpServersByNames,
  type ManagedMcpServer,
} from '@/lib/mcp/registry';

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
  requestedMcpServers?: RequestedMcpServersInput;
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
  userId: string;
  isTemporaryWerewolf: boolean;
  isTemporaryAgora: boolean;
  agoraExpectedResultType?: 'speech' | 'summary' | 'vote';
}

function isTemporaryWerewolfChat(input: {
  roleConfig?: RoleConfig | null;
  workflowContext?: Record<string, any> | null;
}): boolean {
  return input.workflowContext?.temporaryLab === 'werewolf'
    || input.roleConfig?.category === 'werewolf-lab'
    || (
      input.workflowContext?.temporaryLab !== 'agora'
      && Boolean(input.roleConfig?.tags?.includes('werewolf-lab'))
    );
}

function isTemporaryAgoraChat(workflowContext?: Record<string, any> | null): boolean {
  return workflowContext?.temporaryLab === 'agora';
}

function getAgoraExpectedResultType(workflowContext?: Record<string, any> | null): 'speech' | 'summary' | 'vote' {
  const raw = String(workflowContext?.agoraExpectedResultType || '').trim();
  return raw === 'summary' || raw === 'vote' ? raw : 'speech';
}

async function resolveWorkflowChatMcpServers(
  workflowContext: Record<string, any> | null,
  baseDirectory?: string,
): Promise<ManagedMcpServer[]> {
  if (!workflowContext) return [];

  const directNames = Array.isArray(workflowContext.mcpServers)
    ? workflowContext.mcpServers.filter((item: unknown): item is string => typeof item === 'string')
    : [];
  if (directNames.length > 0) {
    return resolveMcpServersByNames(directNames, baseDirectory);
  }

  const configFile = typeof workflowContext.configFile === 'string'
    ? workflowContext.configFile.trim()
    : '';
  if (!configFile) return [];

  try {
    const configPath = await getRuntimeWorkflowConfigPath(configFile);
    const workflowConfig = parse(await readFile(configPath, 'utf-8')) as { context?: { mcpServers?: string[] } };
    return resolveMcpServersByNames(workflowConfig.context?.mcpServers || [], baseDirectory);
  } catch {
    return [];
  }
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
  return stripAceProcessBlocks(String(text || ''), '\n')
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

function extractAnyAgoraResult(rawOutput: string): { kind: 'agora_result'; payload: Record<string, any> } | null {
  return extractResultChannelStructuredResult<{ kind: 'agora_result'; payload: Record<string, any> }>(
    rawOutput,
    (value: any): value is { kind: 'agora_result'; payload: Record<string, any> } => Boolean(
      value
      && typeof value === 'object'
      && value.kind === 'agora_result'
      && value.payload
      && typeof value.payload === 'object'
      && !Array.isArray(value.payload)
    ),
  );
}

function hasAgoraResult(rawOutput: string, expectedType?: 'speech' | 'summary' | 'vote'): boolean {
  const result = extractAnyAgoraResult(rawOutput);
  if (!result) return false;
  if (!expectedType) return true;
  return result.payload?.type === expectedType && typeof result.payload?.content === 'string' && Boolean(result.payload.content.trim());
}

function buildVisibleAgoraOutput(rawOutput: string): string {
  const payload = extractAnyAgoraResult(rawOutput)?.payload;
  if (typeof payload?.content === 'string' && payload.content.trim()) {
    return stripHtmlTags(payload.content);
  }
  return stripToolNarrationBlocks(rawOutput);
}

function buildAgoraResultRetryPrompt(expectedType: 'speech' | 'summary' | 'vote'): string {
  const schema = expectedType === 'summary'
    ? '{"kind":"agora_result","payload":{"type":"summary","title":"本轮总结","content":"共识：...\\n分歧：...\\n风险：...\\n下一步：..."}}'
    : expectedType === 'vote'
      ? '{"kind":"agora_result","payload":{"type":"vote","content":"你的选择\\n理由：一句话","choice":"精确选项文本或弃权","reason":"一句简短理由"}}'
      : '{"kind":"agora_result","payload":{"type":"speech","content":"最终要发出的群聊内容","mentions":["被你@的人名，可为空数组"]}}';
  return [
    `你上一条回复不合规：缺少可解析的议场 <result> 结果块，或 payload.type 不是 "${expectedType}"。`,
    '不要重复过程说明，不要展示任何工具、规则、草稿或解释。',
    '现在仅基于同一回合补发一个合规的 `<result>JSON</result>`。',
    `唯一允许输出的格式是：<result>${schema}</result>`,
    '如果需要给人看的最终发言，只能放进 payload.content；输出 </result> 后不要再追加任何文字。',
  ].join('\n');
}

async function executeWerewolfTurnWithResultEnforcement(input: {
  prepared: PreparedAgentChat;
  prompt: string;
}): Promise<{
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
}> {
  const maxAttempts = 3;
  let latestSessionId = input.prepared.resumeSessionId || undefined;
  let lastResult: {
    success: boolean;
    output: string;
    error?: string;
    sessionId?: string;
  } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const isRetry = attempt > 0;
    const result = await executeEngineWithContextRecovery(input.prepared.engine, {
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
      userId: input.prepared.userId,
    }, {
      onContextReset: () => {
        latestSessionId = undefined;
      },
    });
    lastResult = result;
    latestSessionId = resolveRecoveredSessionId(result, latestSessionId) || undefined;
    if (hasWerewolfResult(result.output || '')) return result;
  }

  return lastResult || { success: false, output: '', error: 'missing werewolf result', sessionId: latestSessionId };
}

async function executeAgoraTurnWithResultEnforcement(input: {
  prepared: PreparedAgentChat;
  prompt: string;
}): Promise<{
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
}> {
  const maxAttempts = 3;
  const expectedType = input.prepared.agoraExpectedResultType || 'speech';
  let latestSessionId = input.prepared.resumeSessionId || undefined;
  let lastResult: {
    success: boolean;
    output: string;
    error?: string;
    sessionId?: string;
  } | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const isRetry = attempt > 0;
    const result = await executeEngineWithContextRecovery(input.prepared.engine, {
      agent: input.prepared.roleConfig.name,
      step: isRetry ? `${input.prepared.mode}-agora-result-retry-${attempt}` : input.prepared.mode,
      prompt: isRetry ? buildAgoraResultRetryPrompt(expectedType) : input.prompt,
      systemPrompt: input.prepared.roleConfig.systemPrompt || `你是 ${input.prepared.roleConfig.name}。`,
      model: input.prepared.model,
      workingDirectory: input.prepared.workingDirectory,
      allowedTools: input.prepared.roleConfig.allowedTools,
      sessionId: latestSessionId,
      appendSystemPrompt: false,
      mcpServers: input.prepared.roleConfig.mcpServers,
      userId: input.prepared.userId,
    }, {
      onContextReset: () => {
        latestSessionId = undefined;
      },
    });
    lastResult = result;
    latestSessionId = resolveRecoveredSessionId(result, latestSessionId) || undefined;
    if (hasAgoraResult(result.output || '', expectedType)) return result;
  }

  return lastResult || { success: false, output: '', error: 'missing agora result', sessionId: latestSessionId };
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
  const finalSessionId = input.sessionId !== undefined
    ? input.sessionId
    : (prepared.resumeSessionId || null);
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
    : prepared.isTemporaryAgora
      ? buildVisibleAgoraOutput(cleanedOutput)
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
    : prepared.isTemporaryAgora
      ? await executeAgoraTurnWithResultEnforcement({
          prepared,
          prompt: prepared.prompt,
        })
    : await executeEngineWithContextRecovery(prepared.engine, {
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
        userId: prepared.userId,
      });

  if (!result.success && !result.output && result.error) {
    return finalizeAgentChatExecution({
      prepared,
      userMessage: message,
      rawOutput: '',
      success: false,
      error: result.error || 'Agent 对话失败',
      sessionId: resolveRecoveredSessionId(result, prepared.resumeSessionId),
    });
  }
  return finalizeAgentChatExecution({
    prepared,
    userMessage: message,
    rawOutput: result.output || '',
    success: result.success,
    error: result.error || null,
    sessionId: resolveRecoveredSessionId(result, prepared.resumeSessionId),
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
  const isTemporaryAgora = isTemporaryAgoraChat(workflowContext);
  const agoraExpectedResultType = isTemporaryAgora ? getAgoraExpectedResultType(workflowContext) : undefined;
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
    : isTemporaryAgora
      ? {
          ...roleConfig,
          systemPrompt: [
            roleConfig.systemPrompt || '',
            '你正在参加议场群聊。当前回合的最终提交必须严格遵守用户消息里给出的 `<result>...</result>` JSON 协议。',
            `本轮期望的 payload.type 是 "${agoraExpectedResultType || 'speech'}"。如果缺少 <result>、kind 不为 "agora_result"、payload.type 不匹配，或 payload.content 为空，本轮会被判失败并要求你重发。`,
            '这个协议只约束最终结果块，不要求你用汇报腔；正常像群聊一样说话就行。',
            '如需中间过程，可先输出普通正文；但最终展示给群里的那段话必须完整写进 payload.content。',
            '输出 </result> 后不要再追加任何文字。',
          ].filter(Boolean).join('\n'),
        } as RoleConfig
    : roleConfig;
  const requestedMcpServers = input.requestedMcpServers !== undefined
    ? await resolveChatRequestedMcpServers({
        requestedMcpServers: input.requestedMcpServers,
        workingDirectory,
      })
    : [];
  const workflowMcpServers = mode === 'workflow-chat'
    ? await resolveWorkflowChatMcpServers(workflowContext, workingDirectory)
    : [];
  const effectiveRoleConfigWithMcp = mergeMcpServers(
    requestedMcpServers,
    workflowMcpServers,
    effectiveRoleConfig.mcpServers as any,
  );
  if (effectiveRoleConfigWithMcp.length > 0 || effectiveRoleConfig.mcpServers?.length) {
    effectiveRoleConfig.mcpServers = effectiveRoleConfigWithMcp as any;
  }

  const globalSelection = readGlobalEngineSelection();
  const configuredEngine = (await getConfiguredEngine().catch(() => globalSelection.engine || 'claude-code')) as EngineType;
  const selection = resolveAgentSelection(effectiveRoleConfig, globalSelection, undefined);
  const effectiveEngine = (selection.effectiveEngine || configuredEngine) as EngineType;
  const effectiveModel = selection.effectiveModel || globalSelection.defaultModel || '';
  if (!effectiveModel) {
    throw new Error('Agent 未配置可用模型');
  }
  await ensureEngineRuntimeSkillsAvailable(effectiveEngine, workingDirectory);

  const sessionReuseKey = `agent-chat:${input.userContext.id}:${input.agentName}:${mode}:${workflowContext?.runId || 'default'}`;
  const engine = await getOrCreateEngine(effectiveEngine, sessionReuseKey, input.userContext.id);
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
  const memoryContextBlock = await resolveAgentMemoryContext({
    agentName: effectiveRoleConfig.name,
    mode,
    workflowContext,
    workingDirectory,
    sessionId: resumeSessionId || undefined,
    maxRoleMemoryChars: effectiveRoleConfig.workspaceProfile?.memory?.baseBudget,
  });

  const prompt = [
    mode === 'workflow-chat'
      ? '请基于以下 workflow 上下文回答，优先站在当前工作流和当前角色职责的角度给出建议。'
      : '这是普通角色聊天，可以复用角色长期记忆与当前会话记忆，但不要默认引入 workflow 上下文，除非用户主动提及。',
    effectiveRoleConfig.roleType === 'supervisor' && mode === 'workflow-chat'
      ? [
        '## Supervisor Spec Coding 修订协议',
        '- 当用户明确要求你刷新、修订、更新、收敛 Spec Coding 制品 / 方案 / 任务分解时，正常回答后，额外单独输出一个 `<result>...</result>` 机器结果块。',
        '- 推荐 JSON 格式: {"kind":"spec_coding_revision","payload":{"apply":true,"summary":"一句话修订摘要","affectedArtifacts":["requirements.md","design.md","tasks.md"],"impact":["影响1","影响2"],"revisionPlan":[{"artifact":"requirements","op":"modify","targetId":"R1","reason":"为什么改"}]}}',
        '- revisionPlan 用 add / modify / remove / rename 描述具体变更；targetId 使用 R/D/T 编号或明确章节名，避免只写笼统影响。',
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
    userId: input.userContext.id,
    isTemporaryWerewolf,
    isTemporaryAgora,
    agoraExpectedResultType,
  };
}
