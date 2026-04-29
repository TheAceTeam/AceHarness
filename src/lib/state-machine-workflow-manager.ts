/**
 * 状态机工作流管理器
 * 支持跨阶段回退的动态流程控制
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, readdir, stat, mkdir, cp, rm, writeFile, copyFile } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { existsSync } from 'fs';
import { cpus } from 'os';
import { parse } from 'yaml';
import { resolveAgentModel } from './workflow-manager';
import { processManager } from './process-manager';
import type { EngineJsonResult } from './engines/engine-interface';
import { createRun, updateRun } from './run-store';
import {
  saveRunState, saveProcessOutput, saveStreamContent,
  loadRunState, loadStepOutputs,
  type PersistedRunState,
  type PersistedProcessInfo,
  type PersistedStepLog,
  type PersistedQualityCheck,
  type PersistedQualityCommandResult,
  type HumanQuestion,
  type HumanQuestionAnswer,
  type HumanAnswerContext,
} from './run-state-persistence';
import {
  appendWorkflowExperience,
  buildWorkflowExperiencePromptBlock,
  findRelevantWorkflowExperiences,
  saveWorkflowFinalReview,
  type WorkflowFinalReview,
} from './workflow-experience-store';
import type {
  StateMachineWorkflowConfig, StateMachineState, StateTransition,
  Issue, WorkflowStep, RoleConfig, TransitionCondition, SpecCodingDocument,
} from './schemas';
import { formatTimestamp } from './utils';
import { createEngine, getConfiguredEngine, type Engine, type EngineType } from './engines';
import { getEngineSkillsSubdir } from './engines/engine-config';
import type { EngineStreamEvent } from './engines/engine-interface';
import { getRuntimeAgentsDirPath, getRuntimeWorkflowConfigPath } from './runtime-configs';
import { getRuntimeSkillsDirPath } from './runtime-skills';
import { getWorkspaceRoot, getWorkspaceRunsDir } from './app-paths';
import { updateChatSessionCreationBinding, updateChatSessionWorkflowBinding } from './chat-persistence';
import {
  DEFAULT_SUPERVISOR_NAME,
  ensureDefaultSupervisorConfig,
  resolveWorkflowSupervisorAgent,
} from './default-supervisor';
import {
  appendSpecCodingRevision,
  appendSupervisorSpecCodingRevision,
  cloneSpecCodingForRun,
  loadLatestCreationSessionByFilename,
  markSpecCodingStateStatus,
  normalizeSpecCodingDocument,
  updateSpecCodingTaskStatuses,
} from './spec-coding-store';
import { appendMemoryEntries } from './workflow-memory-store';
import { upsertRelationshipSignal } from './agent-relationship-store';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
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
  lastOutput: string;
  summary: string;
}

export interface StateExecutionResult {
  stateName: string;
  verdict: 'pass' | 'conditional_pass' | 'fail';
  issues: Issue[];
  stepOutputs: string[];
  summary: string;
}

export interface StateTransitionRecord {
  from: string;
  to: string;
  reason: string;
  issues: Issue[];
  timestamp: string;
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

function extractTaggedBlock(text: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i');
  return text.match(pattern)?.[1]?.trim() || null;
}

function extractSpecTasksBlock(text: string): string | null {
  return extractTaggedBlock(text, 'spec-tasks');
}

function stripSpecTasksBlocks(text: string): string {
  return text.replace(/<spec-tasks>[\s\S]*?<\/spec-tasks>/gi, '');
}

function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function compactStepConclusion(raw: string): string {
  const tagged = extractTaggedBlock(raw, 'step-conclusion');
  if (tagged) return tagged;

  const text = stripSpecTasksBlocks(stripNonAiStreamArtifacts(raw))
    .trim();
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const tail = lines.slice(-30).join('\n').trim();
  return tail.length > 4000 ? tail.slice(-4000).trim() : tail;
}

export class StateMachineWorkflowManager extends EventEmitter {
  private status: 'idle' | 'preparing' | 'running' | 'completed' | 'failed' | 'stopped' = 'idle';
  private statusReason: string | null = null;
  private shouldStop = false;
  private currentState: string | null = null;
  private currentRunId: string | null = null;
  private currentConfigFile: string = '';
  private currentRequirements: string = '';
  private agents: AgentState[] = [];
  private agentConfigs: RoleConfig[] = [];
  private stateHistory: StateTransitionRecord[] = [];
  private issueTracker: Issue[] = [];
  private transitionCount = 0;
  /** Track self-transitions per state for circuit breaking */
  private selfTransitionCounts: Map<string, number> = new Map();
  private runStartTime: string | null = null;
  private runEndTime: string | null = null;
  private pendingForceTransition: string | null = null;
  private pendingForceInstruction: string | null = null;
  /** Tracks human approval context for crash recovery */
  private pendingApprovalInfo: {
    suggestedNextState: string;
    availableStates: string[];
    result: any;
    supervisorAdvice?: string;
  } | null = null;
  private globalContext: string = '';
  private stateContexts: Map<string, string> = new Map();
  private workspaceSkillsCache: string = '';
  private workspaceSkillsCacheProjectRoot: string = '';
  private workspaceSkillNames: Set<string> = new Set();
  /** Skills copied to workspace that need cleanup on finish */
  private copiedSkills: { dir: string; indexCopied: boolean } | null = null;
  private currentStep: string | null = null;
  private completedSteps: string[] = [];
  private currentProcesses: PersistedProcessInfo[] = [];
  private currentSupervisorAgent: string = DEFAULT_SUPERVISOR_NAME;
  private latestSupervisorReview: {
    type: 'state-review' | 'checkpoint-advice' | 'chat-revision' | 'human-question';
    stateName: string;
    content: string;
    timestamp: string;
    affectedArtifacts?: string[];
    impact?: string[];
  } | null = null;
  private humanQuestions: HumanQuestion[] = [];
  private pendingHumanQuestionId: string | null = null;
  private humanAnswersContext: HumanAnswerContext[] = [];
  private humanQuestionWaiters = new Map<string, (question: HumanQuestion | null) => void>();
  private currentRunSpecCoding: SpecCodingDocument | null = null;
  private liveSpecCodingTaskBlocksByProcess: Map<string, string> = new Map();
  private supervisorFlow: { type: string; from: string; to: string; question?: string; method?: string; round: number; timestamp: string; stateName?: string }[] = [];
  /** Agent 工作流：追踪 Agent 之间的信息传递 */
  private agentFlow: {
    id: string;
    type: 'stream' | 'request' | 'response' | 'supervisor';
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }[] = [];
  private stepLogs: PersistedStepLog[] = [];
  private qualityChecks: PersistedQualityCheck[] = [];
  /** Current engine instance (Kiro CLI, etc.) */
  private currentEngine: Engine | null = null;
  /** Current engine type */
  private engineType: EngineType = 'claude-code';
  /** Optional frontend chat session to auto-bind with this run */
  public _frontendSessionId?: string;

  /** Get the workspace skills subdir based on current engine type */
  private get workspaceSkillsSubdir(): string {
    return getEngineSkillsSubdir(this.engineType);
  }

  private resolveProjectRootPath(projectRoot?: string | null): string {
    const baseDir = this._userPersonalDir || getWorkspaceRoot();
    return projectRoot ? resolve(baseDir, projectRoot) : baseDir;
  }
  constructor() {
    super();
  }

  async loadAgentConfigs(): Promise<void> {
    const agentsDir = await getRuntimeAgentsDirPath();
    this.agentConfigs = [];
    try {
      const files = await readdir(agentsDir);
      for (const file of files) {
        if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
        try {
          const content = await readFile(resolve(agentsDir, file), 'utf-8');
          const config = parse(content) as RoleConfig;
          if (config?.name) {
            this.agentConfigs.push(config);
          }
        } catch (e) {
        }
      }
    } catch {
    }
    this.agentConfigs = ensureDefaultSupervisorConfig(this.agentConfigs);
  }

  /**
   * Load and cache workspace skills from <engine-config>/skills/
   */
  private async loadWorkspaceSkills(projectRoot: string): Promise<string> {
    if (this.workspaceSkillsCache && this.workspaceSkillsCacheProjectRoot === projectRoot) {
      return this.workspaceSkillsCache;
    }

    // Try project-level first, then server-level skills directory
    const candidates = [
      join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir),
      await getRuntimeSkillsDirPath(),
    ];

    for (const skillsDir of candidates) {
      try {
        const skillIndex = resolve(skillsDir, 'SKILL.md');
        const indexContent = await readFile(skillIndex, 'utf-8');

        this.workspaceSkillNames.clear();
        try {
          const entries = await readdir(skillsDir);
          for (const entry of entries) {
            const entryPath = resolve(skillsDir, entry);
            const entryStat = await stat(entryPath).catch(() => null);
            if (entryStat?.isDirectory()) {
              this.workspaceSkillNames.add(entry);
            }
          }
        } catch { /* ignore */ }

        const result = indexContent.trim();
        this.workspaceSkillsCache = result;
        this.workspaceSkillsCacheProjectRoot = projectRoot;
        return result;
      } catch { /* try next candidate */ }
    }

    this.workspaceSkillsCache = '';
    this.workspaceSkillsCacheProjectRoot = projectRoot;
    this.workspaceSkillNames.clear();
    return '';
  }

  /**
   * Load a single skill's content from project or system skills directory
   */
  private async loadSkillContent(skillName: string, projectRoot: string): Promise<string | null> {
    const projectSkillPath = join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir, skillName, 'SKILL.md');
    try {
      return await readFile(projectSkillPath, 'utf-8');
    } catch { /* not found in project */ }

    const systemSkillPath = join(await getRuntimeSkillsDirPath(), skillName, 'SKILL.md');
    try {
      return await readFile(systemSkillPath, 'utf-8');
    } catch { /* not found in system */ }

    return null;
  }

  /**
   * Load step-level and workflow-level skills, returning formatted prompt content
   */
  private async loadAdditionalSkills(skillNames: string[], projectRoot: string): Promise<string> {
    const unique = [...new Set(skillNames)].filter(n => !this.workspaceSkillNames.has(n));
    if (unique.length === 0) return '';

    const loaded: { name: string; content: string }[] = [];
    for (const name of unique) {
      const content = await this.loadSkillContent(name, projectRoot);
      if (content) loaded.push({ name, content });
    }
    if (loaded.length === 0) return '';

    let result = `### 步骤/工作流指定 Skills\n\n`;
    for (const skill of loaded) {
      result += `#### ${skill.name}\n\n${skill.content}\n\n---\n\n`;
    }
    return result;
  }

  /**
   * Copy skills from server skills/ directory to workspace <engine-config>/skills/
   * so that AI agents can discover and read them naturally.
   */
  private async syncSkillsToWorkspace(config: StateMachineWorkflowConfig): Promise<void> {
    const projectRoot = config.context?.projectRoot;
    if (!projectRoot) return;

    const serverSkillsDir = await getRuntimeSkillsDirPath();
    const workspaceSkillsDir = join(this.resolveProjectRootPath(projectRoot), this.workspaceSkillsSubdir);

    if (!existsSync(serverSkillsDir)) return;

    // Collect all skill names needed: context.skills + all step.skills
    const needed = new Set<string>();
    if (config.context?.skills) config.context.skills.forEach(s => needed.add(s));
    for (const state of config.workflow.states) {
      for (const step of state.steps) {
        if (step.skills) step.skills.forEach(s => needed.add(s));
      }
    }
    if (needed.size === 0) {
      // 没有指定 skills，symlink 整个 skills 目录（像 chat 一样）
      if (!existsSync(workspaceSkillsDir)) {
        try {
          const { symlinkSync } = await import('fs');
          symlinkSync(serverSkillsDir, workspaceSkillsDir);
        } catch { /* ignore */ }
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
      if (existsSync(dst)) continue;
      try {
        const { symlinkSync } = await import('fs');
        symlinkSync(src, dst);
        linkedNames.push(skillName);
        console.log(`[SM-Skills] 已链接 skill "${skillName}" → ${dst}`);
      } catch (e) {
        try {
          await cp(src, dst, { recursive: true, force: true });
          linkedNames.push(skillName);
          console.log(`[SM-Skills] 已复制 skill "${skillName}" → ${dst}`);
        } catch (e2) {
          console.warn(`[SM-Skills] 同步 skill "${skillName}" 失败:`, e2);
        }
      }
    }

    if (linkedNames.length > 0) {
      this.copiedSkills = { dir: workspaceSkillsDir, indexCopied: false };
      (this.copiedSkills as any).names = linkedNames;
      (this.copiedSkills as any).dirExistedBefore = dirExistedBefore;
    }
  }

  /**
   * Remove skills that were linked/copied to workspace during syncSkillsToWorkspace
   */
  private async cleanupWorkspaceSkills(): Promise<void> {
    if (!this.copiedSkills) return;
    const { dir } = this.copiedSkills;
    const names: string[] = (this.copiedSkills as any).names || [];
    const dirExistedBefore: boolean = (this.copiedSkills as any).dirExistedBefore ?? true;

    for (const name of names) {
      const dst = resolve(dir, name);
      try {
        await rm(dst, { recursive: true, force: true });
        console.log(`[SM-Skills] 已清理 skill "${name}"`);
      } catch { /* ignore */ }
    }

    if (!dirExistedBefore) {
      try {
        const remaining = await readdir(dir);
        if (remaining.length === 0) {
          await rm(dir, { recursive: true, force: true });
          const configDir = resolve(dir, '..');
          const configRemaining = await readdir(configDir);
          if (configRemaining.length === 0) {
            await rm(configDir, { recursive: true, force: true });
          }
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
          this.currentStep = `复制工作目录（建立清单：已扫描 ${scannedFiles} 文件）`;
          this.emit('status', {
            status: 'preparing',
            message: `准备中：建立清单，已扫描 ${scannedFiles} 文件`,
            runId,
            startTime: this.runStartTime,
            currentPhase: '准备阶段',
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
      this.currentStep = stepText;
      this.emit('status', {
        status: 'preparing',
        message: `准备中：${stepText}`,
        runId,
        startTime: this.runStartTime,
        currentPhase: '准备阶段',
        currentStep: this.currentStep,
        currentConfigFile: this.currentConfigFile,
      });
      if (force) {
        await reportStatus(`准备中：${stepText}`, this.currentStep);
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

  getStatus() {
    const supervisorAgent = this.agents.find((agent) => agent.name === this.currentSupervisorAgent);
    const preparingPhase = this.status === 'preparing' ? '准备阶段' : null;
    const runSpecCoding = this.currentRunSpecCoding
      ? normalizeSpecCodingDocument(this.currentRunSpecCoding)
      : null;
    return {
      status: this.status,
      statusReason: this.statusReason,
      runId: this.currentRunId,
      currentState: this.currentState,
      currentPhase: this.currentState || preparingPhase, // alias for frontend compatibility
      currentStep: this.currentStep,
      completedSteps: this.completedSteps,
      currentConfigFile: this.currentConfigFile,
      agents: this.agents,
      stateHistory: this.stateHistory,
      issueTracker: this.issueTracker,
      transitionCount: this.transitionCount,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.stateContexts),
      supervisorFlow: this.supervisorFlow,
      agentFlow: this.agentFlow,
      stepLogs: this.stepLogs,
      workingDirectory: this.getWorkingDirectory(),
      supervisorAgent: this.currentSupervisorAgent,
      supervisorSessionId: supervisorAgent?.sessionId || null,
      attachedAgentSessions: Object.fromEntries(
        this.agents
          .filter((agent) => Boolean(agent.sessionId))
          .map((agent) => [agent.name, agent.sessionId as string])
      ),
      latestSupervisorReview: this.latestSupervisorReview,
      humanQuestions: this.humanQuestions,
      pendingHumanQuestionId: this.pendingHumanQuestionId,
      pendingHumanQuestion: this.getPendingHumanQuestion(),
      humanAnswersContext: this.humanAnswersContext,
      qualityChecks: this.qualityChecks,
      runSpecCoding,
    };
  }

  async applySupervisorChatSpecCodingRevision(input: {
    supervisorAgent: string;
    summary: string;
    content: string;
    affectedArtifacts?: string[];
    impact?: string[];
  }): Promise<SpecCodingDocument | null> {
    if (!this.currentRunId || !this.currentRunSpecCoding) return null;

    this.currentRunSpecCoding = appendSpecCodingRevision(this.currentRunSpecCoding, {
      summary: input.summary,
      createdBy: input.supervisorAgent,
      status: this.currentRunSpecCoding.status,
      progressSummary: input.summary,
    });
    this.latestSupervisorReview = {
      type: 'chat-revision',
      stateName: this.currentState || '全局',
      content: input.content,
      timestamp: new Date().toISOString(),
      affectedArtifacts: input.affectedArtifacts || [],
      impact: input.impact || [],
    };
    await this.persistState();
    this.emit('supervisor-review', this.latestSupervisorReview);
    return this.currentRunSpecCoding;
  }

  async start(
    configFile: string,
    requirementsOrChecks?: string | PersistedQualityCheck[],
    maybePreflightChecks?: PersistedQualityCheck[],
  ): Promise<void> {
    if (this.status === 'running' || this.status === 'preparing') {
      throw new Error('工作流已在运行中');
    }

    try {
      const requirements = typeof requirementsOrChecks === 'string' ? requirementsOrChecks : undefined;
      const preflightChecks = Array.isArray(requirementsOrChecks)
        ? requirementsOrChecks
        : (maybePreflightChecks || []);
      this.status = 'preparing';
      this.shouldStop = false;
      this.stateHistory = [];
      this.issueTracker = [];
      this.transitionCount = 0;
      this.selfTransitionCounts = new Map();
      this.completedSteps = [];
      this.supervisorFlow = [];
      this.agentFlow = [];
      this.stepLogs = [];
      this.qualityChecks = [...preflightChecks];
      this.currentState = null;
      this.currentSupervisorAgent = DEFAULT_SUPERVISOR_NAME;
      this.latestSupervisorReview = null;
      this.currentRunSpecCoding = null;
      this.runStartTime = new Date().toISOString();
      this.currentConfigFile = configFile;
      this.isolatedDir = null;
      this.currentProjectRoot = null;

      // Clear stale in-memory flags from previous run
      this.pendingForceTransition = null;
      this.pendingForceInstruction = null;
      this.pendingApprovalInfo = null;
      this.humanQuestions = [];
      this.pendingHumanQuestionId = null;
      this.humanAnswersContext = [];
      this.humanQuestionWaiters.clear();
      this.interruptFlag = false;
      this.feedbackInterrupt = false;
      this.liveFeedback = [];

      // Load config
      const configPath = await getRuntimeWorkflowConfigPath(configFile);
      const configContent = await readFile(configPath, 'utf-8');
      const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
      this.currentRequirements = requirements || workflowConfig.context?.requirements || '';
      this.currentSupervisorAgent = resolveWorkflowSupervisorAgent(workflowConfig);
      // Resolve projectRoot to absolute path relative to user's personal dir
      this.currentProjectRoot = workflowConfig.context?.projectRoot
        ? this.resolveProjectRootPath(workflowConfig.context.projectRoot)
        : null;

      if (workflowConfig.workflow.mode !== 'state-machine') {
        throw new Error('配置文件不是状态机模式');
      }

      // === Create run FIRST so frontend can see it immediately ===
      const totalSteps = workflowConfig.workflow.states.reduce(
        (sum, s) => sum + s.steps.length, 0
      );
      const runId = `run-${formatTimestamp()}`;
      this.currentRunId = runId;

      await createRun({
        id: runId,
        configFile,
        configName: workflowConfig.workflow.name,
        startTime: this.runStartTime,
        endTime: null,
        status: 'preparing',
        currentPhase: null,
        totalSteps,
        completedSteps: 0,
      });

      this.emit('status', {
        status: 'preparing',
        message: '准备中...',
        runId,
        startTime: this.runStartTime,
        currentPhase: '准备阶段',
        currentStep: '初始化运行上下文',
        currentConfigFile: this.currentConfigFile,
      });
      this.currentStep = '初始化运行上下文';
      await this.persistState();

      const creationSession = await loadLatestCreationSessionByFilename(configFile).catch(() => null);
      if (creationSession?.specCoding) {
        this.currentRunSpecCoding = cloneSpecCodingForRun(creationSession.specCoding, {
          runId,
          filename: configFile,
        });
        await this.persistState();
      }

      const reportPreparingProgress = async (message: string, step: string) => {
        this.currentStep = step;
        this.emit('status', {
          status: 'preparing',
          message,
          runId,
          startTime: this.runStartTime,
          currentPhase: '准备阶段',
          currentStep: this.currentStep,
          currentConfigFile: this.currentConfigFile,
        });
        await this.persistState();
      };

      const workspaceMode = workflowConfig.context?.workspaceMode || 'isolated-copy';

      // === Preparing phase: directory isolation (cp for independence) ===
      if (workspaceMode === 'isolated-copy' && this._userPersonalDir && workflowConfig.context?.projectRoot) {
        await reportPreparingProgress('准备中：复制工作目录...', '复制工作目录');
        // Resolve projectRoot relative to personalDir or runtime root, not install cwd
        const srcDir = this.resolveProjectRootPath(workflowConfig.context.projectRoot);
        if (this.shouldStop) return;
        if (!existsSync(srcDir)) {
          this.emit('log', { message: `项目目录不存在: ${srcDir}，跳过目录隔离` });
        } else {
          const isoDir = resolve(this._userPersonalDir, runId);
          try {
            await mkdir(isoDir, { recursive: true });
            // Persist target working directory early so cleanup can find it
            this.isolatedDir = isoDir;
            this.currentProjectRoot = isoDir;
            await this.persistState();
            await this.copyDirectoryWithProgress(srcDir, isoDir, runId, reportPreparingProgress);
            if (this.shouldStop) {
              // Stopped during copy — clean up incomplete dir
              await rm(isoDir, { recursive: true, force: true }).catch(() => {});
              return;
            }
            workflowConfig.context.projectRoot = isoDir;
          } catch (e: any) {
            if (this.shouldStop) return;
            this.isolatedDir = null;
            this.emit('log', { message: `目录隔离复制失败: ${e.message}，使用原目录` });
          }
        }
      }

      if (this.shouldStop) return;

      // === Preparing phase: load agents, init engine, sync skills ===
      await reportPreparingProgress('准备中：加载 Agent 配置...', '加载 Agent 配置');
      await this.loadAgentConfigs();
      this.ensureSupervisorAgentExists(workflowConfig);
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：构建 Agent 视图...', '构建 Agent 视图');
      this.initializeAgents(workflowConfig);
      await reportPreparingProgress('准备中：初始化执行引擎...', '初始化执行引擎');
      await this.initializeEngine(workflowConfig.context?.engine);
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：同步 Skills...', '同步 Skills');
      await this.syncSkillsToWorkspace(workflowConfig);

      // Try to load existing state (for continuing previous runs)
      const existingState = await loadRunState(runId);
      if (existingState) {
        this.stateHistory = (existingState.stateHistory || []) as StateTransitionRecord[];
        this.issueTracker = (existingState.issueTracker || []) as Issue[];
        this.transitionCount = existingState.transitionCount || 0;
        this.completedSteps = existingState.completedSteps || [];
        const validStates = new Set((workflowConfig.workflow.states || []).map((s) => s.name));
        const restoredState = existingState.currentState;
        this.currentState = restoredState && validStates.has(restoredState) ? restoredState : null;
        this.runStartTime = existingState.startTime;
        this.latestSupervisorReview = existingState.latestSupervisorReview || this.latestSupervisorReview;
        this.humanQuestions = existingState.humanQuestions || [];
        this.pendingHumanQuestionId = existingState.pendingHumanQuestionId || existingState.pendingCheckpoint?.humanQuestionId || null;
        this.humanAnswersContext = existingState.humanAnswersContext || [];
        this.currentRunSpecCoding = existingState.runSpecCoding
          ? normalizeSpecCodingDocument(existingState.runSpecCoding)
          : this.currentRunSpecCoding;
      }

      // === Switch to running ===
      this.status = 'running';
      this.currentStep = null;
      this.emit('status', {
        status: 'running',
        message: '状态机工作流已启动',
        runId,
        startTime: this.runStartTime,
        endTime: this.runEndTime,
        currentConfigFile: this.currentConfigFile,
        workingDirectory: this.getWorkingDirectory(),
      });
      await this.persistState();

      await this.executeStateMachine(workflowConfig, this.currentRequirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
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
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.shouldStop = true;
    this.status = 'stopped';
    this.emit('status', {
      status: 'stopped',
      message: '工作流已停止',
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Kill any running child processes immediately
    const currentProcId = this.currentProcesses?.[0]?.id;
    if (currentProcId) {
      const proc = processManager.getProcessRaw(currentProcId);
      if (proc?.childProcess) {
        try { proc.childProcess.kill('SIGTERM'); } catch { /* already dead */ }
        proc.status = 'killed';
        proc.endTime = new Date();
      } else if (this.currentEngine) {
        this.currentEngine.cancel();
        if (proc) { proc.status = 'killed'; proc.endTime = new Date(); }
      }
    }

    await this.finalizeRun('stopped');
  }

  forceTransition(targetState: string, instruction?: string): void {
    if (this.status !== 'running') {
      throw new Error('工作流未在运行中');
    }
    this.pendingForceTransition = targetState;
    if (instruction) {
      this.pendingForceInstruction = instruction;
    }
    this.emit('force-transition', { targetState, from: this.currentState, instruction });

    // Kill the running process so the main loop can pick up the forced transition immediately
    const currentProcId = this.currentProcesses?.[0]?.id;
    const currentStepId = this.currentProcesses?.[0]?.stepId;
    if (currentProcId || currentStepId) {
      const allProcs = processManager.getAllProcesses();
      const running = allProcs.find(
        (p: any) => (p.status === 'running' || p.status === 'queued') && (
          (currentStepId && p.stepId === currentStepId) ||
          (currentProcId && p.id === currentProcId)
        )
      );
      if (running) {
        if (!processManager.killProcess(running.id) && this.currentEngine) {
          this.currentEngine.cancel();
          const rawProc = processManager.getProcessRaw(running.id);
          if (rawProc) { rawProc.status = 'killed'; rawProc.endTime = new Date(); }
        }
      }
    }
  }

  setContext(scope: 'global' | 'phase', context: string, stateName?: string): void {
    if (scope === 'global') {
      this.globalContext = context;
    } else if (scope === 'phase' && stateName) {
      // For state machine, 'phase' refers to 'state'
      this.stateContexts.set(stateName, context);
    }
  }

  getContexts(): { globalContext: string; phaseContexts: Record<string, string> } {
    return {
      globalContext: this.globalContext,
      phaseContexts: Object.fromEntries(this.stateContexts),
    };
  }

  getHumanQuestions(): HumanQuestion[] {
    return [...this.humanQuestions];
  }

  getPendingHumanQuestion(): HumanQuestion | null {
    if (!this.pendingHumanQuestionId) return null;
    return this.humanQuestions.find((question) => question.id === this.pendingHumanQuestionId && question.status === 'unanswered') || null;
  }

  private formatHumanQuestionAnswer(answer: HumanQuestionAnswer): string {
    const parts: string[] = [];
    if (answer.selectedState) parts.push(`选择状态: ${answer.selectedState}`);
    if (answer.selectedOption) parts.push(`选择: ${answer.selectedOption}`);
    if (answer.selectedOptions?.length) parts.push(`选择: ${answer.selectedOptions.join('、')}`);
    if (answer.text) parts.push(answer.text);
    if (answer.instruction) parts.push(`附加指令: ${answer.instruction}`);
    return parts.filter(Boolean).join('\n') || '已确认';
  }

  async createHumanQuestion(input: Partial<HumanQuestion> & {
    title: string;
    message: string;
    answerSchema: HumanQuestion['answerSchema'];
  }): Promise<HumanQuestion> {
    if (!this.currentRunId) {
      throw new Error('当前没有运行中的工作流');
    }

    const existingPending = this.getPendingHumanQuestion();
    if (existingPending && existingPending.source?.type === input.source?.type && input.kind === existingPending.kind) {
      return existingPending;
    }

    const supervisorAgent = this.agents.find((agent) => agent.name === this.currentSupervisorAgent);
    const question: HumanQuestion = {
      id: input.id || `hq-${Date.now()}-${randomUUID().slice(0, 8)}`,
      runId: this.currentRunId,
      configFile: this.currentConfigFile,
      status: 'unanswered',
      kind: input.kind || 'clarification',
      title: input.title,
      message: input.message,
      supervisorAdvice: input.supervisorAdvice,
      createdAt: input.createdAt || new Date().toISOString(),
      supervisorAgent: input.supervisorAgent || this.currentSupervisorAgent,
      supervisorSessionId: input.supervisorSessionId ?? supervisorAgent?.sessionId ?? null,
      currentState: input.currentState ?? this.currentState,
      previousState: input.previousState,
      suggestedNextState: input.suggestedNextState,
      availableStates: input.availableStates,
      result: input.result,
      requiresWorkflowPause: input.requiresWorkflowPause ?? true,
      answerSchema: input.answerSchema,
      source: input.source || { type: 'manual' },
    };

    this.humanQuestions = [question, ...this.humanQuestions.filter((item) => item.id !== question.id)].slice(0, 100);
    if (question.requiresWorkflowPause) {
      this.pendingHumanQuestionId = question.id;
    }
    this.latestSupervisorReview = {
      type: 'human-question',
      stateName: this.currentState || '全局',
      content: `${question.title}\n${question.message}`,
      timestamp: question.createdAt,
    };
    await this.persistState();
    this.emit('human-question-required', { question, humanQuestions: this.humanQuestions });
    this.emit('status', { status: this.status, pendingHumanQuestion: question, currentConfigFile: this.currentConfigFile });
    return question;
  }

  async answerHumanQuestion(questionId: string, answer: HumanQuestionAnswer): Promise<HumanQuestion> {
    const index = this.humanQuestions.findIndex((question) => question.id === questionId);
    if (index < 0) {
      throw new Error('找不到待回答的 Supervisor 消息');
    }

    const now = new Date().toISOString();
    const existing = this.humanQuestions[index];
    if (existing.status === 'answered') return existing;
    const updated: HumanQuestion = {
      ...existing,
      status: 'answered',
      answer,
      answeredAt: now,
    };
    this.humanQuestions[index] = updated;
    if (this.pendingHumanQuestionId === questionId) {
      this.pendingHumanQuestionId = null;
    }

    const answerText = this.formatHumanQuestionAnswer(answer);
    this.humanAnswersContext = [
      ...this.humanAnswersContext,
      {
        questionId,
        title: existing.title,
        question: existing.message,
        answer: answerText,
        instruction: answer.instruction,
        answeredAt: now,
      },
    ].slice(-20);

    if (existing.answerSchema.type === 'approval-transition') {
      this.pendingForceTransition = answer.selectedState || existing.suggestedNextState || existing.availableStates?.[0] || null;
      this.pendingForceInstruction = answer.instruction || answer.text || null;
    }

    await this.persistState();
    this.emit('human-question-answered', { question: updated, answer });
    this.emit('status', { status: this.status, pendingHumanQuestion: null, currentConfigFile: this.currentConfigFile });
    const waiter = this.humanQuestionWaiters.get(questionId);
    if (waiter) {
      this.humanQuestionWaiters.delete(questionId);
      waiter(updated);
    }
    return updated;
  }

  private async waitForHumanQuestionAnswer(questionId: string): Promise<HumanQuestion | null> {
    const existing = this.humanQuestions.find((question) => question.id === questionId);
    if (!existing || existing.status !== 'unanswered') return existing || null;
    return new Promise((resolve) => {
      this.humanQuestionWaiters.set(questionId, resolve);
      const checkInterval = setInterval(() => {
        const question = this.humanQuestions.find((item) => item.id === questionId) || null;
        if (!question || question.status !== 'unanswered' || this.pendingForceTransition || this.shouldStop) {
          clearInterval(checkInterval);
          this.humanQuestionWaiters.delete(questionId);
          resolve(question);
        }
      }, 500);
    });
  }

  private async waitForHumanApproval(): Promise<void> {
    const pendingQuestion = this.getPendingHumanQuestion();
    if (pendingQuestion) {
      await this.waitForHumanQuestionAnswer(pendingQuestion.id);
      return;
    }

    // Wait for human to call forceTransition
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.pendingForceTransition || this.shouldStop) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 500); // Check every 500ms
    });
  }

  private async finalizeRun(status: 'completed' | 'failed' | 'stopped') {
    if (!this.currentRunId) return;
    this.runEndTime = new Date().toISOString();

    try {
      await this.finalizeSupervisorOutputs(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit('log', { message: `Supervisor 结算输出失败: ${message}` });
    }

    // Cleanup copied skills from workspace
    await this.cleanupWorkspaceSkills();

    try {
      const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        currentPhase: this.currentState,
        completedSteps,
      });

      await this.persistState(status);
    } catch (err) {
    }

    this.status = 'idle';
  }

  private async persistState(finalStatus?: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.currentRunId) return;
    try {
      if (this.currentRunSpecCoding) {
        this.currentRunSpecCoding = normalizeSpecCodingDocument(this.currentRunSpecCoding);
      }
      const statusToPersist = finalStatus || (
        this.shouldStop ? 'stopped' : (this.status === 'idle' ? 'completed' : this.status)
      );
      const preparingPhase = statusToPersist === 'preparing' ? '准备阶段' : null;
      const attachedAgentSessions = Object.fromEntries(
        this.agents
          .filter((agent) => Boolean(agent.sessionId))
          .map((agent) => [agent.name, agent.sessionId as string])
      );
      const supervisorSessionId = this.agents.find((agent) => agent.name === this.currentSupervisorAgent)?.sessionId || null;
      await saveRunState({
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        status: statusToPersist as any,
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: finalStatus ? this.runEndTime : null,
        currentPhase: this.currentState || preparingPhase,
        currentStep: this.currentStep,
        completedSteps: this.completedSteps,
        failedSteps: [],
        stepLogs: [...this.stepLogs],
        agents: this.agents.map(a => ({
          name: a.name,
          team: a.team,
          model: a.model,
          status: a.status,
          completedTasks: a.completedTasks,
          tokenUsage: a.tokenUsage,
          costUsd: a.costUsd,
          sessionId: a.sessionId,
          iterationCount: 0,
          summary: a.summary,
        })),
        iterationStates: {},
        processes: this.currentProcesses,
        mode: 'state-machine',
        currentState: this.currentState,
        transitionCount: this.transitionCount,
        maxTransitions: 50,
        stateHistory: this.stateHistory,
        issueTracker: this.issueTracker,
        requirements: this.currentRequirements,
        globalContext: this.globalContext,
        phaseContexts: Object.fromEntries(this.stateContexts),
        supervisorFlow: this.supervisorFlow,
        agentFlow: this.agentFlow as any,
        // 只在真正等待人工审批时才写入 pendingCheckpoint；已完成/失败/停止时清除
        ...(!finalStatus && this.currentState === '__human_approval__' && this.pendingApprovalInfo ? {
          pendingCheckpoint: {
            phase: '__human_approval__',
            checkpoint: 'human-approval',
            message: `等待人工审查，建议下一状态: ${this.pendingApprovalInfo.suggestedNextState}`,
            isIterativePhase: false,
            suggestedNextState: this.pendingApprovalInfo.suggestedNextState,
            availableStates: this.pendingApprovalInfo.availableStates,
            supervisorAdvice: this.pendingApprovalInfo.supervisorAdvice,
            result: this.pendingApprovalInfo.result,
            humanQuestionId: this.pendingHumanQuestionId || undefined,
            humanQuestion: this.getPendingHumanQuestion() || undefined,
          },
        } : {}),
        workingDirectory: this.getWorkingDirectory() || undefined,
        supervisorAgent: this.currentSupervisorAgent,
        supervisorSessionId,
        attachedAgentSessions,
        latestSupervisorReview: this.latestSupervisorReview,
        humanQuestions: this.humanQuestions,
        pendingHumanQuestionId: this.pendingHumanQuestionId,
        humanAnswersContext: this.humanAnswersContext,
        qualityChecks: this.qualityChecks,
        runSpecCoding: this.currentRunSpecCoding,
      });
      if (this._frontendSessionId) {
        await updateChatSessionWorkflowBinding(this._frontendSessionId, {
          configFile: this.currentConfigFile,
          runId: this.currentRunId,
          supervisorAgent: this.currentSupervisorAgent,
          supervisorSessionId,
          attachedAgentSessions,
        });
        await updateChatSessionCreationBinding(this._frontendSessionId, {
          filename: this.currentConfigFile,
          status: 'run-bound',
        });
      }
    } catch (err) {
    }
  }

  private extractJsonObject(raw: string): any | null {
    const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i);
    const candidate = fencedMatch?.[1] || raw;
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {
      return null;
    }
  }

  private buildFallbackFinalReview(status: 'completed' | 'failed' | 'stopped'): WorkflowFinalReview {
    const generatedAt = new Date().toISOString();
    return {
      runId: this.currentRunId || '',
      configFile: this.currentConfigFile,
      workflowName: undefined,
      projectRoot: this.getWorkingDirectory() || undefined,
      workflowMode: 'state-machine',
      supervisorAgent: this.currentSupervisorAgent,
      status,
      summary: `工作流以 ${status} 状态结束。建议结合运行记录进一步复盘。`,
      nextFocus: this.issueTracker.slice(0, 3).map((issue) => `${issue.type}: ${issue.description}`),
      experience: this.issueTracker.slice(0, 3).map((issue) => `记录 ${issue.type} 类问题的排查与修复路径，避免重复出现。`),
      scoreCards: this.agents.map((agent) => ({
        agent: agent.name,
        score: agent.status === 'completed' ? 85 : agent.status === 'failed' ? 55 : 70,
        strengths: agent.completedTasks > 0 ? ['完成了分配步骤'] : [],
        weaknesses: agent.status !== 'completed' ? ['结果仍需进一步验证'] : [],
      })),
      agentNames: this.agents.map((agent) => agent.name),
      keywords: [],
      generatedAt,
    };
  }

  private async finalizeSupervisorOutputs(status: 'completed' | 'failed' | 'stopped'): Promise<void> {
    if (!this.currentRunId || !this.currentConfigFile) return;
    const configPath = await getRuntimeWorkflowConfigPath(this.currentConfigFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    const supervisorConfig = workflowConfig.workflow.supervisor;
    if (supervisorConfig?.enabled === false) return;

    const scoringEnabled = supervisorConfig?.scoringEnabled !== false;
    const experienceEnabled = supervisorConfig?.experienceEnabled !== false;
    if (!scoringEnabled && !experienceEnabled) return;

    const summaryPrompt = [
      '你是 ACEHarness 的工作流指挥官，请输出本次工作流的结算结果。',
      '请严格输出 JSON，不要附加其他说明。',
      'JSON 结构：',
      '{"summary":"", "nextFocus":[""], "experience":[""], "scoreCards":[{"agent":"", "score":0, "strengths":[""], "weaknesses":[""]}]}',
      '',
      `工作流状态: ${status}`,
      `当前状态数: ${this.stateHistory.length}`,
      `问题数: ${this.issueTracker.length}`,
      '',
      'Agent 执行数据：',
      ...this.agents.map((agent) => `- ${agent.name}: status=${agent.status}, completedTasks=${agent.completedTasks}, costUsd=${agent.costUsd}, summary=${agent.summary || ''}`),
      '',
      '问题摘要：',
      ...(this.issueTracker.length > 0
        ? this.issueTracker.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.description}`)
        : ['- 无']),
    ].join('\n');

    const raw = await this.queryAgent(this.currentSupervisorAgent, summaryPrompt, workflowConfig);
    const parsed = this.extractJsonObject(raw);
    const fallback = this.buildFallbackFinalReview(status);
    const finalReview: WorkflowFinalReview = {
      ...fallback,
      ...(parsed && typeof parsed === 'object' ? {
        summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary : fallback.summary,
        nextFocus: Array.isArray(parsed.nextFocus) ? parsed.nextFocus.filter((item: unknown) => typeof item === 'string') : fallback.nextFocus,
        experience: Array.isArray(parsed.experience) ? parsed.experience.filter((item: unknown) => typeof item === 'string') : fallback.experience,
        scoreCards: Array.isArray(parsed.scoreCards)
          ? parsed.scoreCards
            .filter((item: any) => item && typeof item.agent === 'string')
            .map((item: any) => ({
              agent: item.agent,
              score: Number.isFinite(item.score) ? Math.max(0, Math.min(100, Number(item.score))) : 70,
              strengths: Array.isArray(item.strengths) ? item.strengths.filter((v: unknown) => typeof v === 'string') : [],
              weaknesses: Array.isArray(item.weaknesses) ? item.weaknesses.filter((v: unknown) => typeof v === 'string') : [],
            }))
          : fallback.scoreCards,
      } : {}),
      runId: this.currentRunId,
      configFile: this.currentConfigFile,
      workflowName: workflowConfig.workflow.name,
      projectRoot: this.getWorkingDirectory() || workflowConfig.context?.projectRoot || undefined,
      workflowMode: 'state-machine',
      supervisorAgent: this.currentSupervisorAgent,
      status,
      agentNames: this.agents.map((agent) => agent.name),
      keywords: [
        workflowConfig.workflow.name,
        workflowConfig.context?.requirements,
        ...(this.issueTracker.slice(0, 5).map((issue) => issue.type)),
        ...(this.agents.slice(0, 6).map((agent) => agent.name)),
      ].filter((item): item is string => typeof item === 'string' && item.trim().length > 0),
      generatedAt: new Date().toISOString(),
    };

    if (scoringEnabled) {
      await saveWorkflowFinalReview(finalReview);
    }
    if (experienceEnabled) {
      await appendWorkflowExperience(finalReview);
    }
    await appendMemoryEntries([
      {
        scope: 'workflow',
        key: this.currentConfigFile,
        kind: 'review',
        title: `${workflowConfig.workflow.name} 运行复盘`,
        content: finalReview.summary,
        source: 'workflow-final-review',
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        agent: this.currentSupervisorAgent,
        tags: ['workflow', status],
      },
      {
        scope: 'project',
        key: this.getWorkingDirectory() || workflowConfig.context?.projectRoot || this.currentConfigFile,
        kind: 'experience',
        title: `${workflowConfig.workflow.name} 项目经验`,
        content: [...finalReview.experience, ...finalReview.nextFocus].filter(Boolean).join('；'),
        source: 'workflow-final-review',
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        agent: this.currentSupervisorAgent,
        tags: ['project', status],
      },
      {
        scope: 'role',
        key: this.currentSupervisorAgent,
        kind: 'review',
        title: `${this.currentSupervisorAgent} 监督复盘`,
        content: finalReview.summary,
        source: 'workflow-final-review',
        runId: this.currentRunId,
        configFile: this.currentConfigFile,
        agent: this.currentSupervisorAgent,
        tags: ['role', 'supervisor', status],
      },
      ...finalReview.scoreCards.map((card) => ({
        scope: 'role' as const,
        key: card.agent,
        kind: 'experience' as const,
        title: `${card.agent} 协作评分`,
        content: [
          `得分 ${card.score}`,
          card.strengths.length ? `优势: ${card.strengths.join('；')}` : '',
          card.weaknesses.length ? `短板: ${card.weaknesses.join('；')}` : '',
        ].filter(Boolean).join('；'),
        source: 'workflow-score-card',
        runId: this.currentRunId || undefined,
        configFile: this.currentConfigFile,
        agent: card.agent,
        tags: ['role', 'score-card', status],
      })),
    ]).catch(() => {});
    const relationshipTasks: Promise<void>[] = [];
    for (let i = 0; i < finalReview.scoreCards.length; i += 1) {
      for (let j = i + 1; j < finalReview.scoreCards.length; j += 1) {
        const left = finalReview.scoreCards[i];
        const right = finalReview.scoreCards[j];
        const deltaScore = Math.round(((left.score + right.score) / 2 - 65) / 4);
        relationshipTasks.push(
          upsertRelationshipSignal({
            agent: left.agent,
            peer: right.agent,
            deltaScore,
            strengths: [...left.strengths, ...right.strengths].slice(0, 4),
            runId: this.currentRunId || undefined,
            configFile: this.currentConfigFile,
          })
        );
      }
    }
    await Promise.allSettled(relationshipTasks);
  }

  /**
   * Initialize the AI engine based on workflow config first, then global config.
   */
  private async initializeEngine(workflowEngine?: string): Promise<void> {
    try {
      const requestedEngine = workflowEngine?.trim();
      const supportedEngines: EngineType[] = ['claude-code', 'kiro-cli', 'codex', 'cursor', 'cangjie-magic', 'opencode', 'nga', 'codegenie', 'trae-cli'];
      const isSupportedEngine = (value: string): value is EngineType => supportedEngines.includes(value as EngineType);

      if (requestedEngine) {
        if (isSupportedEngine(requestedEngine)) {
          this.engineType = requestedEngine;
        } else {
          const globalEngine = await getConfiguredEngine();
          this.emit('log', `工作流配置的引擎无效: ${requestedEngine}，回退到全局引擎 ${globalEngine}`);
          this.engineType = globalEngine;
        }
      } else {
        this.engineType = await getConfiguredEngine();
      }
      this.emit('log', `使用引擎: ${this.engineType}`);

      // Always initialize currentEngine for the selected engine, including claude-code.
      this.currentEngine = await createEngine(this.engineType);
      if (!this.currentEngine) {
        throw new Error(`引擎初始化失败: ${this.engineType} 不可用`);
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  /**
   * Execute a task using the configured engine (Kiro CLI, Claude Code, etc.)
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

    const displayStep =
      options.streamStepName || options.streamStepLabel || step;

    // Register process in processManager so it's visible to the frontend
    const proc = processManager.registerExternalProcess(
      processId,
      agent,
      displayStep,
      options.runId,
      options.stepId
    );
    (proc as any)._cancelFn = () => {
      try {
        this.currentEngine?.cancel();
      } catch {
        // Best-effort cancellation; process state is still marked as killed.
      }
    };

    const streamHandler = (event: EngineStreamEvent) => {
      // 'thought' events are forwarded separately (matching Claude Code's { thinking } field),
      // not accumulated into streamContent.
      if (event.type === 'thought') {
        processManager.emit('stream', {
          id: processId,
          step: displayStep,
          thinking: event.content,
        });
        return;
      }

      // Only accumulate 'text' events into the preview stream.
      if (event.type !== 'text') return;

      // Accumulate stream content on the registered process
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.streamContent += event.content;
      }
      const totalContent = rawProc?.streamContent || event.content;
      void this.applyLiveSpecCodingTaskUpdatesFromStream(totalContent, agent, processId);
      processManager.emit('stream', {
        id: processId,
        step: displayStep,
        delta: event.content,
        total: totalContent,
      });
      // Persist stream content periodically
      if (this.currentRunId && rawProc?.streamContent) {
        const smStepName =
          options.streamStepName ||
          options.streamStepLabel ||
          (this.currentState ? `${this.currentState}-${step}` : step);
        saveStreamContent(this.currentRunId, smStepName, rawProc.streamContent).catch(() => {});
      }
    };

    this.currentEngine.on('stream', streamHandler);

    try {
      const result = await this.currentEngine.execute({
        agent, step, prompt, systemPrompt, model,
        workingDirectory: options.workingDirectory,
        allowedTools: options.allowedTools,
        timeoutMs: options.timeoutMs,
        sessionId: options.resumeSessionId,
        appendSystemPrompt: options.appendSystemPrompt,
        runId: options.runId,
      });

      // Mark process as completed
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.status = 'completed';
        rawProc.endTime = new Date();
        rawProc.output = result.output || rawProc.streamContent;
        rawProc.sessionId = result.sessionId;
      }

      // If engine reports failure, throw so the step is marked as failed
      if (!result.success) {
        const errorMsg = result.error || '引擎执行失败（无输出）';
        if (rawProc) { rawProc.status = 'failed'; rawProc.error = errorMsg; }
        throw new Error(`${this.engineType} 引擎执行失败: ${errorMsg}`);
      }

      return {
        result: result.output,
        session_id: result.sessionId || '',
        is_error: false,
        cost_usd: 0,
        duration_ms: 0,
        duration_api_ms: 0,
        num_turns: 0,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      };
    } finally {
      this.liveSpecCodingTaskBlocksByProcess.delete(processId);
      this.currentEngine.off('stream', streamHandler);
    }
  }

  private initializeAgents(workflowConfig: StateMachineWorkflowConfig): void {
    const agentSet = new Set<string>();
    for (const state of workflowConfig.workflow.states) {
      for (const step of state.steps) {
        agentSet.add(step.agent);
      }
    }
    if (workflowConfig.workflow.supervisor?.enabled !== false) {
      agentSet.add(this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME);
    }

    this.agents = Array.from(agentSet).map((agentName) => {
      const roleConfig = this.agentConfigs.find((r) => r.name === agentName)
        || workflowConfig.roles?.find((r) => r.name === agentName);
      return {
        name: agentName,
        team: roleConfig?.team || (agentName === this.currentSupervisorAgent ? 'black-gold' : 'blue'),
        model: resolveAgentModel(roleConfig, workflowConfig.context),
        status: 'waiting',
        currentTask: null,
        completedTasks: 0,
        tokenUsage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        sessionId: null,
        lastOutput: '',
        summary: '',
      };
    });

    this.emit('agents', { agents: this.agents });
  }

  private ensureSupervisorAgentExists(workflowConfig: StateMachineWorkflowConfig): void {
    const supervisorName = this.currentSupervisorAgent || DEFAULT_SUPERVISOR_NAME;
    const existsInConfigs = this.agentConfigs.some((config) => config.name === supervisorName);
    const existsInWorkflow = workflowConfig.roles?.some((config) => config.name === supervisorName);
    if (!existsInConfigs && !existsInWorkflow) {
      this.currentSupervisorAgent = DEFAULT_SUPERVISOR_NAME;
    }
  }

  private async collectSupervisorReview(
    type: 'state-review' | 'checkpoint-advice',
    state: StateMachineState,
    result: StateExecutionResult,
    config: StateMachineWorkflowConfig,
    nextState?: string
  ): Promise<string | null> {
    if (config.workflow.supervisor?.enabled === false) return null;
    if (type === 'state-review' && config.workflow.supervisor?.stageReviewEnabled === false) return null;
    if (type === 'checkpoint-advice' && config.workflow.supervisor?.checkpointAdviceEnabled === false) return null;

    const issueSummary = result.issues.length > 0
      ? result.issues.map((issue) => `- [${issue.severity}] ${issue.type}: ${issue.description}`).join('\n')
      : '- 无';
    const stepSummary = result.stepOutputs
      .map((output, index) => {
        const snippet = output.replace(/\s+/g, ' ').trim().slice(0, 300);
        const step = state.steps[index];
        return `- ${step?.name || `步骤${index + 1}`}: ${snippet || '[无输出]'}`;
      })
      .join('\n');
    const specCodingGuardrail = this.currentRunSpecCoding
      ? [
        '当前 Run Spec Coding 投影：',
        `- 版本: v${this.currentRunSpecCoding.version}`,
        this.currentRunSpecCoding.summary ? `- 摘要: ${this.currentRunSpecCoding.summary}` : '',
        this.currentRunSpecCoding.progress?.summary ? `- 进度: ${this.currentRunSpecCoding.progress.summary}` : '',
        this.currentRunSpecCoding.tasks?.length
          ? `- tasks.md: ${this.currentRunSpecCoding.tasks.filter((task) => task.status === 'completed').length}/${this.currentRunSpecCoding.tasks.length} 已完成`
          : '',
        '- 你负责非状态内容的修订；普通步骤只能更新状态。',
      ].filter(Boolean).join('\n')
      : '';
    const relatedExperiences = this.currentConfigFile
      ? await findRelevantWorkflowExperiences({
          configFile: this.currentConfigFile,
          workflowName: config.workflow?.name,
          requirements: config.context?.requirements,
          projectRoot: this.getWorkingDirectory() || config.context?.projectRoot,
          agentName: this.currentSupervisorAgent,
          excludeRunId: this.currentRunId || undefined,
          limit: 2,
        }).catch(() => [])
      : [];
    const experienceBlock = buildWorkflowExperiencePromptBlock(relatedExperiences, '修订前相关历史经验');
    const prompt = [
      `你是工作流指挥官 ${this.currentSupervisorAgent}。`,
      type === 'state-review'
        ? `请对状态阶段 "${state.name}" 做一次阶段审阅。`
        : `请在人工检查点前，对状态阶段 "${state.name}" 给出检查点建议。`,
      '',
      `当前 verdict: ${result.verdict}`,
      nextState ? `建议下一状态: ${nextState}` : '',
      '',
      '问题摘要：',
      issueSummary,
      '',
      '步骤输出摘要：',
      stepSummary || '- 无',
      experienceBlock,
      specCodingGuardrail ? `\n${specCodingGuardrail}` : '',
      '',
      type === 'state-review'
        ? '请输出：1. 当前阶段结论 2. 是否建议继续迭代 3. 下一步指导意见'
        : '请输出：1. 是否建议人工放行 2. 若不建议放行，需重点检查的风险 3. 给操作者的简短建议',
    ].filter(Boolean).join('\n');

    const response = await this.queryAgent(this.currentSupervisorAgent, prompt, config);
    const timestamp = new Date().toISOString();
    this.latestSupervisorReview = {
      type,
      stateName: state.name,
      content: response,
      timestamp,
    };
    this.supervisorFlow.push({
      type,
      from: this.currentSupervisorAgent,
      to: type === 'checkpoint-advice' ? 'user' : state.name,
      question: response,
      round: this.transitionCount,
      timestamp,
      stateName: state.name,
    });
    this.emit('supervisor-review', this.latestSupervisorReview);
    if (this.currentRunSpecCoding) {
      this.currentRunSpecCoding = appendSupervisorSpecCodingRevision(this.currentRunSpecCoding, {
        stateName: state.name,
        nextState,
        type,
        reviewContent: response,
        supervisorAgent: this.currentSupervisorAgent,
        verdict: result.verdict,
      });
    }
    await this.persistState();
    return response;
  }

  private deriveRunSpecCodingStateUpdate(
    state: StateMachineState,
    result: StateExecutionResult,
    nextState?: string | null
  ): { status: 'pending' | 'in-progress' | 'completed' | 'blocked'; summary: string } {
    if (result.verdict === 'fail') {
      return {
        status: 'blocked',
        summary: `状态 ${state.name} 执行失败，当前运行被标记为阻塞。`,
      };
    }

    if (state.isFinal) {
      return {
        status: 'completed',
        summary: `终止状态 ${state.name} 已完成，本轮运行已到达收口阶段。`,
      };
    }

    if (nextState && nextState !== state.name) {
      return {
        status: 'completed',
        summary: `状态 ${state.name} 已完成，下一状态为 ${nextState}。`,
      };
    }

    return {
      status: 'in-progress',
      summary: result.verdict === 'conditional_pass'
        ? `状态 ${state.name} 进入继续迭代。`
        : `状态 ${state.name} 仍在推进中。`,
    };
  }

  private async executeStateMachine(
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<void> {
    const maxTransitions = config.workflow.maxTransitions || 50;

    // If resuming, use existing currentState; otherwise find initial state
    if (!this.currentState) {
      const initialState = config.workflow.states.find(s => s.isInitial)
        || config.workflow.states[0];
      this.currentState = initialState.name;
    }

    this.emit('state-change', {
      state: this.currentState,
      message: `进入状态: ${this.currentState}`,
    });

    while (this.currentState && !this.shouldStop) {
      // Check max transitions
      if (this.transitionCount >= maxTransitions) {
        throw new Error(`达到最大状态转移次数 (${maxTransitions})，可能存在死循环`);
      }

      // Find current state config
      const stateConfig = config.workflow.states.find(s => s.name === this.currentState);
      if (!stateConfig) {
        throw new Error(`找不到状态配置: ${this.currentState}`);
      }

      // Check if final state
      if (stateConfig.isFinal) {
        // Execute final state steps (e.g. regression tests) before completing
        if (stateConfig.steps.length > 0) {
          const finalResult = await this.executeState(stateConfig, config, requirements);
          if (this.currentRunSpecCoding) {
            const statusUpdate = this.deriveRunSpecCodingStateUpdate(stateConfig, finalResult, null);
            this.currentRunSpecCoding = markSpecCodingStateStatus(this.currentRunSpecCoding, {
              stateName: stateConfig.name,
              status: statusUpdate.status,
              summary: statusUpdate.summary,
            });
            await this.persistState();
          }
        }
        this.emit('state-change', {
          state: this.currentState,
          message: `到达终止状态: ${this.currentState}`,
        });
        break;
      }

      // Execute current state
      const result = await this.executeState(stateConfig, config, requirements);

      // Evaluate transitions
      // Remember whether this transition was forced by the user so we can skip human approval
      const wasForced = !!this.pendingForceTransition;
      const nextState = await this.evaluateTransitions(
        stateConfig.transitions,
        result,
        config
      );

      if (this.currentRunSpecCoding) {
        const statusUpdate = this.deriveRunSpecCodingStateUpdate(stateConfig, result, nextState);
        this.currentRunSpecCoding = markSpecCodingStateStatus(this.currentRunSpecCoding, {
          stateName: stateConfig.name,
          status: statusUpdate.status,
          summary: statusUpdate.summary,
        });
        await this.persistState();
      }

      await this.collectSupervisorReview('state-review', stateConfig, result, config, nextState);

      // Check self-transition circuit breaker
      if (nextState === this.currentState) {
        const currentSelfCount = this.selfTransitionCounts.get(this.currentState!) || 0;
        const maxSelfTransitions = stateConfig.maxSelfTransitions || 3;
        if (currentSelfCount >= maxSelfTransitions) {
          // Circuit breaker triggered - force transition to a different state or fail
          this.emit('circuit-breaker', {
            state: this.currentState,
            selfTransitionCount: currentSelfCount,
            maxSelfTransitions,
            message: `状态 "${this.currentState}" 自我转换次数超过限制 (${maxSelfTransitions})，自动熔断`,
          });
          // Find an alternative transition target
          const alternativeTransition = stateConfig.transitions.find(t => t.to !== this.currentState);
          if (alternativeTransition) {
            this.stateHistory.push({
              from: this.currentState!,
              to: alternativeTransition.to,
              reason: `熔断：自我转换超过限制，强制转向 ${alternativeTransition.to}`,
              issues: result.issues,
              timestamp: new Date().toISOString(),
            });
            this.transitionCount++;
            this.currentState = alternativeTransition.to;
            this.selfTransitionCounts.set(this.currentState, 0);
            this.emit('transition', {
              from: this.currentState,
              to: alternativeTransition.to,
              transitionCount: this.transitionCount,
              issues: result.issues,
              circuitBreaker: true,
            });
            continue;
          } else {
            throw new Error(`状态 "${this.currentState}" 达到最大自我转换次数 (${maxSelfTransitions}) 且无其他转移路径，工作流终止`);
          }
        }
        // Increment self-transition counter
        this.selfTransitionCounts.set(this.currentState!, currentSelfCount + 1);
      } else {
        // Reset self-transition counter when moving to a different state
        this.selfTransitionCounts.set(this.currentState!, 0);
      }

      // Check if human approval is required
      // Skip human approval if transitioning to self (iteration) or if forced by user
      const requiresApproval = stateConfig.requireHumanApproval && nextState !== this.currentState && !wasForced;

      if (requiresApproval) {
        const fromStateName = this.currentState;
        const checkpointAdvice = await this.collectSupervisorReview('checkpoint-advice', stateConfig, result, config, nextState);

        // First transition: current state -> __human_approval__
        this.stateHistory.push({
          from: this.currentState,
          to: '__human_approval__',
          reason: `需要人工审查: ${this.getTransitionReason(result)}`,
          issues: result.issues,
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: this.currentState,
          to: '__human_approval__',
          transitionCount: this.transitionCount,
          issues: result.issues,
        });

        this.currentState = '__human_approval__';

        // Save approval context for crash recovery
        this.pendingApprovalInfo = {
          suggestedNextState: nextState,
          availableStates: config.workflow.states.map(s => s.name),
          result,
          supervisorAdvice: checkpointAdvice || undefined,
        };

        // Persist state so crash recovery can restore to human approval
        await this.persistState();

        const humanQuestion = await this.createHumanQuestion({
          kind: 'approval',
          title: '等待人工审查',
          message: checkpointAdvice || `Supervisor 建议进入 ${nextState}，请确认下一步状态。`,
          supervisorAdvice: checkpointAdvice || undefined,
          currentState: '__human_approval__',
          previousState: fromStateName,
          suggestedNextState: nextState,
          availableStates: config.workflow.states.map(s => s.name),
          result,
          requiresWorkflowPause: true,
          answerSchema: {
            type: 'approval-transition',
            required: true,
            options: config.workflow.states.map(s => ({ label: s.name, value: s.name })),
          },
          source: { type: 'checkpoint-advice', fromState: fromStateName, suggestedNextState: nextState },
        });

        // Emit state change to human approval
        this.emit('state-change', {
          state: '__human_approval__',
          message: '等待人工审查决策',
        });

        // Emit human approval required event and wait
        this.emit('human-approval-required', {
          currentState: '__human_approval__',
          nextState,
          suggestedNextState: nextState,
          result,
          availableStates: config.workflow.states.map(s => s.name),
          supervisorAdvice: checkpointAdvice || undefined,
          humanQuestion,
        });

        // Wait for human decision via forceTransition
        await this.waitForHumanApproval();

        // After human approval, pendingForceTransition will be set
        const humanSelectedState: string = this.pendingForceTransition || nextState;
        this.pendingForceTransition = null;
        this.pendingApprovalInfo = null;

        // Second transition: __human_approval__ -> selected state
        const instruction = this.pendingForceInstruction || '';
        this.pendingForceInstruction = null;
        this.stateHistory.push({
          from: '__human_approval__',
          to: humanSelectedState,
          reason: instruction
            ? `人工决策: 选择进入 ${humanSelectedState}，附加指令: ${instruction}`
            : `人工决策: 选择进入 ${humanSelectedState}`,
          issues: [],
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: '__human_approval__',
          to: humanSelectedState,
          transitionCount: this.transitionCount,
          issues: [],
        });

        // 人工审批后仍然是状态流转，需要补充 Agent 级绿色流转线
        const fromState = fromStateName
          ? config.workflow.states.find(s => s.name === fromStateName)
          : undefined;
        const toState = config.workflow.states.find(s => s.name === humanSelectedState);
        if (fromState && toState && fromState.steps.length > 0 && toState.steps.length > 0) {
          const fromAgent = fromState.steps[fromState.steps.length - 1].agent;
          const toAgent = toState.steps[0].agent;
          if (fromAgent !== toAgent) {
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'stream',
              fromAgent,
              toAgent,
              message: `状态流转: ${fromState.name} -> ${toState.name} (人工审查后)`,
              stateName: fromState.name,
              stepName: fromState.steps[fromState.steps.length - 1].name,
              round: 0,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
          }
        }

        this.currentState = humanSelectedState;
        this.emit('state-change', {
          state: this.currentState,
          message: `进入状态: ${this.currentState}`,
        });
      } else {
        // No human approval needed, proceed automatically
        // Record transition
        this.stateHistory.push({
          from: this.currentState,
          to: nextState,
          reason: this.getTransitionReason(result),
          issues: result.issues,
          timestamp: new Date().toISOString(),
        });

        this.transitionCount++;
        this.emit('transition', {
          from: this.currentState,
          to: nextState,
          transitionCount: this.transitionCount,
          issues: result.issues,
        });

        // 添加状态切换的流转线
        const fromState = config.workflow.states.find(s => s.name === this.currentState);
        const toState = config.workflow.states.find(s => s.name === nextState);
        if (fromState && toState && fromState.steps.length > 0 && toState.steps.length > 0) {
          const fromAgent = fromState.steps[fromState.steps.length - 1].agent;
          const toAgent = toState.steps[0].agent;
          if (fromAgent !== toAgent) {
            this.agentFlow.push({
              id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              type: 'stream',
              fromAgent: fromAgent,
              toAgent: toAgent,
              message: `状态流转: ${fromState.name} -> ${toState.name}`,
              stateName: fromState.name,
              stepName: fromState.steps[fromState.steps.length - 1].name,
              round: 0,
              timestamp: new Date().toISOString(),
            });
            this.emit('agent-flow', { agentFlow: this.agentFlow });
          }
        }

        this.currentState = nextState;
        this.emit('state-change', {
          state: this.currentState,
          message: `进入状态: ${this.currentState}`,
        });
      }
    }
  }

  private async executeState(
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string
  ): Promise<StateExecutionResult> {
    this.emit('state-executing', {
      state: state.name,
      stepCount: state.steps.length,
    });
    if (this.currentRunSpecCoding) {
      this.currentRunSpecCoding = markSpecCodingStateStatus(this.currentRunSpecCoding, {
        stateName: state.name,
        status: 'in-progress',
        summary: `当前推进到状态 ${state.name}。`,
      });
      await this.persistState();
    }

    const stepOutputs: string[] = [];
    const issues: Issue[] = [];
    let verdict: 'pass' | 'conditional_pass' | 'fail' = 'pass';

    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      if (this.shouldStop) break;
      // Allow forced transition to interrupt mid-state
      if (this.pendingForceTransition) break;

      // Delay between steps when using non-claude engines to avoid throttling
      if (i > 0 && this.engineType !== 'claude-code') {
        await new Promise(r => setTimeout(r, 30000));
      }

      try {
        let output: string;
        output = await this.executeStep(step, state, config, requirements);
        stepOutputs.push(output);

        // Parse issues from output
        const stepIssues = this.parseIssuesFromOutput(output, step, state.name);
        issues.push(...stepIssues);

        // Update verdict based on step role
        if (step.role === 'judge') {
          const stepVerdict = this.parseVerdict(output);
          if (stepVerdict === 'fail') verdict = 'fail';
          else if (stepVerdict === 'conditional_pass' && verdict === 'pass') {
            verdict = 'conditional_pass';
          }
        }
      } catch (stepError: any) {
        const errorMsg = stepError.message || String(stepError);
        stepOutputs.push(`ERROR: ${errorMsg}`);
        const isEngineLevelFailure =
          /acp\s+connection\s+closed/i.test(errorMsg)
          || /引擎执行失败/.test(errorMsg)
          || /engine\s+.*failed/i.test(errorMsg);

        if (isEngineLevelFailure) {
          // Engine-level failures are fatal for state-machine execution to avoid
          // uncontrolled fallback iterations and token burn.
          throw new Error(`引擎异常，已停止工作流：${errorMsg}`);
        }

        verdict = 'fail';
        // Abort remaining steps in this state on non-engine step failure
        break;
      }
    }

    // Add issues to tracker
    this.issueTracker.push(...issues);

    return {
      stateName: state.name,
      verdict,
      issues,
      stepOutputs,
      summary: this.generateStateSummary(state, issues),
    };
  }

  private applyRunSpecCodingTaskUpdatesFromOutput(output: string, updatedBy: string): number {
    if (!this.currentRunSpecCoding) return 0;
    const block = extractSpecTasksBlock(output);
    if (!block) return 0;

    const normalizeStatus = (value: unknown): 'pending' | 'in-progress' | 'completed' | 'blocked' | '' => {
      if (typeof value !== 'string') return '';
      const normalized = value.trim().toLowerCase();
      if (normalized === '[ ]' || normalized === 'todo' || normalized === 'pending') return 'pending';
      if (normalized === '[-]' || normalized === '-' || normalized === 'doing' || normalized === 'in_progress' || normalized === 'in-progress') return 'in-progress';
      if (normalized === '[x]' || normalized === 'x' || normalized === 'done' || normalized === 'completed' || normalized === 'complete') return 'completed';
      if (normalized === '[!]' || normalized === 'blocked' || normalized === 'block') return 'blocked';
      return '';
    };
    try {
      const parsed = JSON.parse(stripJsonFence(block));
      const rawUpdates = Array.isArray(parsed) ? parsed : parsed?.updates;
      if (!Array.isArray(rawUpdates)) return 0;
      const updates = rawUpdates.flatMap((item: any) => {
        const id = typeof item?.id === 'string' ? item.id.trim() : '';
        const status = normalizeStatus(item?.status);
        if (!id || !status) return [];
        return [{
          id,
          status,
          validation: typeof item?.validation === 'string' ? item.validation.trim().slice(0, 300) : undefined,
        }];
      });

      if (updates.length === 0) return 0;
      this.currentRunSpecCoding = updateSpecCodingTaskStatuses(this.currentRunSpecCoding, {
        updates,
        updatedBy,
      });
      this.emit('log', { message: `Spec Coding tasks.md 已刷新 ${updates.length} 项` });
      return updates.length;
    } catch {
      this.emit('log', { message: 'Spec Coding tasks.md 状态回传解析失败，已忽略本次状态块' });
      return 0;
    }
  }

  private buildRunSpecCodingStatusPayload() {
    if (!this.currentRunSpecCoding) return {};
    return {
      specCodingSummary: {
        id: this.currentRunSpecCoding.id,
        version: this.currentRunSpecCoding.version,
        status: this.currentRunSpecCoding.status,
        source: 'run' as const,
        summary: this.currentRunSpecCoding.summary,
        phaseCount: this.currentRunSpecCoding.phases.length,
        taskCount: this.currentRunSpecCoding.tasks.length,
        assignmentCount: this.currentRunSpecCoding.assignments.length,
        checkpointCount: this.currentRunSpecCoding.checkpoints.length,
        revisionCount: this.currentRunSpecCoding.revisions.length,
        progress: this.currentRunSpecCoding.progress,
        latestRevision: this.currentRunSpecCoding.revisions.at(-1) || null,
      },
      specCodingDetails: {
        phases: this.currentRunSpecCoding.phases,
        tasks: this.currentRunSpecCoding.tasks,
        assignments: this.currentRunSpecCoding.assignments,
        checkpoints: this.currentRunSpecCoding.checkpoints,
        revisions: this.currentRunSpecCoding.revisions,
        artifacts: this.currentRunSpecCoding.artifacts,
      },
    };
  }

  private async applyLiveSpecCodingTaskUpdatesFromStream(output: string, updatedBy: string, processId: string): Promise<number> {
    const block = extractSpecTasksBlock(output);
    if (!block) return 0;

    const previousBlock = this.liveSpecCodingTaskBlocksByProcess.get(processId);
    if (previousBlock === block) return 0;
    this.liveSpecCodingTaskBlocksByProcess.set(processId, block);

    const updated = this.applyRunSpecCodingTaskUpdatesFromOutput(`<spec-tasks>${block}</spec-tasks>`, updatedBy);
    if (updated <= 0) return 0;

    await this.persistState();
    this.emit('status', {
      status: this.status,
      message: `Spec Coding tasks.md 已实时刷新 ${updated} 项`,
      runId: this.currentRunId,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentPhase: this.currentState,
      currentStep: this.currentStep,
      currentConfigFile: this.currentConfigFile,
      ...this.buildRunSpecCodingStatusPayload(),
    });
    return updated;
  }

  private async executeStep(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string
  ): Promise<string> {
    const agent = this.agents.find(a => a.name === step.agent);
    if (!agent) {
      throw new Error(`找不到 agent: ${step.agent}`);
    }

    const stepId = randomUUID();
    const stepKey = `${state.name}-${step.name}`;

    agent.status = 'running';
    agent.currentTask = step.name;
    this.currentStep = stepKey;
    this.emit('agents', { agents: this.agents });
    
    this.agentFlow.push({
      id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'stream',
      fromAgent: step.agent,
      toAgent: step.agent,
      message: `开始执行步骤: ${step.name}`,
      stateName: state.name,
      stepName: step.name,
      round: 0,
      timestamp: new Date().toISOString(),
    });
    this.emit('agent-flow', { agentFlow: this.agentFlow });
    await this.persistState();

    this.emit('step-start', {
      id: stepId,
      state: state.name,
      step: step.name,
      agent: step.agent,
    });

    try {
      // 在执行 Agent 之前，先执行可选的预命令（例如编译 / 测试命令）
      this.lastPreCommandOutput = null;
      if (Array.isArray((step as any).preCommands) && (step as any).preCommands.length > 0) {
        try {
          const preOutput = await this.runPreCommands(
            (step as any).preCommands as string[],
            config,
            {
              stateName: state.name,
              stepName: step.name,
              agent: step.agent,
            }
          );
          this.lastPreCommandOutput = preOutput.text || null;
        } catch (e) {
          // 预命令执行本身不应中断整个步骤，将错误文本注入上下文由 Agent 决策
          const msg = e instanceof Error ? e.message : String(e);
          this.lastPreCommandOutput = `预执行命令执行异常（不会中断步骤，请你据此判断是否 fail）：\n${msg}`;
        }
      }

      // Build context (now async)
      const context = await this.buildStepContext(step, state, config, requirements, extraContext);

      // Execute step (reuse existing process manager logic)
      const stepResult = await this.runAgentStep(step, context, config, stepId);
      const output = stepResult.output;
      const conclusion = compactStepConclusion(stepResult.lastRoundOutput || output);

      agent.status = 'completed';
      agent.completedTasks++;
      agent.lastOutput = output;
      // Store session ID for reuse across iterations of the same agent
      if (stepResult.sessionId) {
        agent.sessionId = stepResult.sessionId;
      }
      this.currentStep = null;
      this.completedSteps.push(stepKey);
      this.currentProcesses = [];
      this.applyRunSpecCodingTaskUpdatesFromOutput(output, step.agent);

      // Record step log for persistence
      this.stepLogs.push({
        id: stepId,
        stepName: stepKey,
        agent: step.agent,
        status: 'completed',
        output,
        error: '',
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
        timestamp: new Date().toISOString(),
      });

      this.emit('agents', { agents: this.agents });
      await this.persistState();

      this.emit('step-complete', {
        id: stepId,
        state: state.name,
        step: step.name,
        agent: step.agent,
        output,
        costUsd: stepResult.costUsd,
        durationMs: stepResult.durationMs,
      });

      // 记录步骤完成的流转线
      const currentStepIndex = state.steps.findIndex(s => s.name === step.name);
      if (currentStepIndex >= 0 && currentStepIndex < state.steps.length - 1) {
        const nextStep = state.steps[currentStepIndex + 1];
        if (nextStep && nextStep.agent !== step.agent) {
          this.agentFlow.push({
            id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'stream',
            fromAgent: step.agent,
            toAgent: nextStep.agent,
            message: `步骤流转: ${step.name} -> ${nextStep.name}`,
            stateName: state.name,
            stepName: step.name,
            round: 0,
            timestamp: new Date().toISOString(),
          });
          this.emit('agent-flow', { agentFlow: this.agentFlow });
        }
      }

      // Save output to file system
      if (this.currentRunId) {
        const stepFileName = stepKey;
        await saveProcessOutput(this.currentRunId, stepFileName, conclusion).catch(() => {});
      }

      return output;
    } catch (error: any) {
      agent.status = 'failed';
      this.currentStep = null;
      this.currentProcesses = [];

      // Record failed step log
      const errorMsg = error.message || String(error);
      this.stepLogs.push({
        id: stepId,
        stepName: stepKey,
        agent: step.agent,
        status: 'failed',
        output: '',
        error: errorMsg,
        costUsd: 0,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      });

      this.emit('agents', { agents: this.agents });
      await this.persistState();

      // Save error output
      if (this.currentRunId) {
        await saveProcessOutput(this.currentRunId, stepKey, `ERROR: ${errorMsg}`).catch(() => {});
      }

      throw error;
    }
  }

  private async buildStepContext(
    step: WorkflowStep,
    state: StateMachineState,
    config: StateMachineWorkflowConfig,
    requirements?: string,
    extraContext?: string
  ): Promise<string> {
    const parts: string[] = [];

    parts.push(`# 当前状态: ${state.name}`);
    if (state.description) {
      parts.push(`状态描述: ${state.description}`);
    }

    parts.push(`\n# 当前任务: ${step.name}`);
    parts.push(`任务描述: ${step.task}`);

    if (requirements) {
      parts.push(`\n# 需求说明\n${requirements}`);
    }

    if (this.currentRunSpecCoding) {
      const relevantPhase = this.currentRunSpecCoding.phases.find((phase) => phase.title === state.name);
      const relevantTasks = relevantPhase
        ? (this.currentRunSpecCoding.tasks || []).filter((task) => task.phaseId === relevantPhase.id)
        : [];
      const taskContext = relevantTasks.length > 0
        ? relevantTasks
        : (this.currentRunSpecCoding.tasks || []).filter((task) => task.status !== 'completed').slice(0, 12);
      parts.push(`\n# 当前 Run Spec Coding 投影`);
      parts.push(`Spec Coding 版本: v${this.currentRunSpecCoding.version}`);
      parts.push('说明: 当前 Run Spec Coding 投影是本次运行绑定的正式规范制品投影。即使工作目录内没有 requirements.md / design.md / tasks.md 文件实体，也必须以这里注入的规范投影和 tasks.md 条目作为执行与进度回传依据。不要改用旧基线文档替代它。');
      if (this.currentRunSpecCoding.summary) {
        parts.push(`Spec Coding 摘要: ${this.currentRunSpecCoding.summary}`);
      }
      if (this.currentRunSpecCoding.progress?.summary) {
        parts.push(`Spec Coding 进度: ${this.currentRunSpecCoding.progress.summary}`);
      }
      if (relevantPhase?.objective) {
        parts.push(`当前阶段目标: ${relevantPhase.objective}`);
      }
      if (relevantPhase?.ownerAgents?.length) {
        parts.push(`当前阶段责任 Agent: ${relevantPhase.ownerAgents.join(', ')}`);
      }
      if (taskContext.length > 0) {
        parts.push(relevantTasks.length > 0 ? '\n## 当前阶段 tasks.md 条目' : '\n## 相关未完成 tasks.md 条目');
        for (const task of taskContext) {
          const marker = task.status === 'completed' ? 'x' : task.status === 'in-progress' ? '-' : ' ';
          parts.push(`- [${marker}] ${task.id} ${task.title} <!-- status:${task.status} -->`);
        }
      }
      parts.push([
        '权限规则: 你只能更新状态类变化；不能修改目标、约束、阶段定义、分工或其他非状态内容，非状态修订由 Supervisor 负责。',
        'tasks.md 状态标记: [ ]=未开始，[-]=进行中，[x]=已完成，blocked=阻塞。',
        '首要任务: 在你开始读取资料、执行命令、输出分析之前，先立即输出一次 <spec-tasks>，把你当前负责的 task 标记为 in-progress。',
        '只有先输出这次 in-progress 状态回传，本步骤才算真正开始。',
        '完成后再输出一次 <spec-tasks>，把对应 task 更新为 completed 或 blocked；不要等到整步结束才第一次回传状态。',
        '如果本步骤推进了 tasks.md，请输出 <spec-tasks> JSON 块，系统会解析并同步到当前 run 的正式 tasks.md 投影；该状态块可以先于最终结论单独出现，便于前端实时刷新。',
        '这不是系统自动推断，必须由你显式声明。',
        '格式示例:',
        '<spec-tasks>',
        '{"updates":[{"id":"1.1","status":"in-progress","validation":"已开始定位入口"},{"id":"1.2","status":"completed","validation":"已完成并产出证据"}]}',
        '</spec-tasks>',
      ].join('\n'));
    }

    const recentQualityChecks = this.qualityChecks
      .filter((item) => item.stateName === state.name || item.agent === step.agent)
      .slice(-3);
    if (recentQualityChecks.length > 0) {
      parts.push(`\n# 最近质量门禁`);
      for (const check of recentQualityChecks) {
        parts.push(`- [${check.category}/${check.status}] ${check.stepName}: ${check.summary}`);
      }
    }

    // Add global context
    if (this.globalContext) {
      parts.push(`\n# 全局上下文\n${this.globalContext}`);
    }

    if (this.humanAnswersContext.length > 0) {
      const recentAnswers = this.humanAnswersContext.slice(-5).map((item) => [
        `- 问题: ${item.title}`,
        `  - 询问内容: ${item.question}`,
        `  - 人类回答: ${item.answer}`,
        item.instruction ? `  - 附加指令: ${item.instruction}` : '',
      ].filter(Boolean).join('\n'));
      parts.push(`\n# 本轮运行中的人类答复\n${recentAnswers.join('\n')}`);
    }

    // Add state-specific context
    const stateContext = this.stateContexts.get(state.name);
    if (stateContext) {
      parts.push(`\n# 状态上下文\n${stateContext}`);
    }

    // Add project path
    if (config.context?.projectRoot) {
      parts.push(`\n# 项目路径\n${config.context.projectRoot}`);
    }

    // Add system-managed step conclusion protocol
    if (this.currentRunId) {
      const outputPath = `${join(getWorkspaceRunsDir(), this.currentRunId, 'outputs')}/`;
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const summaryFileName = `${ts}-${state.name}-${step.name}.md`;
      parts.push([
        '\n# 文档输出要求',
        `请将你产出的步骤成果详细总结写入以下目录：\n\`${outputPath}\``,
        `当前步骤的步骤成果详细总结文件名必须是：\`${summaryFileName}\``,
        '如果你还需要创建其他附加产物文件，也必须使用时间戳前缀，但后半段名称可以根据内容自行命名；只要不要与当前步骤的步骤成果详细总结重名即可。',
        '\n# 步骤结论归档协议',
        '步骤成果详细总结与步骤结论是两种不同输出。',
        '步骤成果详细总结请按时间戳前缀命名写入 outputs 目录；步骤结论只需要放在回复末尾的 <step-conclusion> 中。',
        '如果你要先汇报进行中状态，可以在过程里提前单独输出一次 <spec-tasks>；最终收尾时，如还需输出流程裁决 JSON 或 <spec-tasks>，顺序必须是：裁决 JSON -> <spec-tasks> -> <step-conclusion>。',
        '请在回复末尾单独输出 <step-conclusion>，里面只写可被下一步 agent 直接复用的步骤结论，不要包含完整过程日志、命令回显、长篇原始证据或重复上下文。',
        '步骤结论必须自包含：下一步 agent 不读完整对话时，也能知道本步骤做了什么、改了哪里、验证到什么程度、还剩什么风险。',
        '建议结构:',
        '<step-conclusion>',
        '## 结果 / 裁决',
        '- 本步骤最终完成了什么，或给出了什么 pass / conditional_pass / fail 判断。',
        '## 下一步所需上下文',
        '- 后续 agent 必须继承的事实、决策、约束、假设和用户确认点。',
        '## 涉及对象',
        '- 读取、修改或重点审查过的文件、符号、配置项、API、状态字段或制品路径。',
        '## 验证状态',
        '- 已运行的命令、人工检查或替代证据；如果未验证，说明原因和影响。',
        '## 未决问题 / 风险',
        '- 仍阻塞、待确认、兼容风险、失败路径或需要 owner/Supervisor 决策的事项；没有则写“无”。',
        '## 下一步建议',
        '- 建议下一个 agent 直接执行的最小动作，避免泛泛而谈。',
        '</step-conclusion>',
      ].join('\n'));
    }

    // Add structured JSON output requirement for attacker/judge roles
    if (step.role === 'attacker' || step.role === 'judge') {
      parts.push(`\n# 结构化输出要求\n请输出以下 JSON 块（用 \`\`\`json 包裹），用于自动化流程判断；如果本轮还要输出 <spec-tasks> 或 <step-conclusion>，该 JSON 块必须放在它们之前：\n\n\`\`\`json\n{\n  "verdict": "pass | conditional_pass | fail",\n  "remaining_issues": 0,\n  "summary": "一句话总结"\n}\n\`\`\`\n\n字段说明：\n- \`verdict\`: \`"pass"\` 表示无问题可通过，\`"conditional_pass"\` 表示有条件通过（存在需修复的问题但方向正确），\`"fail"\` 表示存在严重问题需要重做\n- \`remaining_issues\`: 剩余未解决的问题数量（整数）\n- \`summary\`: 一句话总结你的评估结论\n\n# 裁决边界约束\n- 正式 verdict 只评估当前阶段/当前检查点的核心审查目标。\n- 只有会影响当前检查点是否通过的问题，才能计入 \`remaining_issues\`，并影响 \`pass / conditional_pass / fail\`。\n- 像附加文件命名、时间戳前缀、补充总结归档格式、展示文案、非核心输出排版这类低优先级问题，如果不影响当前检查点核心目标，不能计入 \`remaining_issues\`，也不能单独导致 \`conditional_pass\` 或 \`fail\`。\n- 这类非阻塞问题只能写进 <step-conclusion> 的“后续建议”或“附加观察”，不要放进“结论”主项，不要渲染成阻塞项。`);
    }

    // Add workspace skills (index summary + absolute path for AI to read details)
    if (config.context?.projectRoot) {
      const skills = await this.loadWorkspaceSkills(config.context.projectRoot);
      if (skills) {
        const skillsAbsPath = await getRuntimeSkillsDirPath();
        parts.push(`\n# 可用 Skills\n\nSkills 目录绝对路径: \`${skillsAbsPath}/\`\n\n如需使用某个 Skill，请先用 Read 工具读取对应的 SKILL.md 文件获取详细说明。例如：\`${skillsAbsPath}/build-cangjie/SKILL.md\`\n\n${skills}`);
      }
    }

    // Add workflow-level and step-level skills
    const allSkillNames: string[] = [];
    if (config.context?.skills) allSkillNames.push(...config.context.skills);
    if (step.skills) allSkillNames.push(...step.skills);
    if (allSkillNames.length > 0 && config.context?.projectRoot) {
      const additionalSkills = await this.loadAdditionalSkills(allSkillNames, config.context.projectRoot);
      if (additionalSkills) {
        parts.push(`\n# 必须使用的 Skills\n\n⚠️ **重要提醒：以下 Skills 是本步骤/项目的核心工具，你必须严格遵循以下原则：**\n\n1. **优先阅读 Skills**：在执行任何任务前，请务必仔细阅读下方所有 Skills 的说明文档\n2. **使用 Skills 中的命令**：直接使用 Skills 中提供的命令格式和参数，**严禁**自行猜测命令或随意修改参数\n3. **Skills 包含最佳实践**：每个 Skill 都经过验证，代表了该领域的最佳实践\n4. **遇到问题先查 Skills**：如果遇到构建、测试、部署等问题，请首先检查是否有对应的 Skill 可用\n\n${additionalSkills}`);
      }
    }

    // Add live feedback
    if (this.liveFeedback.length > 0) {
      parts.push(`\n# 实时反馈`);
      for (const feedback of this.liveFeedback) {
        parts.push(`- ${feedback}`);
      }
    }

    // Add state history
    if (this.stateHistory.length > 0) {
      parts.push(`\n# 状态转移历史`);
      const recent = this.stateHistory.slice(-5);
      for (const record of recent) {
        parts.push(`- ${record.from} → ${record.to}: ${record.reason}`);
      }

      // Extract human instruction from the most recent transition (if any)
      const lastTransition = this.stateHistory[this.stateHistory.length - 1];
      if (lastTransition?.reason?.includes('附加指令:')) {
        const instructionMatch = lastTransition.reason.match(/附加指令:\s*(.+)$/);
        if (instructionMatch) {
          parts.push(`\n# ⚠️ 人工指令（必须遵守）\n${instructionMatch[1]}`);
        }
      }
    }

    // Add recent issues
    if (this.issueTracker.length > 0) {
      parts.push(`\n# 已发现的问题`);
      const recent = this.issueTracker.slice(-10);
      for (const issue of recent) {
        parts.push(`- [${issue.severity}] ${issue.type}: ${issue.description}`);
      }
    }

    // Add preCommands output (if any)
    if (this.lastPreCommandOutput) {
      const raw = this.lastPreCommandOutput;
      const maxLen = 4000;
      const display = raw.length > maxLen
        ? '...(截断，保留结尾)...\n' + raw.slice(-maxLen)
        : raw;
      parts.push(`\n# 预执行命令结果（系统自动执行，必须据此做出裁决）\n${display}`);
    }

    if (this.currentConfigFile) {
      const experiences = await findRelevantWorkflowExperiences({
        configFile: this.currentConfigFile,
        workflowName: config.workflow?.name,
        requirements: config.context?.requirements,
        projectRoot: this.getWorkingDirectory() || config.context?.projectRoot,
        limit: 3,
        excludeRunId: this.currentRunId || undefined,
      }).catch(() => []);
      const block = buildWorkflowExperiencePromptBlock(experiences, '历史经验记忆');
      if (block) {
        parts.push(`\n${block}`);
      }
    }

    // Add previous steps' conclusions from the last 2 completed states
    if (this.currentRunId && this.stateHistory.length > 0) {
      try {
        const outputs = await loadStepOutputs(this.currentRunId);
        // Find the last 2 states before current
        const previousStates: string[] = [];
        for (let i = this.stateHistory.length - 1; i >= 0 && previousStates.length < 2; i--) {
          const from = this.stateHistory[i].from;
          if (from !== '__origin__' && from !== '__human_approval__' && !previousStates.includes(from)) {
            previousStates.push(from);
          }
        }

        const conclusions: string[] = [];
        for (const prevState of previousStates) {
          // Find outputs matching this state (format: "stateName-stepName")
          const stateOutputs = Object.entries(outputs)
            .filter(([key]) => key.startsWith(`${prevState}-`));
          for (const [stepKey, content] of stateOutputs) {
            // Truncate to last 2000 chars to avoid prompt bloat
            const truncated = content.length > 2000
              ? '...(截断)\n' + content.slice(-2000)
              : content;
            conclusions.push(`## ${stepKey}\n${truncated}`);
          }
        }

        if (conclusions.length > 0) {
          parts.push(`\n# 前置步骤结论\n以下是之前步骤的产出，请参考：\n`);
          parts.push(conclusions.join('\n\n'));
        }
      } catch { /* non-critical */ }
    }

    // ========== Supervisor-Lite: 注入可选的下一状态 ==========
    if (state.transitions && state.transitions.length > 0) {
      parts.push(`\n# 可选的下一状态`);
      for (const t of state.transitions) {
        const targetState = config.workflow.states.find(s => s.name === t.to);
        parts.push(`- ${t.to}: ${targetState?.description || '无描述'}`);
      }
    }

    // ========== Supervisor-Lite: 注入额外上下文（信息收集循环） ==========
    if (extraContext) {
      parts.push(`\n# 补充信息\n${extraContext}`);
    }

    // Replace template variables
    let result = parts.join('\n');
    if (this.currentRunId) {
      result = result.replace(/\{runId\}/g, this.currentRunId);
    }
    return result;
  }

  /**
   * 在后端直接执行 preCommands（如 build.sh / 测试命令），并收集 stdout/stderr。
   * 命令串行执行，即使命令失败也不会抛出异常，而是把失败信息写入返回文本中。
   */
  private async runPreCommands(
    commands: string[],
    config: StateMachineWorkflowConfig,
    meta?: { stateName: string; stepName: string; agent: string }
  ): Promise<{ text: string; qualityCheck?: PersistedQualityCheck }> {
    const { exec } = await import('child_process');
    const cwd = config.context?.projectRoot
      ? this.resolveProjectRootPath(config.context.projectRoot)
      : this.resolveProjectRootPath();

    const results: string[] = [];
    const commandResults: PersistedQualityCommandResult[] = [];

    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      results.push(`\n[${i + 1}] $ ${cmd}\n工作目录: ${cwd}\n`);
      // eslint-disable-next-line no-await-in-loop
      const { stdout, stderr, exitCode, errorText } = await new Promise<{
        stdout: string;
        stderr: string;
        exitCode: number | null;
        errorText: string | null;
      }>((resolveInner) => {
        const child = exec(cmd, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, so, se) => {
          const code = (error as any)?.code ?? 0;
          resolveInner({
            stdout: so ?? '',
            stderr: se ?? '',
            exitCode: Number.isInteger(code) ? (code as number) : 0,
            errorText: error ? String(error) : null,
          });
        });
        // 避免悬挂：如果 exec 抛出同步异常
        child.on('error', (err) => {
          resolveInner({
            stdout: '',
            stderr: '',
            exitCode: null,
            errorText: String(err),
          });
        });
      });

      const truncate = (text: string, max: number) => {
        if (!text) return '';
        return text.length > max ? text.slice(0, max) + '\n...(截断)...' : text;
      };

      results.push(`exitCode: ${exitCode ?? 'unknown'}\n`);
      if (errorText) {
        results.push(`exec error: ${truncate(errorText, 1000)}\n`);
      }
      if (stdout) {
        results.push(`--- stdout ---\n${truncate(stdout, 4000)}\n`);
      }
      if (stderr) {
        results.push(`--- stderr ---\n${truncate(stderr, 4000)}\n`);
      }

      const category = this.classifyQualityCommand(cmd);
      const status = exitCode === 0 ? 'passed' : exitCode === null ? 'warning' : 'failed';
      commandResults.push({
        command: cmd,
        exitCode,
        status,
        stdout: truncate(stdout, 800),
        stderr: truncate(stderr, 800),
        errorText,
      });
    }

    let qualityCheck: PersistedQualityCheck | undefined;
    if (meta) {
      const failed = commandResults.filter((item) => item.status === 'failed').length;
      const warned = commandResults.filter((item) => item.status === 'warning').length;
      const categories = [...new Set(commandResults.map((item) => this.classifyQualityCommand(item.command)))];
      const category = categories.includes('lint')
        ? 'lint'
        : categories.includes('compile')
          ? 'compile'
          : categories.includes('test')
            ? 'test'
            : 'custom';
      const status = failed > 0 ? 'failed' : warned > 0 ? 'warning' : 'passed';
      qualityCheck = {
        id: `${meta.stateName}-${meta.stepName}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
        stateName: meta.stateName,
        stepName: meta.stepName,
        agent: meta.agent,
        category,
        status,
        summary: failed > 0
          ? `${commands.length} 条预命令中有 ${failed} 条失败`
          : warned > 0
            ? `${commands.length} 条预命令执行完成，但有 ${warned} 条警告`
            : `${commands.length} 条预命令全部通过`,
        createdAt: new Date().toISOString(),
        commands: commandResults,
      };
      this.recordQualityCheck(qualityCheck);
    }

    return { text: results.join('\n'), qualityCheck };
  }

  private classifyQualityCommand(command: string): 'lint' | 'compile' | 'test' | 'custom' {
    const normalized = command.toLowerCase();
    if (/eslint|lint|cjlint/.test(normalized)) return 'lint';
    if (/tsc|build|compile|cjc|cjpm build|make/.test(normalized)) return 'compile';
    if (/test|pytest|jest|vitest|cjpm test/.test(normalized)) return 'test';
    return 'custom';
  }

  private recordQualityCheck(check: PersistedQualityCheck): void {
    const idx = this.qualityChecks.findIndex((item) => item.id === check.id);
    if (idx >= 0) {
      this.qualityChecks[idx] = check;
    } else {
      this.qualityChecks.push(check);
    }
  }

  private async runAgentStep(
    step: WorkflowStep,
    context: string,
    config: StateMachineWorkflowConfig,
    stepId?: string
  ): Promise<{ output: string; lastRoundOutput: string; costUsd: number; durationMs: number; sessionId?: string }> {
    // Find agent config for system prompt and model
    const roleConfig = this.agentConfigs.find(r => r.name === step.agent)
      || config.roles?.find(r => r.name === step.agent);

    const model = resolveAgentModel(roleConfig, config.context);
    const systemPrompt = roleConfig?.systemPrompt || `你是一个 ${step.role || 'assistant'} 角色的 AI 助手。`;
    const workingDirectory = config.context?.projectRoot
      ? this.resolveProjectRootPath(config.context.projectRoot)
      : this.resolveProjectRootPath();

    let currentProcessId = stepId || randomUUID();
    let currentPrompt = context;
    // Reuse session from same agent if available (saves tokens, preserves memory)
    const agent = this.agents.find(a => a.name === step.agent);
    let currentSessionId: string | undefined = agent?.sessionId || undefined;
    let accumulatedOutput = '';
    let lastRoundOutput = '';
    let accumulatedStream = '';
    let accumulatedCost = 0;
    let accumulatedDuration = 0;

    // Use state-prefixed step name so frontend stream polling matches persisted stream files
    const streamStepName = this.currentState ? `${this.currentState}-${step.name}` : step.name;

    // Track process
    this.currentProcesses = [{
      pid: Date.now(),
      id: currentProcessId,
      agent: step.agent,
      step: streamStepName,
      stepId,
      startTime: new Date().toISOString(),
    }];
    await this.persistState();

    // Set up periodic stream content flushing to disk (so frontend can read it)
    let lastFlush = 0;
    const streamFlushHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== currentProcessId) return;
      const now = Date.now();
      if (this.currentRunId && now - lastFlush > 2000) {
        lastFlush = now;
        const proc = processManager.getProcess(currentProcessId);
        const content = proc?.streamContent || data.total;
        if (content) {
          const fullStream = accumulatedStream
            ? accumulatedStream + '\n\n<!-- chunk-boundary -->\n\n' + content
            : content;
          saveStreamContent(this.currentRunId, streamStepName, fullStream).catch(() => {});
        }
      }
    };
    processManager.on('stream', streamFlushHandler);

    // Feedback loop: run agent, handle interrupts and pending feedback
    try {
    while (true) {
      // Check if workflow was stopped
      if (this.shouldStop) {
        throw new Error('工作流已停止');
      }
      let result: EngineJsonResult;
      try {
        result = await this.executeWithEngine(
          currentProcessId,
          step.agent,
          step.name,
          currentPrompt,
          systemPrompt,
          model,
          {
            workingDirectory,
            timeoutMs: (config.context?.timeoutMinutes || 60) * 60 * 1000,
            runId: this.currentRunId || undefined,
            stepId,
            resumeSessionId: currentSessionId,
            appendSystemPrompt: !!currentSessionId,
            streamStepName,
          }
        );
      } catch (err) {
        // If force transition killed the process, return partial output and let main loop handle it
        if (this.pendingForceTransition) {
          console.log(`[SM-ForceTransition] 进程被强制跳转终止，目标: ${this.pendingForceTransition}`);
          const proc = processManager.getProcess(currentProcessId);
          if (proc?.streamContent) {
            accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
          }
          if (this.currentRunId) {
            saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
          }
          return {
            output: accumulatedOutput || '(强制跳转，步骤未完成)',
            lastRoundOutput: '',
            costUsd: accumulatedCost,
            durationMs: accumulatedDuration,
          };
        }
        // If interrupted with feedback, resume with feedback
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
            saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
          }
          // If we have a session, resume it; otherwise start fresh with feedback prepended
          currentSessionId = sessionId || undefined;
          currentPrompt = isFeedbackOnly
            ? `## 人工实时反馈\n用户在你执行过程中提供了补充反馈，请参考以下内容继续完成任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`
            : `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
          if (!sessionId) {
            // No session yet — prepend original context so the agent has full info
            currentPrompt = context + '\n\n' + currentPrompt;
          }
          currentProcessId = stepId || currentProcessId;
          this.currentProcesses = [{
            pid: Date.now(),
            id: currentProcessId,
            agent: step.agent,
            step: streamStepName,
            stepId,
            startTime: new Date().toISOString(),
          }];
          this.emit('step-start', {
            state: this.currentState,
            step: streamStepName,
            agent: step.agent,
          });
          this.emit('feedback-injected', {
            message: feedbackPrompt,
            timestamp: feedbackTimestamp,
          });
          continue;
        }
        throw err;
      }

      // Accumulate stream content
      const proc = processManager.getProcess(currentProcessId);
      if (proc?.streamContent) {
        accumulatedStream += (accumulatedStream ? '\n\n<!-- chunk-boundary -->\n\n' : '') + proc.streamContent;
      }
      if (this.currentRunId) {
        saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
      }

      accumulatedOutput += (accumulatedOutput ? '\n\n---\n\n' : '') + (result.result || '');
      lastRoundOutput = result.result || '';
      accumulatedCost += result.cost_usd || 0;
      accumulatedDuration += result.duration_ms || 0;

      // Always capture session_id for reuse
      if (result.session_id) {
        currentSessionId = result.session_id;
      }

      // Check for pending live feedback after completion
      if (this.liveFeedback.length > 0 && !this.shouldStop) {
        const feedbackPrompt = this.liveFeedback.join('\n\n');
        this.liveFeedback = [];
        const sessionId = result.session_id;
        if (!sessionId) break;

        const feedbackTimestamp = new Date().toISOString();
        accumulatedStream += `\n\n<!-- chunk-boundary -->\n\n<!-- human-feedback: ${feedbackTimestamp} -->\n${feedbackPrompt}`;
        if (this.currentRunId) {
          saveStreamContent(this.currentRunId, streamStepName, accumulatedStream).catch(() => {});
        }
        currentSessionId = sessionId;
        currentPrompt = `## 人工实时反馈\n以下是用户在你执行过程中提供的反馈意见，请基于这些反馈继续处理当前任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
        currentProcessId = stepId || currentProcessId;
        this.currentProcesses = [{
          pid: Date.now(),
          id: currentProcessId,
          agent: step.agent,
          step: streamStepName,
          stepId,
          startTime: new Date().toISOString(),
        }];
        this.emit('feedback-injected', {
          message: feedbackPrompt,
          timestamp: feedbackTimestamp,
        });
        continue;
      }

      break;
    }
    } finally {
      processManager.off('stream', streamFlushHandler);
    }

    if (!hasMeaningfulAiOutput(accumulatedOutput, accumulatedStream)) {
      throw new Error(`AI 服务中断：步骤 "${streamStepName}" 未产生任何输出`);
    }

    return { output: accumulatedOutput, lastRoundOutput, costUsd: accumulatedCost, durationMs: accumulatedDuration, sessionId: currentSessionId };
  }

  private async evaluateTransitions(
    transitions: StateTransition[],
    result: StateExecutionResult,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    // Check for pending forced transition (human override)
    if (this.pendingForceTransition) {
      const target = this.pendingForceTransition;
      this.pendingForceTransition = null;
      this.emit('transition-forced', { from: result.stateName, to: target });
      return target;
    }

    // Check if judge suggested a next_state in JSON output
    const aiSuggestedState = this.parseNextStateFromOutputs(result.stepOutputs, config);
    if (aiSuggestedState) {
      return aiSuggestedState;
    }

    // Sort by priority (lower number = higher priority)
    const sorted = [...transitions].sort((a, b) => a.priority - b.priority);

    for (const transition of sorted) {
      if (this.matchCondition(transition.condition, result)) {
        return transition.to;
      }
    }

    // conditional_pass without explicit rule → self-transition (continue iterating)
    if (result.verdict === 'conditional_pass') {
      this.emit('escalation', {
        state: result.stateName,
        reason: `有条件通过 (conditional_pass)，继续迭代当前状态`,
        result,
      });
      return result.stateName;
    }

    // No matching transition - wait for human decision instead of crashing
    this.emit('escalation', {
      state: result.stateName,
      reason: `没有匹配的状态转移规则 (verdict: ${result.verdict})，等待人工决策`,
      result,
    });

    // Enter human approval mode so user can force-transition
    this.pendingApprovalInfo = {
      suggestedNextState: transitions[0]?.to || result.stateName,
      availableStates: config.workflow.states.map(s => s.name),
      result,
    };

    const humanQuestion = await this.createHumanQuestion({
      kind: 'approval',
      title: '需要人工选择下一状态',
      message: `verdict "${result.verdict}" 没有匹配的转移规则，请选择下一步状态。`,
      currentState: result.stateName,
      suggestedNextState: transitions[0]?.to || result.stateName,
      availableStates: config.workflow.states.map(s => s.name),
      result,
      requiresWorkflowPause: true,
      answerSchema: {
        type: 'approval-transition',
        required: true,
        options: config.workflow.states.map(s => ({ label: s.name, value: s.name })),
      },
      source: { type: 'human-approval', reason: 'no-matching-transition' },
    });

    this.emit('human-approval-required', {
      currentState: result.stateName,
      suggestedNextState: transitions[0]?.to || result.stateName,
      result,
      availableStates: config.workflow.states.map(s => s.name),
      reason: `verdict "${result.verdict}" 没有匹配的转移规则`,
      humanQuestion,
    });

    // Wait for human to force-transition
    await this.waitForHumanApproval();

    const humanSelectedState = this.pendingForceTransition || transitions[0]?.to || result.stateName;
    this.pendingForceTransition = null;
    this.pendingApprovalInfo = null;
    return humanSelectedState;
  }

  private matchCondition(
    condition: TransitionCondition,
    result: StateExecutionResult
  ): boolean {
    // Check verdict match (strict — no fallback for conditional_pass)
    if (condition.verdict && result.verdict !== condition.verdict) {
      return false;
    }

    // Check issue types
    if (condition.issueTypes && condition.issueTypes.length > 0) {
      const hasMatchingType = result.issues.some(
        issue => condition.issueTypes!.includes(issue.type)
      );
      if (!hasMatchingType) return false;
    }

    // Check severities
    if (condition.severities && condition.severities.length > 0) {
      const hasMatchingSeverity = result.issues.some(
        issue => condition.severities!.includes(issue.severity)
      );
      if (!hasMatchingSeverity) return false;
    }

    // Check issue count
    if (condition.minIssueCount !== undefined) {
      if (result.issues.length < condition.minIssueCount) return false;
    }
    if (condition.maxIssueCount !== undefined) {
      if (result.issues.length > condition.maxIssueCount) return false;
    }

    return true;
  }

  private parseNextStateFromOutputs(
    stepOutputs: string[],
    config: StateMachineWorkflowConfig
  ): string | null {
    const validStates = new Set(config.workflow.states.map(s => s.name));
    // Check outputs in reverse order (last judge output takes precedence)
    for (const output of [...stepOutputs].reverse()) {
      const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          if (parsed.next_state && validStates.has(parsed.next_state)) {
            return parsed.next_state;
          }
        } catch { /* ignore */ }
      }
    }
    return null;
  }

  private parseIssuesFromOutput(
    output: string,
    step: WorkflowStep,
    stateName: string
  ): Issue[] {
    const issues: Issue[] = [];

    // Try to parse JSON block
    const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.issues && Array.isArray(parsed.issues)) {
          for (const issue of parsed.issues) {
            // Skip issues without a meaningful description
            if (!issue.description?.trim()) continue;
            issues.push({
              type: issue.type || 'implementation',
              severity: issue.severity || 'minor',
              description: issue.description.trim(),
              foundInState: stateName,
              foundByAgent: step.agent,
            });
          }
        }
      } catch { /* ignore parse errors */ }
    }

    return issues;
  }

  private parseVerdict(output: string): 'pass' | 'conditional_pass' | 'fail' {
    // Empty judge output is invalid for transition decisions.
    // Treat as fail to prevent conditional_pass self-loop token burn.
    if (!output || !output.trim()) {
      return 'fail';
    }

    const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (['pass', 'conditional_pass', 'fail'].includes(parsed.verdict)) {
          return parsed.verdict;
        }
      } catch { /* ignore */ }
    }

    // Fallback: check for keywords
    if (/\b(pass|通过|成功)\b/i.test(output)) return 'pass';
    if (/\b(fail|失败|不通过)\b/i.test(output)) return 'fail';
    return 'conditional_pass';
  }

  private getTransitionReason(result: StateExecutionResult): string {
    if (result.verdict === 'pass') {
      return '所有检查通过';
    } else if (result.issues.length > 0) {
      const criticalCount = result.issues.filter(i => i.severity === 'critical').length;
      const majorCount = result.issues.filter(i => i.severity === 'major').length;
      return `发现 ${criticalCount} 个严重问题, ${majorCount} 个主要问题`;
    }
    return '条件性通过';
  }

  private generateStateSummary(state: StateMachineState, issues: Issue[]): string {
    const parts: string[] = [];
    parts.push(`状态 ${state.name} 执行完成`);
    parts.push(`执行了 ${state.steps.length} 个步骤`);
    if (issues.length > 0) {
      parts.push(`发现 ${issues.length} 个问题`);
    }
    return parts.join(', ');
  }

  // ========== Resume functionality ==========
  async recoverFromCrash(): Promise<void> {
    // Find any crashed runs and attempt to recover
    const runningRuns = await loadRunState(this.currentRunId || '').catch(() => null);
    if (!runningRuns) return;

    if (runningRuns.status === 'running' && runningRuns.mode === 'state-machine') {
      try {
        await this.resume(runningRuns.runId);
      } catch (error) {
      }
    }
  }

  async resume(runId: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    // Restore state
    this.currentRunId = runId;
    this.currentConfigFile = runState.configFile;
    this.currentRequirements = runState.requirements || '';
    this.currentState = runState.currentState || null;
    this.currentSupervisorAgent = runState.supervisorAgent || DEFAULT_SUPERVISOR_NAME;
    this.latestSupervisorReview = runState.latestSupervisorReview || null;
    this.humanQuestions = runState.humanQuestions || [];
    this.pendingHumanQuestionId = runState.pendingHumanQuestionId || runState.pendingCheckpoint?.humanQuestionId || null;
    this.humanAnswersContext = runState.humanAnswersContext || [];
    this.stateHistory = runState.stateHistory || [];
    this.issueTracker = (runState.issueTracker || []) as Issue[];
    this.transitionCount = runState.transitionCount || 0;
    this.completedSteps = runState.completedSteps || [];
    this.stepLogs = runState.stepLogs || [];
    this.qualityChecks = runState.qualityChecks || [];
    this.runStartTime = runState.startTime || null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.currentRunSpecCoding = runState.runSpecCoding
      ? normalizeSpecCodingDocument(runState.runSpecCoding)
      : null;

    this.humanQuestionWaiters.clear();

    // Restore self-transition counts from state history
    this.selfTransitionCounts = new Map();
    for (const record of this.stateHistory) {
      if (record.from === record.to) {
        const currentCount = this.selfTransitionCounts.get(record.from) || 0;
        this.selfTransitionCounts.set(record.from, currentCount + 1);
      }
    }

    this.status = 'running';
    this.shouldStop = false;

    // Clear stale in-memory flags from previous run to prevent ghost transitions
    this.pendingForceTransition = null;
    this.pendingForceInstruction = null;
    this.pendingApprovalInfo = null;
    this.interruptFlag = false;
    this.feedbackInterrupt = false;
    this.liveFeedback = [];

    this.emit('status', {
      status: 'running',
      message: '恢复运行中...',
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configPath = await getRuntimeWorkflowConfigPath(runState.configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    this.currentSupervisorAgent = runState.supervisorAgent || resolveWorkflowSupervisorAgent(workflowConfig);

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.ensureSupervisorAgentExists(workflowConfig);
    this.initializeAgents(workflowConfig);
    for (const persistedAgent of runState.agents || []) {
      const agent = this.agents.find((item) => item.name === persistedAgent.name);
      if (agent && persistedAgent.sessionId) {
        agent.sessionId = persistedAgent.sessionId;
      }
    }

    // Initialize engine
    await this.initializeEngine(workflowConfig.context?.engine);

    // If resuming from __human_approval__, restore the approval wait flow
    if (this.currentState === '__human_approval__') {
      const availableStates = workflowConfig.workflow.states.map(s => s.name);
      // Infer suggested next state from the last transition's "to" before __human_approval__
      const lastTransition = this.stateHistory.filter(h => h.to === '__human_approval__').pop();
      const previousState = lastTransition?.from;
      // Find the state config that triggered approval, use its first transition target as suggestion
      const prevStateConfig = previousState
        ? workflowConfig.workflow.states.find(s => s.name === previousState)
        : null;
      const suggestedNextState = prevStateConfig?.transitions?.[0]?.to || availableStates[0] || '';
      const restoredApprovalResult = runState.pendingCheckpoint?.result || { issues: [] };

      this.pendingApprovalInfo = {
        suggestedNextState,
        availableStates,
        result: restoredApprovalResult,
        supervisorAdvice: runState.pendingCheckpoint?.supervisorAdvice,
      };

      if (!this.getPendingHumanQuestion() && runState.pendingCheckpoint?.humanQuestion) {
        const restoredQuestion = runState.pendingCheckpoint.humanQuestion;
        this.humanQuestions = [
          { ...restoredQuestion, status: 'unanswered' as const, runId, configFile: runState.configFile },
          ...this.humanQuestions.filter((item) => item.id !== restoredQuestion.id),
        ];
        this.pendingHumanQuestionId = restoredQuestion.id;
      }
      if (!this.getPendingHumanQuestion()) {
        const restoredQuestion = await this.createHumanQuestion({
          kind: 'approval',
          title: '等待人工审查',
          message: runState.pendingCheckpoint?.supervisorAdvice || `请确认下一步状态：${suggestedNextState}`,
          supervisorAdvice: runState.pendingCheckpoint?.supervisorAdvice,
          currentState: '__human_approval__',
          previousState,
          suggestedNextState,
          availableStates,
          result: restoredApprovalResult,
          requiresWorkflowPause: true,
          answerSchema: {
            type: 'approval-transition',
            required: true,
            options: availableStates.map(s => ({ label: s, value: s })),
          },
          source: { type: 'human-approval', restored: true },
        });
        if (restoredQuestion?.id) this.pendingHumanQuestionId = restoredQuestion.id;
      }
      const pendingHumanQuestion = this.getPendingHumanQuestion();

      this.emit('state-change', {
        state: '__human_approval__',
        message: '等待人工审查决策',
      });

      this.emit('human-approval-required', {
        currentState: '__human_approval__',
        nextState: suggestedNextState,
        suggestedNextState,
        result: restoredApprovalResult,
        availableStates,
        supervisorAdvice: runState.pendingCheckpoint?.supervisorAdvice,
        humanQuestion: pendingHumanQuestion,
      });

      if (pendingHumanQuestion) {
        this.emit('human-question-required', { question: pendingHumanQuestion, humanQuestions: this.humanQuestions });
      }

      // Wait for human decision
      await this.waitForHumanApproval();

      const humanSelectedState: string = this.pendingForceTransition || suggestedNextState;
      const instruction = this.pendingForceInstruction || '';
      this.pendingForceTransition = null;
      this.pendingForceInstruction = null;
      this.pendingApprovalInfo = null;

      // Record transition from __human_approval__ to selected state
      this.stateHistory.push({
        from: '__human_approval__',
        to: humanSelectedState,
        reason: instruction
          ? `人工决策: 选择进入 ${humanSelectedState}，附加指令: ${instruction}`
          : `人工决策: 选择进入 ${humanSelectedState}`,
        issues: [],
        timestamp: new Date().toISOString(),
      });

      this.transitionCount++;
      this.emit('transition', {
        from: '__human_approval__',
        to: humanSelectedState,
        transitionCount: this.transitionCount,
        issues: [],
      });

      this.currentState = humanSelectedState;
    }

    // Continue execution from current state
    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
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
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  // ========== Live feedback functionality ==========
  private liveFeedback: string[] = [];
  private interruptFlag = false;
  private feedbackInterrupt = false; // true = non-urgent feedback interrupt (softer prompt tone)
  private queuedApprovalAction: 'approve' | 'iterate' | null = null;
  private iterationFeedback: string = '';
  /** 最近一次预执行命令（preCommands）的输出，会注入到对应步骤上下文中 */
  private lastPreCommandOutput: string | null = null;
  /** Multi-user: createdBy userId, set by workflow start route */
  public _createdBy?: string;
  /** Multi-user: user's personal directory for isolation */
  public _userPersonalDir?: string;
  /** The isolated working directory for this run (if isolation is active) */
  private isolatedDir: string | null = null;
  /** Original projectRoot from config (before isolation) */
  private currentProjectRoot: string | null = null;
  private getWorkingDirectory(): string | null {
    return this.isolatedDir || this.currentProjectRoot || null;
  }

  setQueuedApprovalAction(action: 'approve' | 'iterate'): void {
    this.queuedApprovalAction = action;
  }

  setIterationFeedback(feedback: string): void {
    this.iterationFeedback = feedback;
  }

  approve(): void {
    this.queuedApprovalAction = 'approve';
    this.emit('approve');
  }

  requestIteration(feedback: string): void {
    this.iterationFeedback = feedback;
    this.queuedApprovalAction = 'iterate';
    this.emit('iterate');
  }

  getInternalStatus(): string {
    return this.status;
  }

  injectLiveFeedback(message: string): void {
    const entry = { message, timestamp: new Date().toISOString() };
    this.liveFeedback.push(message);
    this.emit('feedback-injected', entry);

    // Interrupt the running process so feedback is delivered immediately via resume
    if (this.status === 'running' && this.currentState) {
      this.interruptFlag = true;
      this.feedbackInterrupt = true; // non-urgent flag, different prompt tone

      const currentProcId = this.currentProcesses?.[0]?.id;
      const currentStepId = this.currentProcesses?.[0]?.stepId;
      const allProcs = processManager.getAllProcesses();
      const running = allProcs.find(
        (p: any) => (p.status === 'running' || p.status === 'queued') && (
          (currentStepId && p.stepId === currentStepId) ||
          (currentProcId && p.id === currentProcId)
        )
      );
      if (running) {
        processManager.killProcess(running.id);
      }
      // For non-claude engines, also cancel via engine API
      if (this.currentEngine) {
        this.currentEngine.cancel();
      }
    }
  }

  recallLiveFeedback(message: string): boolean {
    const idx = this.liveFeedback.indexOf(message);
    if (idx === -1) return false;
    this.liveFeedback.splice(idx, 1);
    this.emit('feedback-recalled', { message, timestamp: new Date().toISOString() });
    return true;
  }

  interruptWithFeedback(message: string): boolean {
    if (this.status !== 'running' || !this.currentState) {
      return false;
    }

    // Queue the feedback
    this.liveFeedback.push(message);
    this.interruptFlag = true;

    // Find and kill the running process by stepId (most reliable), then fall back to processId
    const currentProcId = this.currentProcesses?.[0]?.id;
    const currentStepId = this.currentProcesses?.[0]?.stepId;
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => (p.status === 'running' || p.status === 'queued') && (
        (currentStepId && p.stepId === currentStepId) ||
        (currentProcId && p.id === currentProcId)
      )
    );

    if (running) {
      const killed = processManager.killProcess(running.id);
      // For non-claude engines, also cancel via engine API
      if (!killed && this.currentEngine) {
        this.currentEngine.cancel();
        // Mark external process as killed so executeWithEngine can detect it
        const rawProc = processManager.getProcessRaw(running.id);
        if (rawProc) {
          rawProc.status = 'killed';
          rawProc.endTime = new Date();
        }
      }
      this.emit('feedback-injected', { message, timestamp: new Date().toISOString() });
      return true;
    }
    return false;
  }

  // ========== Force complete functionality ==========
  async forceCompleteStep(): Promise<{ step: string; output: string } | null> {
    if (this.status !== 'running' || !this.currentState) {
      return null;
    }

    // Find the running process by stepId (most reliable), then fall back to processId
    const currentProcId = this.currentProcesses?.[0]?.id;
    const currentStepId = this.currentProcesses?.[0]?.stepId;
    const allProcs = processManager.getAllProcesses();
    const running = allProcs.find(
      (p: any) => (p.status === 'running' || p.status === 'queued') && (
        (currentStepId && p.stepId === currentStepId) ||
        (currentProcId && p.id === currentProcId)
      )
    );

    if (!running) return null;

    // Kill the process
    if (!processManager.killProcess(running.id) && this.currentEngine) {
      this.currentEngine.cancel();
      const rawProc = processManager.getProcessRaw(running.id);
      if (rawProc) { rawProc.status = 'killed'; rawProc.endTime = new Date(); }
    }

    // Get accumulated output
    const output = running.streamContent || '';

    this.emit('step-force-completed', {
      step: this.currentState,
      output,
      timestamp: new Date().toISOString(),
    });

    return {
      step: this.currentState,
      output,
    };
  }

  // ========== Rerun from step functionality ==========
  async rerunFromStep(runId: string, stateName: string): Promise<void> {
    if (this.status === 'running') {
      throw new Error('已有工作流正在运行');
    }

    const runState = await loadRunState(runId);
    if (!runState) {
      throw new Error(`找不到运行记录: ${runId}`);
    }

    if (runState.mode !== 'state-machine') {
      throw new Error('该运行记录不是状态机工作流');
    }

    // Find the state in history
    const stateIndex = this.stateHistory.findIndex(h => h.to === stateName);
    if (stateIndex === -1) {
      throw new Error(`找不到状态: ${stateName}`);
    }

    // Restore state up to that point
    this.currentRunId = runId;
    this.currentConfigFile = runState.configFile;
    this.currentRequirements = runState.requirements || '';
    this.currentState = stateName;
    this.currentSupervisorAgent = runState.supervisorAgent || DEFAULT_SUPERVISOR_NAME;
    this.latestSupervisorReview = runState.latestSupervisorReview || null;
    this.stateHistory = runState.stateHistory?.slice(0, stateIndex + 1) || [];
    this.issueTracker = (runState.issueTracker || []) as Issue[];
    this.transitionCount = stateIndex + 1;
    this.completedSteps = runState.completedSteps || [];
    this.stepLogs = runState.stepLogs || [];
    this.qualityChecks = runState.qualityChecks || [];
    this.runStartTime = runState.startTime || null;
    this.globalContext = runState.globalContext || '';
    this.stateContexts = new Map(Object.entries(runState.phaseContexts || {}));
    this.currentRunSpecCoding = runState.runSpecCoding
      ? normalizeSpecCodingDocument(runState.runSpecCoding)
      : null;
    this.status = 'running';
    this.shouldStop = false;

    // Clear stale in-memory flags from previous run to prevent ghost transitions
    this.pendingForceTransition = null;
    this.pendingForceInstruction = null;
    this.pendingApprovalInfo = null;
    this.interruptFlag = false;
    this.feedbackInterrupt = false;
    this.liveFeedback = [];

    this.emit('status', {
      status: 'running',
      message: `从状态 ${stateName} 重新运行...`,
      startTime: this.runStartTime,
      endTime: this.runEndTime,
      currentConfigFile: this.currentConfigFile
    });

    // Persist state immediately after setting status to running
    await this.persistState();

    // Load config and continue execution
    const configPath = await getRuntimeWorkflowConfigPath(runState.configFile);
    const configContent = await readFile(configPath, 'utf-8');
    const workflowConfig = parse(configContent) as StateMachineWorkflowConfig;
    this.currentSupervisorAgent = runState.supervisorAgent || resolveWorkflowSupervisorAgent(workflowConfig);

    // Load agent configs and initialize agents
    await this.loadAgentConfigs();
    this.ensureSupervisorAgentExists(workflowConfig);
    this.initializeAgents(workflowConfig);
    for (const persistedAgent of runState.agents || []) {
      const agent = this.agents.find((item) => item.name === persistedAgent.name);
      if (agent && persistedAgent.sessionId) {
        agent.sessionId = persistedAgent.sessionId;
      }
    }

    // Continue execution from this state
    try {
      await this.executeStateMachine(workflowConfig, runState.requirements);

      if (!this.shouldStop) {
        this.status = 'completed';
        this.emit('status', {
          status: 'completed',
          message: '工作流执行完成',
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
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
          startTime: this.runStartTime,
          endTime: this.runEndTime,
          currentConfigFile: this.currentConfigFile
        });
        await this.finalizeRun('failed');
      }
      throw error;
    }
  }

  private async queryAgent(
    agentName: string,
    question: string,
    config: StateMachineWorkflowConfig
  ): Promise<string> {
    const roleConfig = this.agentConfigs.find(r => r.name === agentName)
      || config.roles?.find(r => r.name === agentName);

    if (!roleConfig) {
      return `[错误] 找不到 Agent 配置: ${agentName}`;
    }

    const specCodingBlock = this.currentRunSpecCoding
      ? [
        '# 当前 Run Spec Coding 投影',
        `- 版本: v${this.currentRunSpecCoding.version}`,
        this.currentRunSpecCoding.summary ? `- 摘要: ${this.currentRunSpecCoding.summary}` : '',
        this.currentRunSpecCoding.progress?.summary ? `- 进度: ${this.currentRunSpecCoding.progress.summary}` : '',
        this.currentRunSpecCoding.tasks?.length
          ? `- tasks.md: ${this.currentRunSpecCoding.tasks.filter((task) => task.status === 'completed').length}/${this.currentRunSpecCoding.tasks.length} 已完成`
          : '',
        this.currentState ? `- 当前状态: ${this.currentState}` : '',
        '- 规则: 你可以基于该 Spec Coding 投影回答问题；普通 Agent 只能推进状态，系统会同步到正式 tasks.md；任务标记使用 [ ]=未开始、[-]=进行中、[x]=已完成；结构性修订由 Supervisor 负责。',
      ].filter(Boolean).join('\n')
      : '';
    const prompt = [
      specCodingBlock,
      '# 问题',
      question,
      '',
      '请直接回答这个问题，不需要执行其他任务。',
    ].filter(Boolean).join('\n\n');
    const model = resolveAgentModel(roleConfig, config.context);
    const systemPrompt = roleConfig.systemPrompt || `你是一个 AI 助手。`;
    const agentState = this.agents.find((item) => item.name === agentName);

    const processId = `query-${agentName}-${Date.now()}`;

    try {
      const result = await this.executeWithEngine(
        processId,
        agentName,
        'query',
        prompt,
        systemPrompt,
        model,
        {
          workingDirectory: config.context?.projectRoot
            ? this.resolveProjectRootPath(config.context.projectRoot)
            : this.resolveProjectRootPath(),
          timeoutMs: 60000,
          resumeSessionId: agentState?.sessionId || undefined,
        }
      );
      const answer = result.result || '[无输出]';
      if (result.session_id && agentState) {
        agentState.sessionId = result.session_id;
      }
      
      this.agentFlow.push({
        id: `flow-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'response',
        fromAgent: agentName,
        toAgent: 'supervisor',
        message: answer,
        stateName: this.currentState || '',
        stepName: '',
        round: 0,
        timestamp: new Date().toISOString(),
      });
      this.emit('agent-flow', { agentFlow: this.agentFlow });
      
      return answer;
    } catch (error) {
      return `[错误] 查询 Agent 失败: ${error}`;
    }
  }

}

export const stateMachineWorkflowManager = new StateMachineWorkflowManager();
