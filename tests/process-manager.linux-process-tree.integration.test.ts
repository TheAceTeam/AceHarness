import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

type ProcessTree = {
  parent: ChildProcess;
  parentPid: number;
  childPid: number;
};

function startProcessTree(): Promise<ProcessTree> {
  const parentSource = [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
    "process.stdout.write(`${child.pid}\\n`);",
    'setInterval(() => {}, 1000);',
  ].join('');
  const parent = spawn(process.execPath, ['-e', parentSource], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for child pid')), 5000);
    parent.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    parent.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      const childPid = Number.parseInt(output.trim(), 10);
      if (!Number.isSafeInteger(childPid) || childPid <= 1 || !parent.pid) return;
      clearTimeout(timeout);
      resolve({ parent, parentPid: parent.pid, childPid });
    });
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForAliveState(pid: number, expected: boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (isAlive(pid) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`PID ${pid} did not become ${expected ? 'alive' : 'dead'}`);
}

function forceStop(tree: ProcessTree | undefined): void {
  if (!tree) return;
  for (const pid of [tree.childPid, tree.parentPid]) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already exited */ }
  }
}

function writeAcpRecord(aceHome: string, recordId: string, pid: number, cwd: string): void {
  const sessionsDir = join(aceHome, 'data', 'acpx-runtime', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(join(sessionsDir, `${encodeURIComponent(recordId)}.json`), JSON.stringify({
    acpx_record_id: recordId,
    pid,
    cwd,
    agent_started_at: new Date().toISOString(),
  }), 'utf8');
}

describe.skipIf(process.platform !== 'linux')('Linux process-tree cleanup integration', () => {
  test('reaps only the exact run ACP record tree', async () => {
    const previousAceHome = process.env.ACE_HOME;
    const aceHome = mkdtempSync(join(tmpdir(), 'aceharness-linux-process-tree-'));
    let target: ProcessTree | undefined;
    let other: ProcessTree | undefined;

    try {
      process.env.ACE_HOME = aceHome;
      [target, other] = await Promise.all([startProcessTree(), startProcessTree()]);
      await Promise.all([
        waitForAliveState(target.parentPid, true),
        waitForAliveState(target.childPid, true),
        waitForAliveState(other.parentPid, true),
        waitForAliveState(other.childPid, true),
      ]);

      writeAcpRecord(aceHome, 'record-run-a', target.parentPid, '/tmp/run-a');
      writeAcpRecord(aceHome, 'record-run-b', other.parentPid, '/tmp/run-b');

      // Import after ACE_HOME is isolated so the production session-record lookup is real.
      const { processManager } = await import('@/lib/core/process-manager');
      const result = await processManager.killAllSystem({
        sweepAgentProcesses: true,
        workspacePaths: ['/tmp/run-a'],
        acpxRecordIds: ['record-run-a'],
        runIds: ['run-a'],
      });

      expect(result.agentRootsMatched).toBe(1);
      expect(new Set(result.pids)).toEqual(new Set([target.parentPid, target.childPid]));
      expect(result.pids).not.toContain(other.parentPid);
      expect(result.pids).not.toContain(other.childPid);
      await Promise.all([
        waitForAliveState(target.parentPid, false),
        waitForAliveState(target.childPid, false),
        waitForAliveState(other.parentPid, true),
        waitForAliveState(other.childPid, true),
      ]);
      console.info('[linux-process-tree]', JSON.stringify({
        target: { recordId: 'record-run-a', parentPid: target.parentPid, childPid: target.childPid },
        other: { recordId: 'record-run-b', parentPid: other.parentPid, childPid: other.childPid },
        result,
      }));
    } finally {
      forceStop(target);
      forceStop(other);
      rmSync(aceHome, { recursive: true, force: true });
      if (previousAceHome === undefined) delete process.env.ACE_HOME;
      else process.env.ACE_HOME = previousAceHome;
    }
  }, 15000);
});
