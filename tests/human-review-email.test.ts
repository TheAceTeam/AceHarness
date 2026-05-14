import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMailViaSmtp = vi.fn();

vi.mock('@/lib/notify/smtp-client', () => ({
  sendMailViaSmtp,
}));

vi.mock('@/lib/config/system-settings', () => ({
  loadSystemSettings: vi.fn(async () => ({
    emailNotifications: {
      enabled: true,
      smtpHost: 'smtp.example.com',
      smtpPort: 465,
      smtpSecure: true,
      smtpUsername: 'bot@example.com',
      smtpPassword: 'secret',
      fromEmail: 'bot@example.com',
      fromName: 'ACEHarness',
      ccEmails: 'team@example.com; audit@example.com',
      subjectPrefix: '[ACE]',
    },
  })),
}));

vi.mock('@/lib/run/state-persistence', () => ({
  loadRunState: vi.fn(async () => ({
    runOwnerId: 'user-1',
  })),
}));

vi.mock('@/lib/core/user-store', () => ({
  getUserById: vi.fn(async () => ({
    id: 'user-1',
    email: 'owner@example.com',
  })),
}));

describe('human review email notification', () => {
  beforeEach(() => {
    sendMailViaSmtp.mockReset();
    sendMailViaSmtp.mockResolvedValue(undefined);
  });

  it('sends review email to run owner with configured cc recipients', async () => {
    const { sendHumanReviewEmailNotification } = await import('@/lib/notify/human-review-email');

    const result = await sendHumanReviewEmailNotification({
      id: 'hq-1',
      runId: 'run-1',
      configFile: 'demo.yaml',
      currentState: '__human_approval__',
      title: '等待人工审查',
      message: '请确认是否进入下一阶段',
      status: 'unanswered',
      kind: 'approval',
      createdAt: new Date().toISOString(),
      answerSchema: { type: 'text', required: true },
      source: { type: 'human-approval' },
    } as any);

    expect(result.ok).toBe(true);
    expect(sendMailViaSmtp).toHaveBeenCalledTimes(1);
    expect(sendMailViaSmtp).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.example.com',
        fromEmail: 'bot@example.com',
      }),
      expect.objectContaining({
        to: ['owner@example.com'],
        cc: ['team@example.com', 'audit@example.com'],
        subject: expect.stringContaining('等待人工审查'),
      }),
    );
  });
});
