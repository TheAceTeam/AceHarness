import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { extractStructuredResult as extractStructuredResultFromChannel } from '@/lib/result-channel';

export type SpecCodingArtifactKey = 'requirements' | 'design' | 'tasks';

export type SpecCodingArtifactDrafts = Record<SpecCodingArtifactKey, string>;

export type PlanDraftResult = {
  type: 'plan_draft';
  summary?: string;
  goals?: string[];
  nonGoals?: string[];
  constraints?: string[];
  clarification?: {
    summary?: string;
    knownFacts?: string[];
    missingFields?: string[];
    questions?: string[];
  };
  artifacts?: {
    requirements?: string;
    design?: string;
    tasks?: string;
  };
};

export type WorkflowDraftPreviewState = {
  source: 'result-json' | 'yaml' | 'none';
  filename?: string;
  summary?: string;
  yaml?: string;
  config?: any | null;
  parseError?: string;
  validation?: any;
};

export type ClarificationQuestionItem = {
  id: string;
  label: string;
  question: string;
  selectionMode?: 'single' | 'multiple';
  options: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  placeholder?: string;
  required?: boolean;
};

export type ClarificationAnswerValue = {
  optionIds: string[];
  note: string;
};

export type ClarificationFormResult = {
  type: 'clarification_form';
  summary?: string;
  knownFacts: string[];
  missingFields: string[];
  questions: ClarificationQuestionItem[];
};

export function extractStructuredResultPayload<T extends object>(
  markdown: string,
  expectedType: string
): (T & { type: string }) | null {
  const parsed = extractStructuredResultFromChannel<any>(markdown, (value: any): value is any => (
    value?.type === expectedType ||
    value?.kind === expectedType
  ));
  if (!parsed) return null;

  if (parsed.kind === expectedType) {
    const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
    return {
      ...payload,
      type: expectedType,
    } as T & { type: string };
  }

  return {
    ...parsed,
    type: expectedType,
  } as T & { type: string };
}

export function extractPlanDraftResult(markdown: string): PlanDraftResult | null {
  return extractStructuredResultPayload<PlanDraftResult>(markdown, 'plan_draft') as PlanDraftResult | null;
}

export function extractWorkflowDraftPreview(markdown: string, fallbackFilename?: string): WorkflowDraftPreviewState {
  let parseError = '';
  const parsed = extractStructuredResultPayload<Record<string, any>>(markdown, 'workflow_draft');
  if (parsed) {
    if (!parsed.config || typeof parsed.config !== 'object') {
      return {
        source: 'result-json',
        filename: typeof parsed.filename === 'string' ? parsed.filename : fallbackFilename,
        summary: typeof parsed.summary === 'string' ? parsed.summary : '',
        config: null,
        parseError: 'workflow_draft.config 缺失或不是对象',
      };
    }
    return {
      source: 'result-json',
      filename: typeof parsed.filename === 'string' ? parsed.filename : fallbackFilename,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      config: parsed.config,
      yaml: stringifyYaml(parsed.config),
    };
  }

  const yamlBlocks = [...markdown.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)];
  for (let index = yamlBlocks.length - 1; index >= 0; index -= 1) {
    const rawYaml = yamlBlocks[index]?.[1]?.trim() || '';
    if (!rawYaml) continue;
    try {
      const config = parseYaml(rawYaml);
      if (!config || typeof config !== 'object') {
        parseError = 'YAML 解析成功，但结果不是对象';
        continue;
      }
      return {
        source: 'yaml',
        filename: fallbackFilename,
        config,
        yaml: rawYaml,
      };
    } catch (error: any) {
      parseError = `YAML 解析失败: ${error?.message || 'YAML 格式错误'}`;
    }
  }

  return {
    source: 'none',
    filename: fallbackFilename,
    config: null,
    parseError: parseError || '未检测到可读取的 workflow_draft JSON 或 YAML 代码块',
  };
}

export function extractClarificationFormResult(markdown: string): ClarificationFormResult | null {
  const parsed = extractStructuredResultPayload<ClarificationFormResult>(markdown, 'clarification_form');
  if (!parsed) return null;
  return {
    ...parsed,
    type: 'clarification_form',
    knownFacts: Array.isArray(parsed.knownFacts) ? parsed.knownFacts : [],
    missingFields: Array.isArray(parsed.missingFields) ? parsed.missingFields : [],
    questions: Array.isArray(parsed.questions)
      ? parsed.questions
        .filter((item) => item && typeof item.question === 'string')
        .map((item, index) => ({
          id: typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `question_${index + 1}`,
          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : `问题 ${index + 1}`,
          question: item.question.trim(),
          selectionMode: ((item as any).selectionMode === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
          options: Array.isArray((item as any).options)
            ? (item as any).options
              .filter((option: any) => option && typeof option.label === 'string' && option.label.trim())
              .map((option: any, optionIndex: number) => ({
                id: typeof option.id === 'string' && option.id.trim() ? option.id.trim() : `option_${optionIndex + 1}`,
                label: option.label.trim(),
                description: typeof option.description === 'string' ? option.description.trim() : '',
                recommended: option.recommended === true,
              }))
              .slice(0, 4)
            : [],
          placeholder: typeof item.placeholder === 'string' ? item.placeholder.trim() : '',
          required: item.required !== false,
        }))
        .filter((item) => item.options.length > 0)
        .slice(0, 6)
      : [],
  };
}
