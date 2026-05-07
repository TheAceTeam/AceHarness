/**
 * 工作流管理器
 * 负责工作流的执行和状态管理，支持对抗迭代工作流
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { readFile, readdir, stat, mkdir, cp, rm, copyFile } from 'fs/promises';
import { resolve, join, dirname } from 'path';
import { existsSync, readFileSync } from 'fs';
import { cpus } from 'os';
import { parse } from 'yaml';
import { fenced } from './markdown-utils';
import { processManager } from './process-manager';
import type { EngineJsonResult } from './engines/engine-interface';
import { createRun, updateRun } from './run-store';
import type { RunRecord } from './run-store';
import {
  saveRunState, saveProcessOutput, saveStreamContent, loadStreamContent, loadStepOutputs, loadRunState, findRunningRuns, isProcessAlive,
  type PersistedRunState, type PersistedProcessInfo, type PersistedStepLog,
} from './run-state-persistence';
import type { WorkflowConfig, WorkflowPhase, WorkflowStep, RoleConfig, IterationConfig } from './schemas';
import { formatTimestamp } from './utils';
import { createEngine, getConfiguredEngine, type Engine, type EngineType } from './engines';
import { getEngineSkillsSubdir } from './engines/engine-config';
import type { EngineStreamEvent } from './engines/engine-interface';
import { getRuntimeAgentsDirPath, getRuntimeWorkflowConfigPath } from './runtime-configs';
import { getRuntimeSkillsDirPath } from './runtime-skills';
import { getEngineConfigPath, getWorkspaceRoot, getWorkspaceRunsDir } from './app-paths';
import { resolveAgentSelection } from './agent-engine-selection';
import {
  parseNeedInfo,
  isPlanDone,
  routeInfoRequest,
  type AgentSummary,
} from './supervisor-router';

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

  const resolved = resolveAgentSelection(
    roleConfig,
    { engine: globalEngine, defaultModel },
    workflowContext?.engine,
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
  /** Multi-user: user's personal directory for isolation */
  public _userPersonalDir?: string;
  /** The isolated working directory for this run (if isolation is active) */
  private isolatedDir: string | null = null;
  /** Original projectRoot from config (before isolation) */
  private currentProjectRoot: string | null = null;
  private getWorkingDirectory(): string | null {
    return this.isolatedDir || this.currentProjectRoot || null;
  }
  /** Cached workflow-level skills from context.skills */
  private workflowSkillsContent: string = '';
  /** Skills copied to workspace that need cleanup on finish */
  private copiedSkills: { dir: string; names: string[]; indexCopied: boolean; dirExistedBefore: boolean } | null = null;
  /** Current engine instance (Kiro CLI, Codex, etc.) */
  private currentEngine: Engine | null = null;
  /** Current engine type */
  private engineType: EngineType = 'claude-code';

  /** Get the workspace skills subdir based on current engine type */
  private get workspaceSkillsSubdir(): string {
    return getEngineSkillsSubdir(this.engineType);
  }

  private resolveProjectRootPath(projectRoot?: string | null): string {
    const baseDir = this._userPersonalDir || getWorkspaceRoot();
    return projectRoot ? resolve(baseDir, projectRoot) : baseDir;
  }

  // ========== Supervisor-Lite Plan 循环相关 ==========
  /** 待解答的用户问题 Promise 解析器 */
  private pendingUserQuestionResolver: ((answer: string) => void) | null = null;
  /** 当前等待解答的问题 */
  private pendingUserQuestion: { question: string; fromAgent: string; round: number } | null = null;

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
      if (existsSync(dst)) continue; // already exists (symlink or real dir)
      try {
        const { symlinkSync } = await import('fs');
        symlinkSync(src, dst);
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
      return configs;
    } catch {
      return [];
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
      const supportedEngines: EngineType[] = ['claude-code', 'kiro-cli', 'codex', 'cursor', 'cangjie-magic', 'opencode', 'nga', 'codegenie', 'trae-cli'];
      const isSupportedEngine = (value: string): value is EngineType => supportedEngines.includes(value as EngineType);

      if (requestedEngine) {
        if (isSupportedEngine(requestedEngine)) {
          this.engineType = requestedEngine;
        } else {
          const globalEngine = await getConfiguredEngine();
          console.warn(`[WorkflowManager] 工作流配置的引擎无效: ${requestedEngine}，回退到全局引擎 ${globalEngine}`);
          this.emit('log', `工作流配置的引擎无效: ${requestedEngine}，回退到全局引擎 ${globalEngine}`);
          this.engineType = globalEngine;
        }
      } else {
        this.engineType = await getConfiguredEngine();
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

    // Set up stream handler for the engine
    const streamHandler = (event: EngineStreamEvent) => {
      // Accumulate stream content on the registered process
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.streamContent += event.content;
      }
      processManager.emit('stream', {
        id: processId,
        step: step,
        delta: event.content,
        total: rawProc?.streamContent || event.content,
      });
    };

    this.currentEngine.on('stream', streamHandler);

    try {
      const result = await this.currentEngine.execute({
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
      });

      // Mark process as completed
      const rawProc = processManager.getProcessRaw(processId);
      if (rawProc) {
        rawProc.status = result.success ? 'completed' : 'failed';
        rawProc.endTime = new Date();
        rawProc.output = result.output || rawProc.streamContent;
        rawProc.sessionId = result.sessionId;
        if (!result.success) rawProc.error = result.error || '';
      }

      // Convert engine result to EngineJsonResult format
      return {
        result: result.success ? result.output : (result.error || result.output),
        session_id: result.sessionId || '',
        is_error: !result.success,
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
      const state: PersistedRunState = {
        runId: this.currentRunId,
        configFile: this.currentConfigFile || '',
        status: (this.status === 'idle' ? (this.shouldStop ? 'stopped' : 'completed') : this.status) as PersistedRunState['status'],
        statusReason: this.statusReason || undefined,
        startTime: this.runStartTime || new Date().toISOString(),
        endTime: this.runEndTime || null,
        currentPhase: this.currentPhase,
        currentStep: this.currentStep,
        completedSteps: [...this.completedStepNames],
        failedSteps: [...this.failedStepNames],
        stepLogs: [...this.stepLogs],
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
      };
      await saveRunState(state);
    } catch { /* non-critical */ }
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

  async start(configFile: string): Promise<void> {
    if (this.status === 'running' || this.status === 'preparing') {
      throw new Error('已有工作流正在运行');
    }

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
    this.runStartTime = new Date().toISOString();
    this.runEndTime = null;
    this.currentRunId = null;
    this.agentSessionIds.clear();
    this.liveFeedback = [];
    this.globalContext = '';
    this.workspaceSkills = '';
    this.phaseContexts.clear();
    this.isolatedDir = null;
    this.currentProjectRoot = null;

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
      const runId = `run-${formatTimestamp()}`;
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

      // === Preparing phase: load agents, init engine, sync skills ===
      await reportPreparingProgress('准备中：加载 Agent 配置...', '加载 Agent 配置');
      this.agentConfigs = await this.loadAgentConfigs();
      if (this.shouldStop) return;
      await reportPreparingProgress('准备中：初始化执行引擎...', '初始化执行引擎');
      await this.initializeEngine(workflowConfig.context?.engine);
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
      this.emit('status', { status: 'running', message: '工作流已启动', runId, workingDirectory: this.getWorkingDirectory() });
      await this.persistState();

      await this.executeWorkflow(workflowConfig);

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

  private async finalizeRun(status: 'completed' | 'failed' | 'stopped') {
    if (!this.currentRunId) return;
    this.runEndTime = new Date().toISOString();

    // Cleanup copied skills from workspace
    await this.cleanupWorkspaceSkills();

    try {
      const completedSteps = this.agents.reduce((sum, a) => sum + a.completedTasks, 0);
      await updateRun(this.currentRunId, {
        endTime: this.runEndTime,
        status,
        currentPhase: this.currentPhase,
        completedSteps,
      });
    } catch { /* non-critical */ }
    await this.persistState();
    this.status = 'idle';
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
        team: roleConfig?.team || 'blue',
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
   * Expects a ```json block at the end of the output with:
   *   { "verdict": "pass"|"conditional_pass"|"fail", "remaining_issues": N, "summary": "..." }
   * Falls back to parseBugCount if no JSON found.
   */
  parseStepVerdict(output: string): { verdict: 'pass' | 'conditional_pass' | 'fail'; remainingIssues: number; summary: string } {
    const jsonMatch = output.match(/```json\s*\n\s*(\{[\s\S]*?\})\s*\n\s*```\s*$/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return {
          verdict: ['pass', 'conditional_pass', 'fail'].includes(parsed.verdict) ? parsed.verdict : 'fail',
          remainingIssues: typeof parsed.remaining_issues === 'number' ? parsed.remaining_issues : 0,
          summary: parsed.summary || '',
        };
      } catch { /* fall through */ }
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

    try {
      // ========== Supervisor-Lite: 判断是否启用 Plan 循环 ==========
      let resultText: string;
      let jsonResult: EngineJsonResult;
      if (step.enablePlanLoop) {
        jsonResult = await this.executeStepWithInfoGathering(step, workflowConfig);
        resultText = jsonResult.result;
      } else {
        jsonResult = await this.executeStep(step, workflowConfig);
        resultText = jsonResult.result;
      }

      const tokenUsage: TokenUsage = {
        inputTokens: jsonResult.usage.input_tokens,
        outputTokens: jsonResult.usage.output_tokens,
      };
      this.updateAgentTokenUsage(step.agent, tokenUsage);

      if (jsonResult.session_id) {
        this.agentSessionIds.set(step.agent, jsonResult.session_id);
      }

      if (agent) {
        agent.lastOutput = resultText;
        agent.summary = this.parseSummary(resultText);
        agent.costUsd += jsonResult.cost_usd || 0;
        agent.sessionId = jsonResult.session_id || null;
        const newChanges = this.parseChanges(resultText);
        agent.changes = [...agent.changes, ...newChanges];
      }

      this.updateAgentStatus(step.agent, 'completed');
      this.completedStepNames.push(step.name);

      // Record step log
      this.stepLogs.push({
        id: stepId,
        stepName: step.name,
        agent: step.agent,
        status: 'completed',
        output: resultText,
        error: '',
        costUsd: jsonResult.cost_usd || 0,
        durationMs: jsonResult.duration_ms || 0,
        timestamp: new Date().toISOString(),
      });

      this.emit('result', {
        id: stepId,
        step: step.name,
        agent: step.agent,
        output: resultText.substring(0, 500) + (resultText.length > 500 ? '...' : ''),
        fullOutput: resultText,
        role: step.role,
        costUsd: jsonResult.cost_usd,
        sessionId: jsonResult.session_id,
        numTurns: jsonResult.num_turns,
        durationMs: jsonResult.duration_ms,
      });

      if (this.currentRunId) {
        saveProcessOutput(this.currentRunId, step.name, resultText).catch(() => {});
      }
      await this.persistState();

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

        this.stepLogs.push({
          id: stepId,
          stepName: step.name,
          agent: step.agent,
          status: 'completed',
          output: resultText,
          error: '',
          costUsd: 0,
          durationMs: 0,
          timestamp: new Date().toISOString(),
        });

        this.emit('result', {
          id: stepId,
          step: step.name,
          agent: step.agent,
          output: resultText.substring(0, 500) + (resultText.length > 500 ? '...' : ''),
          fullOutput: resultText,
          role: step.role,
          costUsd: 0,
          numTurns: 0,
          durationMs: 0,
          forceCompleted: true,
        });

        if (this.currentRunId) {
          saveProcessOutput(this.currentRunId, step.name, resultText).catch(() => {});
        }
        await this.persistState();
        return resultText;
      }

      const errorMsg = error.message || String(error);

      this.updateAgentStatus(step.agent, 'failed');
      this.failedStepNames.push(step.name);
      this.currentStep = null;

      // Record failed step log
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
    const mainPrompt = await this.buildPrompt(step, workflowConfig, roleConfig, previousOutputs);
    const coordinatorPrompt = `${mainPrompt}\n\n# 专家模式说明\n你现在处于专家模式。你有 ${subAgentNames.length} 个专家子 Agent 可以调用：\n\n${subAgentNames.map(name => `- @${name}: ${subAgents[name].description}`).join('\n')}\n\n请使用 @agent-name 语法调用这些专家，收集他们的分析结果，最后汇总形成综合结论。`;

    const processId = `${step.agent}-${step.name}-${Date.now()}`;
    const existingSessionId = this.agentSessionIds.get(step.agent);
    const isIterationStep = step.name.includes('-迭代');
    const systemPromptToUse = isIterationStep && roleConfig.iterationPrompt
      ? roleConfig.iterationPrompt
      : roleConfig.systemPrompt;

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
        coordinatorPrompt,
        systemPromptToUse,
        resolveAgentModel(roleConfig, workflowConfig.context),
        {
          workingDirectory: workflowConfig.context.projectRoot,
          allowedTools: roleConfig.allowedTools,
          resumeSessionId: existingSessionId,
          appendSystemPrompt: !!existingSessionId,
          timeoutMs: workflowConfig.context.timeoutMinutes
            ? workflowConfig.context.timeoutMinutes * 60 * 1000
            : undefined,
          runId: this.currentRunId || undefined,
          agents: agentsJson, // Pass sub-agents configuration
          mcpServers: roleConfig.mcpServers,
        }
      );

      const proc = processManager.getProcess(processId);
      if (this.currentRunId && proc?.streamContent) {
        saveStreamContent(this.currentRunId, step.name, proc.streamContent).catch(() => {});
      }
      return result;
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

    const prompt = await this.buildPrompt(step, workflowConfig, roleConfig, previousOutputs, extraContext);
    const processId = `${step.agent}-${step.name}-${Date.now()}`;

    // Check for existing session to resume (iterative phases)
    const existingSessionId = this.agentSessionIds.get(step.agent);

    // Determine which system prompt to use: iterationPrompt for iteration steps, systemPrompt otherwise
    const isIterationStep = step.name.includes('-迭代');
    const systemPromptToUse = isIterationStep && roleConfig.iterationPrompt
      ? roleConfig.iterationPrompt
      : roleConfig.systemPrompt;

    // Set up stream content flushing to disk (with chunk separators)
    let lastFlush = 0;
    let activeProcessId = processId;
    let accumulatedStream = ''; // Accumulate stream content across feedback rounds
    const streamHandler = (data: { id: string; step: string; total: string }) => {
      if (data.id !== activeProcessId) return;
      const now = Date.now();
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

    let currentProcessId = processId;
    let currentPrompt = prompt;
    let currentSessionId = existingSessionId;
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
            resolveAgentModel(roleConfig, workflowConfig.context),
            {
              workingDirectory: workflowConfig.context.projectRoot,
              allowedTools: roleConfig.allowedTools,
              resumeSessionId: currentSessionId,
              appendSystemPrompt: !!currentSessionId,
              timeoutMs: workflowConfig.context.timeoutMinutes
                ? workflowConfig.context.timeoutMinutes * 60 * 1000
                : undefined,
              runId: this.currentRunId || undefined,
              mcpServers: roleConfig.mcpServers,
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
            if (!sessionId) throw err; // Can't resume without session ID

            const feedbackPrompt = this.liveFeedback.join('\n\n');
            this.liveFeedback = [];
            const feedbackTimestamp = new Date().toISOString();
            accumulatedStream += `\n\n<!-- chunk-boundary -->\n\n<!-- human-feedback: ${feedbackTimestamp} -->\n${feedbackPrompt}`;
            if (this.currentRunId) {
              saveStreamContent(this.currentRunId, step.name, accumulatedStream).catch(() => {});
            }
            currentSessionId = sessionId;
            currentPrompt = isFeedbackOnly
              ? `## 人工实时反馈\n用户在你执行过程中提供了补充反馈，请参考以下内容继续完成任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`
              : `## 人工实时反馈（紧急打断）\n用户紧急打断了当前执行，请立即处理以下反馈：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
            currentProcessId = `${step.agent}-${step.name}-interrupt-${Date.now()}`;
            activeProcessId = currentProcessId;
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

        // Save session ID for potential resume
        if (result.session_id) {
          this.agentSessionIds.set(step.agent, result.session_id);
        }

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

          // Resume the same session with feedback
          currentSessionId = sessionId;
          currentPrompt = `## 人工实时反馈\n以下是用户在你执行过程中提供的反馈意见，请基于这些反馈继续处理当前任务：\n\n${feedbackPrompt}\n\n请根据以上反馈继续完成任务。`;
          currentProcessId = `${step.agent}-${step.name}-feedback-${Date.now()}`;
          activeProcessId = currentProcessId;

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
      return { ...lastResult!, result: accumulatedOutput };
    } finally {
      processManager.off('stream', streamHandler);
    }
  }

  async buildPrompt(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig,
    roleConfig: RoleConfig,
    previousOutputs?: Record<string, string>,
    extraContext?: string
  ): Promise<string> {
    let prompt = `# 任务\n${step.task}\n\n`;

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
        prompt += `## 文档输出要求\n`;
        prompt += `请将你产出的所有文档、报告、分析结果等写入以下目录：\n`;
        prompt += `\`${outputDir}/\`\n\n`;
        prompt += `**重要**: 文件名必须以时间戳开头（如 \`${ts}-报告名称.md\`），这样便于按时间排序且不会覆盖已有文件。\n\n`;
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

    // ========== Supervisor-Lite: 注入信息请求协议 ==========
    if (step.enablePlanLoop) {
      prompt += `## 信息请求协议\n`;
      prompt += `在执行任务前，请先评估你是否有足够的信息。\n`;
      prompt += `如果信息不足，先进行信息收集而不直接执行任务，请使用以下格式声明你需要的信息：\n`;
      prompt += `- 需要技术/专业信息补充信息时：[NEED_INFO] 问题描述\n`;
      prompt += `- 需要用户/人工补充信息时：[NEED_INFO:human] 问题描述\n`;
      prompt += `- 如果有多个问题需要确认，也只需要列出一个[NEED_INFO]/[NEED_INFO:human]，并在问题描述中列出所有需要确认的问题\n`;
      prompt += `- 如果有问题需要确认，则不执行任务，直接将问题以上述格式进行输出，结束本轮执行，不需要等待回复，supervisor会给你路由到对应的专家，信息收集可能存在多轮\n`;
      prompt += `- 如果信息已充分可以执行：输出[PLAN_DONE]，并执行具体任务\n`;
      prompt += `\n注意：你不需要指定由谁来回答技术问题，系统会自动路由到合适的专家。\n\n`;
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

  injectLiveFeedback(message: string): void {
    const entry = { message, timestamp: new Date().toISOString() };
    this.liveFeedback.push(message);
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
      }
    }
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
  interruptWithFeedback(message: string): boolean {
    if (this.status !== 'running' || !this.currentStep) return false;

    // Queue the feedback
    this.liveFeedback.push(message);
    this.interruptFlag = true;

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
    this.emit('feedback-injected', { message, timestamp: new Date().toISOString() });
    return true;
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
          try {
            const { execSync } = await import('child_process');
            execSync('pkill -f "claude.*--output-format json" 2>/dev/null || true', { timeout: 5000 });
          } catch { /* ignore */ }

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
    this.runStartTime = runState.startTime;
    this.runEndTime = null;
    this.statusReason = null;
    this.pendingCheckpoint = runState.pendingCheckpoint || null;
    this.agentSessionIds.clear();
    this.liveFeedback = [];
    this.globalContext = runState.globalContext || '';
    this.phaseContexts = new Map(Object.entries(runState.phaseContexts || {}));

    console.log(`[WorkflowManager.resume] runId=${runId}`);
    console.log(`[WorkflowManager.resume] completedSteps=`, this.completedStepNames);
    console.log(`[WorkflowManager.resume] iterationStates=`, JSON.stringify(runState.iterationStates));

    // Initialize engine
    await this.initializeEngine(workflowConfig.context?.engine);

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
      stepLogs: this.stepLogs,
      workflow: this.currentWorkflow,
      iterationStates: Object.fromEntries(this.iterationStates),
      workingDirectory: this.getWorkingDirectory(),
    };
  }

  getIterationStates(): Map<string, IterationState> {
    return this.iterationStates;
  }

  // ========== Supervisor-Lite Plan 循环实现 ==========

  private async executeStepWithInfoGathering(
    step: WorkflowStep,
    workflowConfig: WorkflowConfig
  ): Promise<EngineJsonResult> {
    const maxRounds = step.maxPlanRounds || 3;
    let round = 0;
    let extraContext = '';

    while (round < maxRounds) {
      const jsonResult = await this.executeStep(step, workflowConfig, extraContext);
      const output = jsonResult.result;

      const infoRequests = parseNeedInfo(step, output);
      if (infoRequests.length === 0) {
        console.log(`[WorkflowManager] Step ${step.name} 没有信息请求，结束`);
        return jsonResult;
      }

      if (isPlanDone(output)) {
        console.log(`[WorkflowManager] Step ${step.name} 已 PLAN_DONE，继续执行任务`);
        return jsonResult;
      }

      for (const req of infoRequests) {
        if (req.isHuman) {
          this.emit('plan-question', { question: req.question, fromAgent: step.agent, round });
          const answer = await this.waitForUserAnswer(req.question, step.agent, round);
          extraContext += `\n\n[用户回答] ${req.question}\n${answer}`;
          console.log(`[WorkflowManager] 用户回答: ${answer}`);
        } else {
          const agentSummaries = this.buildAgentSummaries();
          const decision = await routeInfoRequest(
            req,
            agentSummaries,
            step.name,
            this.callLightweightLLM.bind(this)
          );

          if (!decision) {
            console.log(`[WorkflowManager] 无法路由，fallback 到用户回答`);
            this.emit('plan-question', { question: req.question, fromAgent: step.agent, round });
            const answer = await this.waitForUserAnswer(req.question, step.agent, round);
            extraContext += `\n\n[用户回答] ${req.question}\n${answer}`;
            console.log(`[WorkflowManager] 用户回答: ${answer}`);
          } else {
            this.emit('route-decision', { ...decision, round });
            const answer = await this.queryAgent(decision.route_to, decision.question, workflowConfig);
            console.log(`[WorkflowManager] ${decision.route_to} 回答: ${answer}`);
            extraContext += `\n\n[${decision.route_to} 回答] ${decision.question}\n${answer}`;
          }
        }
      }

      this.emit('plan-round', { step: step.name, round: round + 1, maxRounds, infoRequests });
      round++;
    }

    extraContext += '\n\n[系统] 信息收集已完成，请基于现有信息执行任务。';
    return this.executeStep(step, workflowConfig, extraContext);
  }

  private buildAgentSummaries(): AgentSummary[] {
    return this.agentConfigs
      .filter(c => c.name)
      .map(c => ({
        name: c.name,
        description: c.description || '',
        keywords: c.keywords || [],
      }));
  }

  private async queryAgent(
    agentName: string,
    question: string,
    workflowConfig: WorkflowConfig
  ): Promise<string> {
    const roleConfig = this.agentConfigs.find(r => r.name === agentName)
      || workflowConfig.roles?.find(r => r.name === agentName);

    if (!roleConfig) {
      return `[错误] 找不到 Agent 配置: ${agentName}`;
    }

    const prompt = `# 问题\n${question}\n\n请直接回答这个问题，不需要执行其他任务。`;
    const model = resolveAgentModel(roleConfig, workflowConfig.context);
    const systemPrompt = roleConfig.systemPrompt || `你是一个 AI 助手。`;

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
          workingDirectory: workflowConfig.context?.projectRoot
            ? this.resolveProjectRootPath(workflowConfig.context.projectRoot)
            : this.resolveProjectRootPath(),
          timeoutMs: 60000,
          mcpServers: roleConfig.mcpServers,
        }
      );
      return result.result || '[无输出]';
    } catch (error) {
      return `[错误] 查询 Agent 失败: ${error}`;
    }
  }

  private async callLightweightLLM(prompt: string): Promise<string> {
    const processId = `router-llm-${Date.now()}`;

    try {
      const result = await this.executeWithEngine(
        processId,
        'router',
        'route',
        prompt,
        '你是一个路由器，根据问题选择最合适的 Agent。',
        'claude-sonnet-4-6',
        {
          workingDirectory: this.resolveProjectRootPath(),
          timeoutMs: 120000, // 2 分钟超时
        }
      );
      return result.result || '';
    } catch (error: any) {
      console.error('[SupervisorRouter] LLM 调用失败:', error?.message || error);
      return ''; // 返回空字符串，让上层处理
    }
  }

  private async waitForUserAnswer(question: string, fromAgent: string, round: number): Promise<string> {
    this.pendingUserQuestion = { question, fromAgent, round };

    return new Promise((resolve) => {
      this.pendingUserQuestionResolver = resolve;

      const checkInterval = setInterval(() => {
        if (!this.pendingUserQuestionResolver) {
          clearInterval(checkInterval);
        }
      }, 500);

      setTimeout(() => {
        if (this.pendingUserQuestionResolver) {
          this.pendingUserQuestionResolver('[超时] 用户未回答');
          this.pendingUserQuestionResolver = null;
          this.pendingUserQuestion = null;
          clearInterval(checkInterval);
        }
      }, 300000);
    });
  }

  submitUserAnswer(answer: string): void {
    if (this.pendingUserQuestionResolver) {
      this.pendingUserQuestionResolver(answer);
      this.pendingUserQuestionResolver = null;
      this.pendingUserQuestion = null;
    }
  }

  getPendingUserQuestion(): { question: string; fromAgent: string; round: number } | null {
    return this.pendingUserQuestion;
  }

  /** Phase 模式无 SDK Plan；与 StateMachineWorkflowManager 接口对齐 */
  submitSdkPlanAnswers(_answers: Record<string, string>): void {
    /* no-op */
  }

  getPendingSdkPlanQuestion(): null {
    return null;
  }
}

// 全局单例 — use globalThis to survive Next.js dev HMR
const globalForWorkflow = globalThis as unknown as { __workflowManager?: WorkflowManager };
export const workflowManager = globalForWorkflow.__workflowManager ??= new WorkflowManager();
