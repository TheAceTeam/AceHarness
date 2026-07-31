import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { execFileSyncMock, execSyncMock, isWindowsMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(),
  execSyncMock: vi.fn(),
  isWindowsMock: vi.fn(),
}));

const TEST_ACE_HOME = `/tmp/aceharness-process-manager-test-${process.pid}`;
const ORIGINAL_ACE_HOME = process.env.ACE_HOME;

vi.mock('child_process', async (importOriginal) => {
  const original = await importOriginal<typeof import('child_process')>();
  return {
    ...original,
    execFileSync: execFileSyncMock,
    execSync: execSyncMock,
  };
});

vi.mock('@/lib/core/runtime-platform', () => ({
  isWindows: isWindowsMock,
}));

import { processManager } from '@/lib/core/process-manager';

// Each test gets a clean-ish state. The ProcessManager is a singleton,
// so we work with it directly and clean up after each test.
beforeEach(() => {
  process.env.ACE_HOME = TEST_ACE_HOME;
  rmSync(TEST_ACE_HOME, { recursive: true, force: true });
  execFileSyncMock.mockReset();
  execSyncMock.mockReset();
  isWindowsMock.mockReset();
  isWindowsMock.mockReturnValue(false);

  // Kill any leftover processes from previous tests
  for (const proc of processManager.getAllProcesses()) {
    if (proc.status === 'running') {
      processManager.killProcess(proc.id);
    }
  }
});

