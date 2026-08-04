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

    if (expectedKind === 'plan_draft') {
      if (!payload.artifacts || typeof payload.artifacts !== 'object') return 'payload 中缺少 artifacts 对象。artifacts 必须包含 requirements、design、tasks 三个字符串字段。';
      const missing = ['requirements', 'design', 'tasks'].filter(k => typeof payload.artifacts[k] !== 'string' || !payload.artifacts[k].trim());
      if (missing.length > 0) return `artifacts 中以下字段缺失或为空: [${missing.join(', ')}]。三份制品都必须有内容。`;
    }

    return `JSON 解析成功且 kind="${expectedKind}"，但后续结构校验未通过。顶层 payload key: [${Object.keys(payload).join(', ')}]`;
  }

  return '未知解析错误';
}
