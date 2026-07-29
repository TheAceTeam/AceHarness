export interface WorkflowTaskInput {
  title?: string;
  description?: string;
  issueUrl?: string;
  targetBranch?: string;
  acceptanceCriteria?: string;
  fields?: Record<string, string>;
  fieldLabels?: Record<string, string>;
}

export type WorkflowTaskInputFieldType = 'text' | 'textarea' | 'url';

export interface WorkflowTaskInputFieldDefinition {
  id: string;
  label: string;
  type?: WorkflowTaskInputFieldType;
  required?: boolean;
  placeholder?: string;
  description?: string;
}

const CORE_FIELD_LIMITS = {
  title: 160,
  description: 8000,
  issueUrl: 1000,
  targetBranch: 200,
  acceptanceCriteria: 4000,
} satisfies Record<'title' | 'description' | 'issueUrl' | 'targetBranch' | 'acceptanceCriteria', number>;

const CORE_FIELD_IDS = new Set(Object.keys(CORE_FIELD_LIMITS));
const CUSTOM_FIELD_LIMIT = 8000;

export const DEFAULT_WORKFLOW_TASK_INPUT_FIELDS: WorkflowTaskInputFieldDefinition[] = [
  {
    id: 'title',
    label: '任务名称',
    type: 'text',
    placeholder: '例如：完成接口兼容性评估',
  },
  {
    id: 'issueUrl',
    label: '参考资料 / 链接',
    type: 'text',
    placeholder: '粘贴需求、文档、问题单或上下文链接',
  },
  {
    id: 'description',
    label: '任务说明',
    type: 'textarea',
    placeholder: '说明本次要达成的目标、背景、约束或输入材料',
  },
  {
    id: 'acceptanceCriteria',
    label: '期望结果',
    type: 'textarea',
    placeholder: '说明希望交付的结果、验收口径或检查方式',
  },
];

function trimString(value: unknown, limit: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.length > limit ? normalized.slice(0, limit) : normalized;
}

function normalizeId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

function normalizeRecord(input: unknown, limit: number): Record<string, string> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const entries = Object.entries(input as Record<string, unknown>)
    .map(([key, value]) => [normalizeId(key), trimString(value, limit)] as const)
    .filter(([key, value]) => key && value);
  if (!entries.length) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

export function normalizeWorkflowTaskInput(input: unknown): WorkflowTaskInput {
  const source = input && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  const normalized: WorkflowTaskInput = {};
  for (const field of Object.keys(CORE_FIELD_LIMITS) as Array<keyof typeof CORE_FIELD_LIMITS>) {
    const value = trimString(source[field], CORE_FIELD_LIMITS[field]);
    if (value) normalized[field] = value;
  }
  const fields = normalizeRecord(source.fields, CUSTOM_FIELD_LIMIT);
  if (fields) normalized.fields = fields;
  const fieldLabels = normalizeRecord(source.fieldLabels, 120);
  if (fieldLabels) normalized.fieldLabels = fieldLabels;
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
      || Object.values(input.fields || {}).some((value) => value.trim())
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
  const customValue = Object.values(normalized.fields || {}).find((value) => value.trim());
  if (customValue) return customValue.length > 120 ? `${customValue.slice(0, 120)}...` : customValue;
  return '';
}

export function normalizeWorkflowTaskInputFieldDefinitions(input: unknown): WorkflowTaskInputFieldDefinition[] {
  const rawFields: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as any).fields)
      ? (input as any).fields
      : [];
  const seen = new Set<string>();
  return rawFields
    .map((field) => {
      const source = field && typeof field === 'object' ? field as Record<string, unknown> : {};
      const id = normalizeId(source.id);
      const label = trimString(source.label, 120);
      if (!id || !label || seen.has(id)) return null;
      seen.add(id);
      const rawType = typeof source.type === 'string' ? source.type : '';
      const type: WorkflowTaskInputFieldType = rawType === 'textarea' || rawType === 'url' ? rawType : 'text';
      return {
        id,
        label,
        type,
        required: source.required === true,
        placeholder: trimString(source.placeholder, 300),
        description: trimString(source.description, 500),
      };
    })
    .filter(Boolean) as WorkflowTaskInputFieldDefinition[];
}

