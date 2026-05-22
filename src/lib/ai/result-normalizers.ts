import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  extractStructuredResult as extractStructuredResultFromChannel,
  getResultSections,
  extractJsonObject,
} from '@/lib/ai/result-channel';

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
        parseError: 'workflow_draft.config 缺失或不是对象。payload 中必须包含 "config" 字段且值为对象，格式: {"kind":"workflow_draft","payload":{"filename":"xxx.yaml","summary":"...","config":{"workflow":{...},"context":{...}}}}',
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

export function diagnoseExtractionFailure(markdown: string, expectedKind: string): string {
  const sections = getResultSections(markdown);
  if (sections.length === 0) {
    const hasResultTag = /<result/i.test(markdown);
    if (!hasResultTag) return '回复中没有 <result> 标签。必须用 <result>...</result> 包裹 JSON 输出。';
    return '<result> 标签未正确闭合或格式异常，系统无法提取内容。请确保使用 <result>...</result> 配对标签。';
  }

  for (const section of sections) {
    const parsed = extractJsonObject(section.content);
    if (!parsed) {
      const trimmed = section.content.trim();
      if (trimmed.startsWith('```')) return '<result> 内包含了 ```json 代码块。请直接输出裸 JSON 对象，不要用代码块包裹。';
      return `<result> 内的内容无法解析为 JSON。前 200 字符: "${trimmed.slice(0, 200)}"`;
    }

    const actualKind = parsed.kind || parsed.type;
    if (!actualKind) return `<result> 内的 JSON 缺少 kind 或 type 字段。解析到的顶层 key: [${Object.keys(parsed).join(', ')}]`;
    if (actualKind !== expectedKind) return `<result> 内 JSON 的 kind="${actualKind}"，但系统期望 kind="${expectedKind}"。`;

    if (parsed.kind === expectedKind && (!parsed.payload || typeof parsed.payload !== 'object')) {
      return `JSON 的 kind="${expectedKind}" 正确，但缺少 payload 对象。格式应为 {"kind":"${expectedKind}","payload":{...}}。`;
    }

    const payload = parsed.payload || parsed;
    if (expectedKind === 'clarification_form') {
      if (!Array.isArray(payload.questions)) return 'payload 中缺少 questions 数组。';
      if (payload.questions.length === 0) return 'questions 数组为空，至少需要 1 个问题。';
      const badQ = payload.questions.find((q: any) => !q || typeof q.question !== 'string');
      if (badQ !== undefined) return `questions 中存在无效项：每个 question 必须有 question 字符串字段。无效项: ${JSON.stringify(badQ)?.slice(0, 150)}`;
      const noOpts = payload.questions.find((q: any) => !Array.isArray(q.options) || q.options.length === 0);
      if (noOpts) return `问题 "${noOpts.question?.slice(0, 40)}" 缺少 options 数组或选项为空。每个问题需要 2-4 个选项。`;
    }

    if (expectedKind === 'plan_draft') {
      if (!payload.artifacts || typeof payload.artifacts !== 'object') return 'payload 中缺少 artifacts 对象。artifacts 必须包含 requirements、design、tasks 三个字符串字段。';
      const missing = ['requirements', 'design', 'tasks'].filter(k => typeof payload.artifacts[k] !== 'string' || !payload.artifacts[k].trim());
      if (missing.length > 0) return `artifacts 中以下字段缺失或为空: [${missing.join(', ')}]。三份制品都必须有内容。`;
    }

    return `JSON 解析成功且 kind="${expectedKind}"，但后续结构校验未通过。顶层 payload key: [${Object.keys(payload).join(', ')}]`;
  }

  return '未知解析错误';
}
