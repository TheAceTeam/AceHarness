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
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { getWorkspaceDataFile, getWorkspaceRunsDir } from '@/lib/core/app-paths';
import { isWindows } from '@/lib/core/runtime-platform';

const RUNS_DIR = getWorkspaceRunsDir();
const DEBUG_DIR = resolve(RUNS_DIR, '.tmp');
const MAX_STREAM_CONTENT_CHARS = 200_000;
const MAX_OUTPUT_CHARS = 200_000;
const MAX_ERROR_CHARS = 50_000;
const MAX_LOG_LINES = 200;
const ACE_PROCESS_OPEN_TAG = '<ace-process>';
const ACE_PROCESS_CLOSE_TAG = '</ace-process>';

/**
 * What the acpx session store records is the pid of the *wrapper* it spawned
 * (`npm exec opencode-ai acp`), not the agent doing the work. The real tree is:
 *
 *   npm exec opencode-ai acp      <- the recorded pid
 *     └─ opencode acp             <- the agent that is stuck in a long tool call
 *          └─ codegraph serve --mcp
 *               └─ node ...
 *
 * Signalling only the recorded pid leaves the agent running: `npm exec` does not reliably
 * forward signals, and would not reach the grandchildren even if it did. So the sweep must
 * walk down from each recorded pid and take the whole subtree.
 *
 * Walking *down* is also what keeps this safe. Every one of these processes shares a process
 * group with the CSIHarness server itself, so a process-group kill would take the server down with
 * them; and the recorded pid's parent *is* the server. Descending from the recorded pid can
 * only ever reach agent-owned processes.
 *
 * `isDescendantOfServer` is the matching entry check — it decides whether a recorded pid is still
 * one of ours — and it is deliberately structural rather than textual. Matching command lines was
 * tried twice and does not work: acpx registers 18 agents launched through varying wrappers, and
 * the `agent_command` it records is the registry template (`npx -y pkg@^1.2.3 acp`), not what `ps`
 * shows (`npm exec pkg acp`). Every recorded pid is spawned by this server, so ancestry answers the
 * same question exactly, for every engine, with no pattern to keep in sync.
 *
 * Known limit: a process orphaned before the check (parent already gone, reparented to init) no
 * longer looks like a descendant and will not be swept.
 */
function isDescendantOfServer(pid: number, table: Map<number, ProcessRow>): boolean {
  let current = table.get(pid)?.ppid;
  // Bounded walk: a cycle or a detached branch must not spin.
  for (let hops = 0; current !== undefined && current > 1 && hops < 64; hops++) {
    if (current === process.pid) return true;
    current = table.get(current)?.ppid;
  }
  return false;
}

/** Session records older than this are treated as dead without being opened. */
const SESSION_RECORD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

type ProcessRow = { ppid: number; command: string; startedAt: number | null };

/** `Tue Jul 21 10:28:58 2026` — five whitespace-separated fields, then the command. */
const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\S+\s+\S+\s+\d+\s+\d+:\d+:\d+\s+\d+)\s+(.*)$/;

/** One `ps` snapshot for the whole sweep — this runs inside the stop request path. */
function readProcessTable(): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>();
  try {
    const out = execSync('ps -eo pid=,ppid=,lstart=,command=', {
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
      // `lstart` goes through strftime, so month and weekday names are localised: under zh_CN it
      // prints `二  7月/21 …` and under de_DE `Di. 21 Juli …`, neither of which parses. Every row
      // would then be dropped, leaving an empty table — which silently disables both sweeps rather
      // than failing loudly. Pin the locale; TZ is deliberately left alone, since `lstart` is local
      // time and Date.parse must read it as such.
      //
      // Consequence for `command`: under C locale `ps` escapes non-ASCII bytes (`M-fM-5M^K…` on
      // macOS, `?` on Linux). That is fine for the two things it is used for — matching ASCII-only
      // patterns, and comparing a pid against its own earlier snapshot, which is taken the same way
      // — but it must not be surfaced to users or written to logs as a readable command line.
      env: { ...process.env, LC_ALL: 'C' },
    });
    for (const line of out.split('\n')) {
      const match = line.match(PS_ROW);
      if (!match) continue;
      const startedAt = Date.parse(match[3]);
      table.set(parseInt(match[1], 10), {
        ppid: parseInt(match[2], 10),
        command: match[4],
        startedAt: Number.isNaN(startedAt) ? null : startedAt,
      });
    }
  } catch {
    // Without a process table the ACP sweep is skipped; the registered-process path still runs.
  }
  return table;
}