export function resolveWorkflowTaskInputFields(input: unknown): WorkflowTaskInputFieldDefinition[] {
  const configured = normalizeWorkflowTaskInputFieldDefinitions(input);
  return configured.length > 0 ? configured : DEFAULT_WORKFLOW_TASK_INPUT_FIELDS;
}

export function getWorkflowTaskInputFieldValue(input: WorkflowTaskInput | null | undefined, fieldId: string): string {
  const normalized = normalizeWorkflowTaskInput(input);
  const id = normalizeId(fieldId);
  if (!id) return '';
  if (CORE_FIELD_IDS.has(id)) {
    return String((normalized as any)[id] || '');
  }
  return normalized.fields?.[id] || '';
}

export function setWorkflowTaskInputFieldValue(input: WorkflowTaskInput | null | undefined, fieldId: string, value: string): WorkflowTaskInput {
  const normalized = normalizeWorkflowTaskInput(input);
  const id = normalizeId(fieldId);
  if (!id) return normalized;
  if (CORE_FIELD_IDS.has(id)) {
    return normalizeWorkflowTaskInput({ ...normalized, [id]: value });
  }
  const nextFields = { ...(normalized.fields || {}) };
  if (value.trim()) {
    nextFields[id] = value;
  } else {
    delete nextFields[id];
  }
  return normalizeWorkflowTaskInput({ ...normalized, fields: nextFields });
}

export function attachWorkflowTaskInputFieldLabels(input: WorkflowTaskInput | null | undefined, fields: WorkflowTaskInputFieldDefinition[]): WorkflowTaskInput {
  const normalized = normalizeWorkflowTaskInput(input);
  if (!hasWorkflowTaskInput(normalized)) return normalized;
  const labels = Object.fromEntries(
    fields
      .map((field) => [field.id, field.label] as const)
      .filter(([id]) => getWorkflowTaskInputFieldValue(normalized, id).trim())
  );
  return normalizeWorkflowTaskInput({ ...normalized, fieldLabels: labels });
}

export function formatWorkflowTaskInputForPrompt(
  input?: WorkflowTaskInput | null,
  fieldDefinitions?: WorkflowTaskInputFieldDefinition[] | null,
): string {
  const normalized = normalizeWorkflowTaskInput(input);
  if (!hasWorkflowTaskInput(normalized)) return '';

  const definitions = fieldDefinitions?.length
    ? fieldDefinitions
    : DEFAULT_WORKFLOW_TASK_INPUT_FIELDS;
  const emitted = new Set<string>();
  const lines = [
    '## 本次任务输入',
    '这些内容只约束当前 run，不代表修改工作流模板或工作流配置。',
  ];

  for (const field of definitions) {
    const value = getWorkflowTaskInputFieldValue(normalized, field.id);
    if (!value.trim()) continue;
    emitted.add(field.id);
    if (field.type === 'textarea' || value.includes('\n')) {
      lines.push(`- ${field.label}:`);
      lines.push(value);
    } else {
      lines.push(`- ${field.label}: ${value}`);
    }
  }

  const fallbackLabels: Record<string, string> = {
    title: normalized.fieldLabels?.title || '任务名称',
    issueUrl: normalized.fieldLabels?.issueUrl || '参考资料 / 链接',
    description: normalized.fieldLabels?.description || '任务说明',
    targetBranch: normalized.fieldLabels?.targetBranch || '目标分支',
    acceptanceCriteria: normalized.fieldLabels?.acceptanceCriteria || '期望结果',
  };
  for (const field of Object.keys(CORE_FIELD_LIMITS)) {
    if (emitted.has(field)) continue;
    const value = getWorkflowTaskInputFieldValue(normalized, field);
    if (!value.trim()) continue;
    emitted.add(field);
    if (field === 'description' || field === 'acceptanceCriteria' || value.includes('\n')) {
      lines.push(`- ${fallbackLabels[field]}:`);
      lines.push(value);
    } else {
      lines.push(`- ${fallbackLabels[field]}: ${value}`);
    }
  }

  for (const [field, value] of Object.entries(normalized.fields || {})) {
    if (emitted.has(field) || !value.trim()) continue;
    const label = normalized.fieldLabels?.[field] || field;
    if (value.includes('\n')) {
      lines.push(`- ${label}:`);
      lines.push(value);
    } else {
      lines.push(`- ${label}: ${value}`);
    }
  }
  return `${lines.join('\n')}\n\n`;
}
