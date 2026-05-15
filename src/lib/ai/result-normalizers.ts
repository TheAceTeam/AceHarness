import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  extractJsonObject,
  extractStructuredResult as extractStructuredResultFromChannel,
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

export type StructuredResultStreamPreview = {
  text: string;
  complete: boolean;
  hasResult: boolean;
  kind?: string;
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

function getFencedCodeBlockRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const fenceRegex = /(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*(?:\n|$)/g;
  let match: RegExpExecArray | null;
  let open: { start: number; marker: string; width: number } | null = null;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const lineStart = match.index + (match[1] ? match[1].length : 0);
    const marker = match[3];
    const char = marker[0];
    const width = marker.length;

    if (!open) {
      open = { start: lineStart, marker: char, width };
      continue;
    }

    if (char === open.marker && width >= open.width) {
      ranges.push([open.start, fenceRegex.lastIndex]);
      open = null;
    }
  }

  if (open) ranges.push([open.start, markdown.length]);
  return ranges;
}

function isInsideRange(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function getResultBodySections(markdown: string): Array<{ body: string; start: number; end: number; complete: boolean }> {
  const sections: Array<{ body: string; start: number; end: number; complete: boolean }> = [];
  const codeBlockRanges = getFencedCodeBlockRanges(markdown);
  const openRegex = /<result>/gi;
  const closeRegex = /<\/result>/gi;
  let openMatch: RegExpExecArray | null;

  while ((openMatch = openRegex.exec(markdown)) !== null) {
    if (isInsideRange(openMatch.index, codeBlockRanges)) continue;

    const start = openMatch.index;
    const bodyStart = openMatch.index + openMatch[0].length;
    closeRegex.lastIndex = bodyStart;
    let closeMatch: RegExpExecArray | null = null;
    let candidate: RegExpExecArray | null;
    while ((candidate = closeRegex.exec(markdown)) !== null) {
      if (isInsideRange(candidate.index, codeBlockRanges)) continue;
      closeMatch = candidate;
      break;
    }

    if (!closeMatch) {
      sections.push({
        body: markdown.slice(bodyStart),
        start,
        end: markdown.length,
        complete: false,
      });
      break;
    }

    sections.push({
      body: markdown.slice(bodyStart, closeMatch.index),
      start,
      end: closeMatch.index + closeMatch[0].length,
      complete: true,
    });
    openRegex.lastIndex = closeMatch.index + closeMatch[0].length;
  }

  return sections;
}

function normalizeArtifactFence(text: string): string {
  return text.replace(/~~~([a-zA-Z0-9_-]*)/g, '```$1');
}

function clipPreviewText(text: string, limit = 6000): string {
  const trimmed = text.trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit).trimEnd()}\n\n...`;
}

function planDraftToPreviewText(draft: PlanDraftResult): string {
  const sections = [
    draft.summary ? `## 计划摘要\n${draft.summary}` : '',
    draft.goals?.length ? `## 目标\n${draft.goals.map((goal) => `- ${goal}`).join('\n')}` : '',
    draft.nonGoals?.length ? `## 非目标\n${draft.nonGoals.map((goal) => `- ${goal}`).join('\n')}` : '',
    draft.constraints?.length ? `## 约束\n${draft.constraints.map((constraint) => `- ${constraint}`).join('\n')}` : '',
    draft.artifacts?.requirements ? normalizeArtifactFence(draft.artifacts.requirements) : '',
    draft.artifacts?.design ? normalizeArtifactFence(draft.artifacts.design) : '',
    draft.artifacts?.tasks ? normalizeArtifactFence(draft.artifacts.tasks) : '',
  ].filter((section) => section.trim());
  return sections.join('\n\n').trim();
}

function workflowDraftToPreviewText(draft: Record<string, any>): string {
  const sections = [
    typeof draft.summary === 'string' && draft.summary.trim() ? `## 工作流草案\n${draft.summary.trim()}` : '',
    typeof draft.filename === 'string' && draft.filename.trim() ? `目标文件：\`${draft.filename.trim()}\`` : '',
    draft.config && typeof draft.config === 'object'
      ? `~~~yaml\n${stringifyYaml(draft.config).trim()}\n~~~`
      : '',
  ].filter(Boolean);
  return normalizeArtifactFence(sections.join('\n\n'));
}

