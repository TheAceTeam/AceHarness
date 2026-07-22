export interface WorkflowTaskInput {
  title?: string;
  description?: string;
  issueUrl?: string;
  targetBranch?: string;
  acceptanceCriteria?: string;
}

const FIELD_LIMITS: Record<keyof WorkflowTaskInput, number> = {
  title: 160,
  description: 8000,
  issueUrl: 1000,
  targetBranch: 200,
  acceptanceCriteria: 4000,
};

function trimString(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

export function normalizeWorkflowTaskInput(input: unknown): WorkflowTaskInput {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const normalized: WorkflowTaskInput = {};
  for (const field of Object.keys(FIELD_LIMITS) as Array<keyof WorkflowTaskInput>) {
    const value = trimString(source[field], FIELD_LIMITS[field]);
    if (value) normalized[field] = value;
  }
  return normalized;
}

export function hasWorkflowTaskInput(input?: WorkflowTaskInput | null): boolean {
  if (!input) return false;
  return Boolean(
    input.title?.trim()
      || input.description?.trim()
      || input.issueUrl?.trim()
      || input.targetBranch?.trim()
      || input.acceptanceCriteria?.trim()
  );
}

export function getWorkflowTaskInputTitle(input?: WorkflowTaskInput | null): string {
  const normalized = normalizeWorkflowTaskInput(input);
  if (normalized.title) return normalized.title;
  if (normalized.issueUrl) return normalized.issueUrl;
  if (normalized.description) {
    const firstLine = normalized.description.split('\n').find((line) => line.trim());
    if (firstLine) {
      return firstLine.length > 120 ? `${firstLine.slice(0, 120)}...` : firstLine;
    }
  }
  return '';
}

export function formatWorkflowTaskInputForPrompt(input?: WorkflowTaskInput | null): string {
  const normalized = normalizeWorkflowTaskInput(input);
  if (!hasWorkflowTaskInput(normalized)) return '';

  const lines = [
    '## 本次任务输入',
    '这些内容只约束当前 run，不代表修改工作流模板或工作流配置。',
  ];
  if (normalized.title) lines.push(`- 任务标题: ${normalized.title}`);
  if (normalized.issueUrl) lines.push(`- Issue 链接: ${normalized.issueUrl}`);
  if (normalized.targetBranch) lines.push(`- 目标分支: ${normalized.targetBranch}`);
  if (normalized.acceptanceCriteria) {
    lines.push('- 验收标准:');
    lines.push(normalized.acceptanceCriteria);
  }
  if (normalized.description) {
    lines.push('- 任务描述:');
    lines.push(normalized.description);
  }
  return `${lines.join('\n')}\n\n`;
}
