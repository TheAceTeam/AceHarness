import { readFile } from 'fs/promises';
import { randomUUID } from 'crypto';
import { parse } from 'yaml';
import { existsSync, readFileSync } from 'fs';
import { loadOwnerBoundChatSession } from '@/lib/memory-v2-cutover/chat-session-identity';
import { getRuntimeAgentConfigPath, getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { resolveAgentSelection } from '@/lib/agent/engine-selection';
import { getEngineConfigPath } from '@/lib/core/app-paths';
import type { RoleConfig } from '@/lib/core/schemas';
import {
  executeChatRuntimeWithContextRecovery,
  getConfiguredChatRuntimeEngine,
  getOrCreateChatRuntimeEngine,
  resolveRecoveredRuntimeSessionId,
  type ChatRuntimeEngine,
  type ChatRuntimeEngineType,
} from '@/lib/chat/chat-engine-runtime';
import {
  appendSpecCodingRevision,
} from '@/lib/spec/coding-store';
import {
  buildMemoryV2RequestContext,
  type MemoryV2ConsumerManifestResult,
} from '@/lib/memory-v2-cutover/consumer-context';
import { buildMemoryV2RecoverySource } from '@/lib/memory-v2-cutover/homepage-chat';
import {
  ensureMemoryV2FreshStart,
  type MemoryV2CutoverStatus,
} from '@/lib/memory-v2-cutover/feature-flag';
import {
  createMemoryService,
  type MemoryRequestContext,
  type MemoryService,
} from '@/lib/memory-v2';
import {
  createAiMemoryContinuityIdentity,
} from '@/lib/agent/ai-memory-session';
import {
  prepareAiMemoryEngineTurn,
  type AiMemoryHandoffEligibleProposalReference,
} from '@/lib/agent/ai-memory-protocol';
import {
  AiMemoryV2EngineAdapter,
  type AiMemoryV2EnginePlan,
} from '@/lib/agent/ai-memory-engine-adapter';
import { workflowRegistry } from '@/lib/workflow/registry';
import { loadRunState, saveRunState } from '@/lib/run/state-persistence';
import { stripAceProcessBlocks } from '@/lib/chat/ai-process-blocks';
import {
  extractSpecCodingRevisionCommand,
  stripSpecCodingRevisionCommand,
  type SpecCodingRevisionCommand,
} from '@/lib/spec/coding-revision-protocol';
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
  frontendSessionId?: string | null;
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
  frontendSessionId: string;
  workingDirectory: string;
  workflowContext: Record<string, any> | null;
  engine: ChatRuntimeEngine;
  engineType: ChatRuntimeEngineType;
  model: string;
  prompt: string;
  sessionReuseKey: string;
  userId: string;
  isTemporaryAgora: boolean;
  agoraExpectedResultType?: 'speech' | 'summary' | 'vote';
  memoryV2: MemoryV2ConsumerManifestResult;
  getLatestMemoryV2PromptBlock: () => string;
  getMemoryV2HandoffEligibleProposals: () => readonly AiMemoryHandoffEligibleProposalReference[];
  releaseMemoryV2: () => void;
}

export function buildAgentChatMemoryV2RecoverySource(
  prepared: Pick<PreparedAgentChat, 'memoryV2' | 'getLatestMemoryV2PromptBlock'>,
  currentRequest: string,
): string {
  if (!prepared.memoryV2.status.ready) {
    return ['# Current request', currentRequest].join('\n\n');
  }
  return buildMemoryV2RecoverySource({
    promptBlock: prepared.getLatestMemoryV2PromptBlock(),
    currentRequest,
  });
}

/**
 * Workflow callers may only hand off references observed from this accessor;
 * model-authored `<memory-handoff>` IDs are not persistence evidence.
 */
export function getPreparedAgentChatMemoryV2HandoffEligibleProposals(
  prepared: Pick<PreparedAgentChat, 'getMemoryV2HandoffEligibleProposals'>,
): readonly AiMemoryHandoffEligibleProposalReference[] {
  return prepared.getMemoryV2HandoffEligibleProposals();
}

function isAgentChatExecutionStep(mode: ChatMode, step: string): boolean {
  return step === mode || step.startsWith(`${mode}-`);
}

function textValue(value: unknown): string | undefined {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || undefined;
}

async function resolveOwnerBoundFrontendSessionId(input: {
  ownerUserId: string;
  frontendSessionId: string;
}): Promise<string> {
  const frontendSessionId = textValue(input.frontendSessionId);
  if (!frontendSessionId) return '';
  const session = await loadOwnerBoundChatSession({
    ownerUserId: input.ownerUserId,
    frontendSessionId,
  });
  return session?.id || '';
}

