/**
 * 工作流管理器
 * 负责工作流的执行和状态管理，支持对抗迭代工作流
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, readdir, stat, mkdir, cp, rm, copyFile, writeFile } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { cpus } from 'os';
import { parse } from 'yaml';
import { fenced } from '@/lib/core/markdown-utils';
import { processManager } from '@/lib/core/process-manager';
import type { EngineJsonResult, EngineResultMetadata, EngineTokenUsage } from '@/lib/engines/engine-interface';
import { createRun, updateRun } from '@/lib/run/store';
import type { RunRecord } from '@/lib/run/store';
import {
  saveRunState, saveProcessOutput, saveStreamContent, loadStreamContent, loadStepOutputs, loadRunState, findRunningRuns, isProcessAlive,
  type PersistedRunState, type PersistedProcessInfo, type PersistedStepLog, type PersistedQualityCheck, type WorkflowGitState,
} from '@/lib/run/state-persistence';
import type { WorkflowConfig, WorkflowPhase, WorkflowStep, RoleConfig, IterationConfig } from '@/lib/core/schemas';
import { formatTimestamp } from '@/lib/core/utils';
import { isWindows } from '@/lib/core/runtime-platform';
import { createEngine, getConfiguredEngine, resolveRequestedEngineType, type Engine, type EngineType } from '@/lib/engines';
import { getEngineSkillsSubdir } from '@/lib/engines/engine-config';
import type { EngineStreamEvent } from '@/lib/engines/engine-interface';
import { compactEngineContextManually, executeEngineWithContextRecovery, resolveRecoveredSessionId } from '@/lib/engines/context-recovery';
import { getRuntimeAgentsDirPath, getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { getRuntimeSkillsDirPath } from '@/lib/run/runtime-skills';
import { getEngineConfigPath, getWorkspaceRoot, getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { createDirectoryLinkSync } from '@/lib/core/directory-links';
import { resolveWorkflowAgentSelection, resolveWorkflowExecutionPolicy } from '@/lib/agent/engine-selection';
import { ensureDefaultSupervisorConfig } from '@/lib/core/default-supervisor';
import { updateChatSessionCreationBinding, updateChatSessionWorkflowBinding } from '@/lib/chat/persistence';
import { appendWorkflowAgoraMessage, createWorkflowParticipants } from '@/lib/agora/workflow-topic';
import { extractJsonObject as extractStructuredJsonObject } from '@/lib/ai/result-channel';
import { compactStepConclusion } from '@/lib/state-machine/utils';
import {
  ensureWorkflowGitState,
  recordWorkflowGitSnapshot,
  upsertWorkflowGitStepDiff,
} from '@/lib/workflow/git-baseline';
import {
  mergeMcpServers,
  resolveMcpServersByNames,
  type ManagedMcpServer,
} from '@/lib/mcp/registry';

/** 根据工作流引擎配置解析 Agent 实际使用的模型 */
export function resolveAgentModel(roleConfig: any, workflowContext?: any): string {
  let globalEngine = '';
  let defaultModel = '';

  try {
    if (existsSync(getEngineConfigPath())) {
      const config = JSON.parse(readFileSync(getEngineConfigPath(), 'utf-8'));
      globalEngine = config.engine || globalEngine;
      defaultModel = config.defaultModel || '';
    }
  } catch {
    // ignore invalid engine config and fall back to defaults
  }

  const resolved = resolveWorkflowAgentSelection(
    roleConfig,
    { engine: globalEngine, defaultModel },
    { agentName: roleConfig?.name, workflowContext },
  );

  if (!resolved.effectiveEngine) {
    throw new Error('未配置默认引擎，请先在首次初始化或引擎设置页面完成配置');
  }
  if (!resolved.effectiveModel) {
    throw new Error('未配置默认模型，请先在首次初始化或引擎设置页面完成配置');
  }

  return resolved.effectiveModel;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

const ZERO_ENGINE_USAGE: EngineTokenUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
};

const STREAM_IDLE_INTERRUPT_MS = 10 * 60 * 1000;
const STREAM_IDLE_CHECK_MS = 30 * 1000;
const AUTO_CONTINUE_FEEDBACK = '系统检测到当前步骤已连续 10 分钟没有新的流式输出。请继续当前任务，并在无法继续时明确说明当前阻塞点。';

interface LiveFeedbackOptions {
  id?: string;
  interrupt?: boolean;
  automatic?: boolean;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function replaceAgentSessionId(agentSessions: Map<string, string>, agentName: string, nextSessionId?: string | null): void {
  if (nextSessionId) {
    agentSessions.set(agentName, nextSessionId);
  } else {
    agentSessions.delete(agentName);
  }
}

function normalizeEngineUsage(metadata?: EngineResultMetadata): EngineTokenUsage {
  const usage = metadata?.usage;
  return {
    input_tokens: numberOrZero(usage?.input_tokens),
    output_tokens: numberOrZero(usage?.output_tokens),
    cache_creation_input_tokens: numberOrZero(usage?.cache_creation_input_tokens),
    cache_read_input_tokens: numberOrZero(usage?.cache_read_input_tokens),
  };
}

function metadataNumber(metadata: EngineResultMetadata | undefined, snakeKey: string, camelKey: string): number {
  return numberOrZero(metadata?.[snakeKey] ?? metadata?.[camelKey]);
}

function toPersistedTokenUsage(usage: EngineTokenUsage): TokenUsage {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheCreationInputTokens: usage.cache_creation_input_tokens,
    cacheReadInputTokens: usage.cache_read_input_tokens,
  };
}

export interface ChangeRecord {
  file: string;
  action: 'created' | 'modified' | 'deleted';
  description: string;
}

export interface AgentState {
  name: string;
  team: string;
  model: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  currentTask: string | null;
  completedTasks: number;
  tokenUsage: TokenUsage;
  costUsd: number;
  sessionId: string | null;
  iterationCount: number;
  lastOutput: string;
  summary: string;
  changes: ChangeRecord[];
}

export interface IterationState {
  phaseName: string;
  currentIteration: number;
  maxIterations: number;
  consecutiveCleanRounds: number;
  status: 'running' | 'completed' | 'escalated';
  bugsFoundPerRound: number[];
}

function stripNonAiStreamArtifacts(text: string): string {
  return text
    .replace(/\n?\s*<!-- chunk-boundary -->\s*\n?/g, '\n')
    .replace(/\n?\s*<!-- human-feedback:[\s\S]*?-->\s*\n?/g, '\n')
    .trim();
}

function hasMeaningfulAiOutput(...parts: Array<string | null | undefined>): boolean {
  return parts.some((part) => typeof part === 'string' && stripNonAiStreamArtifacts(part).length > 0);
}

function buildAgentCompactSourceFromStepLogs(
  stepLogs: PersistedStepLog[],
  agentName: string,
  currentPrompt: string,
): string {
  const recentLogs = stepLogs.filter((log) => log.agent === agentName).slice(-5);
  if (recentLogs.length === 0) return currentPrompt;

  const history = recentLogs.map((log) => {
    const summarySource = log.output || log.error || '';
    const summary = compactStepConclusion(summarySource).slice(0, 4000);
    return [
      `## ${log.stepName}`,
      `状态: ${log.status}`,
      summary ? `${log.output ? '输出摘要' : '错误摘要'}:\n${summary}` : '',
    ].filter(Boolean).join('\n');
  }).join('\n\n');

  return [
    '# 该 Agent 在当前工作流中的历史步骤摘要',
    history,
    '# 当前步骤请求',
    currentPrompt,
  ].join('\n\n');
}

export class WorkflowManager extends EventEmitter {
  private currentWorkflow: WorkflowConfig | null = null;
  private logs: any[] = [];
  private status: 'idle' | 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' = 'idle';
  private agents: AgentState[] = [];
  private currentPhase: string | null = null;
  private currentStep: string | null = null;
  private shouldStop: boolean = false;
  private iterationStates: Map<string, IterationState> = new Map();
  private currentRunId: string | null = null;
  private currentConfigFile: string | null = null;
  private agentConfigs: RoleConfig[] = [];
  private completedStepNames: string[] = [];
  private failedStepNames: string[] = [];
  private stepLogs: PersistedStepLog[] = [];
  private qualityChecks: PersistedQualityCheck[] = [];
  private forceCompleteFlag: boolean = false;
  private interruptFlag: boolean = false;
  private feedbackInterrupt: boolean = false;
  private runStartTime: string | null = null;
  private runEndTime: string | null = null;
  /** Agent name → session_id for --resume in iterative phases */
  private agentSessionIds: Map<string, string> = new Map();
  private statusReason: string | null = null;
  private pendingCheckpoint: { phase: string; checkpoint: string; message: string; isIterativePhase: boolean } | null = null;
  /** Pre-queued action for the next waitForApproval call (set by resume with action) */
  private queuedApprovalAction: 'approve' | 'iterate' | null = null;
  /** Iteration feedback from human review */
  private iterationFeedback: string = '';
  /** Live feedback queued by user during execution, consumed after current step completes */
  private liveFeedback: string[] = [];
  /** Global context injected into all steps */
  private globalContext: string = '';
  /** Per-phase context injected into steps of that phase */
  private phaseContexts: Map<string, string> = new Map();
  /** Cached workspace skills discovered from projectRoot/<engine-config>/skills/ */
  private workspaceSkills: string = '';
  /** Cached workspace skill names for deduplication */
  private workspaceSkillNames: Set<string> = new Set();
  /** Multi-user: createdBy userId, set by workflow start route */
  public _createdBy?: string;
  /** Multi-user: display name for the user who started the run */
  public _createdByName?: string;
  /** Multi-user: user's personal directory for isolation */
  public _userPersonalDir?: string;
  /** Optional frontend chat session to auto-bind with this run */
  public _frontendSessionId?: string;
  /** The isolated working directory for this run (if isolation is active) */
  private isolatedDir: string | null = null;
  /** Original projectRoot from config (before isolation) */
  private currentProjectRoot: string | null = null;
  private getWorkingDirectory(): string | null {
    return this.isolatedDir || this.currentProjectRoot || null;
  }
  /** Cached workflow-level skills from context.skills */
  private workflowSkillsContent: string = '';
  /** Resolved workflow-level MCP servers from context.mcpServers */
  private workflowMcpServers: ManagedMcpServer[] = [];
  /** Skills copied to workspace that need cleanup on finish */
  private copiedSkills: { dir: string; names: string[]; indexCopied: boolean; dirExistedBefore: boolean } | null = null;
  /** Current engine instance (Kiro CLI, Codex, etc.) */
  private currentEngine: Engine | null = null;
  /** Current engine type */
  private engineType: EngineType = 'claude-code';
  private workflowGit: WorkflowGitState | null = null;

  /** Get the workspace skills subdir based on current engine type */
  private get workspaceSkillsSubdir(): string {
    return getEngineSkillsSubdir(this.engineType);
  }

  private resolveProjectRootPath(projectRoot?: string | null): string {
    const baseDir = this._userPersonalDir || getWorkspaceRoot();
    return projectRoot ? resolve(baseDir, projectRoot) : baseDir;
  }

  private async resolveWorkflowMcpServers(workflowConfig: WorkflowConfig): Promise<void> {
    const names = Array.isArray((workflowConfig.context as any)?.mcpServers)
      ? (workflowConfig.context as any).mcpServers
      : [];
    const baseDirectory = this.getWorkingDirectory() || workflowConfig.context?.projectRoot || this.resolveProjectRootPath();
    this.workflowMcpServers = await resolveMcpServersByNames(names, baseDirectory);
  }

  private getEffectiveMcpServers(roleConfig?: RoleConfig | null): ManagedMcpServer[] {
    return mergeMcpServers(this.workflowMcpServers, roleConfig?.mcpServers as any);
  }

  private getWorkflowSupervisorAgentName(): string | undefined {
    return (this.currentWorkflow as any)?.workflow?.supervisor?.agent
      || this.agentConfigs.find((role: any) => role?.roleType === 'supervisor')?.name
      || undefined;
  }

  private async autoCompactAgentContextIfNeeded(input: {
    agentName: string;
    stepName: string;
    workflowConfig: WorkflowConfig;
    prompt: string;
    systemPrompt: string;
    model: string;
    workingDirectory: string;
    timeoutMs?: number;
  }): Promise<{ prompt: string; sessionId?: string }> {
    const policy = resolveWorkflowExecutionPolicy(input.workflowConfig.context);
    const existingSessionId = this.agentSessionIds.get(input.agentName);
    if (!policy.autoCompactOnStepChange || !existingSessionId || !this.currentEngine) {
      return { prompt: input.prompt, sessionId: existingSessionId };
    }
    if (!this.stepLogs.some((log) => log.agent === input.agentName)) {
      return { prompt: input.prompt, sessionId: existingSessionId };
    }

    try {
      this.emit('log', {
        agent: input.agentName,
        level: 'info',
        message: `步骤切换前自动压缩 ${input.agentName} 的上下文：${input.stepName}`,
      });
      const compacted = await compactEngineContextManually(this.currentEngine, {
        agent: input.agentName,
        step: input.stepName,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        model: input.model,
        workingDirectory: input.workingDirectory,
        timeoutMs: input.timeoutMs,
        sessionId: existingSessionId,
        appendSystemPrompt: true,
        runId: this.currentRunId || undefined,
      }, {
        buildCompactSource: async () => buildAgentCompactSourceFromStepLogs(this.stepLogs, input.agentName, input.prompt),
      });
      replaceAgentSessionId(this.agentSessionIds, input.agentName, compacted.nextSessionId);
      const agent = this.agents.find((item) => item.name === input.agentName);
      if (agent) {
        agent.sessionId = compacted.nextSessionId || null;
      }
      await this.persistState();
      this.emit('log', {
        agent: input.agentName,
        level: 'info',
        message: `已完成步骤级自动上下文总结：${compacted.method}`,
      });
      return {
        prompt: compacted.prompt,
        sessionId: compacted.nextSessionId || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('log', {
        agent: input.agentName,
        level: 'warning',
        message: `步骤级自动上下文总结失败，继续原会话：${message}`,
      });
      return { prompt: input.prompt, sessionId: existingSessionId };
    }
  }

  private getWorkflowAgoraAgentSessions(): Record<string, string> {
    return Object.fromEntries(
      this.agents
        .filter((agent) => Boolean(agent.sessionId))
        .map((agent) => [agent.name, agent.sessionId as string])
    );
  }

  private getWorkflowAgoraParticipants() {
    const names = new Set<string>();
    const addName = (name?: string | null) => {
      const trimmed = String(name || '').trim();
      if (trimmed) names.add(trimmed);
    };
    addName(this.getWorkflowSupervisorAgentName());
    this.agents.forEach((agent) => addName(agent.name));
    return createWorkflowParticipants([...names], {
      coordinatorAgent: this.getWorkflowSupervisorAgentName(),
    });
  }

  private async appendWorkflowTranscriptEvent(input: {
    type: string;
    title: string;
    body?: string;
    speakerName: string;
    speakerType?: 'human' | 'agent' | 'system';
    dedupeKey?: string;
  }): Promise<void> {
    if (!this._frontendSessionId) return;
    await appendWorkflowAgoraMessage({
      sessionId: this._frontendSessionId,
      type: input.type,
      title: input.title,
      body: input.body,
      speakerName: input.speakerName,
      speakerType: input.speakerType || 'agent',
      dedupeKey: input.dedupeKey,
      participants: this.getWorkflowAgoraParticipants(),
      agentSessions: this.getWorkflowAgoraAgentSessions(),
      workspacePath: this.getWorkingDirectory() || undefined,
    }).catch(() => {});
  }

  /**
   * Load a single skill's content from either project or system skills directory
   */
  private async loadSkillContent(skillName: string, projectRoot: string): Promise<string | null> {
    // Try project-level skill first
    const projectSkillPath = join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir, skillName, 'SKILL.md');
    try {
      const content = await readFile(projectSkillPath, 'utf-8');
      return content;
    } catch { /* not found in project */ }

    // Try system-level skills directory
    const systemSkillPath = join(await getRuntimeSkillsDirPath(), skillName, 'SKILL.md');
    try {
      const content = await readFile(systemSkillPath, 'utf-8');
      return content;
    } catch { /* not found in system */ }

    return null;
  }

