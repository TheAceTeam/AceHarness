/**
 * Workflow Registry — manages multiple concurrent workflow manager instances.
 * Each configFile gets its own manager instance, enabling parallel workflow execution.
 */
import { EventEmitter } from 'events';
import { WorkflowManager } from '@/lib/workflow/manager';
import { StateMachineWorkflowManager } from '@/lib/state-machine/workflow-manager';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { loadRunState } from '@/lib/run/state-persistence';
import { ensureRuntimeConfigsSeeded, getBundledWorkflowConfigPath, getRuntimeWorkflowConfigPath } from '@/lib/run/runtime-configs';
import { getWorkflowEventStore } from '@/lib/workflow/event-store';

export type AnyWorkflowManager = WorkflowManager | StateMachineWorkflowManager;

export function isStateMachineManagerLike(manager: AnyWorkflowManager | null | undefined): manager is StateMachineWorkflowManager {
  return Boolean(
    manager
    && typeof (manager as StateMachineWorkflowManager).forceTransition === 'function'
    && typeof (manager as StateMachineWorkflowManager).forceJumpToState === 'function'
    && typeof (manager as StateMachineWorkflowManager).setQueuedApprovalAction === 'function'
    && typeof (manager as StateMachineWorkflowManager).resume === 'function'
    && typeof (manager as StateMachineWorkflowManager).getHumanQuestions === 'function'
    && typeof (manager as StateMachineWorkflowManager).createHumanQuestion === 'function'
    && typeof (manager as StateMachineWorkflowManager).answerHumanQuestion === 'function'
  );
}

interface ManagerEntry {
  managerKey: string;
  configFile: string;
  manager: AnyWorkflowManager;
  isStateMachine: boolean;
  createdAt: number;
  implementationVersion?: symbol;
}

const WORKFLOW_REGISTRY_IMPLEMENTATION_VERSION = Symbol('workflow-registry-implementation');

function compactRegistryEventPayload(input: any): any {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const result: any = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'output' || key === 'fullOutput' || key === 'streamContent') {
      result[`${key}Size`] = typeof value === 'string' ? value.length : 0;
      continue;
    }
    if (key === 'result' && value && typeof value === 'object' && !Array.isArray(value)) {
      const nested: any = { ...(value as any) };
      if (Array.isArray(nested.stepOutputs)) {
        nested.stepOutputCount = nested.stepOutputs.length;
        nested.stepOutputBytes = nested.stepOutputs.reduce((sum: number, item: any) => sum + (typeof item === 'string' ? item.length : 0), 0);
        nested.stepOutputs = [];
      }
      result[key] = nested;
      continue;
    }
    result[key] = value;
  }
  return result;
}

class WorkflowRegistry extends EventEmitter {
  private managers = new Map<string, ManagerEntry>();
  private pendingManagerCreations = new Map<string, Promise<AnyWorkflowManager>>();
  private managerKeysByRunId = new Map<string, string>();
  private implementationVersion = WORKFLOW_REGISTRY_IMPLEMENTATION_VERSION;

  refreshImplementation(): void {
    this.implementationVersion = WORKFLOW_REGISTRY_IMPLEMENTATION_VERSION;
    for (const [key, entry] of this.managers) {
      if (this.isActiveStatus(entry.manager.getStatus().status)) continue;
      this.removeManagerEntry(key, entry);
    }
  }

  private topLevelManagerKey(configFile: string): string {
    return `config:${configFile}`;
  }

  private isActiveStatus(status: string): boolean {
    return status === 'running' || status === 'preparing';
  }

  /** All event types that workflow managers emit */
  private static PHASE_EVENTS = [
    'status', 'phase', 'step', 'result', 'checkpoint', 'agents',
    'log',
    'iteration', 'iteration-complete', 'escalation', 'token-usage',
    'feedback-injected', 'feedback-recalled', 'context-updated',
    'route-decision',
  ];
  private static SM_EVENTS = [
    'state-change', 'step-start', 'step-complete', 'transition',
    'force-transition', 'transition-forced', 'human-approval-required',
    'human-question-required', 'human-question-answered', 'human-question-updated',
    'status', 'agents', 'escalation', 'token-usage',
    'log',
    'feedback-injected', 'feedback-recalled',
    'route-decision', 'agent-flow', 'supervisor-review',
    'state-executing', 'parallel-group-start', 'parallel-group-complete',
    'subworkflow-start', 'subworkflow-status', 'subworkflow-waiting-human',
    'subworkflow-complete', 'subworkflow-failed', 'subworkflow-stopped',
    'subworkflow-cancelled', 'circuit-breaker',
  ];