async function assertWorkflowMemoryV2Authorization(input: {
  context: MemoryRequestContext;
  sourceEventId: string;
  service: MemoryService;
}): Promise<void> {
  const runId = input.context.runId;
  const workflowId = input.context.workflowId;
  if (!runId || !workflowId || !input.context.agentId) {
    throw new Error('workflow Memory V2 context requires a run, workflow, and agent identity');
  }

  // The browser may describe workflow context for display, but its run binding
  // is not an authorization grant. Match the persisted run first, then force
  // the Memory V2 service to check its server-owned participant snapshot.
  const persistedRun = await loadRunState(runId);
  if (!persistedRun || textValue(persistedRun.configFile) !== workflowId) {
    throw new Error('workflow Memory V2 context is not bound to the persisted run');
  }
  input.service.getRequiredReadStatus({
    context: input.context,
    targetStepAttemptId: `agent-chat-membership:${input.sourceEventId}`,
  });
}

async function createAgentChatMemoryV2Plan(input: {
  ownerUserId: string;
  frontendSessionId: string;
  workflowContext: Record<string, any> | null;
  agentId: string;
  message: string;
}): Promise<{ memoryV2: MemoryV2ConsumerManifestResult; plan?: AiMemoryV2EnginePlan }> {
  const status = await ensureMemoryV2FreshStart();
  if (!status.ready) {
    return {
      memoryV2: { status, manifest: null, promptBlock: '', skippedReason: status.reason },
    };
  }

  const runId = textValue(input.workflowContext?.runId);
  const workflowId = textValue(input.workflowContext?.configFile);
  const hasWorkflowIdentity = Boolean(runId || workflowId);
  const ownerBoundFrontendSessionId = hasWorkflowIdentity
    ? ''
    : await resolveOwnerBoundFrontendSessionId({
        ownerUserId: input.ownerUserId,
        frontendSessionId: input.frontendSessionId,
      });
  if (!hasWorkflowIdentity && !ownerBoundFrontendSessionId) {
    const reason = 'Memory V2 requires a persisted frontend session owned by the authenticated user';
    const unavailableStatus: MemoryV2CutoverStatus = { ...status, ready: false, reason };
    return {
      memoryV2: { status: unavailableStatus, manifest: null, promptBlock: '', skippedReason: reason },
    };
  }
  try {
    const continuity = createAiMemoryContinuityIdentity({
      frontendSessionId: ownerBoundFrontendSessionId || undefined,
      runId,
      workflowId,
    });
    const requestContext = {
      ...buildMemoryV2RequestContext({
        ownerUserId: input.ownerUserId,
        // Agent chat accepts a browser working directory for runtime tools,
        // never for V2 project scope. No server-owned project identity exists
        // on this path, so project scope is intentionally omitted.
        // Workflow short memory is run-scoped. Do not retain a client session
        // authorization alongside a workflow identity.
        sessionId: hasWorkflowIdentity ? undefined : ownerBoundFrontendSessionId,
        runId,
        workflowId,
        agentId: input.agentId,
      }),
      actor: 'ai' as const,
      actorId: `agent-chat:${input.agentId}`,
    } satisfies MemoryRequestContext;
    const sourceEventId = `agent-chat-memory-v2:${randomUUID()}`;
    const memoryV2: MemoryV2ConsumerManifestResult = { status, manifest: null, promptBlock: '' };
    const previewService = createMemoryService();
    try {
      if (continuity.kind === 'workflow-run') {
        await assertWorkflowMemoryV2Authorization({
          context: requestContext,
          sourceEventId,
          service: previewService,
        });
      }
      const previewTurn = prepareAiMemoryEngineTurn({
        memoryService: previewService,
        requestContext,
        continuity,
        sourceEventId,
        trigger: 'conversation-turn',
        queryText: input.message,
        ...(requestContext.stepAttemptId ? { targetStepAttemptId: requestContext.stepAttemptId } : {}),
      });
      memoryV2.manifest = previewTurn.manifest;
      memoryV2.promptBlock = previewTurn.manifest.promptBlock;
    } finally {
      previewService.close();
    }
    return {
      memoryV2,
      plan: {
        requestContext,
        continuity,
        sourceEventId,
        queryText: input.message,
      },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Memory V2 chat context is unavailable';
    const unavailableStatus: MemoryV2CutoverStatus = { ...status, ready: false, reason };
    return {
      memoryV2: { status: unavailableStatus, manifest: null, promptBlock: '', skippedReason: reason },
    };
  }
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
    const result = await executeChatRuntimeWithContextRecovery(input.prepared.engine, {
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
      buildCompactSource: () => buildAgentChatMemoryV2RecoverySource(input.prepared, input.prompt),
      onContextReset: () => {
        latestSessionId = undefined;
      },
    });
    lastResult = result;
    latestSessionId = resolveRecoveredRuntimeSessionId(result, latestSessionId) || undefined;
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
  const visibleOutput = prepared.isTemporaryAgora
    ? buildVisibleAgoraOutput(cleanedOutput)
    : cleanedOutput;

  prepared.releaseMemoryV2();
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
      ? 'Workflow chat keeps its V2 run scope when the runtime session is replaced.'
      : 'Standalone chat keeps its V2 frontend-session scope when the runtime session is replaced.',
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

  try {
  const result = prepared.isTemporaryAgora
    ? await executeAgoraTurnWithResultEnforcement({
        prepared,
        prompt: prepared.prompt,
      })
    : await executeChatRuntimeWithContextRecovery(prepared.engine, {
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
      }, {
        buildCompactSource: () => buildAgentChatMemoryV2RecoverySource(prepared, message),
      });

  if (!result.success && !result.output && result.error) {
    return finalizeAgentChatExecution({
      prepared,
      userMessage: message,
      rawOutput: '',
      success: false,
      error: result.error || 'Agent 对话失败',
      sessionId: resolveRecoveredRuntimeSessionId(result, prepared.resumeSessionId),
    });
  }
  return finalizeAgentChatExecution({
    prepared,
    userMessage: message,
    rawOutput: result.output || '',
    success: result.success,
    error: result.error || null,
    sessionId: resolveRecoveredRuntimeSessionId(result, prepared.resumeSessionId),
  });
  } finally {
    prepared.releaseMemoryV2();
  }
}

export async function prepareAgentChat(input: ExecuteAgentChatInput): Promise<PreparedAgentChat> {
  const message = String(input.message || '').trim();
  const mode = (input.mode === 'workflow-chat' ? 'workflow-chat' : 'standalone-chat') as ChatMode;
  const resumeSessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : '';
  const workflowContext = input.workflowContext && typeof input.workflowContext === 'object'
    ? input.workflowContext as Record<string, any>
    : null;
  const frontendSessionId = typeof input.frontendSessionId === 'string' && input.frontendSessionId.trim()
    ? input.frontendSessionId.trim()
    : (typeof workflowContext?.frontendSessionId === 'string' && workflowContext.frontendSessionId.trim()
      ? workflowContext.frontendSessionId.trim()
      : '');

  if (!message) {
    throw new Error('消息不能为空');
  }

  const roleConfig = input.temporaryRoleConfig
    ? input.temporaryRoleConfig
    : parse(await readFile(await getRuntimeAgentConfigPath(input.agentName), 'utf-8')) as RoleConfig;
  if (!roleConfig?.name) {
    throw new Error('Agent 配置无效');
  }
  const isTemporaryAgora = isTemporaryAgoraChat(workflowContext);
  const agoraExpectedResultType = isTemporaryAgora ? getAgoraExpectedResultType(workflowContext) : undefined;
  const workingDirectory = typeof input.workingDirectory === 'string' && input.workingDirectory.trim()
    ? input.workingDirectory.trim()
    : input.userContext.personalDir;
  const effectiveRoleConfig = isTemporaryAgora
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
  const configuredEngine = (await getConfiguredChatRuntimeEngine().catch(() => globalSelection.engine || 'claude-code')) as ChatRuntimeEngineType;
  const selection = resolveAgentSelection(effectiveRoleConfig, globalSelection, undefined);
  const effectiveEngine = (selection.effectiveEngine || configuredEngine) as ChatRuntimeEngineType;
  const effectiveModel = selection.effectiveModel || globalSelection.defaultModel || '';
  if (!effectiveModel) {
    throw new Error('Agent 未配置可用模型');
  }
  const effectiveSkillNames = Array.isArray(effectiveRoleConfig.skills)
    ? Array.from(new Set(
        effectiveRoleConfig.skills
          .map((item) => String(item || '').trim())
          .filter(Boolean),
      ))
    : [];
  await ensureEngineRuntimeSkillsAvailable(effectiveEngine, workingDirectory, effectiveSkillNames);

  const sessionReuseKey = `agent-chat:${input.userContext.id}:${input.agentName}:${mode}:${workflowContext?.runId || 'default'}`;
  const engine = await getOrCreateChatRuntimeEngine(effectiveEngine, sessionReuseKey, input.userContext.id);
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
  const preparedMemoryV2 = await createAgentChatMemoryV2Plan({
    ownerUserId: input.userContext.id,
    frontendSessionId,
    workflowContext,
    agentId: effectiveRoleConfig.name,
    message,
  });
  const memoryEngine = new AiMemoryV2EngineAdapter(
    engine,
    (options) => isAgentChatExecutionStep(mode, options.step),
    preparedMemoryV2.plan,
    preparedMemoryV2.memoryV2,
  );

  const prompt = [
    mode === 'workflow-chat'
      ? '请基于以下 workflow 上下文回答，优先站在当前工作流和当前角色职责的角度给出建议。'
      : '这是普通角色聊天。只使用当前授权的 Memory V2 索引清单，不要默认引入 workflow 上下文，除非用户主动提及。',
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
    '',
    '# 用户消息',
    message,
  ].filter(Boolean).join('\n\n');

  return {
    roleConfig: effectiveRoleConfig,
    mode,
    resumeSessionId,
    frontendSessionId,
    workingDirectory,
    workflowContext,
    engine: memoryEngine,
    engineType: effectiveEngine,
    model: effectiveModel,
    prompt,
    sessionReuseKey,
    userId: input.userContext.id,
    isTemporaryAgora,
    agoraExpectedResultType,
    memoryV2: preparedMemoryV2.memoryV2,
    getLatestMemoryV2PromptBlock: () => memoryEngine.getLatestMemoryV2PromptBlock(),
    getMemoryV2HandoffEligibleProposals: () => memoryEngine.getHandoffEligibleProposals(),
    releaseMemoryV2: () => memoryEngine.releaseMemoryV2(),
  };
}