/**
 * How far a live process's start time may sit from what the session record claims before we treat
 * the pid as recycled. Generous enough to absorb recording lag, tight enough that a pid reissued
 * later in the machine's life never passes.
 */
const PID_START_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Recorded session pids that are still alive and still look like an agent root.
 *
 * @param scope.workspacePaths When non-empty, only sessions working inside one of those
 *   directories qualify. This is a secondary guard for a run-scoped sweep.
 * @param scope.acpxRecordIds When provided, only these ACP records qualify. An empty list matches
 *   nothing, so callers that stop a specific run fail closed instead of falling back to a
 *   workspace-wide sweep.
 */
function collectAcpAgentRoots(
  table: Map<number, ProcessRow>,
  scope: { workspacePaths?: string[]; acpxRecordIds?: string[] } = {},
): number[] {
  const workspacePaths = scope.workspacePaths || [];
  const acpxRecordScope = Array.isArray(scope.acpxRecordIds)
    ? new Set(scope.acpxRecordIds.filter((id) => id.trim().length > 0))
    : null;
  if (acpxRecordScope && acpxRecordScope.size === 0) return [];

  const sessionsDir = getWorkspaceDataFile('acpx-runtime', 'sessions');
  if (!existsSync(sessionsDir)) return [];
  let entries: string[] = [];
  try {
    entries = readdirSync(sessionsDir);
  } catch {
    return [];
  }
  const roots = new Set<number>();
  const oldestUseful = Date.now() - SESSION_RECORD_MAX_AGE_MS;
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const path = resolve(sessionsDir, entry);
      // The store never prunes and each record embeds its whole message history (tens of MB in
      // total), so filter on mtime before parsing — `closed` is unreliable and rules out almost
      // nothing, and this runs on a request path.
      if (statSync(path).mtimeMs < oldestUseful) continue;
      const record = JSON.parse(readFileSync(path, 'utf-8'));
      if (record?.closed === true) continue;
      if (acpxRecordScope) {
        const recordIds = getAcpRecordCandidateIds(record, entry);
        if (!recordIds.some((id) => acpxRecordScope.has(id))) continue;
      }
      const pid = record?.pid;
      if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) continue;
      if (pid === process.pid) continue;
      if (workspacePaths.length > 0) {
        const cwd = typeof record?.cwd === 'string' ? record.cwd : '';
        const inScope = workspacePaths.some((ws) => cwd === ws || cwd.startsWith(`${ws}/`));
        if (!inScope) continue;
      }
      if (!isDescendantOfServer(pid, table)) continue;
      // Ancestry alone does not prove identity: every process this server spawned passes it, so a
      // recycled pid that happens to land under the server would be signalled — and then SIGKILLed.
      // The start time pins it to the process the record was actually written about. A record
      // observed on this machine pointed at pid 1192, long since reissued to a system extension.
      const startedAt = table.get(pid)?.startedAt;
      const recordedStart = Date.parse(record?.agent_started_at ?? '');
      if (startedAt === null || startedAt === undefined || Number.isNaN(recordedStart)) continue;
      if (Math.abs(startedAt - recordedStart) > PID_START_TOLERANCE_MS) continue;
      roots.add(pid);
    } catch {
      // Unreadable/partial record — skip it rather than failing the whole sweep.
    }
  }
  return Array.from(roots);
}

function getAcpRecordCandidateIds(record: any, entry: string): string[] {
  const encodedFileId = entry.replace(/\.json$/, '');
  const candidates = [
    encodedFileId,
    safeDecodeURIComponent(encodedFileId),
    record?.acpxRecordId,
    record?.acpx_record_id,
    record?.recordId,
    record?.record_id,
    record?.sessionKey,
    record?.session_key,
    record?.runtimeSessionId,
    record?.runtime_session_id,
    record?.runtimeSessionName,
    record?.runtime_session_name,
    record?.acpSessionId,
    record?.acp_session_id,
  ];
  return Array.from(new Set(candidates.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
}

function safeDecodeURIComponent(input: string): string {
  try {
    return decodeURIComponent(input);
  } catch {
    return input;
  }
}

/** Every descendant of `roots`, roots included. */
function expandProcessSubtrees(roots: number[], table: Map<number, ProcessRow>): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const [pid, row] of table) {
    const siblings = childrenOf.get(row.ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(row.ppid, [pid]);
  }
  const collected = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const pid = queue.shift() as number;
    if (pid === process.pid || collected.has(pid)) continue;
    collected.add(pid);
    for (const child of childrenOf.get(pid) || []) queue.push(child);
  }
  return Array.from(collected);
}

function trimToTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

function trimStreamContentToTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;

  const cutIndex = value.length - maxChars;
  const trimmed = value.slice(cutIndex);
  const lastOpenBeforeCut = value.lastIndexOf(ACE_PROCESS_OPEN_TAG, cutIndex - 1);
  const lastCloseBeforeCut = value.lastIndexOf(ACE_PROCESS_CLOSE_TAG, cutIndex - 1);

  if (lastOpenBeforeCut > lastCloseBeforeCut) {
    const closeInTrimmed = trimmed.indexOf(ACE_PROCESS_CLOSE_TAG);
    if (closeInTrimmed < 0) return '';
    return trimmed.slice(closeInTrimmed + ACE_PROCESS_CLOSE_TAG.length).replace(/^\s+/, '');
  }

  const firstClose = trimmed.indexOf(ACE_PROCESS_CLOSE_TAG);
  const firstOpen = trimmed.indexOf(ACE_PROCESS_OPEN_TAG);
  if (firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen)) {
    return trimmed.slice(firstClose + ACE_PROCESS_CLOSE_TAG.length).replace(/^\s+/, '');
  }

  return trimmed;
}

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

type RegisteredProcessScope = 'none' | 'matching-runs' | 'all';

type KillAllSystemOptions = {
  sweepAgentProcesses?: boolean;
  workspacePaths?: string[];
  acpxRecordIds?: string[];
  runIds?: string[];
  registeredProcessScope?: RegisteredProcessScope;
};