  /**
   * Get or create a manager for a given configFile.
   * If the manager already exists and is idle, reuse it.
   * If it's running, return the existing running instance.
   */
  async getManager(configFile: string): Promise<AnyWorkflowManager> {
    const managerKey = this.topLevelManagerKey(configFile);
    const pending = this.pendingManagerCreations.get(managerKey);
    if (pending) return pending;

    const expectedIsStateMachine = await this.detectStateMachine(configFile);
    const existing = this.managers.get(managerKey);
    if (existing) {
      if (this.canReuseManager(existing, expectedIsStateMachine)) {
        return existing.manager;
      }
      this.removeManagerEntry(managerKey, existing);
    }
    return this.createManagerOnce(configFile, expectedIsStateMachine, managerKey);
  }

  async getManagerForRun(input: { configFile: string; managerKey: string; isStateMachine?: boolean }): Promise<AnyWorkflowManager> {
    const expectedIsStateMachine = input.isStateMachine ?? await this.detectStateMachine(input.configFile);
    const existing = this.managers.get(input.managerKey);
    if (existing) {
      if (this.canReuseManager(existing, expectedIsStateMachine)) {
        return existing.manager;
      }
      this.removeManagerEntry(input.managerKey, existing);
    }
    return this.createManagerOnce(input.configFile, expectedIsStateMachine, input.managerKey);
  }

  private createManagerOnce(configFile: string, isSM: boolean, managerKey = this.topLevelManagerKey(configFile)): Promise<AnyWorkflowManager> {
    const pending = this.pendingManagerCreations.get(managerKey);
    if (pending) return pending;

    const creation = this.createManager(configFile, isSM, managerKey)
      .finally(() => {
        if (this.pendingManagerCreations.get(managerKey) === creation) {
          this.pendingManagerCreations.delete(managerKey);
        }
      });
    this.pendingManagerCreations.set(managerKey, creation);
    return creation;
  }

  private async createManager(configFile: string, isSM?: boolean, managerKey = this.topLevelManagerKey(configFile)): Promise<AnyWorkflowManager> {
    const resolvedIsSM = isSM ?? await this.detectStateMachine(configFile);
    const manager = resolvedIsSM ? new StateMachineWorkflowManager() : new WorkflowManager();
    const entry: ManagerEntry = {
      managerKey,
      configFile,
      manager,
      isStateMachine: resolvedIsSM,
      createdAt: Date.now(),
      implementationVersion: this.implementationVersion,
    };
    this.managers.set(managerKey, entry);
    const events = resolvedIsSM ? WorkflowRegistry.SM_EVENTS : WorkflowRegistry.PHASE_EVENTS;
    for (const evt of events) {
      manager.on(evt, (data: any) => {
        const tagged = { ...data, __configFile: configFile };
        const runId = typeof data?.runId === 'string' && data.runId
          ? data.runId
          : manager.getStatus().runId;
        if (runId) {
          this.managerKeysByRunId.set(runId, managerKey);
        }
        this.emit(evt, tagged);
        if (runId) {
          getWorkflowEventStore().append(runId, `workflow.${evt}`, {
            configFile,
            managerKey,
            ...compactRegistryEventPayload(data),
          }).catch(() => {});
        }
      });
    }
    return manager;
  }

  async getManagerByRunId(runId: string): Promise<AnyWorkflowManager | null> {
    const managerKey = this.managerKeysByRunId.get(runId);
    if (managerKey) {
      const entry = this.managers.get(managerKey);
      if (entry) {
        const status = entry.manager.getStatus().status;
        if (this.isActiveStatus(status) || entry.implementationVersion === this.implementationVersion) {
          return entry.manager;
        }
        this.removeManagerEntry(managerKey, entry);
      }
    }

    const runState = await loadRunState(runId);
    const expectedIsStateMachine = runState
      ? await this.detectStateMachineRun(runState)
      : false;

    for (const [key, entry] of this.managers) {
      const s = entry.manager.getStatus();
      if (s.runId !== runId) continue;
      if (runState && !this.canReuseManager(entry, expectedIsStateMachine)) {
        this.removeManagerEntry(key, entry);
        break;
      }
      this.managerKeysByRunId.set(runId, key);
      return entry.manager;
    }

    if (!runState?.configFile) return null;
    const restoredManagerKey = runState.parentRunId ? `run:${runId}` : this.topLevelManagerKey(runState.configFile);
    const existing = this.managers.get(restoredManagerKey);
    if (existing) {
      if (this.canReuseManager(existing, expectedIsStateMachine)) {
        return existing.manager;
      }
      this.removeManagerEntry(restoredManagerKey, existing);
    }
    const manager = await this.createManagerOnce(runState.configFile, expectedIsStateMachine, restoredManagerKey);
    this.managerKeysByRunId.set(runId, restoredManagerKey);
    return manager;
  }