  /**
   * Load multiple step-level skills, merging duplicates and returning formatted content
   */
  private async loadStepSkills(skillNames: string[], projectRoot: string): Promise<string> {
    const uniqueSkills = [...new Set(skillNames)].filter(
      name => !this.workspaceSkillNames.has(name)
    );
    if (uniqueSkills.length === 0) return '';

    const loadedSkills: { name: string; content: string }[] = [];

    for (const skillName of uniqueSkills) {
      const content = await this.loadSkillContent(skillName, projectRoot);
      if (content) {
        loadedSkills.push({ name: skillName, content });
      }
    }

    if (loadedSkills.length === 0) return '';

    let result = `### 步骤指定 Skills\n\n`;
    result += `此步骤特别要求使用以下 Skills：\n\n`;

    for (const skill of loadedSkills) {
      result += `#### ${skill.name}\n\n`;
      result += skill.content + '\n\n---\n\n';
    }

    return result;
  }

  /**
   * Load workflow-level skills from context.skills
   */
  private async loadWorkflowSkills(skillNames: string[], projectRoot: string): Promise<string> {
    const uniqueSkills = [...new Set(skillNames)].filter(
      name => !this.workspaceSkillNames.has(name)
    );
    if (uniqueSkills.length === 0) return '';

    const loadedSkills: { name: string; content: string }[] = [];

    for (const skillName of uniqueSkills) {
      const content = await this.loadSkillContent(skillName, projectRoot);
      if (content) {
        loadedSkills.push({ name: skillName, content });
        // Also track for deduplication with step-level skills
        this.workspaceSkillNames.add(skillName);
      }
    }

    if (loadedSkills.length === 0) return '';

    let result = `### 工作流指定 Skills\n\n`;
    result += `本工作流要求使用以下 Skills（适用于所有步骤）：\n\n`;

    for (const skill of loadedSkills) {
      result += `#### ${skill.name}\n\n`;
      result += skill.content + '\n\n---\n\n';
    }

    return result;
  }

  /**
   * Copy needed skills from server skills/ to workspace <engine-config>/skills/
   */
  private async syncSkillsToWorkspace(config: any): Promise<void> {
    const projectRoot = config.context?.projectRoot;
    if (!projectRoot) return;

    const serverSkillsDir = await getRuntimeSkillsDirPath();
    const workspaceSkillsDir = join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir);
    if (!existsSync(serverSkillsDir)) return;

    const needed = new Set<string>();
    if (config.context?.skills) config.context.skills.forEach((s: string) => needed.add(s));
    for (const phase of config.workflow?.phases || []) {
      for (const step of phase.steps || []) {
        if (step.skills) step.skills.forEach((s: string) => needed.add(s));
      }
    }
    if (needed.size === 0) {
      // 没有指定 skills，symlink 整个 skills 目录（像 chat 一样）
      if (!existsSync(workspaceSkillsDir)) {
        try {
          createDirectoryLinkSync(serverSkillsDir, workspaceSkillsDir);
        } catch {
          try {
            await cp(serverSkillsDir, workspaceSkillsDir, { recursive: true, force: true });
            console.log(`[WF-Skills] 已复制整个 skills 目录 → ${workspaceSkillsDir}`);
          } catch (e2) {
            console.warn('[WF-Skills] 同步 skills 目录失败:', e2);
          }
        }
      }
      return;
    }

    const dirExistedBefore = existsSync(workspaceSkillsDir);
    await mkdir(workspaceSkillsDir, { recursive: true });

    const linkedNames: string[] = [];
    for (const skillName of needed) {
      const src = resolve(serverSkillsDir, skillName);
      const dst = resolve(workspaceSkillsDir, skillName);
      if (!existsSync(src)) continue;
      if (existsSync(dst)) continue; // already exists (symlink or real dir)
      try {
        createDirectoryLinkSync(src, dst);
        linkedNames.push(skillName);
        console.log(`[WF-Skills] 已链接 skill "${skillName}" → ${dst}`);
      } catch (e) {
        // Fallback to copy if symlink fails (e.g. cross-device)
        try {
          await cp(src, dst, { recursive: true, force: true });
          linkedNames.push(skillName);
          console.log(`[WF-Skills] 已复制 skill "${skillName}" → ${dst}`);
        } catch (e2) {
          console.warn(`[WF-Skills] 同步 skill "${skillName}" 失败:`, e2);
        }
      }
    }

