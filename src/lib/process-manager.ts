/**
 * 进程管理器
 * 通用进程注册/事件总线/队列调度层。
 * 不包含任何引擎特有逻辑 — 所有引擎通过 Engine 接口执行。
 */

import { execSync } from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { writeFile, mkdir } from 'fs/promises';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { getWorkspaceRunsDir } from '@/lib/app-paths';

const RUNS_DIR = getWorkspaceRunsDir();
const DEBUG_DIR = resolve(RUNS_DIR, '.tmp');

function ts(): string { return new Date().toISOString(); }
function fmtMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}min`;
}

export interface ProcessInfo {
  id: string;
  agent: string;
  step: string;
  stepId?: string;
  status: 'running' | 'completed' | 'failed' | 'killed' | 'timeout' | 'queued';
  pid?: number;
  sessionId?: string;
  frontendSessionId?: string;
  startTime: Date;
  endTime?: Date;
  queuedAt?: Date;
  output: string;
  error: string;
  childProcess?: ChildProcess;
  jsonResult?: any;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  streamContent: string;
  logLines: string[];
  logFile?: string;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  lastActivityTime?: number;
  runId?: string;
  prompt?: string;
  systemPrompt?: string;
}
class ProcessManager extends EventEmitter {
  private processes: Map<string, ProcessInfo> = new Map();
  private activeStreams: Map<string, string> = new Map();

  /** Flush debug log to disk */
  async flushLog(proc: ProcessInfo): Promise<void> {
    try {
      const logDir = proc.runId
        ? resolve(RUNS_DIR, proc.runId, 'logs')
        : DEBUG_DIR;
      if (!existsSync(logDir)) await mkdir(logDir, { recursive: true });
      const logFile = proc.logFile || resolve(logDir, `${proc.id}.log`);
      proc.logFile = logFile;

      const elapsed = Date.now() - proc.startTime.getTime();
      const header = [
        `=== Process Debug Log ===`,
        `ID: ${proc.id}`,
        `Agent: ${proc.agent} | Step: ${proc.step}`,
        `Status: ${proc.status}`,
        `Started: ${proc.startTime.toISOString()}`,
        `Elapsed: ${fmtMs(elapsed)}`,
        `===========================`,
        '',
      ];
      const streamSection = proc.streamContent
        ? `\n--- Stream Content (${proc.streamContent.length} chars) ---\n${proc.streamContent.slice(-5000)}\n`
        : '';
      const stderrSection = proc.error ? `\n--- Stderr ---\n${proc.error}\n` : '';
      const outputSection = proc.output ? `\n--- Final Output ---\n${proc.output.slice(0, 5000)}\n` : '';

      const content = header.join('\n')
        + proc.logLines.join('\n')
        + streamSection + stderrSection + outputSection;

      await writeFile(logFile, content, 'utf-8');
    } catch { /* non-critical */ }
  }

  /** Register active stream for frontend session recovery */
  registerActiveStream(frontendSessionId: string, chatId: string): void {
    this.activeStreams.set(frontendSessionId, chatId);
  }

  /** Remove frontend session -> chatId mapping */
  removeActiveStream(frontendSessionId: string): void {
    this.activeStreams.delete(frontendSessionId);
  }

  /** Get chatId for a frontend session if there's an active stream */
  getActiveStreamChatId(frontendSessionId: string): string | undefined {
    return this.activeStreams.get(frontendSessionId);
  }
  killProcess(id: string): boolean {
    const proc = this.processes.get(id);
    if (!proc) return false;
    proc.status = 'killed';
    proc.endTime = new Date();
    proc.logLines.push(`[${ts()}] 手动终止`);
    // Kill child process if present (legacy)
    if (proc.childProcess) {
      try {
        proc.childProcess.kill('SIGTERM');
        setTimeout(() => proc.childProcess?.kill('SIGKILL'), 3000);
      } catch { /* already dead */ }
    }
    // Cancel engine wrapper if present
    if ((proc as any)._cancelFn) {
      try { (proc as any)._cancelFn(); } catch {}
    }
    return true;
  }

  async killAllSystem(): Promise<{ killed: number; pids: number[] }> {
    for (const [, proc] of this.processes) {
      if (proc.status === 'running') {
        proc.status = 'killed';
        proc.endTime = new Date();
        if (proc.childProcess) {
          try { proc.childProcess.kill('SIGTERM'); } catch {}
        }
        if ((proc as any)._cancelFn) {
          try { (proc as any)._cancelFn(); } catch {}
        }
      }
    }
    // Also kill orphan system claude processes
    const pids: number[] = [];
    if (process.platform !== 'win32') {
      try {
        const out = execSync("pgrep -f 'claude.*-p' || true", { encoding: 'utf-8' });
        const lines = out.trim().split('\n').filter(Boolean);
        for (const line of lines) {
          const pid = parseInt(line, 10);
          if (!isNaN(pid) && pid !== process.pid) {
            try { process.kill(pid, 'SIGTERM'); pids.push(pid); } catch {}
          }
        }
      } catch {}
    }
    return { killed: pids.length, pids };
  }

  reset(): void {
    // Don't clear processes map — keep history
  }

  getAllProcesses(): ProcessInfo[] {
    return Array.from(this.processes.values()).map(p => ({
      ...p,
      childProcess: undefined,
      timeoutTimer: undefined,
    }));
  }

  getProcessBySessionId(sessionId: string): ProcessInfo | undefined {
    for (const [, p] of this.processes) {
      if (p.sessionId === sessionId) {
        return { ...p, childProcess: undefined };
      }
    }
    return undefined;
  }

  /**
   * Register an external process (from any engine) so it appears in the process list.
   */
  registerExternalProcess(id: string, agent: string, step: string, runId?: string, stepId?: string): ProcessInfo {
    const proc: ProcessInfo = {
      id, agent, step, stepId,
      status: 'running',
      startTime: new Date(),
      output: '', error: '',
      streamContent: '',
      logLines: [`[${new Date().toISOString()}] 引擎进程已注册`],
      runId,
    };
    this.processes.set(id, proc);
    return proc;
  }

  getProcessRaw(id: string): ProcessInfo | undefined {
    return this.processes.get(id);
  }

  getProcess(id: string): ProcessInfo | undefined {
    const p = this.processes.get(id);
    if (!p) return undefined;
    return { ...p, childProcess: undefined };
  }

  getStats(): { total: number; running: number; completed: number; failed: number; queued: number } {
    let running = 0, completed = 0, failed = 0, queued = 0;
    for (const [, p] of this.processes) {
      switch (p.status) {
        case 'running': running++; break;
        case 'completed': completed++; break;
        case 'failed': case 'killed': case 'timeout': failed++; break;
        case 'queued': queued++; break;
      }
    }
    return { total: this.processes.size, running, completed, failed, queued };
  }

  cleanup(): void {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, p] of this.processes) {
      if (p.endTime && p.endTime.getTime() < cutoff) {
        this.processes.delete(id);
      }
    }
  }
}

// 全局单例 — use globalThis to survive Next.js dev HMR
const globalForProcess = globalThis as unknown as { __processManager?: ProcessManager };
export const processManager = globalForProcess.__processManager ??= new ProcessManager();
