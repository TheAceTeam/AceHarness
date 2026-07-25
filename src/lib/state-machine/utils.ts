/**
 * Pure utility functions extracted from state-machine-workflow-manager for testability.
 * These functions have no side effects and no heavy dependencies.
 */

import type { WorkflowStep } from '@/lib/core/schemas';

export function stripNonAiStreamArtifacts(text: string): string {
  return text
    .replace(/\n?\s*<!-- chunk-boundary -->\s*\n?/g, '\n')
    .replace(/\n?\s*<!-- human-feedback:[\s\S]*?-->\s*\n?/g, '\n')
    .trim();
}

export function extractTaggedBlock(text: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`, 'i');
  return text.match(pattern)?.[1]?.trim() || null;
}

export function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function compactStepConclusion(raw: string): string {
  const MAX_CONCLUSION_CHARS = 4000;
  const tagged = extractTaggedBlock(raw, 'step-conclusion');
  if (tagged) {
    // 与 state-machine/workflow-manager.ts 内的同名实现保持一致：超长保留开头。
    return tagged.length > MAX_CONCLUSION_CHARS
      ? tagged.slice(0, MAX_CONCLUSION_CHARS).trim() + '\n...(结论过长已截断)'
      : tagged;
  }

  const text = stripNonAiStreamArtifacts(raw).trim();
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  const tail = lines.slice(-30).join('\n').trim();
  return tail.length > 4000 ? tail.slice(-4000).trim() : tail;
}

export type StepSegment =
  | { type: 'serial'; step: WorkflowStep }
  | { type: 'parallel'; groupId: string; steps: WorkflowStep[] };

function getStepConcurrencyGroup(step: WorkflowStep): string | undefined {
  return (step as any).concurrency?.groupId || (step as any).parallelGroup || undefined;
}

export function groupStateStepsIntoSegments(steps: WorkflowStep[]): StepSegment[] {
  const segments: StepSegment[] = [];
  let i = 0;
  while (i < steps.length) {
    const step = steps[i];
    const groupId = getStepConcurrencyGroup(step);
    if (!groupId) {
      segments.push({ type: 'serial', step });
      i += 1;
      continue;
    }

    const groupSteps: WorkflowStep[] = [step];
    let j = i + 1;
    while (j < steps.length && getStepConcurrencyGroup(steps[j]) === groupId) {
      groupSteps.push(steps[j]);
      j += 1;
    }

    if (groupSteps.length > 1) {
      segments.push({ type: 'parallel', groupId, steps: groupSteps });
    } else {
      segments.push({ type: 'serial', step });
    }
    i = j;
  }
  return segments;
}

function isStepToolFailure(message: string): boolean {
  return /(?:ENOENT|ENOTDIR|EISDIR|EACCES|EPERM):/i.test(message)
    || /no such file or directory/i.test(message)
    || /file not found/i.test(message)
    || /cannot find path/i.test(message)
    || /找不到文件|文件不存在|路径不存在|没有那个文件或目录/.test(message)
    || /permission denied/i.test(message);
}

function isHttpAuthStatusFailure(message: string): boolean {
  return /(?:HTTP|status|statusCode|response|request|code)[^\r\n]{0,40}\b(?:401|403)\b/i.test(message)
    || /\b(?:401|403)\b[^\r\n]{0,80}(?:unauthorized|forbidden|invalid token|invalid api key|authentication failed|无效的令牌|令牌无效|认证失败|鉴权失败)/i.test(message);
}

export function isEngineLevelFailure(message: string): boolean {
  const normalized = String(message || '');
  if (!normalized.trim()) return false;
  if (/引擎连续失败|自动恢复\s*\d+\s*次后仍失败/.test(normalized)) return true;
  if (isStepToolFailure(normalized)) return false;

  return /acp\s+connection\s+closed/i.test(normalized)
    || /apierror/i.test(normalized)
    || /模型调用失败(?:\s*\(\s*\d{3}\s*\))?\s*:/i.test(normalized)
    || /(?:unauthorized|invalid token|invalid api key|authentication failed|permission denied)/i.test(normalized)
    || /(?:无效的令牌|令牌无效|认证失败|鉴权失败|API\s*Key\s*无效)/i.test(normalized)
    || isHttpAuthStatusFailure(normalized)
    || /context window limit/i.test(normalized)
    || /reached (its |the )?context window limit/i.test(normalized)
    || /maximum context length/i.test(normalized)
    || /prompt is too long/i.test(normalized)
    || /SDK API retry limit/i.test(normalized)
    || /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE/i.test(normalized)
    || /engine (?:not initialized|unavailable|connection .*failed|process .*failed|session .*failed)/i.test(normalized)
    || /failed to create .*process streams/i.test(normalized)
    || /引擎(?:未初始化|初始化失败|不可用|连接.*失败|连接.*断开|连续失败)/.test(normalized);
}
