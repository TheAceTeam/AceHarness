import { jsonrepair } from 'jsonrepair';
import { getAceProcessRanges as getStructuredAceProcessRanges } from '@/lib/chat/ai-process-blocks';

export interface ResultSection {
  start: number;
  end: number;
  content: string;
}

type JsonSchema = Record<string, any>;

const STRING_ARRAY_SCHEMA = { type: 'array', items: { type: 'string' } };
const REVISION_PLAN_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      artifact: { type: 'string' },
      op: { type: 'string' },
      targetId: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};
const SIMPLE_ITEM_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string' },
    data: { type: 'object' },
    payload: {
      type: 'object',
      properties: {
        data: { type: 'object' },
      },
      required: ['data'],
    },
  },
};

type AiJsonRepairLoads = (input: string, options?: Record<string, any>) => any;

const KNOWN_RESULT_SCHEMAS: Record<string, JsonSchema> = {
  home_sidebar: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      type: { type: 'string' },
      mode: { type: 'string' },
      tabs: STRING_ARRAY_SCHEMA,
      activeTab: { type: 'string' },
      intent: { type: 'string' },
      stage: { type: 'string' },
      reason: { type: 'string' },
      summary: { type: 'string' },
      knownFacts: STRING_ARRAY_SCHEMA,
      missingFields: STRING_ARRAY_SCHEMA,
      questions: STRING_ARRAY_SCHEMA,
      recommendedNextAction: { type: 'string' },
      shouldOpenModal: { type: 'boolean' },
      workflowDraft: { type: 'object' },
      agentDraft: { type: 'object' },
      payload: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          tabs: STRING_ARRAY_SCHEMA,
          activeTab: { type: 'string' },
          intent: { type: 'string' },
          stage: { type: 'string' },
          reason: { type: 'string' },
          summary: { type: 'string' },
          knownFacts: STRING_ARRAY_SCHEMA,
          missingFields: STRING_ARRAY_SCHEMA,
          questions: STRING_ARRAY_SCHEMA,
          recommendedNextAction: { type: 'string' },
          shouldOpenModal: { type: 'boolean' },
          workflowDraft: { type: 'object' },
          agentDraft: { type: 'object' },
        },
      },
    },
  },
  card: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          header: { type: 'object' },
          blocks: { type: 'array', items: { type: 'object' } },
          actions: { type: 'array', items: { type: 'object' } },
        },
      },
      header: { type: 'object' },
      blocks: { type: 'array', items: { type: 'object' } },
      actions: { type: 'array', items: { type: 'object' } },
    },
  },
  clarification_form: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      type: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          knownFacts: STRING_ARRAY_SCHEMA,
          missingFields: STRING_ARRAY_SCHEMA,
          questions: { type: 'array', items: { type: 'object' } },
        },
      },
      summary: { type: 'string' },
      knownFacts: STRING_ARRAY_SCHEMA,
      missingFields: STRING_ARRAY_SCHEMA,
      questions: { type: 'array', items: { type: 'object' } },
    },
  },
  plan_draft: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      type: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          goals: STRING_ARRAY_SCHEMA,
          nonGoals: STRING_ARRAY_SCHEMA,
          constraints: STRING_ARRAY_SCHEMA,
          clarification: { type: 'object' },
          artifacts: { type: 'object' },
        },
      },
      summary: { type: 'string' },
      goals: STRING_ARRAY_SCHEMA,
      nonGoals: STRING_ARRAY_SCHEMA,
      constraints: STRING_ARRAY_SCHEMA,
      clarification: { type: 'object' },
      artifacts: { type: 'object' },
    },
  },
  workflow_draft: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      type: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          summary: { type: 'string' },
          config: { type: 'object' },
        },
        required: ['config'],
      },
      filename: { type: 'string' },
      summary: { type: 'string' },
      config: { type: 'object' },
    },
  },
  workflow_patch: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      type: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          summary: { type: 'string' },
          scope: { type: 'string' },
          workflowMode: { type: 'string' },
          patch: { type: 'object' },
        },
        required: ['scope', 'patch'],
      },
      filename: { type: 'string' },
      summary: { type: 'string' },
      scope: { type: 'string' },
      workflowMode: { type: 'string' },
      patch: { type: 'object' },
    },
  },
  workflow_clarification_summary: SIMPLE_ITEM_RESULT_SCHEMA,
  workflow_clarification_facts: SIMPLE_ITEM_RESULT_SCHEMA,
  workflow_clarification_gaps: SIMPLE_ITEM_RESULT_SCHEMA,
  workflow_clarification_question: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_coding_meta: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_requirement: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_design: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_decision: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_task: SIMPLE_ITEM_RESULT_SCHEMA,
  workflow_state_outline: SIMPLE_ITEM_RESULT_SCHEMA,
  workflow_state_steps: SIMPLE_ITEM_RESULT_SCHEMA,
  workflow_patch_item: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_revision_item: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_artifact_revision: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          revisionPlan: REVISION_PLAN_SCHEMA,
          artifacts: { type: 'object' },
        },
        required: ['artifacts'],
      },
      summary: { type: 'string' },
      revisionPlan: REVISION_PLAN_SCHEMA,
      artifacts: { type: 'object' },
    },
  },
  agent_clarification_summary: SIMPLE_ITEM_RESULT_SCHEMA,
  agent_clarification_facts: SIMPLE_ITEM_RESULT_SCHEMA,
  agent_clarification_gaps: SIMPLE_ITEM_RESULT_SCHEMA,
  agent_clarification_question: SIMPLE_ITEM_RESULT_SCHEMA,
  agent_role_profile: SIMPLE_ITEM_RESULT_SCHEMA,
  agent_execution_profile: SIMPLE_ITEM_RESULT_SCHEMA,
  agent_config: SIMPLE_ITEM_RESULT_SCHEMA,
  spec_coding_revision: {
    type: 'object',
    properties: {
      kind: { type: 'string' },
      type: { type: 'string' },
      payload: {
        type: 'object',
        properties: {
          apply: { type: 'boolean' },
          summary: { type: 'string' },
          affectedArtifacts: STRING_ARRAY_SCHEMA,
          impact: STRING_ARRAY_SCHEMA,
          revisionPlan: REVISION_PLAN_SCHEMA,
        },
      },
      apply: { type: 'boolean' },
      summary: { type: 'string' },
      affectedArtifacts: STRING_ARRAY_SCHEMA,
      impact: STRING_ARRAY_SCHEMA,
      revisionPlan: REVISION_PLAN_SCHEMA,
    },
  },
  'spec-coding-revision': {
    type: 'object',
    properties: {
      type: { type: 'string' },
      apply: { type: 'boolean' },
      summary: { type: 'string' },
      affectedArtifacts: STRING_ARRAY_SCHEMA,
      impact: STRING_ARRAY_SCHEMA,
      revisionPlan: REVISION_PLAN_SCHEMA,
    },
  },
};

