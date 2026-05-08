import { describe, expect, test, vi, beforeEach } from 'vitest';
import { processManager } from '@/lib/process-manager';

// Each test gets a clean-ish state. The ProcessManager is a singleton,
// so we work with it directly and clean up after each test.
beforeEach(() => {
  // Kill any leftover processes from previous tests
  for (const proc of processManager.getAllProcesses()) {
    if (proc.status === 'running') {
      processManager.killProcess(proc.id);
    }
  }
});

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