type KillAllSystemResult = {
  killed: number;
  pids: number[];
  agentRootsMatched?: number;
  registeredKilled: number;
  registeredProcessIds: string[];
};

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

  /**
   * In-flight agent work: running/queued child processes plus live frontend
   * streams. The server-side memory watchdog uses this to avoid restarting
   * the process in the middle of a workflow/agent run.
   */
  getActiveWorkCount(): number {
    let active = 0;
    for (const [, proc] of this.processes) {
      if (proc.status === 'running' || proc.status === 'queued') active++;
    }
    return active + this.activeStreams.size;
  }

  appendStreamContent(id: string, chunk: string): string {
    const proc = this.processes.get(id);
    if (!proc) return '';
    proc.streamContent = trimStreamContentToTail(proc.streamContent + chunk, MAX_STREAM_CONTENT_CHARS);
    return proc.streamContent;
  }

  setProcessOutput(id: string, output: string): void {
    const proc = this.processes.get(id);
    if (!proc) return;
    proc.output = trimStreamContentToTail(output, MAX_OUTPUT_CHARS);
  }

  setProcessError(id: string, error: string): void {
    const proc = this.processes.get(id);
    if (!proc) return;
    proc.error = trimToTail(error, MAX_ERROR_CHARS);
  }

  appendLogLine(id: string, line: string): void {
    const proc = this.processes.get(id);
    if (!proc) return;
    proc.logLines.push(line);
    if (proc.logLines.length > MAX_LOG_LINES) {
      proc.logLines = proc.logLines.slice(-MAX_LOG_LINES);
    }
  }

  killProcess(id: string): boolean {
    const proc = this.processes.get(id);
    if (!proc) return false;
    proc.status = 'killed';
    proc.endTime = new Date();
    this.appendLogLine(id, `[${ts()}] 手动终止`);
    // Kill child process if present (preRuntime)
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

  /**
   * @param options.runIds Registered processes are only killed when their `runId` matches this
   *   set. This is the normal path for stopping one workflow run.
   * @param options.registeredProcessScope `all` is reserved for the explicit global process
   *   management API. The default is `none`, so cleanup callers never widen into unrelated runs
   *   by accident.
   * @param options.sweepAgentProcesses Also terminate ACP agent process trees. Off by default:
   *   this method is reached from config edits and run deletions too (via `WorkflowManager.stop`),
   *   and those must not take down agents belonging to unrelated live runs. Only an explicit
   *   "stop this workflow" request opts in.
   * @param options.workspacePaths Restrict that sweep to agents working inside these directories.
   *   Stopping specific runs must pass this as the secondary directory guard.
   * @param options.acpxRecordIds Restrict the ACP sweep to these session records. If this option is
   *   present and empty, the sweep matches nothing.
   */
  async killAllSystem(
    options: KillAllSystemOptions = {}
  ): Promise<KillAllSystemResult> {
    const runIdSet = new Set((options.runIds || []).filter(Boolean));
    const registeredProcessScope: RegisteredProcessScope = options.registeredProcessScope
      || (runIdSet.size > 0 ? 'matching-runs' : 'none');
    const registeredProcessIds: string[] = [];

    for (const [, proc] of this.processes) {
      if (proc.status !== 'running') continue;
      const shouldKillRegisteredProcess = registeredProcessScope === 'all'
        || (registeredProcessScope === 'matching-runs' && !!proc.runId && runIdSet.has(proc.runId));
      if (!shouldKillRegisteredProcess) continue;

      proc.status = 'killed';
      proc.endTime = new Date();
      registeredProcessIds.push(proc.id);
      if (proc.childProcess) {
        try { proc.childProcess.kill('SIGTERM'); } catch {}
      }
      if ((proc as any)._cancelFn) {
        try { (proc as any)._cancelFn(); } catch {}
      }
    }
    // Also kill agent processes that outlived their run.
    //
    // Engine cancellation is cooperative: an agent stuck in a long tool call (a compiler build,
    // say) keeps running — and keeps streaming — well after its run has been marked stopped. The
    // survivors then contend with the next run for resources and keep writing into its workspace.
    // Agent cleanup is based on ACP session records rather than engine-specific command lines.
    //
    const signalled: number[] = [];
    // Set whenever a sweep was requested, so "asked to sweep but matched nothing" stays reportable
    // even on Windows, where the sweep is not implemented at all and would otherwise be silent.
    let agentRootsMatched: number | undefined = options.sweepAgentProcesses ? 0 : undefined;
    if (!isWindows()) {
      const escalate: Array<{ pid: number; command: string }> = [];
      // Only read once a sweep is actually requested: the other callers of this method (config
      // edits, run deletion, DELETE /api/processes) would otherwise pay a synchronous `ps` for
      // nothing.
      const table = options.sweepAgentProcesses ? readProcessTable() : new Map<number, ProcessRow>();

      // ACP agent trees. Cancellation is cooperative, so an agent blocked in a long tool call
      // ignores SIGTERM and has to be escalated — these are identified structurally (a recorded
      // session pid plus its descendants) rather than by pattern, which is what makes escalation
      // safe here.
      if (options.sweepAgentProcesses) {
        const roots = collectAcpAgentRoots(table, {
          workspacePaths: options.workspacePaths,
          acpxRecordIds: options.acpxRecordIds,
        });
        // Surfaced so a zero-match sweep is visible: a run whose recorded workingDirectory differs
        // from the agent's actual cwd (isolated-run layouts do this) would otherwise no-op silently.
        agentRootsMatched = roots.length;
        for (const pid of expandProcessSubtrees(roots, table)) {
          const command = table.get(pid)?.command;
          if (command === undefined) continue;
          try {
            process.kill(pid, 'SIGTERM');
            signalled.push(pid);
            // Pin identity now, while the tree is still intact.
            escalate.push({ pid, command });
          } catch { /* gone */ }
        }
      }

      if (escalate.length > 0) {
        // Fire-and-forget, like the escalation in `killProcess`: awaiting would hold the stop
        // response open for the whole grace period for no benefit to the caller.
        setTimeout(() => {
          // Verify each pid individually against the identity pinned at SIGTERM time. Re-deriving
          // the tree here would defeat the escalation in exactly the case it exists for: the
          // recorded pid is a wrapper that exits promptly on SIGTERM, orphaning the agent that
          // ignored it — the survivor is then no longer in anyone's subtree. Comparing the full
          // command line is what rules out a pid recycled during the grace window.
          const fresh = readProcessTable();
          for (const { pid, command } of escalate) {
            if (fresh.get(pid)?.command !== command) continue;
            try { process.kill(pid, 'SIGKILL'); } catch { /* exited on SIGTERM */ }
          }
        }, 2000).unref?.();
      }
    }
    // Counts processes signalled, not confirmed dead — SIGKILL escalation is still pending at this
    // point, and a just-killed child reads as alive until the parent reaps it.
    return {
      killed: signalled.length,
      pids: signalled,
      agentRootsMatched,
      registeredKilled: registeredProcessIds.length,
      registeredProcessIds,
    };
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
