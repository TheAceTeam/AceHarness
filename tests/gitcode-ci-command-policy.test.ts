import { describe, expect, test } from 'vitest';
import {
  decideGitCodeCiGateRecovery,
  findGitCodeCiToolCommandViolation,
  GITCODE_CI_TRIGGER_COMMAND,
  validateGitCodeCiTriggerCommand,
} from '@/lib/workflow/gitcode-ci-command-policy';

describe('GitCode CI command policy', () => {
  test('accepts only the exact GitCode CI comment body', () => {
    expect(validateGitCodeCiTriggerCommand(GITCODE_CI_TRIGGER_COMMAND)).toEqual({
      ok: true,
      command: 'start build',
    });
    expect(validateGitCodeCiTriggerCommand('start_build')).toMatchObject({ ok: false });
    expect(validateGitCodeCiTriggerCommand('start build ')).toMatchObject({ ok: false });
  });

  test('flags malformed trigger variants only in GitCode PR comment commands', () => {
    expect(findGitCodeCiToolCommandViolation({
      input: { command: 'gc pr comment 2085 --body start_build' },
    })).toMatchObject({ code: 'GITCODE_CI_TRIGGER_COMMAND_INVALID' });
    expect(findGitCodeCiToolCommandViolation({
      input: { command: 'python power-gitcode.py comment_pr --body start-build' },
    })).toMatchObject({ code: 'GITCODE_CI_TRIGGER_COMMAND_INVALID' });
    expect(findGitCodeCiToolCommandViolation({
      input: { command: 'rg start_build docs' },
    })).toBeNull();
  });

  test('does not flag the canonical command inside a GitCode PR comment tool call', () => {
    expect(findGitCodeCiToolCommandViolation({
      input: { command: 'gc pr comment 2085 --body "start build"' },
    })).toBeNull();
  });

  test('allows one authorized recovery for a trailing-newline trigger but never repeats it', () => {
    const snapshot = {
      headSha: 'ffe4b340',
      labels: ['waiting-start-build'],
      latestTriggerBody: 'start build\n',
      botRequestedRetry: true,
      ciRunning: false,
      retryAlreadyAttempted: false,
      triggerAuthorized: true,
    };

    expect(decideGitCodeCiGateRecovery(snapshot)).toMatchObject({ action: 'trigger_once' });
    expect(decideGitCodeCiGateRecovery({ ...snapshot, retryAlreadyAttempted: true }))
      .toMatchObject({ action: 'external_blocked' });
    expect(decideGitCodeCiGateRecovery({ ...snapshot, latestTriggerBody: 'start build' }))
      .toMatchObject({ action: 'external_blocked' });
    expect(decideGitCodeCiGateRecovery({ ...snapshot, ciRunning: true }))
      .toMatchObject({ action: 'monitor' });
  });
});
