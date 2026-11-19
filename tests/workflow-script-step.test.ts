import { describe, expect, it } from 'vitest';
import { runWorkflowScript } from '@/lib/workflow/script-step';

const windows = process.platform === 'win32';

describe('script interpreter process', () => {
  it('executes a real script and returns stdout, stderr, and the exit code', async () => {
    const result = await runWorkflowScript({
      interpreter: windows ? 'cmd' : 'shell',
      source: windows ? 'echo scripted-result\necho scripted-error 1>&2\nexit /b 7'
        : 'printf scripted-result\nprintf scripted-error >&2\nexit 7',
      timeoutMs: 10000,
      onFailure: { action: 'continue' },
    }, { cwd: process.cwd() });
    expect(result, result.error || result.stderr).toMatchObject({ started: true, exitCode: 7, cancelled: false });
    expect(result.stdout).toContain('scripted-result');
    expect(result.stderr).toContain('scripted-error');
  });

  it('does not launch an already-cancelled script', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runWorkflowScript({
      interpreter: windows ? 'cmd' : 'shell', source: 'exit 0',
      timeoutMs: 10000, onFailure: { action: 'stop' },
    }, { cwd: process.cwd(), signal: controller.signal });
    expect(result).toMatchObject({ started: false, cancelled: true, exitCode: null });
  });
});