afterEach(() => {
  rmSync(TEST_ACE_HOME, { recursive: true, force: true });
  if (ORIGINAL_ACE_HOME === undefined) delete process.env.ACE_HOME;
  else process.env.ACE_HOME = ORIGINAL_ACE_HOME;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function writeAcpSessionRecord(recordId: string, record: Record<string, unknown>): string {
  const sessionsDir = join(TEST_ACE_HOME, 'data', 'acpx-runtime', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const path = join(sessionsDir, `${encodeURIComponent(recordId)}.json`);
  writeFileSync(path, JSON.stringify(record), 'utf-8');
  return path;
}

describe('ProcessManager', () => {
  test('registerExternalProcess creates process with correct fields', () => {
    const proc = processManager.registerExternalProcess('test-1', 'developer', 'build step', 'run-123', 'step-1');
    expect(proc.id).toBe('test-1');
    expect(proc.agent).toBe('developer');
    expect(proc.step).toBe('build step');
    expect(proc.stepId).toBe('step-1');
    expect(proc.status).toBe('running');
    expect(proc.runId).toBe('run-123');
    expect(proc.startTime).toBeInstanceOf(Date);
    expect(proc.output).toBe('');
    expect(proc.error).toBe('');
    expect(proc.streamContent).toBe('');
    expect(proc.logLines.length).toBeGreaterThan(0); // has initial log
  });

  test('appendStreamContent appends and returns content', () => {
    processManager.registerExternalProcess('stream-1', 'dev', 'step');
    processManager.appendStreamContent('stream-1', 'Hello ');
    const result = processManager.appendStreamContent('stream-1', 'World');
    expect(result).toBe('Hello World');
  });

  test('appendStreamContent truncates at 200KB keeping tail', () => {
    processManager.registerExternalProcess('stream-trunc', 'dev', 'step');
    const bigChunk = 'x'.repeat(150_000);
    processManager.appendStreamContent('stream-trunc', bigChunk);
    processManager.appendStreamContent('stream-trunc', bigChunk);
    const proc = processManager.getProcess('stream-trunc');
    expect(proc!.streamContent.length).toBeLessThanOrEqual(200_000);
    // Should contain the tail
    expect(proc!.streamContent).toContain('x');
  });

  test('appendStreamContent does not retain a truncated ace-process tail fragment', () => {
    processManager.registerExternalProcess('stream-protocol-trunc', 'dev', 'step');
    const largeToolOutput = [
      '<ace-process>{"toolName":"read","title":"📖 读取文件","output":"',
      'UC-10-OPEN-RECEIVING-SETTINGS -> entry/src/test/cangjie/RiderOrderHallSpecTest.cj\\n'.repeat(5000),
      'C:\\\\Users\\\\Shawn\\\\Desktop\\\\App\\\\specs\\\\FEATURE-RIDER-ORDER-HALL.yaml',
      '","exitCode":0,"kind":"tool-result","body":""}</ace-process>',
    ].join('');

    processManager.appendStreamContent('stream-protocol-trunc', largeToolOutput);
    const proc = processManager.getProcess('stream-protocol-trunc');

    expect(proc!.streamContent).not.toContain('","exitCode":0,"kind":"tool-result","body":""}');
    expect(proc!.streamContent).not.toContain('FEATURE-RIDER-ORDER-HALL.yaml","exitCode"');
  });

  test('setProcessOutput sets output', () => {
    processManager.registerExternalProcess('out-1', 'dev', 'step');
    processManager.setProcessOutput('out-1', 'output content');
    const proc = processManager.getProcess('out-1');
    expect(proc!.output).toBe('output content');
  });

  test('setProcessOutput truncates at 200KB', () => {
    processManager.registerExternalProcess('out-trunc', 'dev', 'step');
    const bigOutput = 'y'.repeat(250_000);
    processManager.setProcessOutput('out-trunc', bigOutput);
    const proc = processManager.getProcess('out-trunc');
    expect(proc!.output.length).toBeLessThanOrEqual(200_000);
  });

  test('setProcessOutput does not retain a truncated ace-process tail fragment', () => {
    processManager.registerExternalProcess('out-protocol-trunc', 'dev', 'step');
    const largeToolOutput = [
      '<ace-process>{"toolName":"read","title":"📖 读取文件","output":"',
      'tUtils category: utility description: "Host app UIFont Category providing font creation from JSON config or naming conventions."\\n'.repeat(5000),
      'framework_mapping: uikit: "UIFont+Utils.h (Category) [HOST-ONLY]" notes: "Use system font APIs directly in Pod code."',
      '","exitCode":0,"kind":"tool-result","body":""}</ace-process>',
    ].join('');

    processManager.setProcessOutput('out-protocol-trunc', largeToolOutput);
    const proc = processManager.getProcess('out-protocol-trunc');

    expect(proc!.output).not.toContain('","exitCode":0,"kind":"tool-result","body":""}');
    expect(proc!.output).not.toContain('UIFont+Utils.h (Category) [HOST-ONLY]" notes:');
  });

  test('setProcessError truncates at 50KB', () => {
    processManager.registerExternalProcess('err-1', 'dev', 'step');
    const bigError = 'e'.repeat(60_000);
    processManager.setProcessError('err-1', bigError);
    const proc = processManager.getProcess('err-1');
    expect(proc!.error.length).toBeLessThanOrEqual(50_000);
  });

  test('appendLogLine caps at 200 lines', () => {
    processManager.registerExternalProcess('log-1', 'dev', 'step');
    for (let i = 0; i < 250; i++) {
      processManager.appendLogLine('log-1', `log line ${i}`);
    }
    const proc = processManager.getProcess('log-1');
    expect(proc!.logLines.length).toBeLessThanOrEqual(200);
    // Should contain the latest lines
    expect(proc!.logLines[proc!.logLines.length - 1]).toBe('log line 249');
  });

  test('killProcess sets status to killed', () => {
    processManager.registerExternalProcess('kill-1', 'dev', 'step');
    const result = processManager.killProcess('kill-1');
    expect(result).toBe(true);
    const proc = processManager.getProcess('kill-1');
    expect(proc!.status).toBe('killed');
    expect(proc!.endTime).toBeInstanceOf(Date);
  });

  test('killProcess calls cancel function if present', () => {
    const proc = processManager.registerExternalProcess('kill-cancel', 'dev', 'step');
    const cancelFn = vi.fn();
    (proc as any)._cancelFn = cancelFn;
    processManager.killProcess('kill-cancel');
    expect(cancelFn).toHaveBeenCalledOnce();
  });

  test('killProcess returns false for nonexistent process', () => {
    expect(processManager.killProcess('nonexistent')).toBe(false);
  });

  test('killAllSystem does not scan or signal machine-wide agents by default', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const proc = processManager.registerExternalProcess('kill-all-default-run', 'dev', 'step', 'run-default');
    const childKill = vi.fn();
    const cancelFn = vi.fn();
    (proc as any).childProcess = { kill: childKill };
    (proc as any)._cancelFn = cancelFn;

    const result = await processManager.killAllSystem();

    expect(result.pids).toEqual([]);
    expect(result.registeredKilled).toBe(0);
    expect(processManager.getProcess('kill-all-default-run')!.status).toBe('running');
    expect(childKill).not.toHaveBeenCalled();
    expect(cancelFn).not.toHaveBeenCalled();
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });

  test('killAllSystem only cancels registered processes for matching run ids', async () => {
    const runA = processManager.registerExternalProcess('kill-all-run-a', 'dev', 'step', 'run-a');
    const runB = processManager.registerExternalProcess('kill-all-run-b', 'dev', 'step', 'run-b');
    const unscoped = processManager.registerExternalProcess('kill-all-unscoped', 'dev', 'step');
    const runAChildKill = vi.fn();
    const runBChildKill = vi.fn();
    const unscopedChildKill = vi.fn();
    const runACancel = vi.fn();
    const runBCancel = vi.fn();
    const unscopedCancel = vi.fn();
    (runA as any).childProcess = { kill: runAChildKill };
    (runB as any).childProcess = { kill: runBChildKill };
    (unscoped as any).childProcess = { kill: unscopedChildKill };
    (runA as any)._cancelFn = runACancel;
    (runB as any)._cancelFn = runBCancel;
    (unscoped as any)._cancelFn = unscopedCancel;

    const result = await processManager.killAllSystem({ runIds: ['run-a'] });

    expect(result.pids).toEqual([]);
    expect(result.registeredKilled).toBe(1);
    expect(result.registeredProcessIds).toEqual(['kill-all-run-a']);
    expect(processManager.getProcess('kill-all-run-a')!.status).toBe('killed');
    expect(processManager.getProcess('kill-all-run-b')!.status).toBe('running');
    expect(processManager.getProcess('kill-all-unscoped')!.status).toBe('running');
    expect(runAChildKill).toHaveBeenCalledWith('SIGTERM');
    expect(runACancel).toHaveBeenCalledOnce();
    expect(runBChildKill).not.toHaveBeenCalled();
    expect(runBCancel).not.toHaveBeenCalled();
    expect(unscopedChildKill).not.toHaveBeenCalled();
    expect(unscopedCancel).not.toHaveBeenCalled();
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  test('killAllSystem cleans queued registered processes for matching run ids', async () => {
    const proc = processManager.registerExternalProcess('kill-all-queued', 'dev', 'step', 'run-queued');
    proc.status = 'queued';
    const childKill = vi.fn();
    const cancelFn = vi.fn();
    (proc as any).childProcess = { kill: childKill };
    (proc as any)._cancelFn = cancelFn;

    const result = await processManager.killAllSystem({ runIds: ['run-queued'] });

    expect(result.registeredKilled).toBe(1);
    expect(result.registeredProcessIds).toEqual(['kill-all-queued']);
    expect(processManager.getProcess('kill-all-queued')!.status).toBe('killed');
    expect(childKill).toHaveBeenCalledWith('SIGTERM');
    expect(cancelFn).toHaveBeenCalledOnce();
  });

  test('killAllSystem supports explicit global registered-process cleanup', async () => {
    processManager.registerExternalProcess('kill-all-global-run', 'dev', 'step', 'run-global');
    processManager.registerExternalProcess('kill-all-global-unscoped', 'dev', 'step');

    const result = await processManager.killAllSystem({ registeredProcessScope: 'all' });

    expect(result.pids).toEqual([]);
    expect(result.registeredKilled).toBe(2);
    expect(result.registeredProcessIds).toEqual(['kill-all-global-run', 'kill-all-global-unscoped']);
    expect(processManager.getProcess('kill-all-global-run')!.status).toBe('killed');
    expect(processManager.getProcess('kill-all-global-unscoped')!.status).toBe('killed');
    expect(execSyncMock).not.toHaveBeenCalled();
  });

  test('requested system cleanup ignores command-line-only Claude processes without ACP sessions', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    execSyncMock.mockReturnValue([
      `91001 ${process.pid} Tue Jul 23 10:05:00 2026 /tmp/claude --dangerously-skip-permissions`,
      `91002 ${process.pid} Tue Jul 23 10:05:01 2026 /tmp/claude -p probe`,
      `91003 ${process.pid} Tue Jul 23 10:05:02 2026 /bin/zsh -lc claude -p embedded`,
      `91004 ${process.pid} Tue Jul 23 10:05:03 2026 /tmp/claude --print=probe`,
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: ['/tmp/aceharness-process-manager-test-no-acp-sessions'],
    });

    expect(result.pids).toEqual([]);
    expect(result.agentRootsMatched).toBe(0);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test('killAllSystem only sweeps ACP records for the targeted run in a shared workspace', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const workspace = '/tmp/aceharness-process-manager-shared-workspace';
    writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: workspace,
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
    });
    writeAcpSessionRecord('record-run-b', {
      acpx_record_id: 'record-run-b',
      pid: 92001,
      cwd: workspace,
      agent_started_at: 'Tue Jul 28 10:06:00 2026',
    });
    execSyncMock.mockReturnValue([
      `91001 ${process.pid} Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a`,
      `91002 91001 Tue Jul 28 10:05:01 2026 /tmp/agent-a`,
      `92001 ${process.pid} Tue Jul 28 10:06:00 2026 /tmp/acpx-wrapper-b`,
      `92002 92001 Tue Jul 28 10:06:01 2026 /tmp/agent-b`,
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: [workspace],
      acpxRecordIds: ['record-run-a'],
    });

    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).toHaveBeenCalledWith(91001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(91002, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92001, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem reaps an exact closed ACP record after runtime cleanup', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const workspace = '/tmp/aceharness-process-manager-closed-record';
    writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: workspace,
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
      closed: true,
    });
    writeAcpSessionRecord('record-run-b', {
      acpx_record_id: 'record-run-b',
      pid: 92001,
      cwd: workspace,
      agent_started_at: 'Tue Jul 28 10:06:00 2026',
      closed: true,
    });
    execSyncMock.mockReturnValue([
      `91001 ${process.pid} Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a`,
      `91002 91001 Tue Jul 28 10:05:01 2026 /tmp/agent-a`,
      `92001 ${process.pid} Tue Jul 28 10:06:00 2026 /tmp/acpx-wrapper-b`,
      `92002 92001 Tue Jul 28 10:06:01 2026 /tmp/agent-b`,
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: [workspace],
      acpxRecordIds: ['record-run-a'],
    });

    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).toHaveBeenCalledWith(91001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(91002, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92001, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem reaps an exact ACP record when run workspace metadata is unavailable', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: '/unknown-workspace-a',
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
    });
    writeAcpSessionRecord('record-run-b', {
      acpx_record_id: 'record-run-b',
      pid: 92001,
      cwd: '/unknown-workspace-b',
      agent_started_at: 'Tue Jul 28 10:06:00 2026',
    });
    execSyncMock.mockReturnValue([
      `91001 ${process.pid} Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a`,
      `91002 91001 Tue Jul 28 10:05:01 2026 /tmp/agent-a`,
      `92001 ${process.pid} Tue Jul 28 10:06:00 2026 /tmp/acpx-wrapper-b`,
      `92002 92001 Tue Jul 28 10:06:01 2026 /tmp/agent-b`,
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: [],
      acpxRecordIds: ['record-run-a'],
    });

    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).not.toHaveBeenCalledWith(92001, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem keeps a directly scoped ACP record eligible after the maintenance age window', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const workspace = '/tmp/aceharness-process-manager-long-run';
    const recordPath = writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: workspace,
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
    });
    const staleTime = new Date(Date.now() - (25 * 60 * 60 * 1000));
    utimesSync(recordPath, staleTime, staleTime);
    execSyncMock.mockReturnValue([
      `91001 ${process.pid} Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a`,
      `91002 91001 Tue Jul 28 10:05:01 2026 /tmp/agent-a`,
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: [workspace],
      acpxRecordIds: ['record-run-a'],
    });

    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).toHaveBeenCalledWith(91001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(91002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem reaps a detached exact ACP target despite closed and mismatched cwd metadata', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: '/different/workspace',
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
      closed: true,
    });
    execSyncMock.mockReturnValue([
      '91001 1 Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a',
      '91002 91001 Tue Jul 28 10:05:01 2026 /tmp/agent-a',
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: ['/expected/workspace'],
      acpxRecordIds: ['record-run-a'],
    });

    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).toHaveBeenCalledWith(91001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(91002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem matches an old one-shot ACP record through record.name', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const oneShotName = 'session-key:oneshot:db9c90b1';
    const recordPath = writeAcpSessionRecord('opaque-record-id', {
      name: oneShotName,
      pid: 91001,
      cwd: '/different/workspace',
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
      closed: true,
    });
    const staleTime = new Date(Date.now() - (48 * 60 * 60 * 1000));
    utimesSync(recordPath, staleTime, staleTime);
    execSyncMock.mockReturnValue([
      '91001 1 Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a',
      '91002 91001 Tue Jul 28 10:05:01 2026 /tmp/agent-a',
    ].join('\n'));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: ['/expected/workspace'],
      acpxRecordIds: [oneShotName],
    });

    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).toHaveBeenCalledWith(91001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(91002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem applies exact ACP targeting on Windows', async () => {
    vi.useFakeTimers();
    isWindowsMock.mockReturnValue(true);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const workspace = 'C:\\Repo\\Workflow';
    writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: 'c:\\repo\\workflow\\src',
      agent_started_at: '2026-07-28T10:05:00.000Z',
    });
    writeAcpSessionRecord('record-run-b', {
      acpx_record_id: 'record-run-b',
      pid: 92001,
      cwd: 'C:\\Repo\\Workflow\\src',
      agent_started_at: '2026-07-28T10:06:00.000Z',
    });
    execFileSyncMock.mockReturnValue(JSON.stringify([
      { pid: 91001, ppid: process.pid, startedAt: '2026-07-28T10:05:00.000Z', command: 'acpx-wrapper-a' },
      { pid: 91002, ppid: 91001, startedAt: '2026-07-28T10:05:01.000Z', command: 'agent-a' },
      { pid: 92001, ppid: process.pid, startedAt: '2026-07-28T10:06:00.000Z', command: 'acpx-wrapper-b' },
      { pid: 92002, ppid: 92001, startedAt: '2026-07-28T10:06:01.000Z', command: 'agent-b' },
    ]));

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: [workspace],
      acpxRecordIds: ['record-run-a'],
    });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      'powershell.exe',
      expect.arrayContaining(['-NoProfile', '-NonInteractive', '-Command']),
      expect.objectContaining({ windowsHide: true }),
    );
    expect(execSyncMock).not.toHaveBeenCalled();
    expect(result.agentRootsMatched).toBe(1);
    expect(new Set(result.pids)).toEqual(new Set([91001, 91002]));
    expect(killSpy).toHaveBeenCalledWith(91001, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(91002, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92001, 'SIGTERM');
    expect(killSpy).not.toHaveBeenCalledWith(92002, 'SIGTERM');
    vi.clearAllTimers();
  });

  test('killAllSystem does not fall back to workspace-only ACP sweep with an empty record scope', async () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const workspace = '/tmp/aceharness-process-manager-shared-workspace';
    writeAcpSessionRecord('record-run-a', {
      acpx_record_id: 'record-run-a',
      pid: 91001,
      cwd: workspace,
      agent_started_at: 'Tue Jul 28 10:05:00 2026',
    });
    execSyncMock.mockReturnValue(`91001 ${process.pid} Tue Jul 28 10:05:00 2026 /tmp/acpx-wrapper-a`);

    const result = await processManager.killAllSystem({
      sweepAgentProcesses: true,
      workspacePaths: [workspace],
      acpxRecordIds: [],
    });

    expect(result.pids).toEqual([]);
    expect(result.agentRootsMatched).toBe(0);
    expect(killSpy).not.toHaveBeenCalled();
  });

  test('getProcess returns copy without childProcess', () => {
    processManager.registerExternalProcess('get-1', 'dev', 'step');
    const proc = processManager.getProcess('get-1');
    expect(proc).toBeDefined();
    expect(proc!.childProcess).toBeUndefined();
  });

  test('getProcess returns undefined for nonexistent', () => {
    expect(processManager.getProcess('nonexistent')).toBeUndefined();
  });

  test('getProcessBySessionId finds process by sessionId', () => {
    const proc = processManager.registerExternalProcess('sess-1', 'dev', 'step');
    proc.sessionId = 'session-abc';
    const found = processManager.getProcessBySessionId('session-abc');
    expect(found).toBeDefined();
    expect(found!.id).toBe('sess-1');
  });

  test('getProcessBySessionId returns undefined for unknown sessionId', () => {
    expect(processManager.getProcessBySessionId('unknown')).toBeUndefined();
  });

  test('getStats counts processes by status', () => {
    processManager.registerExternalProcess('stats-1', 'dev', 'step');
    processManager.registerExternalProcess('stats-2', 'dev', 'step');
    processManager.killProcess('stats-2');
    const stats = processManager.getStats();
    expect(stats.running).toBeGreaterThanOrEqual(1);
    expect(stats.failed).toBeGreaterThanOrEqual(1); // killed counts as failed
  });

  test('cleanup removes processes ended more than 30 minutes ago', () => {
    const proc = processManager.registerExternalProcess('cleanup-1', 'dev', 'step');
    processManager.killProcess('cleanup-1');
    // Manually set endTime to 31 minutes ago
    proc.endTime = new Date(Date.now() - 31 * 60 * 1000);
    processManager.cleanup();
    expect(processManager.getProcess('cleanup-1')).toBeUndefined();
  });

  test('cleanup keeps recently ended processes', () => {
    const proc = processManager.registerExternalProcess('cleanup-keep', 'dev', 'step');
    processManager.killProcess('cleanup-keep');
    // endTime is now, within 30 min window
    processManager.cleanup();
    expect(processManager.getProcess('cleanup-keep')).toBeDefined();
  });

  test('registerActiveStream and getActiveStreamChatId lifecycle', () => {
    processManager.registerActiveStream('frontend-1', 'chat-abc');
    expect(processManager.getActiveStreamChatId('frontend-1')).toBe('chat-abc');
    processManager.removeActiveStream('frontend-1');
    expect(processManager.getActiveStreamChatId('frontend-1')).toBeUndefined();
  });

  test('appendStreamContent returns empty for nonexistent process', () => {
    expect(processManager.appendStreamContent('nonexistent', 'data')).toBe('');
  });

  test('setProcessOutput is no-op for nonexistent process', () => {
    // Should not throw
    processManager.setProcessOutput('nonexistent', 'data');
  });

  test('setProcessError is no-op for nonexistent process', () => {
    processManager.setProcessError('nonexistent', 'data');
  });

  test('appendLogLine is no-op for nonexistent process', () => {
    processManager.appendLogLine('nonexistent', 'data');
  });
});
