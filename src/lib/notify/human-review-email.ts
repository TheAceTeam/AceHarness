import { getUserById } from '@/lib/core/user-store';
import { loadRunState } from '@/lib/run/state-persistence';
import type { HumanQuestion } from '@/lib/run/state-persistence';
import { loadSystemSettings } from '@/lib/config/system-settings';
import { sendMailViaSmtp } from '@/lib/notify/smtp-client';

const deliveredQuestionIds = new Set<string>();

function splitEmailList(raw?: string): string[] {
  return String(raw || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildSubject(prefix: string | undefined, question: HumanQuestion): string {
  const base = `工作流人工审查: ${question.title || '等待处理'}`;
  const trimmedPrefix = String(prefix || '').trim();
  return trimmedPrefix ? `${trimmedPrefix} ${base}` : base;
}

function buildBody(question: HumanQuestion): string {
  return [
    'CSIHarness 检测到一个需要人工处理的工作流审查事项。',
    '',
    `标题: ${question.title || '未命名问题'}`,
    `工作流配置: ${question.configFile || '未知'}`,
    `运行 ID: ${question.runId || '未知'}`,
    `当前状态: ${question.currentState || '未知'}`,
    question.suggestedNextState ? `建议下一状态: ${question.suggestedNextState}` : '',
    '',
    '审查内容:',
    question.message || '(无内容)',
    '',
    question.supervisorAdvice ? `Supervisor 建议:\n${question.supervisorAdvice}` : '',
    '',
    '请前往 CSIHarness 中的工作流运行面板或待处理人工审查列表完成回复。',
  ].filter(Boolean).join('\n');
}

export async function sendHumanReviewEmailNotification(question: HumanQuestion): Promise<{ ok: boolean; reason?: string }> {
  if (!question?.id) return { ok: false, reason: 'missing-question-id' };
  if (deliveredQuestionIds.has(question.id)) return { ok: true, reason: 'already-sent' };

  const settings = await loadSystemSettings();
  const emailSettings = settings.emailNotifications;
  if (!emailSettings?.enabled) return { ok: false, reason: 'email-disabled' };
  if (!emailSettings.smtpHost || !emailSettings.smtpPort || !emailSettings.fromEmail) {
    return { ok: false, reason: 'email-config-incomplete' };
  }

  const runState = question.runId ? await loadRunState(question.runId).catch(() => null) : null;
  const owner = runState?.runOwnerId ? await getUserById(runState.runOwnerId).catch(() => undefined) : undefined;
  const to = owner?.email ? [owner.email] : [];
  const cc = splitEmailList(emailSettings.ccEmails);
  if (to.length === 0 && cc.length === 0) {
    return { ok: false, reason: 'no-recipients' };
  }

  await sendMailViaSmtp({
    host: emailSettings.smtpHost,
    port: emailSettings.smtpPort,
    secure: emailSettings.smtpSecure,
    username: emailSettings.smtpUsername,
    password: emailSettings.smtpPassword,
    fromEmail: emailSettings.fromEmail,
    fromName: emailSettings.fromName,
    replyTo: emailSettings.replyTo,
  }, {
    to,
    cc,
    subject: buildSubject(emailSettings.subjectPrefix, question),
    text: buildBody(question),
  });

  deliveredQuestionIds.add(question.id);
  return { ok: true };
}