  getRunningManagers(): { configFile: string; manager: AnyWorkflowManager; isStateMachine: boolean }[] {
    const result: { configFile: string; manager: AnyWorkflowManager; isStateMachine: boolean }[] = [];
    for (const [, entry] of this.managers) {
      if (this.isActiveStatus(entry.manager.getStatus().status)) {
        result.push({ configFile: entry.configFile, manager: entry.manager, isStateMachine: entry.isStateMachine });
      }
    }
    return result;
  }

  getRunningManager(configFile?: string): AnyWorkflowManager | null {
    if (configFile) {
      const topLevel = this.managers.get(this.topLevelManagerKey(configFile));
      if (topLevel && this.isActiveStatus(topLevel.manager.getStatus().status)) return topLevel.manager;
      const entry = Array.from(this.managers.values()).find((item) => item.configFile === configFile && this.isActiveStatus(item.manager.getStatus().status));
      if (entry) return entry.manager;
      return null;
    }
    const running = this.getRunningManagers();
    return running.length > 0 ? running[0].manager : null;
  }

  getAllManagers(): ManagerEntry[] {
    return Array.from(this.managers.values());
  }

  cleanup() {
    for (const [key, entry] of this.managers) {
      const s = entry.manager.getStatus();
      if (!this.isActiveStatus(s.status) && Date.now() - entry.createdAt > 3600_000) {
        this.removeManagerEntry(key, entry);
      }
    }
  }

  private async detectStateMachine(configFile: string): Promise<boolean> {
    try {
      await ensureRuntimeConfigsSeeded();
      let p = await getRuntimeWorkflowConfigPath(configFile);
      const { existsSync } = await import('fs');
      if (!existsSync(p)) p = getBundledWorkflowConfigPath(configFile);
      const content = await readFile(p, 'utf-8');
      const config = parse(content);
      return config.workflow?.mode === 'state-machine';
    } catch { return false; }
  }

  private async detectStateMachineRun(runState: { configFile?: string; mode?: string; currentState?: string | null; stateHistory?: unknown[] }): Promise<boolean> {
    if (runState.mode === 'state-machine') return true;
    if (runState.mode === 'phase-based') return false;
    if (runState.currentState || (Array.isArray(runState.stateHistory) && runState.stateHistory.length > 0)) return true;
    return runState.configFile ? this.detectStateMachine(runState.configFile) : false;
  }

  private managerMatchesMode(manager: AnyWorkflowManager, isStateMachine: boolean): boolean {
    return isStateMachine ? isStateMachineManagerLike(manager) : !isStateMachineManagerLike(manager);
  }

  private canReuseManager(entry: ManagerEntry, expectedIsStateMachine: boolean): boolean {
    if (entry.isStateMachine !== expectedIsStateMachine || !this.managerMatchesMode(entry.manager, expectedIsStateMachine)) {
      return false;
    }
    return this.isActiveStatus(entry.manager.getStatus().status)
      || entry.implementationVersion === this.implementationVersion;
  }

  private removeManagerEntry(key: string, entry: ManagerEntry): void {
    this.managers.delete(key);
    for (const [runId, managerKey] of this.managerKeysByRunId) {
      if (managerKey === key) this.managerKeysByRunId.delete(runId);
    }
    entry.manager.removeAllListeners();
  }
}

const g = globalThis as unknown as { __workflowRegistry?: WorkflowRegistry };
if (g.__workflowRegistry) {
  Object.setPrototypeOf(g.__workflowRegistry, WorkflowRegistry.prototype);
  g.__workflowRegistry.refreshImplementation();
}
export const workflowRegistry = g.__workflowRegistry ??= new WorkflowRegistry();
