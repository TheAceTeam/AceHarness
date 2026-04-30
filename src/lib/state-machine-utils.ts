/**
 * Pure utility functions extracted from state-machine-workflow-manager for testability.
 * These functions have no side effects and no heavy dependencies.
 */

import type { WorkflowStep } from '@/lib/schemas';

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

export function extractSpecTasksBlock(text: string): string | null {
  return extractTaggedBlock(text, 'spec-tasks');
}

export function stripSpecTasksBlocks(text: string): string {
  return text.replace(/<spec-tasks>[\s\S]*?<\/spec-tasks>/gi, '');
}

export function stripJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function compactStepConclusion(raw: string): string {
  const tagged = extractTaggedBlock(raw, 'step-conclusion');
  if (tagged) return tagged;

  const text = stripSpecTasksBlocks(stripNonAiStreamArtifacts(raw))
    .trim();
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

export function isEngineLevelFailure(message: string): boolean {
  return /acp\s+connection\s+closed/i.test(message)
    || /引擎执行失败/.test(message)
    || /engine\s+.*failed/i.test(message);
}
