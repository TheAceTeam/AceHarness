import { jsonrepair } from 'jsonrepair';

export interface ResultSection {
  start: number;
  end: number;
  content: string;
}

type JsonSchema = Record<string, any>;

const STRING_ARRAY_SCHEMA = { type: 'array', items: { type: 'string' } };

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
        },
      },
      apply: { type: 'boolean' },
      summary: { type: 'string' },
      affectedArtifacts: STRING_ARRAY_SCHEMA,
      impact: STRING_ARRAY_SCHEMA,
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
    },
  },
};

export function getResultSections(markdown: string): ResultSection[] {
  const sections: ResultSection[] = [];
  const resultRegex = /<result>([\s\S]*?)<\/result>/gi;
  let match: RegExpExecArray | null;
  while ((match = resultRegex.exec(markdown)) !== null) {
    sections.push({
      start: match.index,
      end: match.index + match[0].length,
      content: match[1],
    });
  }
  return sections;
}

function extractJsonFromCandidate(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  const fencedMatch = trimmed.match(/^```(?:json|card)\s*([\s\S]*?)```$/i);
  const body = fencedMatch ? fencedMatch[1].trim() : trimmed;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  return body.slice(start, end + 1);
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
