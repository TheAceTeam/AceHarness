import { describe, expect, test } from 'vitest';
import {
  classifyGitCodeCiGate,
  createGitCodeCiGateObservation,
  createGitCodePullRequestReadinessObservation,
  decideGitCodeCiGateRecovery,
  findGitCodePullRequestRef,
  findGitCodeCiToolCommandViolation,
  buildGitCodeCiCommandPolicyPrompt,
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

  test('accepts only a canonical PR link as gate-observation input', () => {
    expect(findGitCodePullRequestRef('https://gitcode.com/Cangjie/cangjie_compiler/pull/2085/discuss'))
      .toEqual({
        owner: 'Cangjie',
        repo: 'cangjie_compiler',
        number: 2085,
        url: 'https://gitcode.com/Cangjie/cangjie_compiler/pull/2085',
      });
    expect(findGitCodePullRequestRef('https://gitcode.com/Cangjie/UsersForum/issues/3350')).toBeNull();
  });

  test('requires both build and codecheck labels before auto-advancing a gate', () => {
    expect(classifyGitCodeCiGate(['build-test-passed', 'codecheck-passed'])).toMatchObject({
      status: 'passed',
    });
    expect(classifyGitCodeCiGate(['build-test-passed'])).toMatchObject({ status: 'unknown' });
    expect(classifyGitCodeCiGate(['CI-running'])).toMatchObject({ status: 'running' });
    expect(classifyGitCodeCiGate(['codecheck-failed', 'build-test-passed'])).toMatchObject({
      status: 'failed',
    });
    expect(createGitCodeCiGateObservation({
      labels: ['build-test-passed', 'codecheck-passed'],
      headSha: 'ffe4b340',
      merged: true,
      checkedAt: '2026-08-29T10:18:20.000Z',
    })).toMatchObject({ status: 'passed', headSha: 'ffe4b340', merged: true });
  });

  test('routes unresolved reviews back to repair even when CI labels are green', () => {
    expect(createGitCodePullRequestReadinessObservation({
      labels: ['build-test-passed', 'codecheck-passed'],
      headSha: 'ffe4b340',
      mergeableState: { ci_state_passed: true, resolve_discussion_passed: false },
      reviewComments: [{ id: 'review-1', body: '[major] add a regression', resolved: false, file: 'foo.cpp', line: 42 }],
    })).toMatchObject({
      readiness: 'repair_required',
      blockers: expect.arrayContaining(['存在 1 条未解决的行级检视意见。']),
    });
  });

  test('distinguishes waiting for reviewers from a PR ready for another user to merge', () => {
    const base = {
      labels: ['build-test-passed', 'codecheck-passed'],
      headSha: 'ffe4b340',
      mergeableState: {
        ci_state_passed: true,
        resolve_discussion_passed: true,
        conflict_passed: true,
        approval_reviewers_required_passed: true,
        approval_approvers_required_passed: true,
        approval_testers_required_passed: true,
        branch_missing_passed: true,
      },
    };
    expect(createGitCodePullRequestReadinessObservation(base)).toMatchObject({ readiness: 'ready_for_merge' });
    expect(createGitCodePullRequestReadinessObservation({
      ...base,
      mergeableState: { ...base.mergeableState, approval_reviewers_required_passed: false },
    })).toMatchObject({ readiness: 'waiting_external' });
  });

  test('injects the single-commit amend policy into every workflow delivery prompt', () => {
    const prompt = buildGitCodeCiCommandPolicyPrompt('/tmp/aceharness-gitcode-ci-delivery/SKILL.md');

    expect(prompt).toContain('一个 PR、一个提交');
    expect(prompt).toContain('git commit --amend');
    expect(prompt).toContain('git push --force-with-lease');
    expect(prompt).toContain('只有“尚未创建 PR 的首次交付”');
  });
});