function clarificationFormToPreviewText(form: ClarificationFormResult): string {
  const questions = (form.questions || [])
    .map((question, index) => {
      const options = question.options?.length
        ? question.options.map((option) => `  - ${option.label}${option.description ? `：${option.description}` : ''}`).join('\n')
        : '';
      return [`${index + 1}. ${question.question}`, options].filter(Boolean).join('\n');
    })
    .join('\n\n');
  return [
    form.summary ? `## 澄清摘要\n${form.summary}` : '',
    form.knownFacts?.length ? `## 已确认信息\n${form.knownFacts.map((fact) => `- ${fact}`).join('\n')}` : '',
    form.missingFields?.length ? `## 待补充信息\n${form.missingFields.map((field) => `- ${field}`).join('\n')}` : '',
    questions ? `## 需要确认的问题\n${questions}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

function specCodingRevisionToPreviewText(revision: Record<string, any>): string {
  const affected = Array.isArray(revision.affectedArtifacts) ? revision.affectedArtifacts : [];
  const impact = Array.isArray(revision.impact) ? revision.impact : [];
  return [
    typeof revision.summary === 'string' && revision.summary.trim() ? `## 修订摘要\n${revision.summary.trim()}` : '',
    affected.length ? `## 影响制品\n${affected.map((item) => `- ${item}`).join('\n')}` : '',
    impact.length ? `## 影响说明\n${impact.map((item) => `- ${item}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n').trim();
}

function cardToPreviewText(card: Record<string, any>): string {
  const payload = card.payload && typeof card.payload === 'object' ? card.payload : card;
  const header = payload.header && typeof payload.header === 'object' ? payload.header : null;
  const blocks = Array.isArray(payload.blocks) ? payload.blocks : [];
  const blockText = blocks
    .map((block: any) => {
      if (!block || typeof block !== 'object') return '';
      if (typeof block.content === 'string') return block.content;
      if (typeof block.text === 'string') return block.text;
      if (typeof block.title === 'string') return `### ${block.title}`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
  return [
    header?.title ? `## ${header.title}` : '',
    header?.subtitle ? String(header.subtitle) : '',
    blockText,
  ].filter(Boolean).join('\n\n').trim();
}

function normalizeResultPayload(value: any): Record<string, any> {
  if (!value || typeof value !== 'object') return {};
  if (typeof value.kind === 'string' && value.payload && typeof value.payload === 'object') {
    return {
      ...value.payload,
      type: value.kind,
    };
  }
  if (typeof value.type === 'string' && value.payload && typeof value.payload === 'object') {
    return {
      ...value.payload,
      type: value.type,
    };
  }
  return value;
}

function getResultKind(value: any): string {
  return typeof value?.kind === 'string'
    ? value.kind
    : typeof value?.type === 'string'
      ? value.type
      : '';
}

function resultValueToPreviewText(value: any): { kind?: string; text: string } {
  const kind = getResultKind(value);
  const payload = normalizeResultPayload(value);
  if (kind === 'plan_draft') {
    return { kind, text: planDraftToPreviewText(payload as PlanDraftResult) };
  }
  if (kind === 'workflow_draft') {
    return { kind, text: workflowDraftToPreviewText(payload) };
  }
  if (kind === 'clarification_form') {
    return { kind, text: clarificationFormToPreviewText({
      ...(payload as ClarificationFormResult),
      type: 'clarification_form',
      knownFacts: Array.isArray(payload.knownFacts) ? payload.knownFacts : [],
      missingFields: Array.isArray(payload.missingFields) ? payload.missingFields : [],
      questions: Array.isArray(payload.questions) ? payload.questions : [],
    }) };
  }
  if (kind === 'spec_coding_revision' || kind === 'spec-coding-revision') {
    return { kind, text: specCodingRevisionToPreviewText(payload) };
  }
  if (kind === 'card') {
    return { kind, text: cardToPreviewText(value) };
  }
  return { kind, text: '' };
}

function extractJsonStringValuePrefix(jsonText: string, key: string): string {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`, 'g');
  const match = keyPattern.exec(jsonText);
  if (!match) return '';
  let index = match.index + match[0].length;
  let value = '';
  let escaped = false;
  while (index < jsonText.length) {
    const char = jsonText[index];
    if (escaped) {
      value += `\\${char}`;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      break;
    } else {
      value += char;
    }
    index += 1;
  }
  try {
    return JSON.parse(`"${value}${escaped ? '\\\\' : ''}"`);
  } catch {
    return value
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

function inferKindFromResultBody(body: string): string {
  return extractJsonStringValuePrefix(body, 'kind') || extractJsonStringValuePrefix(body, 'type');
}

function extractStringArrayPreview(body: string, key: string): string[] {
  const pattern = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)(?:\\]|$)`);
  const match = body.match(pattern);
  if (!match) return [];
  return [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)]
    .map((item) => {
      try {
        return JSON.parse(`"${item[1]}"`);
      } catch {
        return item[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
      }
    })
    .filter(Boolean);
}

function extractPartialPreviewFromResultBody(body: string, kind: string): string {
  const summary = extractJsonStringValuePrefix(body, 'summary');
  const requirements = extractJsonStringValuePrefix(body, 'requirements');
  const design = extractJsonStringValuePrefix(body, 'design');
  const tasks = extractJsonStringValuePrefix(body, 'tasks');
  if (kind === 'plan_draft') {
    const goals = extractStringArrayPreview(body, 'goals');
    return [
      summary ? `## 计划摘要\n${summary}` : '',
      goals.length ? `## 目标\n${goals.map((goal) => `- ${goal}`).join('\n')}` : '',
      requirements ? normalizeArtifactFence(requirements) : '',
      design ? normalizeArtifactFence(design) : '',
      tasks ? normalizeArtifactFence(tasks) : '',
    ].filter(Boolean).join('\n\n').trim();
  }
  if (kind === 'workflow_draft') {
    const filename = extractJsonStringValuePrefix(body, 'filename');
    return [
      summary ? `## 工作流草案\n${summary}` : '',
      filename ? `目标文件：\`${filename}\`` : '',
    ].filter(Boolean).join('\n\n').trim();
  }
  if (kind === 'clarification_form') {
    const knownFacts = extractStringArrayPreview(body, 'knownFacts');
    const missingFields = extractStringArrayPreview(body, 'missingFields');
    return [
      summary ? `## 澄清摘要\n${summary}` : '',
      knownFacts.length ? `## 已确认信息\n${knownFacts.map((fact) => `- ${fact}`).join('\n')}` : '',
      missingFields.length ? `## 待补充信息\n${missingFields.map((field) => `- ${field}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n').trim();
  }
  if (kind === 'spec_coding_revision' || kind === 'spec-coding-revision') {
    return specCodingRevisionToPreviewText({
      summary,
      affectedArtifacts: extractStringArrayPreview(body, 'affectedArtifacts'),
      impact: extractStringArrayPreview(body, 'impact'),
    });
  }
  if (kind === 'card') {
    return summary || extractJsonStringValuePrefix(body, 'title');
  }
  return '';
}

function getResultBodyPreviewText(body: string, complete: boolean): { kind?: string; text: string } {
  const completedMarkdown = `<result>${body}</result>`;
  const parsed = extractJsonObject(body)
    || extractStructuredResultFromChannel<any>(completedMarkdown, (value: any): value is any => Boolean(getResultKind(value)));
  const parsedPreview = parsed ? resultValueToPreviewText(parsed) : { kind: inferKindFromResultBody(body), text: '' };
  const kind = parsedPreview.kind || inferKindFromResultBody(body);
  const partialPreview = extractPartialPreviewFromResultBody(body, kind);
  return {
    kind: kind || undefined,
    text: complete
      ? (parsedPreview.text || partialPreview)
      : (partialPreview || parsedPreview.text),
  };
}

export function getStructuredResultStreamPreview(markdown: string): StructuredResultStreamPreview {
  const resultSections = getResultBodySections(markdown);
  if (resultSections.length === 0) {
    return { text: markdown.trim(), complete: false, hasResult: false };
  }

  const chunks: string[] = [];
  let cursor = 0;
  let lastKind = '';
  for (const section of resultSections) {
    chunks.push(markdown.slice(cursor, section.start));
    const preview = getResultBodyPreviewText(section.body, section.complete);
    if (preview.kind) lastKind = preview.kind;
    if (preview.text.trim()) {
      chunks.push(`\n\n${preview.text.trim()}\n\n`);
    }
    cursor = section.end;
  }
  chunks.push(markdown.slice(cursor));

  const text = chunks.join('').replace(/[ \t]+\n/g, '\n');
  return {
    text: clipPreviewText(text),
    complete: resultSections.every((section) => section.complete),
    hasResult: true,
    kind: lastKind || undefined,
  };
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