    if (linkedNames.length > 0) {
      this.copiedSkills = { dir: workspaceSkillsDir, names: linkedNames, indexCopied: false, dirExistedBefore };
    }
  }

  private async cleanupWorkspaceSkills(): Promise<void> {
    if (!this.copiedSkills) return;
    const { dir, names, dirExistedBefore } = this.copiedSkills;

    for (const name of names) {
      try { await rm(resolve(dir, name), { recursive: true, force: true }); } catch { /* ignore */ }
    }
    if (!dirExistedBefore) {
      try {
        const remaining = await readdir(dir);
        if (remaining.length === 0) {
          await rm(dir, { recursive: true, force: true });
          const configDir = resolve(dir, '..');
          const configRemaining = await readdir(configDir);
          if (configRemaining.length === 0) await rm(configDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
    this.copiedSkills = null;
  }

  /**
   * Copy a directory with progress updates so frontend can show preparation details.
   */
  private async copyDirectoryWithProgress(
    srcDir: string,
    destDir: string,
    runId: string,
    reportStatus: (message: string, step: string) => Promise<void>
  ): Promise<void> {
    const files: Array<{ src: string; dst: string; size: number }> = [];
    const formatBytes = (bytes: number): string => {
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let v = bytes;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
      }
      return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
    };

    await reportStatus('准备中：扫描目录并计算总体积...', '复制工作目录（建立清单）');

    const stack = [{ src: srcDir, dst: destDir }];
    let scannedFiles = 0;
    let lastScanReport = 0;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      const entries = await readdir(cur.src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = join(cur.src, entry.name);
        const dstPath = join(cur.dst, entry.name);
        if (entry.isDirectory()) {
          stack.push({ src: srcPath, dst: dstPath });
          continue;
        }
        let size = 0;
        try { size = (await stat(srcPath)).size; } catch { /* keep zero */ }
        files.push({ src: srcPath, dst: dstPath, size });
        scannedFiles += 1;
        const now = Date.now();
        if (now - lastScanReport > 1000) {
          lastScanReport = now;
          this.currentPhase = '准备阶段';
          this.currentStep = `复制工作目录（建立清单：已扫描 ${scannedFiles} 文件）`;
          this.emit('status', {
            status: 'preparing',
            message: `准备中：建立清单，已扫描 ${scannedFiles} 文件`,
            runId,
            currentPhase: this.currentPhase,
            currentStep: this.currentStep,
            currentConfigFile: this.currentConfigFile,
          });
        }
      }
    }

    const totalFiles = files.length;
    const totalBytes = files.reduce((s, f) => s + f.size, 0);
    if (totalFiles === 0) {
      await reportStatus('准备中：工作目录为空，无需复制', '复制工作目录 (完成)');
      return;
    }

    let copiedFiles = 0;
    let copiedBytes = 0;
    const copyStartAt = Date.now();
    let displayedEtaSec: number | null = null;
    let speedEma = 0;
    const speedSamples: Array<{ t: number; bytes: number }> = [];

    const buildStepText = (etaSec: number | null): string => {
      const percent = Math.min(100, Math.round((copiedBytes / Math.max(totalBytes, 1)) * 100));
      const etaText = etaSec === null ? '计算中' : `${etaSec}s`;
      return `复制工作目录 (${formatBytes(copiedBytes)}/${formatBytes(totalBytes)}，${percent}%，文件 ${copiedFiles}/${totalFiles}，预计剩余${etaText})`;
    };

    const emitProgress = async (force = false) => {
      const now = Date.now();
      speedSamples.push({ t: now, bytes: copiedBytes });
      while (speedSamples.length > 1 && now - speedSamples[0].t > 20000) speedSamples.shift();

      let etaSec: number | null = null;
      if (speedSamples.length >= 2) {
        const first = speedSamples[0];
        const last = speedSamples[speedSamples.length - 1];
        const dt = Math.max(1, (last.t - first.t) / 1000);
        const instSpeed = Math.max(0, (last.bytes - first.bytes) / dt);
        if (instSpeed > 0) {
          speedEma = speedEma === 0 ? instSpeed : (speedEma * 0.75 + instSpeed * 0.25);
        }
      }
      if (speedEma > 0 && copiedBytes < totalBytes) {
        etaSec = Math.max(1, Math.ceil((totalBytes - copiedBytes) / speedEma));
        if (displayedEtaSec !== null) etaSec = Math.min(displayedEtaSec, etaSec);
        displayedEtaSec = etaSec;
      } else if (copiedBytes >= totalBytes) {
        etaSec = 0;
        displayedEtaSec = 0;
      }

      const stepText = buildStepText(etaSec);
      this.currentPhase = '准备阶段';
      this.currentStep = stepText;
      this.emit('status', {
        status: 'preparing',
        message: `准备中：${stepText}`,
        runId,
        currentPhase: this.currentPhase,
        currentStep: this.currentStep,
        currentConfigFile: this.currentConfigFile,
      });
      if (force) {
        await reportStatus(`准备中：${stepText}`, stepText);
      }
    };

    await emitProgress(true);

    const maxWorkers = Math.min(32, Math.max(8, cpus().length * 2));
    const workerCount = Math.min(maxWorkers, totalFiles);
    let cursor = 0;

    const worker = async () => {
      while (!this.shouldStop) {
        const idx = cursor++;
        if (idx >= totalFiles) break;
        const file = files[idx];
        await mkdir(dirname(file.dst), { recursive: true });
        await copyFile(file.src, file.dst);
        copiedFiles += 1;
        copiedBytes += file.size;
      }
    };

    const ticker = setInterval(() => {
      void emitProgress(false);
    }, 1000);

    try {
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
    } finally {
      clearInterval(ticker);
    }

    await emitProgress(true);
  }

  private async loadAgentConfigs(): Promise<RoleConfig[]> {
    const agentsDir = await getRuntimeAgentsDirPath();
    try {
      const files = await readdir(agentsDir);
      const yamlFiles = files.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
      const configs: RoleConfig[] = [];
      for (const file of yamlFiles) {
        try {
          const content = await readFile(resolve(agentsDir, file), 'utf-8');
          const agent = parse(content);
          if (agent?.name) configs.push(agent);
        } catch { /* skip malformed */ }
      }
      return ensureDefaultSupervisorConfig(configs);
    } catch {
      return ensureDefaultSupervisorConfig([]);
    }
  }

  /**
   * Discover skills from the workspace projectRoot (engine-aware config dir).
   * Reads each skill's SKILL.md and returns a formatted prompt section.
   * Also tracks skill names for deduplication with step-level skills.
   */
  private async discoverWorkspaceSkills(projectRoot: string): Promise<string> {
    const absRoot = this.resolveProjectRootPath(projectRoot);
    const skillsDir = join(absRoot, this.workspaceSkillsSubdir);
    try {
      const skillIndex = resolve(skillsDir, 'SKILL.md');
      const indexContent = await readFile(skillIndex, 'utf-8');

      // Also read each sub-skill's SKILL.md for detailed instructions
      const entries = await readdir(skillsDir);
      const details: string[] = [];
      this.workspaceSkillNames.clear();

      for (const entry of entries) {
        const entryPath = resolve(skillsDir, entry);
        const entryStat = await stat(entryPath).catch(() => null);
        if (!entryStat?.isDirectory()) continue;

        // Track skill name for deduplication
        this.workspaceSkillNames.add(entry);

        const subSkillMd = resolve(entryPath, 'SKILL.md');
        try {
          const content = await readFile(subSkillMd, 'utf-8');
          details.push(content);
        } catch { /* no SKILL.md in this dir */ }
      }

      let result = `## 可用 Skills（来自项目 skills/）\n\n`;
      result += `以下是项目工作区中预定义的 Skills，你可以直接按照说明使用：\n\n`;
      result += indexContent + '\n\n';
      if (details.length > 0) {
        result += `### 详细使用说明\n\n`;
        result += details.join('\n\n---\n\n') + '\n\n';
      }
      return result;
    } catch {
      // No skills directory or index — that's fine
      this.workspaceSkillNames.clear();
      return '';
    }
  }

  /**
   * Initialize the AI engine based on workflow config first, then global config.
   */
  private async initializeEngine(workflowEngine?: string): Promise<void> {
    try {
      const requestedEngine = workflowEngine?.trim();
try {
        this.engineType = requestedEngine
          ? await resolveRequestedEngineType(requestedEngine)
          : await getConfiguredEngine();
      } catch {
        const globalEngine = await getConfiguredEngine();
        console.warn(`[WorkflowManager] 工作流配置的引擎无效: ${requestedEngine}，回退到全局引擎 ${globalEngine}`);
        this.emit('log', `工作流配置的引擎无效: ${requestedEngine}，回退到全局引擎 ${globalEngine}`);
        this.engineType = globalEngine;
      }
      console.log(`[WorkflowManager] 使用引擎: ${this.engineType}`);
      this.emit('log', `使用引擎: ${this.engineType}`);

      // Always initialize currentEngine for the selected engine, including claude-code.
      this.currentEngine = await createEngine(this.engineType);
      if (!this.currentEngine) {
        throw new Error(`引擎 ${this.engineType} 不可用`);
      } else {
        console.log(`[WorkflowManager] 引擎 ${this.engineType} 初始化成功`);
        this.emit('log', `引擎 ${this.engineType} 初始化成功`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[WorkflowManager] 引擎初始化失败: ${message}`);
      this.emit('log', `引擎初始化失败: ${message}`);
      throw error;
    }
  }

  /**
   * Execute a task using the configured engine
   */
  private async executeWithEngine(
    processId: string,
    agent: string,
    step: string,
    prompt: string,
    systemPrompt: string,
    model: string,
    options: any
  ): Promise<EngineJsonResult> {
    if (!this.currentEngine) {
      throw new Error(`引擎未初始化 (engineType=${this.engineType})`);
    }

    // Use alternative engine (Kiro CLI, etc.)
    this.emit('log', `使用 ${this.engineType} 引擎执行任务: ${step}`);

    // Register process in processManager so it's visible to the frontend
    const proc = processManager.registerExternalProcess(processId, agent, step, options.runId);
    (proc as any)._cancelFn = () => {
      try {
        this.currentEngine?.cancel();
      } catch {
        // Best-effort cancellation; process state is still marked as killed.
      }
    };

    let fullStreamContent = '';

    // Set up stream handler for the engine
    const streamHandler = (event: EngineStreamEvent) => {
      fullStreamContent += event.content;
      const retainedPreview = processManager.appendStreamContent(processId, event.content) || event.content;
      processManager.emit('stream', {
        id: processId,
        step: step,
        delta: event.content,
        total: retainedPreview,
      });
    };

    this.currentEngine.on('stream', streamHandler);

    try {
      const result = await executeEngineWithContextRecovery(this.currentEngine, {
        agent,
        step,
        prompt,
        systemPrompt,
        model,
        workingDirectory: options.workingDirectory,
        allowedTools: options.allowedTools,
        timeoutMs: options.timeoutMs,
        sessionId: options.resumeSessionId,
        appendSystemPrompt: options.appendSystemPrompt,
        runId: options.runId,
        mcpServers: options.mcpServers,
      }, {
        onContextReset: (event) => {
          this.emit('log', {
            agent,
            level: 'warning',
            message: `上下文超限，已清空 ${this.engineType} 会话并重试: ${event.method}`,
          });
        },
      });

      // Mark process as completed
      const resolvedSessionId = resolveRecoveredSessionId(result, options.resumeSessionId);
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.status = result.success ? 'completed' : 'failed';
        rawProc.endTime = new Date();
        processManager.setProcessOutput(processId, result.output || fullStreamContent || rawProc.streamContent);
        rawProc.sessionId = resolvedSessionId || undefined;
        if (!result.success) processManager.setProcessError(processId, result.error || '');
      }

      const metadata = result.metadata;
      const usage = normalizeEngineUsage(metadata);

      // Convert engine result to EngineJsonResult format
      return {
        result: result.success ? result.output : (result.error || result.output),
        session_id: resolvedSessionId || '',
        is_error: !result.success,
        cost_usd: metadataNumber(metadata, 'cost_usd', 'costUsd'),
        duration_ms: metadataNumber(metadata, 'duration_ms', 'durationMs'),
        duration_api_ms: metadataNumber(metadata, 'duration_api_ms', 'durationApiMs'),
        num_turns: metadataNumber(metadata, 'num_turns', 'numTurns'),
        usage,
      };
    } finally {
      this.currentEngine.off('stream', streamHandler);
    }
  }

  private getActiveProcessPids(): PersistedProcessInfo[] {
    return processManager.getAllProcesses()
      .filter(p => p.status === 'running')
      .map(p => ({
        pid: p.pid || 0,
        id: p.id,
        agent: p.agent,
        step: p.step,
        startTime: p.startTime.toISOString(),
      }));
  }

  private async persistState(): Promise<void> {
    if (!this.currentRunId) return;
    try {
      const attachedAgentSessions = Object.fromEntries(
        this.agents
          .filter((agent) => Boolean(agent.sessionId))
          .map((agent) => [agent.name, agent.sessionId as string])
      );
      const state: PersistedRunState = {
        runId: this.currentRunId,
        configFile: this.currentConfigFile || '',
        runOwnerId: this._createdBy,
        runOwnerName: this._createdByName,
        createdBy: this._createdBy,
        createdByName: this._createdByName,
        status: (this.status === 'idle' ? (this.shouldStop ? 'stopped' : 'completed') : this.status) as PersistedRunState['status'],
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: this.runEndTime || null,
        currentPhase: this.currentPhase,
        currentStep: this.currentStep,
        completedSteps: [...this.completedStepNames],
        failedSteps: [...this.failedStepNames],
        stepLogs: [...this.stepLogs],
        qualityChecks: [...this.qualityChecks],
        agents: this.agents.map(a => ({
          name: a.name,
          team: a.team,
          model: a.model,
          status: a.status,
          completedTasks: a.completedTasks,
          tokenUsage: { ...a.tokenUsage },
          costUsd: a.costUsd,
          sessionId: a.sessionId,
          iterationCount: a.iterationCount,
          summary: a.summary,
        })),
        iterationStates: Object.fromEntries(this.iterationStates),
        processes: this.getActiveProcessPids(),
        pendingCheckpoint: this.pendingCheckpoint || undefined,
        globalContext: this.globalContext || undefined,
        phaseContexts: this.phaseContexts.size > 0 ? Object.fromEntries(this.phaseContexts) : undefined,
        workingDirectory: this.getWorkingDirectory() || undefined,
        workspaceGit: this.workflowGit || undefined,
        attachedAgentSessions,
        workflowFrontendSessionId: this._frontendSessionId || null,
      };
      await saveRunState(state);
      if (this._frontendSessionId) {
        await updateChatSessionWorkflowBinding(this._frontendSessionId, {
          configFile: this.currentConfigFile || '',
          runId: this.currentRunId,
          attachedAgentSessions,
        });
        await updateChatSessionCreationBinding(this._frontendSessionId, {
          filename: this.currentConfigFile || '',
          status: 'run-bound',
        });
      }
    } catch { /* non-critical */ }
  }

  private async ensureWorkflowGitBaseline(workspacePath?: string | null): Promise<void> {
    if (!this.currentRunId || !workspacePath) return;
    try {
      this.workflowGit = await ensureWorkflowGitState({
        workspacePath,
        runId: this.currentRunId,
        existing: this.workflowGit || undefined,
      });
      await this.persistState();
      this.emit('log', {
        agent: 'system',
        level: 'info',
        message: `Git 基线已建立: ${this.workflowGit.baselineCommit?.slice(0, 12) || this.workflowGit.baselineRef || 'baseline'}`,
      });
    } catch (error: any) {
      this.workflowGit = {
        enabled: false,
        runId: this.currentRunId,
        workspacePath,
        repoRoot: workspacePath,
        wasGitRepository: false,
        initializedRepository: false,
        snapshots: [],
        stepDiffs: [],
        error: error?.message || String(error),
        updatedAt: new Date().toISOString(),
      };
      await this.persistState();
      this.emit('log', {
        agent: 'system',
        level: 'warning',
        message: `Git 基线建立失败: ${this.workflowGit.error}`,
      });
    }
  }

  private async disableWorkflowGitBaseline(workspacePath?: string | null): Promise<void> {
    if (!this.currentRunId || !workspacePath) return;
    this.workflowGit = {
      enabled: false,
      runId: this.currentRunId,
      workspacePath,
      repoRoot: workspacePath,
      wasGitRepository: false,
      initializedRepository: false,
      snapshots: [],
      stepDiffs: [],
      error: 'Git 基线已在工作流配置中关闭',
      updatedAt: new Date().toISOString(),
    };
    await this.persistState();
  }

  private async recordStepGitBefore(input: {
    stepLogId: string;
    stepName: string;
    phaseName?: string;
    agent: string;
  }): Promise<string | undefined> {
    if (!this.workflowGit?.enabled) return undefined;
    try {
      const recorded = await recordWorkflowGitSnapshot({
        state: this.workflowGit,
        kind: 'step-before',
        label: `步骤开始前: ${input.stepName}`,
        stepName: input.stepName,
        phaseName: input.phaseName,
        agent: input.agent,
      });
      this.workflowGit = upsertWorkflowGitStepDiff(recorded.state, {
        id: `git-step-${input.stepLogId}`,
        stepLogId: input.stepLogId,
        stepName: input.stepName,
        phaseName: input.phaseName,
        agent: input.agent,
        status: 'running',
        beforeSnapshotId: recorded.snapshot.id,
        startedAt: new Date().toISOString(),
      });
      await this.persistState();
      return recorded.snapshot.id;
    } catch (error: any) {
      this.workflowGit = { ...this.workflowGit, error: error?.message || String(error), updatedAt: new Date().toISOString() };
      await this.persistState();
      return undefined;
    }
  }

  private async recordStepGitAfter(input: {
    stepLogId: string;
    stepName: string;
    phaseName?: string;
    agent: string;
    status: 'completed' | 'failed';
    beforeSnapshotId?: string;
  }): Promise<string | undefined> {
    if (!this.workflowGit?.enabled) return undefined;
    try {
      const recorded = await recordWorkflowGitSnapshot({
        state: this.workflowGit,
        kind: 'step-after',
        label: `步骤结束后: ${input.stepName}`,
        stepName: input.stepName,
        phaseName: input.phaseName,
        agent: input.agent,
      });
      const existing = this.workflowGit.stepDiffs.find((item) => item.id === `git-step-${input.stepLogId}`);
      this.workflowGit = upsertWorkflowGitStepDiff(recorded.state, {
        id: `git-step-${input.stepLogId}`,
        stepLogId: input.stepLogId,
        stepName: input.stepName,
        phaseName: input.phaseName,
        agent: input.agent,
        status: input.status,
        beforeSnapshotId: existing?.beforeSnapshotId || input.beforeSnapshotId || recorded.snapshot.id,
        afterSnapshotId: recorded.snapshot.id,
        startedAt: existing?.startedAt || new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      await this.persistState();
      return recorded.snapshot.id;
    } catch (error: any) {
      this.workflowGit = { ...this.workflowGit, error: error?.message || String(error), updatedAt: new Date().toISOString() };
      await this.persistState();
      return undefined;
    }
  }

  private async recordFinalGitSnapshot(status: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.workflowGit?.enabled) return;
    try {
      const recorded = await recordWorkflowGitSnapshot({
        state: this.workflowGit,
        kind: 'run-final',
        label: `工作流结束: ${status}`,
        phaseName: this.currentPhase || undefined,
      });
      this.workflowGit = recorded.state;
      await this.persistState();
    } catch (error: any) {
      this.workflowGit = { ...this.workflowGit, error: error?.message || String(error), updatedAt: new Date().toISOString() };
      await this.persistState();
    }
  }

  async recoverFromCrash(): Promise<void> {
    try {
      const runningRuns = await findRunningRuns();
      for (const runState of runningRuns) {
        const anyAlive = runState.processes.some(p => isProcessAlive(p.pid));
        if (!anyAlive) {
          runState.status = 'crashed';
          runState.statusReason = `服务重启时检测到运行中断。进程已不存在 (PIDs: ${runState.processes.map(p => p.pid).join(', ') || '无'})。当前阶段: ${runState.currentPhase || '未知'}，当前步骤: ${runState.currentStep || '未知'}，已完成 ${runState.completedSteps?.length || 0} 步。`;
          runState.endTime = new Date().toISOString();
          // Fix agent states: mark any "running" agents as "failed"
          for (const agent of (runState.agents || [])) {
            if (agent.status === 'running') {
              agent.status = 'failed';
            }
          }
          // Mark the interrupted step as failed
          if (runState.currentStep && !runState.completedSteps?.includes(runState.currentStep) && !runState.failedSteps?.includes(runState.currentStep)) {
            runState.failedSteps = [...(runState.failedSteps || []), runState.currentStep];
          }
          // Clear stale process list
          runState.processes = [];
          await saveRunState(runState);
        }
      }
    } catch { /* non-critical on startup */ }
  }

  async start(
    configFile: string,
    requirementsOrChecks?: string | PersistedQualityCheck[],
    maybePreflightChecks?: PersistedQualityCheck[],
    initialContexts?: { globalContext?: string; phaseContexts?: Record<string, string> },
    requestedRunId?: string,
  ): Promise<void> {
    if (this.status === 'running' || this.status === 'preparing') {
      throw new Error('已有工作流正在运行');
    }

    const preflightChecks = Array.isArray(requirementsOrChecks)
      ? requirementsOrChecks
      : (maybePreflightChecks || []);
    this.status = 'preparing';
    this.statusReason = null;
    this.logs = [];
    this.agents = [];
    this.shouldStop = false;
    this.iterationStates.clear();
    this.currentConfigFile = configFile;
    this.completedStepNames = [];
    this.failedStepNames = [];
    this.stepLogs = [];
    this.qualityChecks = [...preflightChecks];
    this.runStartTime = new Date().toISOString();
    this.runEndTime = null;
    this.currentRunId = null;
    this.agentSessionIds.clear();
    this.liveFeedback = [];
    this.globalContext = initialContexts?.globalContext || '';
    this.workspaceSkills = '';
    this.workflowMcpServers = [];
    this.phaseContexts = new Map(Object.entries(initialContexts?.phaseContexts || {}));
    this.isolatedDir = null;
    this.currentProjectRoot = null;
    this.workflowGit = null;

    // Reset process manager counters in case previous run left stale state
    processManager.reset();

    try {
      const configPath = await getRuntimeWorkflowConfigPath(configFile);
      const content = await readFile(configPath, 'utf-8');
      const workflowConfig: WorkflowConfig = parse(content);

      this.currentWorkflow = workflowConfig;
      // Resolve projectRoot to absolute path relative to user's personal dir
      this.currentProjectRoot = workflowConfig.context.projectRoot
        ? this.resolveProjectRootPath(workflowConfig.context.projectRoot)
        : null;

      // === Create run FIRST so frontend can see it immediately ===
      const totalSteps = workflowConfig.workflow.phases.reduce(
        (sum, p) => sum + p.steps.length, 0
      );
      const runId = requestedRunId || `run-${formatTimestamp()}`;
      this.currentRunId = runId;

      try {
        await createRun({
          id: runId, configFile, configName: configFile, startTime: this.runStartTime,
          endTime: null, status: 'preparing', currentPhase: null,
          totalSteps, completedSteps: 0,
        });
      } catch { /* non-critical */ }

      this.emit('status', {
        status: 'preparing',
        message: '准备中...',
        runId,
        currentPhase: '准备阶段',
        currentStep: '初始化运行上下文',
        currentConfigFile: this.currentConfigFile,
        workflowFrontendSessionId: this._frontendSessionId || null,
      });
      this.currentPhase = '准备阶段';
      this.currentStep = '初始化运行上下文';
      await this.persistState();

      const reportPreparingProgress = async (message: string, step: string) => {
        this.currentPhase = '准备阶段';
        this.currentStep = step;
        this.emit('status', {
          status: 'preparing',
          message,
          runId,
          currentPhase: this.currentPhase,
          currentStep: this.currentStep,
          currentConfigFile: this.currentConfigFile,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.persistState();
      };

      const workspaceMode = workflowConfig.context.workspaceMode || 'isolated-copy';

      // === Preparing phase: directory isolation (cp for independence) ===
      if (workspaceMode === 'isolated-copy' && this._userPersonalDir && workflowConfig.context.projectRoot) {
        await reportPreparingProgress('准备中：复制工作目录...', '复制工作目录');
        if (this.shouldStop) return;
        const srcDir = this.resolveProjectRootPath(workflowConfig.context.projectRoot);
        if (!existsSync(srcDir)) {
          this.emit('log', { message: `项目目录不存在: ${srcDir}，跳过目录隔离` });
        } else {
          const isolatedDir = resolve(this._userPersonalDir, runId);
          try {
            await mkdir(isolatedDir, { recursive: true });
            // Persist target working directory early so cleanup can find it
            this.isolatedDir = isolatedDir;
            this.currentProjectRoot = isolatedDir;
            await this.persistState();
            await this.copyDirectoryWithProgress(srcDir, isolatedDir, runId, reportPreparingProgress);
            if (this.shouldStop) {
              // Stopped during copy — clean up incomplete dir
              await rm(isolatedDir, { recursive: true, force: true }).catch(() => {});
              return;
            }
            workflowConfig.context.projectRoot = isolatedDir;
          } catch (e: any) {
            if (this.shouldStop) return;
            this.isolatedDir = null;
            this.emit('log', { message: `目录隔离复制失败: ${e.message}，使用原目录` });
          }
        }
      }

      if (this.shouldStop) return;

      const workflowGitWorkspacePath = this.getWorkingDirectory() || workflowConfig.context.projectRoot;
      if (workflowGitWorkspacePath && workflowConfig.context.gitBaselineEnabled !== false) {
        await reportPreparingProgress('准备中：建立 Git 基线...', '建立 Git 基线');
        await this.ensureWorkflowGitBaseline(workflowGitWorkspacePath);
      } else if (workflowGitWorkspacePath) {
        await this.disableWorkflowGitBaseline(workflowGitWorkspacePath);
      }

      // === Preparing phase: load agents, init engine, sync skills ===
      await reportPreparingProgress('准备中：加载 Agent 配置...', '加载 Agent 配置');
      this.agentConfigs = await this.loadAgentConfigs();
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：初始化执行引擎...', '初始化执行引擎');
        await this.initializeEngine(resolveWorkflowExecutionPolicy(workflowConfig.context).defaultEngine || workflowConfig.context?.engine);
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：加载 MCP 配置...', '加载 MCP 配置');
      await this.resolveWorkflowMcpServers(workflowConfig);

      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：同步 Skills...', '同步 Skills');
      await this.syncSkillsToWorkspace(workflowConfig);

      if (workflowConfig.context.projectRoot) {
        this.workspaceSkills = await this.discoverWorkspaceSkills(workflowConfig.context.projectRoot);

        if (workflowConfig.context.skills && workflowConfig.context.skills.length > 0) {
          this.workflowSkillsContent = await this.loadWorkflowSkills(
            workflowConfig.context.skills,
            workflowConfig.context.projectRoot
          );
        }
      }

      this.workflowSkillsContent = '';
      if (workflowConfig.context.skills && workflowConfig.context.skills.length > 0) {
        this.workflowSkillsContent = await this.loadWorkflowSkills(
          workflowConfig.context.skills,
          workflowConfig.context.projectRoot || ''
        );
      }

      await reportPreparingProgress('准备中：构建执行上下文...', '构建执行上下文');
      this.initializeAgents(workflowConfig);

      // === Switch to running ===
      this.status = 'running';
      this.currentStep = null;
      this.emit('status', {
        status: 'running',
        message: '工作流已启动',
        runId,
        workingDirectory: this.getWorkingDirectory(),
        workflowFrontendSessionId: this._frontendSessionId || null,
      });
      await this.persistState();

      await this.executeWorkflow(workflowConfig);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          runId,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', {
          status: 'failed',
          message: error.message,
          runId: this.currentRunId,
          workflowFrontendSessionId: this._frontendSessionId || null,
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  private async finalizeRun(status: 'completed' | 'failed' | 'stopped') {
    if (!this.currentRunId) return;
    this.runEndTime = new Date().toISOString();

    // Cleanup copied skills and engine processes from workspace/run execution
    this.cleanupCurrentEngine();
    await this.cleanupWorkspaceSkills();
    await this.recordFinalGitSnapshot(status);

    const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
    try {
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        currentPhase: this.currentPhase,
        completedSteps,
      });
    } catch { /* non-critical */ }
    await this.persistState();
    if (this._frontendSessionId) {
      await this.appendWorkflowTranscriptEvent({
        type: status === 'completed' ? 'run-completed' : status === 'failed' ? 'run-failed' : 'run-stopped',
        title: status === 'completed' ? '工作流执行完成' : status === 'failed' ? '工作流执行失败' : '工作流已停止',
        body: status === 'completed'
          ? `完成步骤：${completedSteps}`
          : this.statusReason || '',
        speakerName: this.getWorkflowSupervisorAgentName() || this.agents[0]?.name || '工作流协作',
        dedupeKey: `workflow-run-${status}-${this.currentRunId}`,
      });
    }
    this.status = 'idle';
  }

  private cleanupCurrentEngine(): void {
    const engine = this.currentEngine;
    if (!engine) return;
    try {
      engine.cancel();
    } catch {
      // best-effort cleanup
    }
    try {
      (engine as any).cleanup?.();
    } catch {
      // best-effort cleanup
    }
    this.currentEngine = null;
  }

  initializeAgents(workflowConfig: WorkflowConfig): void {
    const agentSet = new Set<string>();
    for (const phase of workflowConfig.workflow.phases) {
      for (const step of phase.steps) {
        agentSet.add(step.agent);
      }
    }

    this.agents = Array.from(agentSet).map((agentName) => {
      const roleConfig = this.agentConfigs.find((r) => r.name === agentName)
        || workflowConfig.roles?.find((r) => r.name === agentName);
      return {
        name: agentName,
        team: roleConfig?.team || 'red',
        model: resolveAgentModel(roleConfig, workflowConfig.context),
        status: 'waiting',
        currentTask: null,
        completedTasks: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        sessionId: null,
        iterationCount: 0,
        lastOutput: '',
        summary: '',
        changes: [],
      };
    });

    this.emit('agents', { agents: this.agents });
  }

  updateAgentStatus(
    agentName: string,
    status: AgentState['status'],
    task: string | null = null
  ): void {
    const agent = this.agents.find((a) => a.name === agentName);
    if (agent) {
      agent.status = status;
      agent.currentTask = task;
      if (status === 'completed') {
        agent.completedTasks++;
      }
      this.emit('agents', { agents: this.agents });
    }
  }

  updateAgentTokenUsage(agentName: string, usage: TokenUsage): void {
    const agent = this.agents.find((a) => a.name === agentName);
    if (agent) {
      agent.tokenUsage.inputTokens += usage.inputTokens;
      agent.tokenUsage.outputTokens += usage.outputTokens;
      agent.tokenUsage.cacheCreationInputTokens = (agent.tokenUsage.cacheCreationInputTokens || 0) + (usage.cacheCreationInputTokens || 0);
      agent.tokenUsage.cacheReadInputTokens = (agent.tokenUsage.cacheReadInputTokens || 0) + (usage.cacheReadInputTokens || 0);
      this.emit('token-usage', {
        agent: agentName,
        usage: agent.tokenUsage,
        delta: usage,
      });
    }
  }

  parseBugCount(output: string): number {
    const bugMatch = output.match(/(?:bugs?|issues?|problems?|defects?)\s*(?:found|discovered|detected)[:\s]*(\d+)/i);
    if (bugMatch) return parseInt(bugMatch[1], 10);
    const countMatch = output.match(/(\d+)\s*(?:bugs?|issues?|problems?|defects?)/i);
    if (countMatch) return parseInt(countMatch[1], 10);
    const hasBugs = /(?:found|discovered|detected)\s+(?:a\s+)?(?:bug|issue|problem|defect|vulnerability)/i.test(output);
    return hasBugs ? 1 : 0;
  }

  /**
   * Parse structured JSON verdict from attacker/judge output.
   * Expects a structured JSON object in bare or legacy fenced form:
   *   { "verdict": "pass"|"conditional_pass"|"fail", "remaining_issues": N, "summary": "..." }
   * Falls back to parseBugCount if no JSON found.
   */
  parseStepVerdict(output: string): { verdict: 'pass' | 'conditional_pass' | 'fail'; remainingIssues: number; summary: string } {
    const parsed = extractStructuredJsonObject(output);
    if (parsed) {
      return {
        verdict: ['pass', 'conditional_pass', 'fail'].includes(parsed.verdict) ? parsed.verdict : 'fail',
        remainingIssues: typeof parsed.remaining_issues === 'number' ? parsed.remaining_issues : 0,
        summary: parsed.summary || '',
      };
    }
    // Fallback: no structured JSON found — be conservative, require human review
    const bugCount = this.parseBugCount(output);
    return {
      verdict: bugCount > 0 ? 'fail' : 'conditional_pass',
      remainingIssues: bugCount,
      summary: '',
    };
  }

  parseChanges(output: string): ChangeRecord[] {
    const changes: ChangeRecord[] = [];
    const filePatterns = output.matchAll(/(?:created|modified|deleted|updated|changed)\s+(?:file\s+)?[`"']?([^\s`"']+\.\w+)[`"']?/gi);
    for (const match of filePatterns) {
      const action = match[0].toLowerCase().startsWith('created') ? 'created'
        : match[0].toLowerCase().startsWith('deleted') ? 'deleted' : 'modified';
      changes.push({ file: match[1], action, description: match[0] });
    }
    return changes;
  }

  parseSummary(output: string): string {
    const summaryMatch = output.match(/(?:summary|总结|结论)[:\s]*\n?([\s\S]{10,300}?)(?:\n\n|$)/i);
    return summaryMatch ? summaryMatch[1].trim() : output.substring(0, 200).trim();
  }

  private sanitizeOutputName(name: string): string {
    return String(name || '').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  }

  private deriveStepDisplayOutput(rawOutput: string): string {
    const parsed = extractStructuredJsonObject(rawOutput);
    if (parsed && typeof parsed.summary === 'string' && parsed.summary.trim()) {
      return parsed.summary.trim();
    }

    const compact = compactStepConclusion(rawOutput).trim();
    if (compact && compact !== '{}' && compact !== '[]') {
      return compact;
    }

    const fallback = this.parseSummary(rawOutput).trim();
    if (fallback && fallback !== '{}' && fallback !== '[]') {
      return fallback;
    }

    return '';
  }

  private selectPreferredAgentOutput(rawOutput: string, streamOutput?: string | null): string {
    const normalizedRaw = stripNonAiStreamArtifacts(rawOutput || '');
    const normalizedStream = stripNonAiStreamArtifacts(streamOutput || '');

    if (!normalizedStream) {
      return rawOutput;
    }
    if (!normalizedRaw) {
      return normalizedStream;
    }

    const rawDisplay = this.deriveStepDisplayOutput(normalizedRaw);
    if (!rawDisplay) {
      return normalizedStream;
    }

    if (normalizedRaw === '{}' || normalizedRaw === '[]') {
      return normalizedStream;
    }

    const parsed = extractStructuredJsonObject(normalizedRaw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 0) {
      return normalizedStream;
    }

    return rawOutput;
  }

  private buildTimestampedDetailFileName(phaseName: string | null, stepName: string): string {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safePhase = this.sanitizeOutputName(phaseName || '当前阶段');
    const safeStep = this.sanitizeOutputName(stepName);
    return `${ts}-${safePhase}-${safeStep}.md`;
  }

  private async persistPhaseStepArtifacts(stepName: string, rawOutput: string, displayOutput?: string): Promise<void> {
    if (!this.currentRunId) return;

    const summaryContent = (displayOutput || '').trim() || rawOutput;
    await saveProcessOutput(this.currentRunId, stepName, summaryContent).catch(() => {});

    const outputsDir = join(getWorkspaceRunsDir(), this.currentRunId, 'outputs');
    const detailFileName = this.buildTimestampedDetailFileName(this.currentPhase, stepName);
    const detailFilePath = resolve(outputsDir, detailFileName);
    if (!existsSync(detailFilePath)) {
      await mkdir(outputsDir, { recursive: true }).catch(() => {});
      await writeFile(detailFilePath, rawOutput || summaryContent, 'utf-8').catch(() => {});
    }
  }

  async executeWorkflow(workflowConfig: WorkflowConfig): Promise<void> {
    for (const phase of workflowConfig.workflow.phases) {
      if (this.shouldStop) break;

      this.currentPhase = phase.name;
      this.emit('phase', {
        phase: phase.name,
        message: `进入阶段: ${phase.name}`,
        totalSteps: phase.steps.length,
        iteration: phase.iteration,
      });
      await this.persistState();
      const phaseLead = phase.steps[0]?.agent || this.agents[0]?.name || 'Supervisor';
      const phaseCloser = [...phase.steps].reverse().find((step) => step.agent)?.agent || phaseLead;
      if (this._frontendSessionId) {
        await this.appendWorkflowTranscriptEvent({
          type: 'phase-start',
          title: `阶段开始：${phase.name}`,
          body: `${phase.steps.length} 个步骤待处理。`,
          speakerName: phaseLead,
          dedupeKey: `workflow-phase-start-${this.currentRunId || this.currentConfigFile}-${phase.name}`,
        });
      }

      try {
        if (phase.iteration?.enabled) {
          await this.executeIterativePhase(phase, workflowConfig);
        } else {
          await this.executeLinearPhase(phase, workflowConfig);
        }

        // Checkpoint with iterate support — loop allows re-running iterative phase
        while (phase.checkpoint && !this.shouldStop) {
          this.pendingCheckpoint = {
            phase: phase.name,
            checkpoint: phase.checkpoint.name,
            message: phase.checkpoint.message,
            isIterativePhase: !!phase.iteration?.enabled,
          };
          this.emit('checkpoint', {
            ...this.pendingCheckpoint,
            requiresApproval: true,
          });
          await this.persistState();
          const action = await this.waitForApproval();
          if (this._frontendSessionId) {
            await this.appendWorkflowTranscriptEvent({
              type: 'human-answer',
              title: action === 'iterate' ? `请求继续迭代：${phase.name}` : `批准进入下一阶段：${phase.name}`,
              body: action === 'iterate'
                ? (this.iterationFeedback || '请再推进一轮迭代。')
                : '确认当前阶段结果，可以继续后续环节。',
              speakerName: '你',
              speakerType: 'human',
              dedupeKey: `workflow-phase-approval-${this.currentRunId || this.currentConfigFile}-${phase.name}-${Date.now()}`,
            });
          }
          this.pendingCheckpoint = null;
          if (action === 'iterate' && phase.iteration?.enabled) {
            // Re-run the iterative phase for another round
            await this.executeIterativePhase(phase, workflowConfig);
            // Check if iteration is still running (not completed/escalated)
            const iterState = this.iterationStates.get(phase.name);
            if (iterState && (iterState.status === 'completed' || iterState.status === 'escalated')) {
              // Iteration finished, show checkpoint one more time for final decision
              continue;
            }
            // Iteration still running, break out to avoid double checkpoint
            break;
          }
          // action === 'approve' → proceed to next phase
          break;
        }

        if (!this.shouldStop && this._frontendSessionId) {
          await this.appendWorkflowTranscriptEvent({
            type: 'phase-complete',
            title: `阶段完成：${phase.name}`,
            body: `${phase.steps.length} 个步骤已处理。`,
            speakerName: phaseCloser,
            dedupeKey: `workflow-phase-complete-${this.currentRunId || this.currentConfigFile}-${phase.name}`,
          });
        }
      } catch (error: any) {
        if (this._frontendSessionId) {
          await this.appendWorkflowTranscriptEvent({
            type: 'phase-failed',
            title: `阶段失败：${phase.name}`,
            body: error?.message || String(error),
            speakerName: phaseCloser,
            dedupeKey: `workflow-phase-failed-${this.currentRunId || this.currentConfigFile}-${phase.name}`,
          });
        }
        throw error;
      }
    }
  }

  async executeLinearPhase(phase: WorkflowPhase, workflowConfig: WorkflowConfig): Promise<void> {
    // Group steps into sequential and parallel segments
    const segments = this.groupStepsIntoSegments(phase.steps);
    for (const segment of segments) {
      if (this.shouldStop) break;
      if (segment.parallel) {
        // Run all steps in the parallel group concurrently
        const results = await Promise.allSettled(
          segment.steps.map((step, i) => this.runStep(step, phase, workflowConfig, segment.startIndex + i))
        );
        const failed = results.find((r) => r.status === 'rejected');
        if (failed) {
          throw new Error((failed as PromiseRejectedResult).reason?.message || '并行步骤执行失败');
        }
        // Check if any step in the group failed
        for (const step of segment.steps) {
          if (this.failedStepNames.includes(step.name)) {
            throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
          }
        }
      } else {
        // Sequential step
        const step = segment.steps[0];
        await this.runStep(step, phase, workflowConfig, segment.startIndex);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
        }
      }
    }
  }

  private groupStepsIntoSegments(steps: any[]): Array<{ parallel: boolean; steps: any[]; startIndex: number }> {
    const segments: Array<{ parallel: boolean; steps: any[]; startIndex: number }> = [];
    let i = 0;
    while (i < steps.length) {
      const step = steps[i];
      if (step.parallelGroup) {
        const groupId = step.parallelGroup;
        const groupSteps: any[] = [];
        const startIndex = i;
        while (i < steps.length && steps[i].parallelGroup === groupId) {
          groupSteps.push(steps[i]);
          i++;
        }
        segments.push({ parallel: true, steps: groupSteps, startIndex });
      } else {
        segments.push({ parallel: false, steps: [step], startIndex: i });
        i++;
      }
    }
    return segments;
  }

  async executeIterativePhase(phase: WorkflowPhase, workflowConfig: WorkflowConfig, skipCompletedSteps?: Set<string>): Promise<void> {
    const iterConfig = phase.iteration!;
    const defenderSteps = phase.steps.filter((s) => s.role === 'defender');
    const attackerSteps = phase.steps.filter((s) => s.role === 'attacker');
    const judgeSteps = phase.steps.filter((s) => s.role === 'judge');
    // Local mutable copy — cleared after first iteration pass so subsequent iterations run all steps
    let skipSet = skipCompletedSteps;

    // Restore or create iteration state
    let iterState = this.iterationStates.get(phase.name);
    // Detect if this is a subsequent iteration call (from checkpoint "iterate" action)
    // In that case, skipCompletedSteps is undefined and iterState already has currentIteration >= 1
    const isSubsequentIteration = !skipCompletedSteps && iterState && iterState.currentIteration >= 1;

    if (!iterState) {
      iterState = {
        phaseName: phase.name,
        currentIteration: 0,
        maxIterations: iterConfig.maxIterations,
        consecutiveCleanRounds: 0,
        status: 'running',
        bugsFoundPerRound: [],
      };
      this.iterationStates.set(phase.name, iterState);
    } else if (isSubsequentIteration) {
      // Coming from checkpoint "iterate" — keep all history, just resume
      iterState.status = 'running';
    } else if (iterState.status === 'completed') {
      // Fresh start (no prior iterations)
      iterState = {
        phaseName: phase.name,
        currentIteration: 0,
        maxIterations: iterConfig.maxIterations,
        consecutiveCleanRounds: 0,
        status: 'running',
        bugsFoundPerRound: [],
      };
      this.iterationStates.set(phase.name, iterState);
    }

    // Helper: create step copy with iteration suffix for iter >= 2
    const iterStep = (step: WorkflowStep, iter: number): WorkflowStep =>
      iter >= 2 ? { ...step, name: `${step.name}-迭代${iter}` } : step;

    console.log(`[iterPhase] "${phase.name}" iterState:`, JSON.stringify(iterState));
    console.log(`[iterPhase] skipSet:`, skipSet ? [...skipSet] : 'none');
    console.log(`[iterPhase] isSubsequentIteration:`, isSubsequentIteration);
    console.log(`[iterPhase] defenders=[${defenderSteps.map(s=>s.name).join(', ')}] attackers=[${attackerSteps.map(s=>s.name).join(', ')}] judges=[${judgeSteps.map(s=>s.name).join(', ')}]`);

    let startIter: number;

    // Determine starting iteration - always check if current iteration is complete
    if (iterState.currentIteration >= 1) {
      // Check if all steps of the current iteration are in completedSteps
      const curIter = iterState.currentIteration;
      const iterStepNames = phase.steps.map(s => curIter >= 2 ? `${s.name}-迭代${curIter}` : s.name);
      const allCompleted = iterStepNames.every(n => this.completedStepNames.includes(n));
      if (isSubsequentIteration) {
        // Called from checkpoint "iterate" — start next iteration if current is complete
        startIter = allCompleted ? curIter + 1 : curIter;
        console.log(`[iterPhase] Subsequent iteration: currentIter=${curIter}, allCompleted=${allCompleted}, starting at iter=${startIter}`);
      } else {
        // Resume from where we left off
        startIter = allCompleted ? curIter + 1 : curIter;
        console.log(`[iterPhase] Resume: currentIter=${curIter}, allCompleted=${allCompleted}, starting at iter=${startIter}`);
      }
    } else {
      startIter = 1;
      console.log(`[iterPhase] Fresh start: starting at iter=1`);
    }

    // Main iteration loop — execute steps in workflow.yaml order
    for (let iter = startIter; iter <= iterConfig.maxIterations; iter++) {
      if (this.shouldStop) break;

      iterState.currentIteration = iter;
      this.emit('iteration', {
        phase: phase.name,
        iteration: iter,
        maxIterations: iterConfig.maxIterations,
        consecutiveClean: iterState.consecutiveCleanRounds,
      });
      await this.persistState();

      // Execute all steps in the order defined in workflow.yaml
      let totalBugs = 0;
      let judgeVerdict: { verdict: 'pass' | 'conditional_pass' | 'fail'; remainingIssues: number; summary: string } | null = null;

      for (const step of phase.steps) {
        if (this.shouldStop) return;
        const namedStep = iterStep(step, iter);
        if (skipSet?.has(namedStep.name)) {
          this.emit('step', { step: namedStep.name, agent: namedStep.agent, message: `跳过已完成: ${namedStep.name}`, skipped: true });
          continue;
        }
        const output = await this.runStep(namedStep, phase, workflowConfig, 0);
        if (!this.lastStepSucceeded()) {
          throw new Error(`步骤 "${namedStep.name}" 执行失败，迭代阶段中止`);
        }
        if (step.role === 'attacker') {
          const verdict = this.parseStepVerdict(output);
          totalBugs += verdict.remainingIssues;
        } else if (step.role === 'judge') {
          judgeVerdict = this.parseStepVerdict(output);
        }
      }

      // Clear skip set after first iteration pass — subsequent iterations run all steps
      skipSet = undefined;

      // If all steps in this iteration were skipped (resume scenario), skip verdict/exit logic
      // to avoid double-counting bugs and incorrectly triggering exit conditions
      const allStepsSkipped = judgeVerdict === null && totalBugs === 0 &&
        phase.steps.every(s => {
          const name = iter >= 2 ? `${s.name}-迭代${iter}` : s.name;
          return this.completedStepNames.includes(name);
        });

      if (allStepsSkipped) {
        // This iteration was already fully processed in a previous run — skip verdict logic
        continue;
      }

      // Use judge verdict if available, otherwise fall back to attacker bug count
      const effectiveBugs = judgeVerdict ? judgeVerdict.remainingIssues : totalBugs;
      iterState.bugsFoundPerRound.push(effectiveBugs);

      if (effectiveBugs === 0) {
        iterState.consecutiveCleanRounds++;
      } else {
        iterState.consecutiveCleanRounds = 0;
      }

      // Emit verdict info for frontend
      this.emit('iteration', {
        phase: phase.name,
        iteration: iter,
        maxIterations: iterConfig.maxIterations,
        consecutiveClean: iterState.consecutiveCleanRounds,
        verdict: judgeVerdict?.verdict || (effectiveBugs === 0 ? 'pass' : 'fail'),
        remainingIssues: effectiveBugs,
        verdictSummary: judgeVerdict?.summary || '',
      });

      // Judge says pass → exit iteration
      if (judgeVerdict?.verdict === 'pass') {
        iterState.status = 'completed';
        this.emit('iteration-complete', {
          phase: phase.name,
          totalIterations: iter,
          reason: 'judge_pass',
          bugsPerRound: iterState.bugsFoundPerRound,
        });
        break;
      }

      // Check exit conditions (legacy: consecutive clean rounds etc.)
      // Only auto-exit if judge explicitly passed; conditional_pass requires human checkpoint
      if (!judgeVerdict || judgeVerdict.verdict !== 'fail') {
        const shouldExit = this.checkExitCondition(iterConfig, iterState);
        if (shouldExit) {
          iterState.status = 'completed';
          this.emit('iteration-complete', {
            phase: phase.name,
            totalIterations: iter,
            reason: iterConfig.exitCondition,
            bugsPerRound: iterState.bugsFoundPerRound,
          });
          break;
        }
      }

      // If issues remain or judge says conditional_pass/fail, continue to next iteration
      // (defenders will run at the start of the next iteration with -迭代N suffix)
      // If no fix needed, the loop exits via judge pass or exit condition above

      // Max iterations reached
      if (iter === iterConfig.maxIterations) {
        if (iterConfig.escalateToHuman) {
          iterState.status = 'escalated';
          this.emit('escalation', {
            phase: phase.name,
            reason: `达到最大迭代次数 ${iterConfig.maxIterations}`,
            bugsPerRound: iterState.bugsFoundPerRound,
          });
        }
        this.emit('iteration-complete', {
          phase: phase.name,
          totalIterations: iter,
          reason: 'max_iterations',
          bugsPerRound: iterState.bugsFoundPerRound,
        });
      }

      // Clear iteration feedback after each round (will be set again if user provides new feedback)
      this.iterationFeedback = '';
    }
  }

  checkExitCondition(config: IterationConfig, state: IterationState): boolean {
    switch (config.exitCondition) {
      case 'no_new_bugs_3_rounds':
        return state.consecutiveCleanRounds >= config.consecutiveCleanRounds;
      case 'all_resolved':
        return state.bugsFoundPerRound.length > 0 &&
          state.bugsFoundPerRound[state.bugsFoundPerRound.length - 1] === 0;
      case 'manual':
        return false;
      default:
        return false;
    }
  }

  async runStep(
    step: WorkflowStep,
    phase: WorkflowPhase,
    workflowConfig: WorkflowConfig,
    stepIndex: number
  ): Promise<string> {
    const stepId = randomUUID();
    this.currentStep = step.name;
    this.updateAgentStatus(step.agent, 'running', step.task);
    const beforeSnapshotId = await this.recordStepGitBefore({
      stepLogId: stepId,
      stepName: step.name,
      phaseName: phase.name,
      agent: step.agent,
    });

    const agent = this.agents.find((a) => a.name === step.agent);
    if (agent) agent.iterationCount++;

    this.emit('step', {
      id: stepId,
      step: step.name,
      agent: step.agent,
      message: `执行步骤: ${step.name}`,
      stepIndex: stepIndex + 1,
      totalSteps: phase.steps.length,
      role: step.role,
    });
    await this.persistState();
    if (this._frontendSessionId) {
      await this.appendWorkflowTranscriptEvent({
        type: 'step-start',
        title: `步骤开始：${phase.name} / ${step.name}`,
        body: `- Agent: ${step.agent}`,
        speakerName: step.agent,
        dedupeKey: `workflow-step-start-${stepId}`,
      });
    }

    try {
      let resultText: string;
      let jsonResult: EngineJsonResult;
      jsonResult = await this.executeStep(step, workflowConfig);
      resultText = jsonResult.result;

      const tokenUsage: TokenUsage = toPersistedTokenUsage(jsonResult.usage);
      this.updateAgentTokenUsage(step.agent, tokenUsage);

      replaceAgentSessionId(this.agentSessionIds, step.agent, jsonResult.session_id);

      const displayOutput = this.deriveStepDisplayOutput(resultText) || resultText;

      if (agent) {
        agent.lastOutput = displayOutput;
        agent.summary = this.deriveStepDisplayOutput(resultText) || this.parseSummary(resultText);
        agent.costUsd += jsonResult.cost_usd || 0;
        agent.sessionId = jsonResult.session_id || null;
        const newChanges = this.parseChanges(resultText);
        agent.changes = [...agent.changes, ...newChanges];
      }

      this.updateAgentStatus(step.agent, 'completed');
      this.completedStepNames.push(step.name);

      const afterSnapshotId = await this.recordStepGitAfter({
        stepLogId: stepId,
        stepName: step.name,
        phaseName: phase.name,
        agent: step.agent,
        status: 'completed',
        beforeSnapshotId,
      });
      // Record step log
      this.stepLogs.push({
        id: stepId,
        stepName: step.name,
        agent: step.agent,
        status: 'completed',
        output: displayOutput,
        error: '',
        costUsd: jsonResult.cost_usd || 0,
        durationMs: jsonResult.duration_ms || 0,
        timestamp: new Date().toISOString(),
        tokenUsage,
        sessionId: jsonResult.session_id || null,
        engineName: this.engineType,
        gitStepDiffId: `git-step-${stepId}`,
        gitBeforeSnapshotId: beforeSnapshotId,
        gitAfterSnapshotId: afterSnapshotId,
      });

      this.emit('result', {
        id: stepId,
        step: step.name,
        agent: step.agent,
        output: displayOutput.substring(0, 500) + (displayOutput.length > 500 ? '...' : ''),
        fullOutput: displayOutput,
        role: step.role,
        costUsd: jsonResult.cost_usd,
        sessionId: jsonResult.session_id,
        numTurns: jsonResult.num_turns,
        durationMs: jsonResult.duration_ms,
      });

      await this.persistPhaseStepArtifacts(step.name, resultText, displayOutput);
      await this.persistState();
      if (this._frontendSessionId) {
        await this.appendWorkflowTranscriptEvent({
          type: 'step-complete',
          title: `步骤完成：${phase.name} / ${step.name}`,
          body: [
            `- Agent: ${step.agent}`,
            displayOutput ? `- 结论: ${displayOutput.slice(0, 1200)}` : '',
          ].filter(Boolean).join('\n'),
          speakerName: step.agent,
          dedupeKey: `workflow-step-complete-${stepId}`,
        });
      }

      return resultText;
    } catch (error: any) {
      // If workflow was stopped, don't record this as a failure
      if (this.shouldStop) {
        this.currentStep = null;
        return '';
      }

      // If force-complete was triggered, treat as success with stream content
      if (this.forceCompleteFlag) {
        this.forceCompleteFlag = false;
        console.log(`[runStep] forceCompleteFlag caught for step "${step.name}"`);
        // Find the process to get its stream content
        const allProcs = processManager.getAllProcesses();
        const proc = allProcs.find((p: any) => p.step === step.name);
        const procInfo = proc ? processManager.getProcess(proc.id) : null;
        const resultText = procInfo?.streamContent || procInfo?.output || '(强制完成，无输出)';
        console.log(`[runStep] force-complete resultText length: ${resultText.length}`);

        this.updateAgentStatus(step.agent, 'completed');
        this.completedStepNames.push(step.name);
        this.currentStep = null;

        const displayOutput = this.deriveStepDisplayOutput(resultText) || resultText;

        const afterSnapshotId = await this.recordStepGitAfter({
          stepLogId: stepId,
          stepName: step.name,
          phaseName: phase.name,
          agent: step.agent,
          status: 'completed',
          beforeSnapshotId,
        });
        this.stepLogs.push({
          id: stepId,
          stepName: step.name,
          agent: step.agent,
          status: 'completed',
          output: displayOutput,
          error: '',
          costUsd: 0,
          durationMs: 0,
          timestamp: new Date().toISOString(),
          tokenUsage: toPersistedTokenUsage(ZERO_ENGINE_USAGE),
          sessionId: null,
          engineName: this.engineType,
          gitStepDiffId: `git-step-${stepId}`,
          gitBeforeSnapshotId: beforeSnapshotId,
          gitAfterSnapshotId: afterSnapshotId,
        });

        this.emit('result', {
          id: stepId,
          step: step.name,
          agent: step.agent,
          output: displayOutput.substring(0, 500) + (displayOutput.length > 500 ? '...' : ''),
          fullOutput: displayOutput,
          role: step.role,
          costUsd: 0,
          numTurns: 0,
          durationMs: 0,
          forceCompleted: true,
        });

        await this.persistPhaseStepArtifacts(step.name, resultText, displayOutput);
        await this.persistState();
        if (this._frontendSessionId) {
          await this.appendWorkflowTranscriptEvent({
            type: 'step-complete',
            title: `步骤完成：${phase.name} / ${step.name}`,
            body: [
              `- Agent: ${step.agent}`,
              displayOutput ? `- 结论: ${displayOutput.slice(0, 1200)}` : '',
            ].filter(Boolean).join('\n'),
            speakerName: step.agent,
            dedupeKey: `workflow-step-complete-${stepId}`,
          });
        }
        return resultText;
      }

      const errorMsg = error.message || String(error);

      this.updateAgentStatus(step.agent, 'failed');
      this.failedStepNames.push(step.name);
      this.currentStep = null;

      // Record failed step log
      const afterSnapshotId = await this.recordStepGitAfter({
        stepLogId: stepId,
        stepName: step.name,
        phaseName: phase.name,
        agent: step.agent,
        status: 'failed',
        beforeSnapshotId,
      });
      this.stepLogs.push({
        id: stepId,
        stepName: step.name,
        agent: step.agent,
        status: 'failed',
        output: '',
        error: errorMsg,
        costUsd: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
        gitStepDiffId: `git-step-${stepId}`,
        gitBeforeSnapshotId: beforeSnapshotId,
        gitAfterSnapshotId: afterSnapshotId,
      });

      this.emit('result', {
        id: stepId,
        step: step.name,
        agent: step.agent,
        output: `执行失败: ${errorMsg}`,
        error: true,
        errorDetail: errorMsg,
        role: step.role,
      });

      if (this.currentRunId) {
        saveProcessOutput(this.currentRunId, step.name, `ERROR: ${errorMsg}`).catch(() => {});
      }

      await this.persistState();
      if (this._frontendSessionId) {
        await this.appendWorkflowTranscriptEvent({
          type: 'step-failed',
          title: `步骤失败：${phase.name} / ${step.name}`,
          body: [
            `- Agent: ${step.agent}`,
            `- 错误: ${errorMsg}`,
          ].join('\n'),
          speakerName: step.agent,
          dedupeKey: `workflow-step-failed-${stepId}`,
        });
      }
      return '';
    }
  }

  /**
   * Returns true if step succeeded, false if failed.
   * Used by iterative phases to decide whether to continue.
   */
  private lastStepSucceeded(): boolean {
    if (this.failedStepNames.length === 0) return true;
    // Check if the most recent stepLog was a failure
    const last = this.stepLogs[this.stepLogs.length - 1];
    return !last || last.status !== 'failed';
  }

  async executeStep(step: WorkflowStep, workflowConfig: WorkflowConfig, extraContext?: string): Promise<EngineJsonResult> {
    const roleConfig = this.agentConfigs.find((r) => r.name === step.agent)
      || workflowConfig.roles?.find((r) => r.name === step.agent);
    if (!roleConfig) {
      throw new Error(`未找到角色配置: ${step.agent}`);
    }

    // Check if review panel mode is enabled
    const enableReviewPanel = (step as any).enableReviewPanel && roleConfig.reviewPanel?.enabled;

    if (enableReviewPanel && roleConfig.reviewPanel?.subAgents) {
      // Execute review panel mode: run multiple sub-agents in parallel
      return await this.executeReviewPanel(step, workflowConfig, roleConfig, extraContext);
    }

    // Normal single-agent execution
    return await this.executeSingleAgent(step, workflowConfig, roleConfig, extraContext);
  }

  private async executeReviewPanel(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig,
    extraContext?: string
  ): Promise<EngineJsonResult> {
    const subAgents = roleConfig.reviewPanel!.subAgents;
    const subAgentNames = Object.keys(subAgents);

    console.log(`[专家模式] 启动 ${subAgentNames.length} 个专家子 Agent 进行多角度分析...`);

    // Load previous step outputs for context injection
    let previousOutputs: Record<string, string> = {};
    if (this.currentRunId) {
      try {
        const allOutputs = await loadStepOutputs(this.currentRunId);
        const completedSet = new Set(this.completedStepNames);
        for (const [name, content] of Object.entries(allOutputs)) {
          if (completedSet.has(name)) {
            previousOutputs[name] = content;
          }
        }
      } catch { /* non-critical */ }
    }

    // Build agents JSON for claude --agents flag
    const agentsJson: Record<string, any> = {};
    for (const [name, config] of Object.entries(subAgents)) {
      agentsJson[name] = {
        description: config.description,
        prompt: config.prompt,
        tools: config.tools,
        model: config.model,
      };
    }

    // Build main prompt that coordinates sub-agents
    const model = resolveAgentModel(roleConfig, workflowConfig.context);
    const mainPrompt = await this.buildPrompt(step, workflowConfig, roleConfig, previousOutputs);
    const coordinatorPrompt = `${mainPrompt}\n\n# 专家模式说明\n你现在处于专家模式。你有 ${subAgentNames.length} 个专家子 Agent 可以调用：\n\n${subAgentNames.map(name => `- @${name}: ${subAgents[name].description}`).join('\n')}\n\n请使用 @agent-name 语法调用这些专家，收集他们的分析结果，最后汇总形成综合结论。`;
    const isIterationStep = step.name.includes('-迭代');
    const systemPromptToUse = isIterationStep && roleConfig.iterationPrompt
      ? roleConfig.iterationPrompt
      : roleConfig.systemPrompt;
    const workingDirectory = this.getWorkingDirectory() || workflowConfig.context.projectRoot || this.resolveProjectRootPath();
    const timeoutMs = workflowConfig.context.timeoutMinutes
      ? workflowConfig.context.timeoutMinutes * 60 * 1000
      : undefined;
    const compactedExecution = await this.autoCompactAgentContextIfNeeded({
      agentName: step.agent,
      stepName: step.name,
      workflowConfig,
      prompt: coordinatorPrompt,
      systemPrompt: systemPromptToUse,
      model,
      workingDirectory,
      timeoutMs,
    });
    const processId = `${step.agent}-${step.name}-${Date.now()}`;
    const existingSessionId = compactedExecution.sessionId;

    // Set up stream content flushing
    let lastFlush = 0;
    const streamHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== processId) return;
      const now = Date.now();
      if (this.currentRunId && now - lastFlush > 3000) {
        lastFlush = now;
        saveStreamContent(this.currentRunId, step.name, data.total).catch(() => {});
      }
    };
    processManager.on('stream', streamHandler);

    try {
      const result = await this.executeWithEngine(
        processId,
        step.agent,
        step.name,
        compactedExecution.prompt,
        systemPromptToUse,
        model,
        {
          workingDirectory,
          allowedTools: roleConfig.allowedTools,
          resumeSessionId: existingSessionId,
          appendSystemPrompt: !!existingSessionId,
          timeoutMs,
          runId: this.currentRunId || undefined,
          agents: agentsJson, // Pass sub-agents configuration
          mcpServers: this.getEffectiveMcpServers(roleConfig),
        }
      );

      const proc = processManager.getProcess(processId);
      if (this.currentRunId && proc?.streamContent) {
        saveStreamContent(this.currentRunId, step.name, proc.streamContent).catch(() => {});
      }
      return {
        ...result,
        result: this.selectPreferredAgentOutput(result.result, proc?.streamContent),
      };
    } finally {
      processManager.off('stream', streamHandler);
    }
  }

  private async executeSingleAgent(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig,
    extraContext?: string
  ): Promise<EngineJsonResult> {
    // Load previous step outputs for context injection — only completed steps
    let previousOutputs: Record<string, string> = {};
    if (this.currentRunId) {
      try {
        const allOutputs = await loadStepOutputs(this.currentRunId);
        const completedSet = new Set(this.completedStepNames);
        for (const [name, content] of Object.entries(allOutputs)) {
          if (completedSet.has(name)) {
            previousOutputs[name] = content;
          }
        }
      } catch { /* non-critical */ }
    }

    const model = resolveAgentModel(roleConfig, workflowConfig.context);
    const prompt = await this.buildPrompt(step, workflowConfig, roleConfig, previousOutputs, extraContext);
    const processId = `${step.agent}-${step.name}-${Date.now()}`;

    // Determine which system prompt to use: iterationPrompt for iteration steps, systemPrompt otherwise
    const isIterationStep = step.name.includes('-迭代');
    const systemPromptToUse = isIterationStep && roleConfig.iterationPrompt
      ? roleConfig.iterationPrompt
      : roleConfig.systemPrompt;
    const workingDirectory = this.getWorkingDirectory() || workflowConfig.context.projectRoot || this.resolveProjectRootPath();
    const timeoutMs = workflowConfig.context.timeoutMinutes
      ? workflowConfig.context.timeoutMinutes * 60 * 1000
      : undefined;
    const compactedExecution = await this.autoCompactAgentContextIfNeeded({
      agentName: step.agent,
      stepName: step.name,
      workflowConfig,
      prompt,
      systemPrompt: systemPromptToUse,
      model,
      workingDirectory,
      timeoutMs,
    });

    // Set up stream content flushing to disk (with chunk separators)
    let lastFlush = 0;
    let activeProcessId = processId;
    let accumulatedStream = ''; // Accumulate stream content across feedback rounds
    let lastStreamAt = Date.now();
    let watchdogTriggeredForProcess = '';
    const streamHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== activeProcessId) return;
      const now = Date.now();
      lastStreamAt = now;
      watchdogTriggeredForProcess = '';
      // Flush to disk every 3 seconds
      if (this.currentRunId && now - lastFlush > 3000) {
        lastFlush = now;
        const fullStream = accumulatedStream
          ? accumulatedStream + '\n\n<!-- chunk-boundary -->\n\n' + data.total
          : data.total;
        saveStreamContent(this.currentRunId, step.name, fullStream).catch(() => {});
      }
    };
    processManager.on('stream', streamHandler);
    const idleWatchdog = setInterval(() => {
      if (!activeProcessId || this.shouldStop || this.interruptFlag) return;
      if (watchdogTriggeredForProcess === activeProcessId) return;
      if (Date.now() - lastStreamAt < STREAM_IDLE_INTERRUPT_MS) return;
      const proc = processManager.getProcess(activeProcessId);
      if (!proc || proc.status !== 'running') return;
      watchdogTriggeredForProcess = activeProcessId;
      this.liveFeedback.push(AUTO_CONTINUE_FEEDBACK);
      this.interruptFlag = true;
      this.feedbackInterrupt = true;
      this.emit('feedback-injected', { message: AUTO_CONTINUE_FEEDBACK, timestamp: new Date().toISOString(), status: 'queued', automatic: true });
      processManager.killProcess(activeProcessId);
    }, STREAM_IDLE_CHECK_MS);

    let currentProcessId = processId;
    let currentPrompt = compactedExecution.prompt;
    let currentSessionId = compactedExecution.sessionId;
    let lastResult: EngineJsonResult;
    let accumulatedOutput = ''; // Accumulate result output across feedback rounds

    try {
      // Execute loop: run agent, then check for pending feedback and resume if any
      while (true) {
        let result: EngineJsonResult;
        try {
          result = await this.executeWithEngine(
            currentProcessId,
            step.agent,
            step.name,
            currentPrompt,
            systemPromptToUse,
            model,
            {
              workingDirectory,
              allowedTools: roleConfig.allowedTools,
              resumeSessionId: currentSessionId,
              appendSystemPrompt: !!currentSessionId,
              timeoutMs,
              runId: this.currentRunId || undefined,
              mcpServers: this.getEffectiveMcpServers(roleConfig),
            }
          );
        } catch (err) {
          // If interrupted with feedback, preserve stream and resume with feedback
          if (this.interruptFlag && this.liveFeedback.length > 0) {
            const isFeedbackOnly = this.feedbackInterrupt;
            this.interruptFlag = false;
            this.feedbackInterrupt = false;
            const proc = processManager.getProcess(currentProcessId);
            if (proc?.streamContent) {
              accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
            }
            const sessionId = proc?.sessionId;

            const feedbackPrompt = this.liveFeedback.join('\n\n');
            this.liveFeedback = [];
            const feedbackTimestamp = new Date().toISOString();
            accumulatedStream += `\n\n<!-- chunk-boundary -->\n\n<!-- human-feedback: ${feedbackTimestamp} -->\n${feedbackPrompt}`;
            if (this.currentRunId) {
              saveStreamContent(this.currentRunId, step.name, accumulatedStream).catch(() => {});
            }
            this.emit('feedback-injected', { message: feedbackPrompt, timestamp: feedbackTimestamp, status: 'delivered' });
            currentSessionId = sessionId || undefined;
            currentPrompt = isFeedbackOnly
              ? `## 人工实时反馈\n用户在你执行过程中提供了补充反馈，请参考以下内容继续完成任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`
              : `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
            if (!sessionId) {
              currentPrompt = prompt + '\n\n' + currentPrompt;
            }
            currentProcessId = `${step.agent}-${step.name}-interrupt-${Date.now()}`;
            activeProcessId = currentProcessId;
            lastStreamAt = Date.now();
            watchdogTriggeredForProcess = '';
            this.emit('step', {
              step: step.name,
              agent: step.agent,
              message: isFeedbackOnly ? `收到反馈，恢复执行: ${step.name}` : `收到紧急反馈，打断并重新执行: ${step.name}`,
              role: step.role,
            });
            continue;
          }
          throw err; // Non-interrupt error, propagate normally
        }

        // Save or clear session ID for potential resume
        replaceAgentSessionId(this.agentSessionIds, step.agent, result.session_id);

        // Accumulate stream content from this round
        const proc = processManager.getProcess(currentProcessId);
        if (proc?.streamContent) {
          accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
        }
        // Save the full accumulated stream
        if (this.currentRunId) {
          saveStreamContent(this.currentRunId, step.name, accumulatedStream).catch(() => {});
        }

        lastResult = result;
        accumulatedOutput += (accumulatedOutput ? '\n\n---\n\n' : '') + (result.result || '');

        // Check for pending live feedback
        if (this.liveFeedback.length > 0 && !this.shouldStop) {
          const feedbackPrompt = this.liveFeedback.map((fb, i) => `${i + 1}. ${fb}`).join('\n');
          this.liveFeedback = [];

          const sessionId = result.session_id;
          if (!sessionId) break; // Can't resume without session ID

          // Append feedback marker to accumulated stream so it shows inline
          const feedbackTimestamp = new Date().toISOString();
          accumulatedStream += `\n\n<!-- chunk-boundary -->\n\n<!-- human-feedback: ${feedbackTimestamp} -->\n${feedbackPrompt}`;
          if (this.currentRunId) {
            saveStreamContent(this.currentRunId, step.name, accumulatedStream).catch(() => {});
          }
          this.emit('feedback-injected', { message: feedbackPrompt, timestamp: feedbackTimestamp, status: 'delivered' });

          // Resume the same session with feedback
          currentSessionId = sessionId;
          currentPrompt = `## 人工实时反馈\n以下是用户在你执行过程中提供的反馈意见，请基于这些反馈继续处理当前任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
          currentProcessId = `${step.agent}-${step.name}-feedback-${Date.now()}`;
          activeProcessId = currentProcessId;
          lastStreamAt = Date.now();
          watchdogTriggeredForProcess = '';

          this.emit('step', {
            step: step.name,
            agent: step.agent,
            message: `收到人工反馈，继续执行: ${step.name}`,
            role: step.role,
          });
          continue;
        }

        break;
      }

      if (!hasMeaningfulAiOutput(accumulatedOutput, accumulatedStream)) {
        throw new Error(`AI 服务中断：步骤 "${step.name}" 未产生任何输出`);
      }

      // Return result with accumulated output from all rounds
      return {
        ...lastResult!,
        result: this.selectPreferredAgentOutput(accumulatedOutput, accumulatedStream),
      };
    } finally {
      clearInterval(idleWatchdog);
      processManager.off('stream', streamHandler);
    }
  }

  private buildWorkflowRoadmapContext(currentStep: WorkflowStep, workflowConfig: WorkflowConfig): string {
    const lines: string[] = [
      `## 全局工作流路线与当前职责边界`,
      `你可以看到完整工作流路线，用它来理解上下游分工，但不能把当前步骤的核心交付留给后续步骤。`,
      `当前步骤必须尽量完成其任务描述中可完成的分析、实现、验证或裁决；后续步骤只负责在你的明确产出基础上继续推进。`,
      `如果发现某件事确实应由后续步骤处理，请在步骤结论中写清楚具体输入、文件、风险和最小动作，不要只笼统写“留给后续”。`,
      ``,
    ];
    for (const phase of workflowConfig.workflow.phases || []) {
      const phaseMarker = phase.name === this.currentPhase ? '=> ' : '   ';
      lines.push(`${phaseMarker}阶段: ${phase.name}`);
      const phaseDescription = typeof (phase as any).description === 'string' ? (phase as any).description : '';
      if (phaseDescription) lines.push(`   阶段目标: ${phaseDescription}`);
      for (const item of phase.steps || []) {
        const isCurrent = item === currentStep || (item.name === currentStep.name && phase.name === this.currentPhase);
        const status = this.completedStepNames.includes(item.name)
          ? '已完成'
          : isCurrent
            ? '当前步骤'
            : '待执行';
        lines.push(`${isCurrent ? '   *' : '   -'} 步骤: ${item.name} [${status}]${item.agent ? ` / agent: ${item.agent}` : ''}${item.role ? ` / role: ${item.role}` : ''}`);
        if (item.task) {
          const compactTask = String(item.task).replace(/\s+/g, ' ').trim();
          lines.push(`     任务: ${compactTask.slice(0, 220)}${compactTask.length > 220 ? '...' : ''}`);
        }
      }
    }
    return `${lines.join('\n')}\n\n`;
  }

  async buildPrompt(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig,
    previousOutputs?: Record<string, string>,
    extraContext?: string
  ): Promise<string> {
    let prompt = `# 任务\n${step.task}\n\n`;
    prompt += this.buildWorkflowRoadmapContext(step, workflowConfig);

    if (workflowConfig.context.requirements) {
      prompt += `## 需求背景\n${workflowConfig.context.requirements}\n\n`;
    }

    // Inject global context
    if (this.globalContext) {
      prompt += `## 全局上下文\n${this.globalContext}\n\n`;
    }

    // Inject phase-specific context
    if (this.currentPhase) {
      const phaseCtx = this.phaseContexts.get(this.currentPhase);
      if (phaseCtx) {
        prompt += `## 阶段上下文（${this.currentPhase}）\n${phaseCtx}\n\n`;
      }
    }

    if (workflowConfig.context.projectRoot) {
      prompt += `## 项目路径\n${workflowConfig.context.projectRoot}\n\n`;
      if (this.currentRunId) {
        const outputDir = join(getWorkspaceRunsDir(), this.currentRunId, 'outputs');
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const phaseName = this.currentPhase || '当前阶段';
        const summaryFileName = `${ts}-${phaseName}-${step.name}.md`;
        prompt += `## 文档输出要求\n`;
        prompt += `请将你产出的步骤成果详细总结写入以下目录：\n`;
        prompt += `\`${outputDir}/\`\n\n`;
        prompt += `当前步骤的步骤成果详细总结文件名必须是：\`${summaryFileName}\`\n`;
        prompt += `以上规则仅适用于系统要求的“步骤成果详细总结”归档文件。\n`;
        prompt += `除步骤成果详细总结外，其他正式产物文件（例如代码、设计文档、API 文档、说明文档、脚本、配置等）应严格按照用户要求、任务要求和项目目录约定写入；如果用户要求产出到工作目录，就写入工作目录，不要写入该归档目录。\n\n`;
      }
    }

    // Collect all skills: workspace + workflow + step-level, then merge and deduplicate
    const allSkillNames = new Set<string>();

    // 1. Workspace skills (already loaded and tracked)
    this.workspaceSkillNames.forEach(name => allSkillNames.add(name));

    // 2. Workflow-level skills (from context.skills)
    if (workflowConfig.context.skills) {
      workflowConfig.context.skills.forEach(name => allSkillNames.add(name));
    }

    // 3. Step-level skills (from step.skills)
    if (step.skills) {
      step.skills.forEach(name => allSkillNames.add(name));
    }

    // Load all skills content
    if (allSkillNames.size > 0) {
      prompt += `## 必须使用的 Skills\n\n`;
      prompt += `⚠️ **重要提醒：以下 Skills 是本步骤/项目的核心工具，你必须严格遵循以下原则：**\n\n`;
      prompt += `1. **优先阅读 Skills**：在执行任何任务前，请务必仔细阅读下方所有 Skills 的说明文档\n`;
      prompt += `2. **使用 Skills 中的命令**：直接使用 Skills 中提供的命令格式和参数，**严禁**自行猜测命令或随意修改参数\n`;
      prompt += `3. **Skills 包含最佳实践**：每个 Skill 都经过验证，代表了该领域的最佳实践，偏离 Skill 指导可能导致错误或性能问题\n`;
      prompt += `4. **遇到问题先查 Skills**：如果遇到构建、测试、部署等问题，请首先检查是否有对应的 Skill 可用\n\n`;
      prompt += `### 如何使用 Skills\n\n`;
      const skillsAbsPath = await getRuntimeSkillsDirPath();
      prompt += `- **Skills 目录绝对路径**: \`${skillsAbsPath}/\`\n`;
      prompt += `- **阅读 SKILL.md**：每个 Skill 目录下的 SKILL.md 包含完整使用说明，例如 \`${skillsAbsPath}/build-cangjie/SKILL.md\`\n`;
      prompt += `- **查看 REFERENCE.md**：如需更多参数说明，参考同目录下的 REFERENCE.md\n`;
      prompt += `- **复制粘贴命令**：直接使用 Skill 中给出的示例命令，确保参数格式正确\n\n`;

      // Load and inject workspace skills content first (already cached)
      if (this.workspaceSkills) {
        prompt += this.workspaceSkills;
      }

      // Load workflow-level and step-level skills that are not in workspace
      const additionalSkills = [...allSkillNames].filter(
        name => !this.workspaceSkillNames.has(name)
      );

      if (additionalSkills.length > 0) {
        const additionalSkillsContent = await this.loadStepSkills(
          additionalSkills,
          workflowConfig.context.projectRoot || ''
        );
        if (additionalSkillsContent) {
          prompt += additionalSkillsContent;
        }
      }
    }

    if (roleConfig.capabilities && roleConfig.capabilities.length > 0) {
      prompt += `## 你的能力\n`;
      roleConfig.capabilities.forEach((cap) => {
        prompt += `- ${cap}\n`;
      });
      prompt += '\n';
    }

    if (step.constraints && step.constraints.length > 0) {
      prompt += `## 约束条件\n`;
      step.constraints.forEach((constraint) => {
        prompt += `- ${constraint}\n`;
      });
      prompt += '\n';
    }

    if (roleConfig.constraints && roleConfig.constraints.length > 0) {
      prompt += `## Agent 约束\n`;
      roleConfig.constraints.forEach((constraint) => {
        prompt += `- ${constraint}\n`;
      });
      prompt += '\n';
    }

    // Inject previous step outputs as context (only completed steps are passed in)
    if (previousOutputs && Object.keys(previousOutputs).length > 0) {
      prompt += `## 前序步骤产出\n`;
      prompt += `以下是已完成步骤的产出摘要。如需查看完整内容，请读取对应文件路径。\n\n`;
      for (const [stepName, output] of Object.entries(previousOutputs)) {
        const safeName = stepName.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
        // 与 loadStepOutputs / saveProcessOutput 一致：数据目录下 runs/{runId}/outputs/，非 projectRoot/.ace-outputs
        const fullPath = this.currentRunId
          ? join(getWorkspaceRunsDir(), this.currentRunId, 'outputs', `${safeName}.md`)
          : '';
        // Extract the tail of the output as summary (AI typically summarizes at the end)
        const summary = output.length > 3000
          ? output.substring(output.length - 3000)
          : output;
        prompt += `### ${stepName}\n`;
        if (fullPath) {
          prompt += `完整文档路径: \`${fullPath}\`\n\n`;
        }
        prompt += `${fenced(summary)}\n\n`;
      }
    }

    // Inject structured JSON output requirement for attacker/judge roles
    if (step.role === 'attacker' || step.role === 'judge') {
      prompt += `## 结构化输出要求\n`;
      prompt += `在你的回复最末尾，请务必输出以下 JSON 块（用 \`\`\`json 包裹），用于自动化流程判断：\n\n`;
      prompt += `\`\`\`json\n`;
      prompt += `{\n`;
      prompt += `  "verdict": "pass | conditional_pass | fail",\n`;
      prompt += `  "remaining_issues": 0,\n`;
      prompt += `  "summary": "一句话总结"\n`;
      prompt += `}\n`;
      prompt += `\`\`\`\n\n`;
      prompt += `字段说明：\n`;
      prompt += `- \`verdict\`: \`"pass"\` 表示无问题可通过，\`"conditional_pass"\` 表示有条件通过（存在需修复的问题但方向正确），\`"fail"\` 表示存在严重问题需要重做\n`;
      prompt += `- \`remaining_issues\`: 剩余未解决的问题数量（整数）\n`;
      prompt += `- \`summary\`: 一句话总结你的评估结论\n\n`;
      prompt += `## 裁决边界约束\n`;
      prompt += `- 正式 verdict 只评估当前阶段/当前检查点的核心审查目标。\n`;
      prompt += `- 只有会影响当前检查点是否通过的问题，才能计入 \`remaining_issues\`，并影响 \`pass / conditional_pass / fail\`。\n`;
      prompt += `- 像附加文件命名、时间戳前缀、补充总结归档格式、展示文案、非核心输出排版这类低优先级问题，如果不影响当前检查点核心目标，不能计入 \`remaining_issues\`，也不能单独导致 \`conditional_pass\` 或 \`fail\`。\n`;
      prompt += `- 这类非阻塞问题只能放进补充建议，不要写成正式阻塞项。\n\n`;
    }

    // Inject human iteration feedback as check items
    if (this.iterationFeedback && step.name.includes('-迭代')) {
      prompt += `## 人工评审意见（本轮迭代的检查项）\n`;
      prompt += `以下是人工审阅者对上一轮迭代的评审意见，请将这些意见作为本轮迭代的重点检查项：\n\n`;
      prompt += `${this.iterationFeedback}\n\n`;
      prompt += `请确保在本轮迭代中重点关注和解决上述评审意见中提到的问题。\n\n`;
    }

    // For defender steps in iteration rounds, require a complete final deliverable
    if (step.role === 'defender' && step.name.includes('-迭代')) {
      prompt += `## 完整产出要求\n`;
      prompt += `重要：你必须产出两份独立文档，严格分开：\n\n`;
      prompt += `1. **迭代改进分析**（单独文件，如 \`迭代改进分析-迭代N.md\`）：本轮发现的问题、改进点对比、修复方案选择等分析过程。\n`;
      prompt += `2. **最终完整方案**（单独文件，如 \`最终设计方案.md\` 或 \`最终代码.md\`）：融合所有历史迭代改进后的完整最终产出。这份文档中不得出现任何"补丁"、"增量修改"、"相比上一轮"等措辞，它必须是一份从零可读的、独立完整的最终文档，读者无需了解迭代历史即可理解全貌。\n\n`;
      prompt += `最终方案文档是你最重要的交付物，请确保它的质量和完整性。\n\n`;
    }

    // ========== Supervisor-Lite: 注入额外上下文（信息收集循环） ==========
    if (extraContext) {
      prompt += `## 补充信息\n${extraContext}\n\n`;
    }

    // Replace template variables
    if (this.currentRunId) {
      prompt = prompt.replace(/\{runId\}/g, this.currentRunId);
    }

    return prompt;
  }

  async waitForApproval(): Promise<'approve' | 'iterate'> {
    // If there's a pre-queued action (from resume with action), use it immediately
    if (this.queuedApprovalAction) {
      const action = this.queuedApprovalAction;
      this.queuedApprovalAction = null;
      return action;
    }
    return new Promise((resolve) => {
      const cleanup = () => { this.off('approve', onApprove); this.off('iterate', onIterate); this.off('force-stop', onStop); };
      const onApprove = () => { cleanup(); resolve('approve'); };
      const onIterate = () => { cleanup(); resolve('iterate'); };
      const onStop = () => { cleanup(); resolve('approve'); }; // resolve to unblock, shouldStop will prevent further execution
      this.once('approve', onApprove);
      this.once('iterate', onIterate);
      this.once('force-stop', onStop);
    });
  }

  approve(): void {
    this.emit('approve');
  }

  requestIteration(feedback: string): void {
    this.iterationFeedback = feedback;
    // Reset iteration state for current phase to allow re-execution
    if (this.currentPhase) {
      const iterState = this.iterationStates.get(this.currentPhase);
      if (iterState) {
        // Reset status to 'running' so resume won't skip this phase
        iterState.status = 'running';
        iterState.consecutiveCleanRounds = 0;
        // Ensure at least one more iteration is allowed
        if (iterState.currentIteration >= iterState.maxIterations) {
          iterState.maxIterations = iterState.currentIteration + 1;
        }
        this.iterationStates.set(this.currentPhase, iterState);
      }
    }
    this.emit('iterate');
  }

  setQueuedApprovalAction(action: 'approve' | 'iterate'): void {
    this.queuedApprovalAction = action;
  }

  setIterationFeedback(feedback: string): void {
    this.iterationFeedback = feedback;
  }

  injectLiveFeedback(message: string, options: LiveFeedbackOptions = {}): boolean {
    const entry = {
      id: options.id,
      message,
      timestamp: new Date().toISOString(),
      status: options.interrupt ? 'interrupting' : 'queued',
      interrupt: !!options.interrupt,
      automatic: options.automatic,
    };
    if (!this.liveFeedback.includes(message)) {
      this.liveFeedback.push(message);
    }
    this.emit('feedback-injected', entry);

    // Interrupt the running process so feedback is delivered immediately via resume
    if (this.status === 'running' && this.currentStep) {
      this.interruptFlag = true;
      this.feedbackInterrupt = true;

      const allProcs = processManager.getAllProcesses();
      const running = allProcs.find(
        (p: any) => p.status === 'running' && (p.step === this.currentStep || p.id.startsWith(this.currentStep!.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')))
      );
      if (running) {
        processManager.killProcess(running.id);
        this.emit('feedback-injected', { ...entry, status: 'interrupting' });
        return true;
      }
    }
    return false;
  }

  /**
   * Recall (remove) a pending live feedback message that hasn't been consumed yet.
   * Returns true if the message was found and removed.
   */
  recallLiveFeedback(message: string): boolean {
    const idx = this.liveFeedback.indexOf(message);
    if (idx === -1) return false;
    this.liveFeedback.splice(idx, 1);
    this.emit('feedback-recalled', { message, timestamp: new Date().toISOString() });
    return true;
  }

  /**
   * Interrupt the currently running step and immediately resume with feedback.
   * Kills the current process and queues feedback so executeSingleAgent resumes.
   */
  interruptWithFeedback(message: string, options: LiveFeedbackOptions = {}): boolean {
    if (this.status !== 'running' || !this.currentStep) return false;

    // Queue the feedback
    if (!this.liveFeedback.includes(message)) {
      this.liveFeedback.push(message);
    }
    this.interruptFlag = true;
    this.feedbackInterrupt = false;

    // Find and kill the running process
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => p.status === 'running' && (p.step === this.currentStep || p.id.startsWith(this.currentStep!.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')))
    );
    if (running) {
      processManager.killProcess(running.id);
    }

    this.emit('log', {
      agent: 'system',
      level: 'warning',
      message: `步骤 "${this.currentStep}" 被打断，将立即处理反馈`,
    });
    this.emit('feedback-injected', {
      id: options.id,
      message,
      timestamp: new Date().toISOString(),
      status: running ? 'interrupting' : 'queued',
      interrupt: true,
      automatic: options.automatic,
    });
    return Boolean(running);
  }

  setContext(scope: 'global' | 'phase', context: string, phase?: string): void {
    if (scope === 'global') {
      this.globalContext = context;
    } else if (phase) {
      if (context) {
        this.phaseContexts.set(phase, context);
      } else {
        this.phaseContexts.delete(phase);
      }
    }
    this.emit('context-updated', {
      scope,
      phase: phase || null,
      context,
    });
    this.persistState().catch(() => {});
  }

  getContexts(): { globalContext: string; phaseContexts: Record<string, string> } {
    return {
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.phaseContexts),
    };
  }

  /**
   * Force-complete the currently running step.
   * Kills the process and uses accumulated stream content as the step output.
   */
  async forceCompleteStep(): Promise<{ step: string; output: string } | null> {
    let stepName = this.currentStep;

    // If in-memory state is empty (e.g. after server restart), try to recover from persisted state
    if (!stepName || this.status !== 'running') {
      const runningRuns = await findRunningRuns();
      if (runningRuns.length > 0) {
        const runState = runningRuns[0];
        stepName = runState.currentStep;
        if (!stepName) return null;
        // Restore minimal state so we can operate
        this.status = 'running';
        this.currentStep = stepName;
        this.currentRunId = runState.runId;
        this.currentConfigFile = runState.configFile;
        this.completedStepNames = runState.completedSteps || [];
        this.failedStepNames = runState.failedSteps || [];
        this.stepLogs = runState.stepLogs || [];
        this.currentPhase = runState.currentPhase;
      } else {
        return null;
      }
    }

    // Find the running process for this step (check both step field and id prefix)
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => p.status === 'running' && (p.step === stepName || p.id.startsWith(stepName!.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_')))
    );

    // Also try to find and kill any orphaned Claude CLI processes for this step
    if (!running) {
      // Try to get output from persisted stream file
      if (this.currentRunId && stepName) {
        const streamContent = await loadStreamContent(this.currentRunId, stepName);
        if (streamContent) {
          // Kill any orphaned claude processes
          if (!isWindows()) {
            try {
              const { execSync } = await import('child_process');
              execSync('pkill -f "claude.*--output-format json" 2>/dev/null || true', { timeout: 5000 });
            } catch { /* ignore */ }
          }

          // Mark step as completed with stream content
          return { step: stepName, output: streamContent };
        }
      }

      // Check for most recent process for this step
      const recent = allProcs
        .filter((p: any) => p.step === stepName)
        .sort((a: any, b: any) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())[0];
      if (recent?.streamContent || recent?.output) {
        return { step: stepName, output: recent.streamContent || recent.output || '(已完成)' };
      }
      return null;
    }

    const proc = processManager.getProcess(running.id);
    if (!proc) return null;

    // Capture current stream content as the output
    const output = proc.streamContent || proc.output || '(强制完成，无输出)';

    // Set force-complete flag so the error handler in runStep treats this as success
    this.forceCompleteFlag = true;

    // Kill the process — this will cause the engine execution to reject
    processManager.killProcess(running.id);

    this.emit('log', {
      agent: 'system',
      level: 'warning',
      message: `步骤 "${stepName}" 被强制完成，使用已有输出 (${output.length} 字符)`,
    });

    return { step: stepName, output };
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
    // Unblock any pending waitForApproval
    this.emit('force-stop');
    // Mark the current running step as failed so it shows red in the flow diagram
    const stoppedStep = this.currentStep;
    if (stoppedStep && !this.completedStepNames.includes(stoppedStep) && !this.failedStepNames.includes(stoppedStep)) {
      this.failedStepNames.push(stoppedStep);
    }
    this.statusReason = stoppedStep
      ? `用户手动停止。中断步骤: ${stoppedStep}`
      : '用户手动停止';
    this.currentStep = null;
    // Mark any running agents as failed (they were interrupted)
    for (const agent of this.agents) {
      if (agent.status === 'running') {
        agent.status = 'failed';
      }
    }
    // Cancel current engine if using alternative engine
    if (this.currentEngine) {
      try {
        this.currentEngine.cancel();
      } catch (error) {
        this.emit('log', `引擎取消失败: ${error}`);
      }
    }
    // Kill managed processes + orphan system claude processes
    await processManager.killAllSystem();
    // Small delay to let close events fire
    await new Promise(r => setTimeout(r, 500));
    // Ensure status is still stopped (not overwritten by async handlers)
    this.status = 'stopped';
    try {
      await this.finalizeRun('stopped');
    } catch {
      // finalizeRun failed — persist state directly as fallback
    }
    // Always try to persist stopped state, even if finalizeRun already did
    this.status = 'stopped';
    await this.persistState().catch(() => {});
    this.emit('status', { status: 'stopped', message: '工作流已停止' });
    // Reset memory status to idle so polling doesn't overwrite frontend with stale data
    this.status = 'idle';
  }

  async resume(runId: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }
    if (runState.status === 'running') {
      throw new Error('该运行仍在进行中');
    }
    if (runState.status === 'completed') {
      throw new Error('该运行已完成，无需恢复');
    }

    // Load the original workflow config
    const configPath = await getRuntimeWorkflowConfigPath(runState.configFile);
    const content = await readFile(configPath, 'utf-8');
    const workflowConfig: WorkflowConfig = parse(content);

    // Restore internal state
    this.currentWorkflow = workflowConfig;
    this.currentRunId = runId;
    this.currentConfigFile = runState.configFile;
    this._createdBy = runState.runOwnerId || runState.createdBy || this._createdBy;
    this._createdByName = runState.runOwnerName || runState.createdByName || this._createdByName;
    this.status = 'running';
    this.shouldStop = false;
    this.logs = [];
    this.completedStepNames = [...(runState.completedSteps || [])];
    // Promote failed steps that have completed stepLogs — they ran successfully but
    // were marked failed due to downstream errors (e.g. API timeout after output).
    const failedSet = new Set(runState.failedSteps || []);
    const completedLogNames = new Set(
      (runState.stepLogs || []).filter(l => l.status === 'completed').map(l => l.stepName)
    );
    for (const fn of failedSet) {
      if (completedLogNames.has(fn) && !this.completedStepNames.includes(fn)) {
        this.completedStepNames.push(fn);
      }
    }

    // Recover missing completed steps by checking log files
    // This handles cases where steps completed but state wasn't persisted (e.g. crash/restart)
    try {
      const logsDir = resolve(getWorkspaceRunsDir(), runId, 'logs');
      const logFiles = await readdir(logsDir).catch(() => []);
      for (const file of logFiles) {
        if (!file.endsWith('.log')) continue;
        // Parse filename: agent-stepName-timestamp.log
        const match = file.match(/^(.+?)-(.+)-(\d+)\.log$/);
        if (!match) continue;
        const stepName = match[2];
        // Skip if already in completedSteps or stepLogs
        if (this.completedStepNames.includes(stepName) || completedLogNames.has(stepName)) continue;
        // Check if log file indicates completion (has "✓ 完成" or "进程退出 code=0")
        const logPath = resolve(logsDir, file);
        const logContent = await readFile(logPath, 'utf-8').catch(() => '');
        if (logContent.includes('✓ 完成') || (logContent.includes('进程退出 code=0') && !logContent.includes('✗ 失败'))) {
          console.log(`[resume] 恢复丢失的完成步骤: ${stepName} (从日志文件)`);
          this.completedStepNames.push(stepName);
        }
      }
    } catch (err) {
      console.warn(`[resume] 无法恢复日志文件状态:`, err);
    }

    this.failedStepNames = []; // Reset failed — we'll retry truly failed ones
    this.stepLogs = [...(runState.stepLogs || []).filter(l => l.status === 'completed')];
    this.qualityChecks = runState.qualityChecks || [];
    this.runStartTime = runState.startTime;
    this.runEndTime = null;
    this.statusReason = null;
    this.pendingCheckpoint = runState.pendingCheckpoint || null;
    this.agentSessionIds.clear();
    this.liveFeedback = [];
    this.globalContext = runState.globalContext || '';
    this.workflowMcpServers = [];
    this.phaseContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.isolatedDir = runState.workingDirectory || null;
    this.currentProjectRoot = runState.workingDirectory || workflowConfig.context.projectRoot || null;
    if (runState.workingDirectory) {
      workflowConfig.context.projectRoot = runState.workingDirectory;
    }
    this.workflowGit = runState.workspaceGit || null;

    console.log(`[WorkflowManager.resume] runId=${runId}`);
    console.log(`[WorkflowManager.resume] completedSteps=`, this.completedStepNames);
    console.log(`[WorkflowManager.resume] iterationStates=`, JSON.stringify(runState.iterationStates));

    // Initialize engine
    await this.initializeEngine(resolveWorkflowExecutionPolicy(workflowConfig.context).defaultEngine || workflowConfig.context?.engine);
    await this.resolveWorkflowMcpServers(workflowConfig);

    if (workflowConfig.context.gitBaselineEnabled !== false) {
      await this.ensureWorkflowGitBaseline(workflowConfig.context.projectRoot || runState.workingDirectory);
    } else {
      await this.disableWorkflowGitBaseline(workflowConfig.context.projectRoot || runState.workingDirectory);
    }

    // Load agent configs
    this.agentConfigs = await this.loadAgentConfigs();

    // Discover workspace skills from projectRoot/skills/
    if (workflowConfig.context.projectRoot) {
      this.workspaceSkills = await this.discoverWorkspaceSkills(workflowConfig.context.projectRoot);

      // Load workflow-level skills from context.skills
      if (workflowConfig.context.skills && workflowConfig.context.skills.length > 0) {
        this.workflowSkillsContent = await this.loadWorkflowSkills(
          workflowConfig.context.skills,
          workflowConfig.context.projectRoot
        );
      }
    } else {
      this.workspaceSkills = '';
      this.workflowSkillsContent = '';
    }

    this.initializeAgents(workflowConfig);

    // Restore agent state from persisted data
    for (const pa of (runState.agents || [])) {
      const agent = this.agents.find(a => a.name === pa.name);
      if (agent) {
        agent.tokenUsage = pa.tokenUsage || { inputTokens: 0, outputTokens: 0 };
        agent.costUsd = pa.costUsd || 0;
        agent.completedTasks = pa.completedTasks || 0;
        agent.iterationCount = pa.iterationCount || 0;
        agent.summary = pa.summary || '';
        // Restore status: completed agents stay completed, failed reset to waiting for retry
        if (pa.status === 'completed') {
          agent.status = 'completed';
        }
        if (pa.sessionId) {
          agent.sessionId = pa.sessionId;
          this.agentSessionIds.set(pa.name, pa.sessionId);
        }
      }
    }

    // Restore iteration states
    this.iterationStates.clear();
    for (const [key, val] of Object.entries(runState.iterationStates || {})) {
      this.iterationStates.set(key, val as IterationState);
    }

    processManager.reset();

    console.log(`[WorkflowManager.resume] FINAL STATE BEFORE EXECUTE:`);
    console.log(`  completedStepNames=`, JSON.stringify(this.completedStepNames));
    console.log(`  failedStepNames=`, JSON.stringify(this.failedStepNames));
    console.log(`  iterationStates=`, JSON.stringify(Object.fromEntries(this.iterationStates)));

    this.emit('status', { status: 'running', message: `恢复运行: ${runId}`, runId });
    this.emit('agents', { agents: this.agents });

    // Update run record status
    runState.status = 'running';
    runState.endTime = null;
    await saveRunState(runState);

    await this.persistState();

    try {
      await this.executeWorkflowResume(workflowConfig);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', { status: 'completed', message: '工作流执行完成' });
        await this.finalizeRun('completed');
      }
    } catch (error: any) {
      if (!this.shouldStop) {
        this.status = 'failed';
        this.statusReason = error.message || String(error);
        this.emit('status', { status: 'failed', message: error.message });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  async rerunFromStep(runId: string, stepName: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    // Normalize: strip iteration suffix to get the base step name
    const baseStepName = stepName.replace(/-迭代\d+$/, '');

    // Find the step index in stepLogs execution order (try exact name first, then base name)
    let logIndex = runState.stepLogs.findIndex(l => l.stepName === stepName);
    if (logIndex === -1) {
      logIndex = runState.stepLogs.findIndex(l => l.stepName === baseStepName);
    }

    const inCompleted = runState.completedSteps.includes(stepName) || runState.completedSteps.includes(baseStepName);
    const inFailed = runState.failedSteps?.includes(stepName) || runState.failedSteps?.includes(baseStepName);

    if (logIndex === -1 && !inCompleted && !inFailed) {
      throw new Error(`步骤 "${stepName}" 未在运行记录中找到`);
    }

    // Collect agents from steps being removed (before truncation)
    const removedStepAgents = new Set<string>();
    if (logIndex >= 0) {
      for (const log of runState.stepLogs.slice(logIndex)) {
        if (log.agent) removedStepAgents.add(log.agent);
      }
    }

    // Remove target step and all subsequent steps from completed list
    if (logIndex >= 0) {
      const stepsToRemove = new Set(
        runState.stepLogs.slice(logIndex).map(l => l.stepName)
      );
      // Also add the base name variants
      for (const s of [...stepsToRemove]) {
        stepsToRemove.add(s.replace(/-迭代\d+$/, ''));
      }
      runState.completedSteps = runState.completedSteps.filter(s => !stepsToRemove.has(s));
      runState.stepLogs = runState.stepLogs.slice(0, logIndex);
    } else {
      // Step was failed or only in completedSteps — remove both exact and base name
      runState.completedSteps = runState.completedSteps.filter(s => s !== stepName && s !== baseStepName);
    }
    runState.failedSteps = (runState.failedSteps || []).filter(s => s !== stepName && s !== baseStepName);

    // Adjust iteration state for the phase containing this step
    const configPath = await getRuntimeWorkflowConfigPath(runState.configFile);
    const content = await readFile(configPath, 'utf-8');
    const workflowConfig: WorkflowConfig = parse(content);
    for (const phase of workflowConfig.workflow.phases) {
      const phaseHasStep = phase.steps.some(s => s.name === baseStepName);
      if (phaseHasStep && phase.iteration?.enabled && runState.iterationStates[phase.name]) {
        const iterState = runState.iterationStates[phase.name];

        // Extract iteration number from step name (e.g. "提出设计方案-迭代2" → 2)
        const iterMatch = stepName.match(/-迭代(\d+)$/);
        let targetIter: number;

        if (iterMatch) {
          // Step name has explicit iteration suffix
          targetIter = parseInt(iterMatch[1], 10);
        } else {
          // Step name has no suffix - could be iteration 1 or a failed step from current iteration
          // Check if this step appears in stepLogs to determine actual iteration
          const stepLog = runState.stepLogs.find(l => l.stepName === stepName || l.stepName === baseStepName);
          if (stepLog) {
            // Find all logs with the same base step name to count iterations
            const sameStepLogs = runState.stepLogs.filter(l =>
              l.stepName === baseStepName || l.stepName.startsWith(`${baseStepName}-迭代`)
            );
            targetIter = sameStepLogs.length; // The iteration number is the count of attempts
          } else {
            // Not in logs yet, use current iteration state + 1 (next attempt)
            targetIter = Math.max(1, iterState.currentIteration + 1);
          }
        }

        // Check if we need to roll back the entire iteration or just remove specific steps
        // If the target step is the first step in the iteration, roll back the iteration
        // Otherwise, keep the iteration state and just remove the step from completed list
        const isFirstStepInIteration = logIndex >= 0 && (() => {
          // Find all steps in this iteration that come before the target step
          const iterSteps = runState.stepLogs.slice(0, logIndex).filter(l => {
            const match = l.stepName.match(/-迭代(\d+)$/);
            const stepIter = match ? parseInt(match[1], 10) : 1;
            return stepIter === targetIter;
          });
          return iterSteps.length === 0;
        })();

        if (isFirstStepInIteration) {
          // Roll back iteration state to just before the target iteration
          iterState.currentIteration = targetIter - 1;
          iterState.status = 'running';
          // Trim bugsFoundPerRound to only keep rounds before target
          if (iterState.bugsFoundPerRound) {
            iterState.bugsFoundPerRound = iterState.bugsFoundPerRound.slice(0, targetIter - 1);
          }
          // Reset consecutive clean rounds count
          iterState.consecutiveCleanRounds = 0;
        } else {
          // Keep iteration state, just mark as running to allow re-execution
          iterState.status = 'running';
          // Don't roll back currentIteration - we're in the middle of this iteration
        }
      }
    }

    // Clear session IDs for agents involved in removed steps so they start fresh
    // Also collect from workflow config for the target step (covers failed-only case)
    for (const phase of workflowConfig.workflow.phases) {
      for (const s of phase.steps) {
        if (s.name === baseStepName && s.agent) {
          removedStepAgents.add(s.agent);
        }
      }
    }
    // Clear session IDs in persisted agent state
    for (const pa of (runState.agents || [])) {
      if (removedStepAgents.has(pa.name)) {
        pa.sessionId = null;
      }
    }

    // Mark as stopped so resume() accepts it
    runState.status = 'stopped';
    runState.pendingCheckpoint = undefined;
    if (runState.workspaceGit?.stepDiffs?.length) {
      const removedIds = new Set((runState.stepLogs || []).slice(logIndex >= 0 ? logIndex : runState.stepLogs.length).map((log) => log.gitStepDiffId || `git-step-${log.id}`));
      runState.workspaceGit.stepDiffs = runState.workspaceGit.stepDiffs.filter((diff) => !removedIds.has(diff.id));
    }
    await saveRunState(runState);

    // Now delegate to normal resume
    await this.resume(runId);
  }

  private async executeWorkflowResume(workflowConfig: WorkflowConfig): Promise<void> {
    const completedSet = new Set(this.completedStepNames);
    console.log(`[resume] completedSet:`, [...completedSet]);

    for (const phase of workflowConfig.workflow.phases) {
      if (this.shouldStop) break;

      // Check if entire phase is already completed
      const phaseStepNames = phase.steps.map(s => s.name);
      const allPhaseCompleted = phaseStepNames.every(n => completedSet.has(n));
      // For iterative phases, also check iteration state — steps may be "completed" from round 1
      // but iteration itself may still need more rounds
      const iterState = phase.iteration?.enabled ? this.iterationStates.get(phase.name) : null;
      const iterDone = !iterState || iterState.status === 'completed' || iterState.status === 'escalated';
      console.log(`[resume] phase="${phase.name}" steps=[${phaseStepNames.join(', ')}] allCompleted=${allPhaseCompleted} iterative=${!!phase.iteration?.enabled} iterDone=${iterDone}`);
      if (allPhaseCompleted && iterDone) {
        this.emit('phase', {
          phase: phase.name,
          message: `跳过已完成阶段: ${phase.name}`,
          totalSteps: phase.steps.length,
          skipped: true,
        });
        continue;
      }

      this.currentPhase = phase.name;
      this.emit('phase', {
        phase: phase.name,
        message: `恢复阶段: ${phase.name}`,
        totalSteps: phase.steps.length,
      });
      await this.persistState();

      // If we were waiting at a checkpoint for this phase, go straight to checkpoint
      if (this.pendingCheckpoint && this.pendingCheckpoint.phase === phase.name) {
        // Skip re-execution, go directly to checkpoint dialog
      } else if (phase.iteration?.enabled) {
        // For iterative phases, check if we have saved iteration state
        const savedIter = this.iterationStates.get(phase.name);
        console.log(`[resume] iterState for "${phase.name}":`, savedIter ? JSON.stringify(savedIter) : 'none');
        if (savedIter && savedIter.status === 'completed') {
          this.emit('phase', {
            phase: phase.name,
            message: `跳过已完成迭代阶段: ${phase.name}`,
            totalSteps: phase.steps.length,
            skipped: true,
          });
          continue; // Already finished
        }
        // Resume iterative phase, skipping completed defender steps
        await this.executeIterativePhase(phase, workflowConfig, completedSet);
      } else {
        // Linear phase — skip completed steps
        for (let i = 0; i < phase.steps.length; i++) {
          if (this.shouldStop) break;
          const step = phase.steps[i];
          if (completedSet.has(step.name)) {
            this.emit('step', {
              step: step.name,
              agent: step.agent,
              message: `跳过已完成步骤: ${step.name}`,
              skipped: true,
            });
            continue;
          }
          await this.runStep(step, phase, workflowConfig, i);
          if (!this.lastStepSucceeded()) {
            throw new Error(`步骤 "${step.name}" 执行失败，阶段中止`);
          }
        }
      }

      // Skip checkpoint if phase was partially done before
      while (phase.checkpoint && !this.shouldStop) {
        this.pendingCheckpoint = {
          phase: phase.name,
          checkpoint: phase.checkpoint.name,
          message: phase.checkpoint.message,
          isIterativePhase: !!phase.iteration?.enabled,
        };
        this.emit('checkpoint', {
          ...this.pendingCheckpoint,
          requiresApproval: true,
        });
        await this.persistState();
        const action = await this.waitForApproval();
        this.pendingCheckpoint = null;
        if (action === 'iterate' && phase.iteration?.enabled) {
          await this.executeIterativePhase(phase, workflowConfig);
          // Check if iteration is still running (not completed/escalated)
          const iterState = this.iterationStates.get(phase.name);
          if (iterState && (iterState.status === 'completed' || iterState.status === 'escalated')) {
            // Iteration finished, show checkpoint one more time for final decision
            continue;
          }
          // Iteration still running, break out to avoid double checkpoint
          break;
        }
        break;
      }
    }
  }

  getInternalStatus(): string { return this.status; }
  getCurrentStep(): string | null { return this.currentStep; }

  getStatus(): any {
    return {
      status: this.status,
      statusReason: this.statusReason,
      runId: this.currentRunId,
      currentConfigFile: this.currentConfigFile,
      logs: this.logs,
      agents: this.agents,
      currentPhase: this.currentPhase,
      currentStep: this.currentStep,
      completedSteps: this.completedStepNames,
      failedSteps: this.failedStepNames,
      pendingLiveFeedback: this.liveFeedback.map((message, index) => ({
        id: `phase-feedback-${index}`,
        message,
        timestamp: new Date().toISOString(),
        status: this.interruptFlag ? 'interrupting' : 'queued',
        interrupt: this.interruptFlag,
      })),
      stepLogs: this.stepLogs,
      qualityChecks: this.qualityChecks,
      workflow: this.currentWorkflow,
      iterationStates: Object.fromEntries(this.iterationStates),
      workingDirectory: this.getWorkingDirectory(),
      workspaceGit: this.workflowGit || undefined,
      workflowFrontendSessionId: this._frontendSessionId || null,
    };
  }

  getIterationStates(): Map<string, IterationState> {
    return this.iterationStates;
  }

}

// 全局单例 — use globalThis to survive Next.js dev HMR
const globalForWorkflow = globalThis as unknown as { __workflowManager?: WorkflowManager };
export const workflowManager = globalForWorkflow.__workflowManager ??= new WorkflowManager();
