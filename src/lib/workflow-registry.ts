/**
 * Workflow Registry — manages multiple concurrent workflow manager instances.
 * Each configFile gets its own manager instance, enabling parallel workflow execution.
 */
import { EventEmitter } from 'events';
import { WorkflowManager } from './workflow-manager';
import { StateMachineWorkflowManager } from './state-machine-workflow-manager';
import { readFile } from 'fs/promises';
import { parse } from 'yaml';
import { loadRunState } from './run-state-persistence';
import { ensureRuntimeConfigsSeeded, getBundledWorkflowConfigPath, getRuntimeWorkflowConfigPath } from './runtime-configs';

export type AnyWorkflowManager = WorkflowManager | StateMachineWorkflowManager;

interface ManagerEntry {
  configFile: string;
  manager: AnyWorkflowManager;
  isStateMachine: boolean;
  createdAt: number;
}

class WorkflowRegistry extends EventEmitter {
  private managers = new Map<string, ManagerEntry>();

  private isActiveStatus(status: string): boolean {
    return status === 'running' || status === 'preparing';
  }

  /** All event types that workflow managers emit */
  private static PHASE_EVENTS = [
    'status', 'phase', 'step', 'result', 'checkpoint', 'agents',
    'iteration', 'iteration-complete', 'escalation', 'token-usage',
    'feedback-injected', 'feedback-recalled', 'context-updated',
    'route-decision',
  ];
  private static SM_EVENTS = [
    'state-change', 'step-start', 'step-complete', 'transition',
    'force-transition', 'transition-forced', 'human-approval-required',
    'status', 'agents', 'escalation', 'token-usage',
    'feedback-injected', 'feedback-recalled',
    'route-decision', 'agent-flow',
  ];

  /**
   * Get or create a manager for a given configFile.
   * If the manager already exists and is idle, reuse it.
   * If it's running, return the existing running instance.
   */
  async getManager(configFile: string): Promise<AnyWorkflowManager> {
    const existing = this.managers.get(configFile);
    if (existing) return existing.manager;
    return this.createManager(configFile);
  }

  private async createManager(configFile: string): Promise<AnyWorkflowManager> {
    const isSM = await this.detectStateMachine(configFile);
    const manager = isSM ? new StateMachineWorkflowManager() : new WorkflowManager();
    const entry: ManagerEntry = { configFile, manager, isStateMachine: isSM, createdAt: Date.now() };
    this.managers.set(configFile, entry);
    const events = isSM ? WorkflowRegistry.SM_EVENTS : WorkflowRegistry.PHASE_EVENTS;
    for (const evt of events) {
      manager.on(evt, (data: any) => {
        this.emit(evt, { ...data, __configFile: configFile });
      });
    }
    return manager;
  }

  async getManagerByRunId(runId: string): Promise<AnyWorkflowManager | null> {
    for (const [, entry] of this.managers) {
      const s = entry.manager.getStatus();
      if (s.runId === runId) return entry.manager;
    }
    const runState = await loadRunState(runId);
    if (!runState?.configFile) return null;
    return this.getManager(runState.configFile);
  }

  getRunningManagers(): { configFile: string; manager: AnyWorkflowManager; isStateMachine: boolean }[] {
    const result: { configFile: string; manager: AnyWorkflowManager; isStateMachine: boolean }[] = [];
    for (const [cf, entry] of this.managers) {
      if (this.isActiveStatus(entry.manager.getStatus().status)) {
        result.push({ configFile: cf, manager: entry.manager, isStateMachine: entry.isStateMachine });
      }
    }
    return result;
  }

  getRunningManager(configFile?: string): AnyWorkflowManager | null {
    if (configFile) {
      const entry = this.managers.get(configFile);
      if (entry && this.isActiveStatus(entry.manager.getStatus().status)) return entry.manager;
      return null;
    }
    const running = this.getRunningManagers();
    return running.length > 0 ? running[0].manager : null;
  }

  getAllManagers(): ManagerEntry[] {
    return Array.from(this.managers.values());
  }

  cleanup() {
    for (const [cf, entry] of this.managers) {
      const s = entry.manager.getStatus();
      if (!this.isActiveStatus(s.status) && Date.now() - entry.createdAt > 3600_000) {
        entry.manager.removeAllListeners();
        this.managers.delete(cf);
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
}

const g = globalThis as unknown as { __workflowRegistry?: WorkflowRegistry };
export const workflowRegistry = g.__workflowRegistry ??= new WorkflowRegistry();
