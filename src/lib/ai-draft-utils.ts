import type { SpecCodingDocument } from '@/lib/schemas';
import { normalizeSpecCodingDocument } from '@/lib/spec-coding-store';

export function extractJsonObject(text: string): any | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] || text;
  const trimmed = candidate.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function normalizeStringArray(input: unknown, limit = 12): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function applyAiSpecCodingDraft(base: SpecCodingDocument, ai: any): SpecCodingDocument {
  const summary = typeof ai?.summary === 'string' && ai.summary.trim() ? ai.summary.trim() : base.summary;
  const goals = normalizeStringArray(ai?.goals, 8);
  const nonGoals = normalizeStringArray(ai?.nonGoals, 8);
  const constraints = normalizeStringArray(ai?.constraints, 12);
  const requirements = typeof ai?.artifacts?.requirements === 'string' ? ai.artifacts.requirements.trim() : '';
  const design = typeof ai?.artifacts?.design === 'string' ? ai.artifacts.design.trim() : '';
  const tasks = typeof ai?.artifacts?.tasks === 'string' ? ai.artifacts.tasks.trim() : '';

  return normalizeSpecCodingDocument({
    ...base,
    summary: summary || base.summary,
    goals: goals.length ? goals : base.goals,
    nonGoals: nonGoals.length ? nonGoals : base.nonGoals,
    constraints: constraints.length ? constraints : base.constraints,
    progress: {
      ...base.progress,
      summary: typeof ai?.clarification?.summary === 'string' && ai.clarification.summary.trim()
        ? ai.clarification.summary.trim()
        : base.progress.summary,
    },
    artifacts: {
      requirements: requirements || base.artifacts.requirements,
      design: design || base.artifacts.design,
      tasks: tasks || base.artifacts.tasks,
    },
  });
}

export function buildFallbackClarification(input: {
  workflowName: string;
  requirements?: string;
  description?: string;
  workingDirectory: string;
  referenceWorkflow?: string;
}) {
  return {
    summary: '已根据当前输入整理业务背景，但仍需要补齐会直接影响业务方案、范围和验证方式的关键信息。',
    knownFacts: [
      input.workflowName ? `工作流名称：${input.workflowName}` : '',
      input.requirements ? `需求：${input.requirements}` : '',
      input.description ? `补充说明：${input.description}` : '',
      input.workingDirectory ? `工作目录：${input.workingDirectory}` : '',
      input.referenceWorkflow ? `参考工作流：${input.referenceWorkflow}` : '',
    ].filter(Boolean),
    missingFields: [
      '关键术语与对象定义',
      '业务结果边界',
      '覆盖范围与优先级',
      '兼容与验证约束',
    ],
    questions: [
      '有哪些关键术语、业务对象或边界概念需要先统一定义？',
      '最终希望业务问题被拆解成哪些可以直接执行和审查的结果？',
      '这次必须覆盖哪些业务对象、场景或能力，优先级如何？',
      '有哪些兼容性、风险边界或验证要求会直接改变方案设计？',
    ],
  };
}