function getFencedCodeBlockRanges(markdown: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  const openRegex = /^([ \t]{0,3})(`{3,}|~{3,})([^\r\n]*)/gm;
  let match: RegExpExecArray | null;
  while ((match = openRegex.exec(markdown)) !== null) {
    const start = match.index;
    const marker = match[2];
    const markerChar = marker[0];
    const markerWidth = marker.length;
    const lineEnd = markdown.indexOf('\n', openRegex.lastIndex);
    const openingLineEnd = lineEnd === -1 ? markdown.length : lineEnd + 1;

    const closeRegex = new RegExp(`^[ \\t]{0,3}${markerChar}{${markerWidth},}[ \\t]*$`, 'gm');
    closeRegex.lastIndex = openingLineEnd;
    const close = closeRegex.exec(markdown);
    if (!close) {
      ranges.push([start, markdown.length]);
      openRegex.lastIndex = markdown.length;
      break;
    }

    const closeLineEnd = markdown.indexOf('\n', close.index + close[0].length);
    const end = closeLineEnd === -1 ? close.index + close[0].length : closeLineEnd + 1;
    ranges.push([start, end]);
    openRegex.lastIndex = end;
  }
  return ranges;
}

function getAceProcessRanges(markdown: string): Array<[number, number]> {
  return getStructuredAceProcessRanges(markdown);
}

function isInsideRanges(index: number, ranges: Array<[number, number]>): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

export function getResultSections(markdown: string): ResultSection[] {
  const sections: ResultSection[] = [];
  const skipRanges = [
    ...getFencedCodeBlockRanges(markdown),
    ...getAceProcessRanges(markdown),
  ];
  const resultRegex = /<result>([\s\S]*?)<\/result>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(markdown)) !== null) {
    if (isInsideRanges(match.index, skipRanges)) continue;
    sections.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[1],
    });
  }
  const resultOpenRegex = /<result>/gi;
  while ((match = resultOpenRegex.exec(markdown)) !== null) {
    if (isInsideRanges(match.index, skipRanges)) continue;
    if (sections.some((section) => match!.index >= section.start && match!.index < section.end)) continue;
    const contentStart = match.index + match[0].length;
    const bounds = findBalancedJsonObjectBounds(markdown.slice(contentStart));
    if (!bounds) continue;
    sections.push({
      start: match.index,
      end: contentStart + bounds.end,
      content: markdown.slice(contentStart + bounds.start, contentStart + bounds.end),
    });
  }
  sections.sort((left, right) => left.start - right.start);
  return sections;
}

function findBalancedJsonObjectBounds(text: string): { start: number; end: number } | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === '{') {
      depth += 1;
      continue;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return { start, end: index + 1 };
      }
    }
  }

  return null;
}

function extractJsonFromCandidate(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/^```(?:json|card)\s*([\s\S]*?)```$/i);
  const body = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const bounds = findBalancedJsonObjectBounds(body);
  if (!bounds) return null;
  return body.slice(bounds.start, bounds.end);
}

export function normalizeStructuredResultBlocks(markdown: string): string {
  const source = String(markdown || '');
  const sections = getResultSections(source);
  if (sections.length === 0) return source;

  let normalized = source;
  for (const section of [...sections].reverse()) {
    const bounds = findBalancedJsonObjectBounds(section.content);
    if (!bounds) continue;

    const prefix = section.content.slice(0, bounds.start);
    const suffix = section.content.slice(bounds.end);
    if (prefix.trim()) continue;
    if (!suffix.trim()) continue;

    const json = section.content.slice(bounds.start, bounds.end);
    const trailingNewline = /\r?\n/.test(prefix) || /\r?\n/.test(suffix) ? '\n' : '';
    const normalizedSection = `<result>${prefix}${json}${trailingNewline}</result>`;
    normalized = normalized.slice(0, section.start) + normalizedSection + normalized.slice(section.end);
  }

  return normalized;
}

function getAiJsonRepairLoads(): AiJsonRepairLoads | null {
  if (typeof window !== 'undefined') return null;
  try {
    const req = Function('return require')() as NodeRequire;
    const mod = req('ai-json-repair') as { loads?: AiJsonRepairLoads };
    return typeof mod.loads === 'function' ? mod.loads : null;
  } catch {
    return null;
  }
}

function lightweightRepairParse(json: string): any | null {
  try {
    return JSON.parse(jsonrepair(json));
  } catch {
    return null;
  }
}

function detectKnownResultSchemaKey(value: any): string | null {
  if (!value || typeof value !== 'object') return null;
  if (typeof value.kind === 'string' && KNOWN_RESULT_SCHEMAS[value.kind]) {
    return value.kind;
  }
  if (typeof value.type === 'string' && KNOWN_RESULT_SCHEMAS[value.type]) {
    return value.type;
  }
  if (value.type === 'home_sidebar') return 'home_sidebar';
  return null;
}

function toStringArray(value: unknown): string[] | unknown {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return value;
}

function toBoolean(value: unknown): boolean | unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'TRUE') return true;
  if (value === 'false' || value === 'FALSE') return false;
  return value;
}

function coerceKnownResultShape(parsed: any): any {
  const schemaKey = detectKnownResultSchemaKey(parsed);
  if (!schemaKey || !parsed || typeof parsed !== 'object') return parsed;

  const clone = JSON.parse(JSON.stringify(parsed));
  const target = clone.kind === schemaKey && clone.payload && typeof clone.payload === 'object'
    ? clone.payload
    : clone;

  if (schemaKey === 'home_sidebar') {
    target.tabs = toStringArray(target.tabs);
    target.knownFacts = toStringArray(target.knownFacts);
    target.missingFields = toStringArray(target.missingFields);
    target.questions = toStringArray(target.questions);
    target.shouldOpenModal = toBoolean(target.shouldOpenModal);
    return clone;
  }

  if (schemaKey === 'spec_coding_revision' || schemaKey === 'spec-coding-revision') {
    target.apply = toBoolean(target.apply);
    target.affectedArtifacts = toStringArray(target.affectedArtifacts);
    target.impact = toStringArray(target.impact);
    return clone;
  }

  if (schemaKey === 'plan_draft') {
    target.goals = toStringArray(target.goals);
    target.nonGoals = toStringArray(target.nonGoals);
    target.constraints = toStringArray(target.constraints);
    return clone;
  }

  if (schemaKey === 'clarification_form') {
    target.knownFacts = toStringArray(target.knownFacts);
    target.missingFields = toStringArray(target.missingFields);
    return clone;
  }

  return clone;
}

function repairWithKnownSchema(json: string, parsed: any): any {
  const schemaKey = detectKnownResultSchemaKey(parsed);
  if (!schemaKey) return parsed;

  const schema = KNOWN_RESULT_SCHEMAS[schemaKey];
  const loads = getAiJsonRepairLoads();
  if (!loads) return coerceKnownResultShape(parsed);
  try {
    return coerceKnownResultShape(loads(json, {
      schema,
      schemaRepairMode: 'salvage',
      returnObjects: true,
    }));
  } catch {
    return coerceKnownResultShape(parsed);
  }
}

export function extractJsonObject(text: string): any | null {
  const json = extractJsonFromCandidate(text);
  if (!json) return null;
  try {
    return repairWithKnownSchema(json, JSON.parse(json));
  } catch {
    const lightweight = lightweightRepairParse(json);
    if (lightweight) {
      return repairWithKnownSchema(json, lightweight);
    }
    return null;
  }
}

export function extractStructuredResult<T = any>(
  markdown: string,
  predicate: (parsed: any) => parsed is T,
): T | null {
  for (const section of getResultSections(markdown)) {
    const parsed = extractJsonObject(section.content);
    if (parsed && predicate(parsed)) {
      return parsed;
    }
  }
  return null;
}
