import { extractStructuredResult } from '@/lib/ai/result-channel';
import type { ClarificationFormResult, ClarificationQuestionItem, PlanDraftResult } from '@/lib/ai/result-normalizers';

export const WORKFLOW_CLARIFICATION_SUMMARY_KIND = 'workflow_clarification_summary';
export const WORKFLOW_CLARIFICATION_FACTS_KIND = 'workflow_clarification_facts';
export const WORKFLOW_CLARIFICATION_GAPS_KIND = 'workflow_clarification_gaps';
export const WORKFLOW_CLARIFICATION_QUESTION_KIND = 'workflow_clarification_question';
export const SPEC_CODING_META_KIND = 'spec_coding_meta';
export const SPEC_REQUIREMENT_KIND = 'spec_requirement';
export const SPEC_DESIGN_KIND = 'spec_design';
export const SPEC_DECISION_KIND = 'spec_decision';
export const SPEC_TASK_KIND = 'spec_task';
export const WORKFLOW_STATE_OUTLINE_KIND = 'workflow_state_outline';
export const WORKFLOW_STATE_STEPS_KIND = 'workflow_state_steps';
export const WORKFLOW_PATCH_ITEM_KIND = 'workflow_patch_item';
export const SPEC_REVISION_ITEM_KIND = 'spec_revision_item';

export type WorkflowCreationItemKind =
  | typeof WORKFLOW_CLARIFICATION_SUMMARY_KIND
  | typeof WORKFLOW_CLARIFICATION_FACTS_KIND
  | typeof WORKFLOW_CLARIFICATION_GAPS_KIND
  | typeof WORKFLOW_CLARIFICATION_QUESTION_KIND
  | typeof SPEC_CODING_META_KIND
  | typeof SPEC_REQUIREMENT_KIND
  | typeof SPEC_DESIGN_KIND
  | typeof SPEC_DECISION_KIND
  | typeof SPEC_TASK_KIND
  | typeof WORKFLOW_STATE_OUTLINE_KIND
  | typeof WORKFLOW_STATE_STEPS_KIND
  | typeof WORKFLOW_PATCH_ITEM_KIND
  | typeof SPEC_REVISION_ITEM_KIND;

export type WorkflowCreationItemResult = {
  kind: WorkflowCreationItemKind;
  data: Record<string, any>;
};

export type WorkflowCreationItemExtraction =
  | { ok: true; result: WorkflowCreationItemResult }
  | { ok: false; error: string };

export interface SpecRequirementItem {
  id: string;
  title: string;
  userStory: string;
  acceptanceCriteria: string[];
}

export interface SpecGlossaryItem {
  term: string;
  definition: string;
}

export interface SpecDesignDecisionItem {
  id: string;
  topic: string;
  choice: string;
  reason: string;
}

export interface SpecTaskItem {
  id: string;
  title: string;
  requirementIds: string[];
  designRefs: string[];
  actions: string[];
  deliverables: string[];
  validation: string;
}

export interface WorkflowOutlineStateItem {
  name: string;
  description?: string;
  isInitial?: boolean;
  isFinal?: boolean;
}

export interface WorkflowCreationState {
  clarification: {
    summary: string;
    knownFacts: string[];
    missingFields: string[];
    questions: ClarificationQuestionItem[];
  };
  spec: {
    summary: string;
    goals: string[];
    nonGoals: string[];
    constraints: string[];
    glossary: SpecGlossaryItem[];
    requirements: SpecRequirementItem[];
    design: {
      overview: string;
      architecture: string[];
      components: string[];
      interfaces: string[];
      dataModels: string[];
      pseudocode: string;
      keyCode: string;
      testPlan: string[];
      compatibility: string;
      assumptions: string[];
      mermaid: string;
      decisions: SpecDesignDecisionItem[];
    };
    tasks: SpecTaskItem[];
  };
  workflow: {
    outline: WorkflowOutlineStateItem[];
    stateSteps: Record<string, any[]>;
  };
}

export interface WorkflowCreationAssemblyInput {
  workflowName: string;
  filename?: string;
  description?: string;
  requirements?: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  recommendedAgents?: string[];
  recommendedSupervisorAgent?: string;
  specCoding?: any;
}

export const WORKFLOW_CREATION_ITEM_KINDS = new Set<string>([
  WORKFLOW_CLARIFICATION_SUMMARY_KIND,
  WORKFLOW_CLARIFICATION_FACTS_KIND,
  WORKFLOW_CLARIFICATION_GAPS_KIND,
  WORKFLOW_CLARIFICATION_QUESTION_KIND,
  SPEC_CODING_META_KIND,
  SPEC_REQUIREMENT_KIND,
  SPEC_DESIGN_KIND,
  SPEC_DECISION_KIND,
  SPEC_TASK_KIND,
  WORKFLOW_STATE_OUTLINE_KIND,
  WORKFLOW_STATE_STEPS_KIND,
  WORKFLOW_PATCH_ITEM_KIND,
  SPEC_REVISION_ITEM_KIND,
]);

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function itemShapeHint(kind?: WorkflowCreationItemKind): string {
  const expectedKind = kind || '当前要求的 kind';
  return `<result>{"kind":"${expectedKind}","data":{...}}</result>`;
}

function validationError(path: string, problem: string, fix: string): string {
  return `错误字段：${path}。问题：${problem}。修改方式：${fix}`;
}

function stringArray(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanString(item))
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeGlossaryItems(value: unknown, limit = 12): SpecGlossaryItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') {
        const [term, ...definitionParts] = item.split(/[:：]/);
        return {
          term: cleanString(term),
          definition: cleanString(definitionParts.join('：')),
        };
      }
      return {
        term: cleanString((item as any)?.term || (item as any)?.name || (item as any)?.label),
        definition: cleanString((item as any)?.definition || (item as any)?.description || (item as any)?.meaning),
      };
    })
    .filter((item) => item.term && item.definition)
    .slice(0, limit);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function uniqueGlossaryItems(values: SpecGlossaryItem[]): SpecGlossaryItem[] {
  const seen = new Set<string>();
  const result: SpecGlossaryItem[] = [];
  for (const item of values) {
    const term = item.term.trim();
    const definition = item.definition.trim();
    const key = term.toLowerCase();
    if (!term || !definition || seen.has(key)) continue;
    seen.add(key);
    result.push({ term, definition });
  }
  return result;
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function ensureTaskId(value: unknown, fallbackIndex: number): string {
  const raw = cleanString(value);
  if (/^(?:[A-Za-z]+\d+(?:\.\d+)*|\d+(?:\.\d+)*)$/.test(raw)) return raw;
  return `T${fallbackIndex + 1}.1`;
}

function getPayload(raw: any): Record<string, any> {
  const payload = raw?.payload && typeof raw.payload === 'object' ? raw.payload : raw;
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  return data && typeof data === 'object' ? data : {};
}

function normalizeQuestion(data: Record<string, any>, index: number): ClarificationQuestionItem | null {
  const source = data.question && typeof data.question === 'object' ? data.question : data;
  const id = cleanString(source.id) || `q${index + 1}`;
  const label = cleanString(source.label) || cleanString(source.title) || `问题 ${index + 1}`;
  const question = cleanString(source.question) || cleanString(source.text);
  const selectionMode = source.selectionMode === 'multiple' || source.mode === 'multiple' ? 'multiple' : 'single';
  const options: ClarificationQuestionItem['options'] = (Array.isArray(source.options) ? source.options : [])
    .map((option: any, optionIndex: number) => ({
      id: cleanString(option?.id) || `opt${optionIndex + 1}`,
      label: cleanString(option?.label) || cleanString(option?.text) || `选项 ${optionIndex + 1}`,
      description: cleanString(option?.description) || cleanString(option?.detail) || undefined,
      recommended: option?.recommended === true,
    }))
    .filter((option: ClarificationQuestionItem['options'][number]) => option.label);
  if (!question || options.length < 2) return null;
  if (!options.some((option: ClarificationQuestionItem['options'][number]) => option.recommended)) {
    options[0] = { ...options[0], recommended: true };
  }
  return {
    id,
    label,
    question,
    selectionMode,
    options: options.slice(0, 4),
    placeholder: cleanString(source.placeholder) || cleanString(source.defaultAssumption) || '如果跳过，系统会采用保守默认假设继续。',
    required: source.required === false ? false : true,
  };
}

function normalizeRequirement(data: Record<string, any>, index: number): SpecRequirementItem | null {
  const source = data.requirement && typeof data.requirement === 'object' ? data.requirement : data;
  const title = cleanString(source.title) || cleanString(source.name);
  const description = cleanString(source.userStory) || cleanString(source.story) || cleanString(source.description) || cleanString(source.detail);
  const acceptanceCriteria = stringArray(source.acceptanceCriteria || source.acceptance || source.criteria, 8);
  if (!title || !description) return null;
  return {
    id: cleanString(source.id) || `R${index + 1}`,
    title,
    userStory: description,
    acceptanceCriteria: acceptanceCriteria.length ? acceptanceCriteria : [`WHEN ${title} 完成 THEN 用户可以看到可验证的结果。`],
  };
}

function normalizeDecision(data: Record<string, any>, index: number): SpecDesignDecisionItem | null {
  const source = data.decision && typeof data.decision === 'object' ? data.decision : data;
  const topic = cleanString(source.topic) || cleanString(source.title);
  const choice = cleanString(source.choice) || cleanString(source.decision);
  const reason = cleanString(source.reason) || cleanString(source.rationale);
  if (!topic || !choice) return null;
  return {
    id: cleanString(source.id) || `D${index + 1}`,
    topic,
    choice,
    reason: reason || '该选择能以较低复杂度满足当前已确认范围。',
  };
}

function normalizeMultiline(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item, index) => {
        const text = cleanString(item);
        if (!text) return '';
        return /^\d+[\).]/.test(text) ? text : `${index + 1}. ${text}`;
      })
      .filter(Boolean)
      .join('\n');
  }
  return cleanString(value);
}

function normalizeTask(data: Record<string, any>, index: number): SpecTaskItem | null {
  const source = data.task && typeof data.task === 'object' ? data.task : data;
  const title = cleanString(source.title) || cleanString(source.name);
  if (!title) return null;
  return {
    id: ensureTaskId(source.id, index),
    title,
    requirementIds: uniqueStrings(stringArray(source.requirementIds || source.requirements, 6)),
    designRefs: uniqueStrings(stringArray(source.designRefs || source.decisions, 6)),
    actions: stringArray(source.actions || source.steps, 8),
    deliverables: stringArray(source.deliverables || source.outputs, 6),
    validation: cleanString(source.validation) || cleanString(source.acceptance) || '运行相关自动检查，并人工确认结果符合需求。',
  };
}

function normalizeWorkflowOutline(states: WorkflowOutlineStateItem[]): WorkflowOutlineStateItem[] {
  const deduped: WorkflowOutlineStateItem[] = [];
  const names = new Set<string>();
  for (const state of states) {
    const name = cleanString(state.name);
    if (!name || names.has(name)) continue;
    names.add(name);
    deduped.push({ ...state, name });
  }
  if (!deduped.some((state) => state.isFinal)) {
    deduped.push({ name: '完成', description: '工作流执行完成并沉淀结果。', isFinal: true });
  }
  const finalIndex = deduped.findIndex((state) => state.isFinal);
  return deduped.map((state, index) => ({
    ...state,
    isInitial: index === 0,
    isFinal: index === finalIndex,
  }));
}

function normalizeOutlineStates(data: Record<string, any>): WorkflowOutlineStateItem[] {
  const rawStates = Array.isArray(data.states) ? data.states : [];
  return normalizeWorkflowOutline(rawStates.map((state: any, index: number) => ({
    name: cleanString(state?.name) || cleanString(state?.title) || `状态 ${index + 1}`,
    description: cleanString(state?.description) || cleanString(state?.purpose) || undefined,
    isInitial: state?.isInitial === true || index === 0,
    isFinal: state?.isFinal === true,
  })));
}

export function createEmptyWorkflowCreationState(): WorkflowCreationState {
  return {
    clarification: {
      summary: '',
      knownFacts: [],
      missingFields: [],
      questions: [],
    },
    spec: {
      summary: '',
      goals: [],
      nonGoals: [],
      constraints: [],
      glossary: [],
      requirements: [],
      design: {
        overview: '',
        architecture: [],
        components: [],
        interfaces: [],
        dataModels: [],
        pseudocode: '',
        keyCode: '',
        testPlan: [],
        compatibility: '',
        assumptions: [],
        mermaid: '',
        decisions: [],
      },
      tasks: [],
    },
    workflow: {
      outline: [],
      stateSteps: {},
    },
  };
}

function normalizeItem(raw: any): WorkflowCreationItemResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const kind = cleanString(raw.kind) as WorkflowCreationItemKind;
  if (!WORKFLOW_CREATION_ITEM_KINDS.has(kind)) return null;
  return { kind, data: getPayload(raw) };
}

export function extractWorkflowCreationItemResult(markdown: string, expectedKind?: WorkflowCreationItemKind): WorkflowCreationItemExtraction {
  const parsed = extractStructuredResult<any>(markdown, (value: any): value is any => WORKFLOW_CREATION_ITEM_KINDS.has(cleanString(value?.kind)));
  const result = normalizeItem(parsed);
  if (!result) {
    return {
      ok: false,
      error: [
        `未检测到 ${expectedKind || 'workflow creation item'} 结果。`,
        `修改方式：在回复末尾补发一个机器结果块，形如 ${itemShapeHint(expectedKind)}。`,
        '<result> 内只能是一个裸 JSON 对象，不能包 Markdown 代码块；顶层 kind 必须等于当前要求的 kind，内容放在 data 对象里。',
      ].join('\n'),
    };
  }
  if (expectedKind && result.kind !== expectedKind) {
    return {
      ok: false,
      error: [
        `错误字段：kind。问题：kind 应为 "${expectedKind}"，实际为 "${result.kind}"。`,
        `修改方式：保持当前 data 内容不变也可以，但顶层必须改成 "kind":"${expectedKind}"，并按 ${itemShapeHint(expectedKind)} 补发。`,
      ].join('\n'),
    };
  }
  const validation = validateWorkflowCreationItem(result);
  if (!validation.ok) return { ok: false, error: validation.errors.join('\n') };
  return { ok: true, result };
}

export function validateWorkflowCreationItem(result: WorkflowCreationItemResult): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const data = result.data || {};
  if (result.kind === WORKFLOW_CLARIFICATION_SUMMARY_KIND) {
    if (!cleanString(data.summary || data.text)) errors.push(validationError('data.summary', 'summary 缺失或为空。', '在 data.summary 填入 1-2 句当前理解摘要。'));
  } else if (result.kind === WORKFLOW_CLARIFICATION_FACTS_KIND) {
    if (stringArray(data.facts || data.knownFacts).length === 0) errors.push(validationError('data.facts', 'facts 缺失、不是数组或数组里没有有效字符串。', '把已确认事实写成字符串数组，例如 "facts":["事实 1","事实 2"]。'));
  } else if (result.kind === WORKFLOW_CLARIFICATION_GAPS_KIND) {
    if (stringArray(data.gaps || data.missingFields).length === 0) errors.push(validationError('data.gaps', 'gaps 缺失、不是数组或数组里没有有效字符串。', '把待补信息写成字符串数组，并用 blocking/optional 标出优先级。'));
  } else if (result.kind === WORKFLOW_CLARIFICATION_QUESTION_KIND) {
    const source = data.question && typeof data.question === 'object' ? data.question : data;
    if (!cleanString(source.question) && !cleanString(source.text)) {
      errors.push(validationError('data.question', '澄清问题缺少 question 文本。', '在 data.question 写入具体问题，并说明这个答案会影响什么决策。'));
    }
    if (!Array.isArray(source.options) || source.options.length < 2) {
      errors.push(validationError('data.options', 'options 缺失、不是数组或少于 2 个选项。', '提供 2-4 个选项对象，每个选项包含 id、label、description。'));
    }
    if (Array.isArray(source.options) && source.options.length >= 2 && !source.options.some((option: any) => option?.recommended === true)) {
      errors.push(validationError('data.options', '没有选项设置 recommended=true。', '在最稳妥的默认选项上设置 "recommended":true。'));
    }
  } else if (result.kind === SPEC_CODING_META_KIND) {
    if (!cleanString(data.summary)) errors.push(validationError('data.summary', 'summary 缺失或为空。', '在 data.summary 写入计划摘要；goals、nonGoals、constraints 可用字符串数组补充。'));
  } else if (result.kind === SPEC_REQUIREMENT_KIND) {
    if (!normalizeRequirement(data, 0)) errors.push(validationError('data', '需求小点缺少 title 或 userStory/description。', '补齐 id、title、userStory，并提供 acceptanceCriteria 字符串数组。'));
  } else if (result.kind === SPEC_DESIGN_KIND) {
    if (!cleanString(data.overview)) errors.push(validationError('data.overview', 'overview 缺失或为空。', '写入设计概览；可同时补充 architecture、components、interfaces、assumptions 和 mermaid。'));
  } else if (result.kind === SPEC_DECISION_KIND) {
    if (!normalizeDecision(data, 0)) errors.push(validationError('data', '设计决策缺少 topic 或 choice。', '补齐 id、topic、choice、reason，说明选择和理由。'));
  } else if (result.kind === SPEC_TASK_KIND) {
    if (!normalizeTask(data, 0)) errors.push(validationError('data.title', '任务小点缺少 title/name。', '补齐 id、title、requirementIds、actions、deliverables、validation。'));
  } else if (result.kind === WORKFLOW_STATE_OUTLINE_KIND) {
    if (normalizeOutlineStates(data).length < 2) errors.push(validationError('data.states', 'states 缺失或少于 2 个状态。', '按执行顺序提供至少 2 个状态对象，并给最后一个状态设置 isFinal=true；状态会串行执行。'));
  } else if (result.kind === WORKFLOW_STATE_STEPS_KIND) {
    if (!cleanString(data.stateName)) errors.push(validationError('data.stateName', 'stateName 缺失或为空。', '把 data.stateName 设置为系统当前要求的状态名，必须完全一致。'));
    if (!Array.isArray(data.steps) || data.steps.length === 0) errors.push(validationError('data.steps', 'steps 缺失、不是数组或为空。', '提供 1-4 个步骤对象；并发只在同一 stateName 的 steps 内用相同 parallelGroup 表达。'));
  } else if (result.kind === WORKFLOW_PATCH_ITEM_KIND) {
    if (!['workflow', 'state', 'step'].includes(data.scope)) errors.push(validationError('data.scope', 'scope 不是 workflow/state/step。', '根据当前优化目标把 scope 改为 workflow、state 或 step。'));
    if (!['phase-based', 'state-machine'].includes(data.workflowMode)) errors.push(validationError('data.workflowMode', 'workflowMode 不是 phase-based/state-machine。', '按当前工作流模式填写 phase-based 或 state-machine。'));
    if (!data.patch || typeof data.patch !== 'object') errors.push(validationError('data.patch', 'patch 缺失或不是对象。', '在 data.patch 中放入当前 scope 对应的 workflow、state 或 step 对象。'));
  } else if (result.kind === SPEC_REVISION_ITEM_KIND) {
    if (typeof data.apply !== 'boolean') errors.push(validationError('data.apply', 'apply 缺失或不是 boolean。', '明确填写 "apply":true 或 "apply":false。'));
    if (!cleanString(data.summary)) errors.push(validationError('data.summary', 'summary 缺失或为空。', '用一句话说明本次修订判断或结果。'));
  }
  return { ok: errors.length === 0, errors };
}

export function applyWorkflowCreationItem(state: WorkflowCreationState, result: WorkflowCreationItemResult): WorkflowCreationState {
  const next: WorkflowCreationState = JSON.parse(JSON.stringify(state || createEmptyWorkflowCreationState()));
  const data = result.data || {};

  switch (result.kind) {
    case WORKFLOW_CLARIFICATION_SUMMARY_KIND:
      next.clarification.summary = cleanString(data.summary || data.text);
      break;
    case WORKFLOW_CLARIFICATION_FACTS_KIND:
      next.clarification.knownFacts = uniqueStrings([...next.clarification.knownFacts, ...stringArray(data.facts || data.knownFacts, 12)]);
      break;
    case WORKFLOW_CLARIFICATION_GAPS_KIND:
      next.clarification.missingFields = uniqueStrings([...next.clarification.missingFields, ...stringArray(data.gaps || data.missingFields, 12)]);
      break;
    case WORKFLOW_CLARIFICATION_QUESTION_KIND: {
      const question = normalizeQuestion(data, next.clarification.questions.length);
      if (question) next.clarification.questions = [...next.clarification.questions.filter((item) => item.id !== question.id), question];
      break;
    }
    case SPEC_CODING_META_KIND:
      next.spec.summary = cleanString(data.summary) || next.spec.summary;
      next.spec.goals = uniqueStrings([...next.spec.goals, ...stringArray(data.goals, 8)]);
      next.spec.nonGoals = uniqueStrings([...next.spec.nonGoals, ...stringArray(data.nonGoals, 8)]);
      next.spec.constraints = uniqueStrings([...next.spec.constraints, ...stringArray(data.constraints, 12)]);
      next.spec.glossary = uniqueGlossaryItems([
        ...next.spec.glossary,
        ...normalizeGlossaryItems(data.glossary || data.terms, 12),
      ]);
      break;
    case SPEC_REQUIREMENT_KIND: {
      const requirement = normalizeRequirement(data, next.spec.requirements.length);
      if (requirement) next.spec.requirements = [...next.spec.requirements.filter((item) => item.id !== requirement.id), requirement];
      break;
    }
    case SPEC_DESIGN_KIND:
      next.spec.design.overview = cleanString(data.overview) || next.spec.design.overview;
      next.spec.design.architecture = uniqueStrings([...next.spec.design.architecture, ...stringArray(data.architecture, 8)]);
      next.spec.design.components = uniqueStrings([...next.spec.design.components, ...stringArray(data.components || data.coreComponents, 10)]);
      next.spec.design.interfaces = uniqueStrings([...next.spec.design.interfaces, ...stringArray(data.interfaces || data.contracts, 10)]);
      next.spec.design.dataModels = uniqueStrings([...next.spec.design.dataModels, ...stringArray(data.dataModels || data.models || data.entities, 10)]);
      next.spec.design.pseudocode = normalizeMultiline(data.pseudocode || data.pseudoCode || data.algorithm) || next.spec.design.pseudocode;
      next.spec.design.keyCode = cleanString(data.keyCode || data.code || data.keySnippet) || next.spec.design.keyCode;
      next.spec.design.testPlan = uniqueStrings([...next.spec.design.testPlan, ...stringArray(data.testPlan || data.tests || data.validationPlan, 12)]);
      next.spec.design.compatibility = cleanString(data.compatibility || data.migration || data.compatibilityAndMigration) || next.spec.design.compatibility;
      next.spec.design.assumptions = uniqueStrings([...next.spec.design.assumptions, ...stringArray(data.assumptions || data.unknowns, 10)]);
      next.spec.design.mermaid = cleanString(data.mermaid) || next.spec.design.mermaid;
      break;
    case SPEC_DECISION_KIND: {
      const decision = normalizeDecision(data, next.spec.design.decisions.length);
      if (decision) next.spec.design.decisions = [...next.spec.design.decisions.filter((item) => item.id !== decision.id), decision];
      break;
    }
    case SPEC_TASK_KIND: {
      const task = normalizeTask(data, next.spec.tasks.length);
      if (task) next.spec.tasks = [...next.spec.tasks.filter((item) => item.id !== task.id), task];
      break;
    }
    case WORKFLOW_STATE_OUTLINE_KIND:
      next.workflow.outline = normalizeOutlineStates(data);
      break;
    case WORKFLOW_STATE_STEPS_KIND:
      next.workflow.stateSteps[cleanString(data.stateName)] = Array.isArray(data.steps) ? data.steps : [];
      break;
  }

  return next;
}

export function assembleClarificationForm(state: WorkflowCreationState): ClarificationFormResult {
  return {
    type: 'clarification_form',
    summary: state.clarification.summary,
    knownFacts: state.clarification.knownFacts,
    missingFields: state.clarification.missingFields,
    questions: state.clarification.questions,
  };
}

function ensureSpecRequirements(state: WorkflowCreationState, input: WorkflowCreationAssemblyInput): SpecRequirementItem[] {
  if (state.spec.requirements.length > 0) return state.spec.requirements;
  const title = input.requirements || input.description || input.workflowName;
  return [{
    id: 'R1',
    title: input.workflowName,
    userStory: `作为用户，我希望完成 ${title}，以便获得可执行、可验证的工作流计划。`,
    acceptanceCriteria: ['WHEN 计划完成 THEN requirements、design、tasks 与 workflow 草案保持一致。'],
  }];
}

function ensureSpecTasks(state: WorkflowCreationState, requirements: SpecRequirementItem[]): SpecTaskItem[] {
  const tasks = state.spec.tasks.length
    ? state.spec.tasks
    : requirements.map((requirement, index) => ({
        id: `T${index + 1}.1`,
        title: `完成 ${requirement.title}`,
        requirementIds: [requirement.id],
        designRefs: ['D1'],
        actions: [`根据 ${requirement.id} 完成实现或配置调整。`],
        deliverables: ['可审查的代码、配置或文档变更。'],
        validation: '运行相关自动检查，并确认验收标准满足。',
      }));
  if (tasks.some((task) => task.title.includes('检查点'))) return tasks;
  return [
    ...tasks,
    {
      id: `T${tasks.length + 1}`,
      title: '检查点 - 汇总验证与交付',
      requirementIds: requirements.map((requirement) => requirement.id).slice(0, 4),
      designRefs: ['D1'],
      actions: ['汇总验证结果、风险和剩余问题。'],
      deliverables: ['最终检查记录。'],
      validation: '确认所有关键任务已完成，workflow 可以收口。',
    },
  ];
}

function ensureGlossary(state: WorkflowCreationState, input: WorkflowCreationAssemblyInput): SpecGlossaryItem[] {
  const glossary = uniqueGlossaryItems(state.spec.glossary);
  if (glossary.length > 0) return glossary;
  return [
    {
      term: input.workflowName,
      definition: '本次创建或调整的目标能力，也是 requirements、design、tasks 三份制品共同描述的范围。',
    },
    {
      term: 'Spec 制品',
      definition: 'requirements.md、design.md 和 tasks.md，用于在生成 workflow 配置前确认需求、设计和执行计划。',
    },
    {
      term: '工作流步骤',
      definition: '由指定 Agent 执行的最小工作单元，需要绑定任务、需求和验证证据。',
    },
  ];
}

function fallbackDataModels(input: WorkflowCreationAssemblyInput, requirements: SpecRequirementItem[]): string[] {
  return [
    `WorkflowCreationInput：workflowName=${input.workflowName}，workingDirectory=${input.workingDirectory}，workspaceMode=${input.workspaceMode}`,
    `RequirementItem：${requirements.map((requirement) => requirement.id).join('、')}，包含用户故事和验收标准`,
    'SpecTaskItem：任务编号、关联需求、动作、交付物和验证方式',
  ];
}

function fallbackPseudocode(tasks: SpecTaskItem[]): string {
  const coreTasks = tasks.slice(0, 4);
  return [
    '1. 读取已确认需求、设计约束和用户补充回答。',
    ...coreTasks.map((task, index) => `${index + 2}. 执行 ${task.id}：${task.title}，产出 ${task.deliverables[0] || '可审查结果'}。`),
    `${coreTasks.length + 2}. 汇总验证结果、风险和交付说明。`,
  ].join('\n');
}

function fallbackKeyCode(tasks: SpecTaskItem[]): string {
  const validations = uniqueStrings(tasks.map((task) => task.validation).filter(Boolean)).slice(0, 4);
  return [
    'for (const task of specTasks) {',
    '  await runTask(task);',
    '  await verify(task.validation);',
    '}',
    validations.length ? `// 验证重点：${validations.join('；')}` : '',
  ].filter(Boolean).join('\n');
}

function fallbackTestPlan(tasks: SpecTaskItem[]): string[] {
  const validations = uniqueStrings(tasks.map((task) => task.validation).filter(Boolean)).slice(0, 6);
  if (validations.length > 0) return validations;
  return [
    '运行相关自动化检查，确认关键路径通过。',
    '人工审查 requirements/design/tasks 与 workflow 草案是否一致。',
    '验证异常路径、回退策略和交付证据。',
  ];
}

function fallbackCompatibility(state: WorkflowCreationState): string {
  const compatibilityHint = state.spec.requirements
    .flatMap((requirement) => requirement.acceptanceCriteria)
    .find((criterion) => /兼容|迁移|旧|已有|回退|rollback/i.test(criterion));
  return compatibilityHint || '未识别到需要迁移的旧数据或旧接口；如实现中发现兼容影响，应先记录风险并补充设计说明。';
}

export function assemblePlanDraftFromItems(state: WorkflowCreationState, input: WorkflowCreationAssemblyInput): PlanDraftResult {
  const requirements = ensureSpecRequirements(state, input);
  const tasks = ensureSpecTasks(state, requirements);
  const glossary = ensureGlossary(state, input);
  const summary = state.spec.summary || state.clarification.summary || input.requirements || input.description || `${input.workflowName} 的正式计划`;
  const goals = state.spec.goals.length ? state.spec.goals : [summary];
  const constraints = state.spec.constraints.length ? state.spec.constraints : [
    `工作目录：${input.workingDirectory}`,
    `工作区模式：${input.workspaceMode}`,
  ];

  const requirementsMarkdown = [
    `# 需求文档：${input.workflowName}`,
    '',
    '## 简介',
    summary,
    '',
    '## 术语表',
    '',
    ...glossary.map((item) => `- **${item.term}**: ${item.definition}`),
    '',
    '## 需求',
    '',
    ...requirements.flatMap((requirement, index) => [
      `### 需求 ${index + 1}：${requirement.title}`,
      `**用户故事：** ${requirement.userStory}`,
      '',
      '#### 验收标准',
      ...requirement.acceptanceCriteria.map((criterion, criterionIndex) => `${criterionIndex + 1}. ${criterion}`),
      '',
    ]),
  ].join('\n').trim();

  const mermaid = state.spec.design.mermaid || [
    'flowchart TD',
    '  A[澄清需求] --> B[生成计划]',
    '  B --> C[生成工作流]',
    '  C --> D[校验与交付]',
  ].join('\n');
  const decisions = state.spec.design.decisions.length
    ? state.spec.design.decisions
    : [{ id: 'D1', topic: '分步生成', choice: '系统引导 AI 逐项输出，系统负责最终装配。', reason: '降低低端模型一次性输出大 JSON 的失败率。' }];
  const designComponents = state.spec.design.components.length
    ? state.spec.design.components
    : ['创建向导', 'Spec 制品', 'Workflow 装配器', '校验器'];
  const designInterfaces = state.spec.design.interfaces.length
    ? state.spec.design.interfaces
    : ['AI 每轮只返回当前小点对应的 kind JSON，系统校验后写入会话状态。'];
  const dataModels = state.spec.design.dataModels.length
    ? state.spec.design.dataModels
    : fallbackDataModels(input, requirements);
  const pseudocode = state.spec.design.pseudocode || fallbackPseudocode(tasks);
  const keyCode = state.spec.design.keyCode || fallbackKeyCode(tasks);
  const testPlan = state.spec.design.testPlan.length
    ? state.spec.design.testPlan
    : fallbackTestPlan(tasks);
  const compatibility = state.spec.design.compatibility || fallbackCompatibility(state);
  const designMarkdown = [
    `# 设计文档：${input.workflowName}`,
    '',
    '## 概述',
    state.spec.design.overview || summary,
    '',
    '## 架构',
    '```mermaid',
    mermaid,
    '```',
    '',
    '## 组件与接口',
    '',
    ...designComponents.flatMap((component, index) => [
      `### ${component}`,
      '',
      `**职责：** ${index === 0 ? state.spec.design.overview || summary : '承接当前设计中的一项核心职责，输入清晰、输出可审查。'}`,
      '',
      '**接口：**',
      '',
      '```text',
      designInterfaces[index] || designInterfaces[0],
      '```',
      '',
    ]),
    '## 数据模型',
    '',
    ...dataModels.map((item) => `- ${item}`),
    '',
    '## 数据流',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  participant User as 用户/创建者',
    '  participant Spec as Spec 制品',
    '  participant Workflow as Workflow 装配',
    '  User->>Spec: 确认需求、设计和任务',
    '  Spec->>Workflow: 提供任务绑定和验证依据',
    '  Workflow-->>User: 返回可审查的工作流草案',
    '```',
    '',
    '## 伪代码 / 关键代码',
    '',
    '```text',
    pseudocode,
    '```',
    '',
    '```ts',
    keyCode,
    '```',
    '',
    '## 关键决策',
    '',
    '| 决策 | 选择 | 理由 | 替代方案 |',
    '| --- | --- | --- | --- |',
    ...decisions.map((decision) => `| ${decision.topic} | ${decision.choice} | ${decision.reason} | 未采用更复杂方案，避免扩大当前范围 |`),
    '',
    '## 测试方案',
    '',
    ...testPlan.map((item) => `- ${item}`),
    '',
    '## 兼容性与迁移',
    '',
    compatibility,
    '',
    '## 假设与未知',
    ...(state.spec.design.assumptions.length ? state.spec.design.assumptions : state.clarification.missingFields).map((item) => `- ${item}`),
  ].join('\n').trim();

  const tasksMarkdown = [
    `# 实现计划：${input.workflowName}`,
    '',
    '## 概述',
    '',
    `按 ${requirements.map((requirement) => requirement.id).join('、')} 的验收标准推进，优先完成核心路径，再处理边界、异常和交付检查点。`,
    '',
    '## 任务',
    '',
    ...tasks.flatMap((task) => [
      `- [ ] ${task.id} ${task.title}`,
      `  - 需求追踪：${task.requirementIds.length ? task.requirementIds.join(', ') : requirements[0]?.id || 'R1'}`,
      task.designRefs.length ? `  - 设计追踪：${task.designRefs.join(', ')}` : '',
      ...(task.actions.length ? ['  - 动作：', ...task.actions.map((action) => `    - ${action}`)] : []),
      ...(task.deliverables.length ? ['  - 交付：', ...task.deliverables.map((deliverable) => `    - ${deliverable}`)] : []),
      `  - 验证：${task.validation}`,
      '',
    ].filter(Boolean)),
  ].join('\n').trim();

  return {
    type: 'plan_draft',
    summary,
    goals,
    nonGoals: state.spec.nonGoals,
    constraints,
    clarification: {
      summary: state.clarification.summary || summary,
      knownFacts: state.clarification.knownFacts,
      missingFields: state.clarification.missingFields,
      questions: state.clarification.questions.map((question) => question.question),
    },
    artifacts: {
      requirements: requirementsMarkdown,
      design: designMarkdown,
      tasks: tasksMarkdown,
    },
  };
}

function flattenSpecTaskIds(specCoding: any): string[] {
  const result: string[] = [];
  const walk = (tasks: any[]) => {
    for (const task of tasks || []) {
      if (Array.isArray(task?.children) && task.children.length > 0) walk(task.children);
      else if (typeof task?.id === 'string' && task.id.trim()) result.push(task.id.trim());
    }
  };
  walk(Array.isArray(specCoding?.tasks) ? specCoding.tasks : []);
  return uniqueStrings(result);
}

function normalizeWorkflowStep(input: any, fallback: {
  stateName: string;
  index: number;
  agent: string;
  taskId: string;
  requirementId: string;
}) {
  const name = cleanString(input?.name) || cleanString(input?.title) || `步骤 ${fallback.index + 1}`;
  const rawBinding = input?.specTaskBinding && typeof input.specTaskBinding === 'object' ? input.specTaskBinding : {};
  const taskIds = uniqueStrings([
    ...stringArray(rawBinding.taskIds, 6),
    cleanString(rawBinding.taskId),
    ...stringArray(input?.taskIds, 6),
  ]).filter(Boolean);
  return {
    id: cleanString(input?.id) || `${slug(fallback.stateName, 'state')}-${fallback.index + 1}`,
    name,
    agent: cleanString(input?.agent) || fallback.agent,
    role: ['attacker', 'defender', 'judge'].includes(input?.role) ? input.role : undefined,
    task: cleanString(input?.task) || cleanString(input?.prompt) || `${name}，并产出可审查结果。`,
    parallelGroup: cleanString(input?.parallelGroup || input?.groupId) || undefined,
    specTaskBinding: {
      taskId: taskIds[0] || fallback.taskId,
      taskIds: taskIds.length ? taskIds : [fallback.taskId],
      requirementIds: uniqueStrings([
        ...stringArray(rawBinding.requirementIds, 6),
        ...stringArray(input?.requirementIds, 6),
        fallback.requirementId,
      ]),
      artifactKeys: uniqueStrings([
        ...stringArray(rawBinding.artifactKeys, 6),
        ...stringArray(input?.artifactKeys, 6),
        'requirements',
        'design',
        'tasks',
      ]),
    },
  };
}

function pickWorkflowTaskAgent(agents: string[], index: number, supervisorAgent?: string): string {
  const fallbackAgents = ['developer', 'architect', 'tester'];
  const pool = [...agents, ...fallbackAgents]
    .map((agent) => cleanString(agent))
    .filter((agent) => agent && agent !== cleanString(supervisorAgent) && agent !== 'default-supervisor');
  return pool[index % Math.max(pool.length, 1)] || 'developer';
}

function replaceSupervisorStepAgent(step: any, fallbackAgent: string, supervisorAgent?: string) {
  const currentAgent = cleanString(step?.agent);
  const effectiveSupervisor = cleanString(supervisorAgent) || 'default-supervisor';
  if (currentAgent && currentAgent !== effectiveSupervisor && currentAgent !== 'default-supervisor') {
    return step;
  }
  return {
    ...step,
    agent: fallbackAgent,
  };
}

export function assembleWorkflowConfigFromItems(state: WorkflowCreationState, input: WorkflowCreationAssemblyInput): any {
  const outline = state.workflow.outline.length
    ? normalizeWorkflowOutline(state.workflow.outline)
    : normalizeWorkflowOutline([
        { name: '执行', description: input.description || input.requirements || '执行已确认任务。', isInitial: true },
        { name: '完成', description: '工作流完成。', isFinal: true },
      ]);
  const leafTaskIds = flattenSpecTaskIds(input.specCoding);
  const plannedTasks = ensureSpecTasks(state, ensureSpecRequirements(state, input));
  const fallbackTaskIds = plannedTasks.map((task) => task.id);
  const taskIds = leafTaskIds.length ? leafTaskIds : fallbackTaskIds;
  const checkpointTaskId = taskIds.find((taskId) => plannedTasks.find((task) => task.id === taskId)?.title.includes('检查点')) || taskIds[taskIds.length - 1] || 'T1.1';
  const supervisorAgent = input.recommendedSupervisorAgent || 'default-supervisor';
  const agents = input.recommendedAgents?.length ? input.recommendedAgents : ['developer', 'architect', 'tester'];
  const requirementCount = Math.max(1, ensureSpecRequirements(state, input).length);
  let globalStepIndex = 0;

  const states = outline.map((outlineState, stateIndex) => {
    if (outlineState.isFinal) {
      return {
        name: outlineState.name,
        description: outlineState.description || '工作流完成。',
        isInitial: stateIndex === 0,
        isFinal: true,
        maxSelfTransitions: 3,
        steps: [{
          id: `${slug(outlineState.name, 'final')}-summary`,
          name: '汇总结果',
          agent: pickWorkflowTaskAgent(agents, globalStepIndex, supervisorAgent),
          role: 'judge',
          task: '汇总本次工作流的执行结果、验证证据和剩余风险。',
          specTaskBinding: {
            taskId: checkpointTaskId,
            taskIds: [checkpointTaskId],
            requirementIds: ['R1'],
            artifactKeys: ['requirements', 'design', 'tasks'],
          },
        }],
        transitions: [],
      };
    }

    const candidateSteps = Array.isArray(state.workflow.stateSteps?.[outlineState.name])
      ? state.workflow.stateSteps[outlineState.name]
      : [];
    const normalizedSteps = (candidateSteps.length ? candidateSteps : [{
      name: `${outlineState.name}执行`,
      agent: pickWorkflowTaskAgent(agents, stateIndex, supervisorAgent),
      task: `完成 ${outlineState.name} 对应任务，并产出可验证结果。`,
    }]).map((step: any, stepIndex: number) => {
      const taskId = taskIds[Math.min(globalStepIndex, taskIds.length - 1)] || taskIds[0] || 'T1.1';
      const requirementId = `R${Math.min(globalStepIndex + 1, requirementCount)}`;
      const fallbackAgent = pickWorkflowTaskAgent(agents, globalStepIndex + stepIndex, supervisorAgent);
      const normalized = normalizeWorkflowStep(replaceSupervisorStepAgent(step, fallbackAgent, supervisorAgent), {
        stateName: outlineState.name,
        index: stepIndex,
        agent: fallbackAgent,
        taskId,
        requirementId,
      });
      globalStepIndex += 1;
      return normalized;
    });
    const nextState = outline[stateIndex + 1]?.name || outline.find((item) => item.isFinal)?.name || outlineState.name;
    return {
      name: outlineState.name,
      description: outlineState.description || `${outlineState.name}。`,
      isInitial: stateIndex === 0,
      isFinal: false,
      maxSelfTransitions: 3,
      steps: normalizedSteps,
      transitions: [
        { to: nextState, condition: { verdict: 'pass' }, priority: 100, label: '通过' },
        { to: nextState, condition: { verdict: 'conditional_pass' }, priority: 90, label: '有条件通过' },
        { to: outlineState.name, condition: { verdict: 'fail' }, priority: 80, label: '失败重试' },
      ],
    };
  });

  return {
    workflow: {
      name: input.workflowName,
      description: input.description || input.requirements || '',
      mode: 'state-machine',
      maxTransitions: Math.max(20, states.length * 8),
      supervisor: {
        enabled: true,
        agent: supervisorAgent,
        stageReviewEnabled: true,
        checkpointAdviceEnabled: true,
        scoringEnabled: true,
        experienceEnabled: true,
      },
      states,
    },
    context: {
      projectRoot: input.workingDirectory,
      workspaceMode: input.workspaceMode,
      requirements: input.requirements || input.description || '',
    },
  };
}

export function describeWorkflowCreationItem(result: WorkflowCreationItemResult): string {
  const data = result.data || {};
  if (result.kind === WORKFLOW_CLARIFICATION_QUESTION_KIND) {
    const question = normalizeQuestion(data, 0);
    return question ? `已生成澄清问题：${question.label}` : '已生成澄清问题';
  }
  if (result.kind === SPEC_REQUIREMENT_KIND) {
    const requirement = normalizeRequirement(data, 0);
    return requirement ? `已确认需求：${requirement.id} ${requirement.title}` : '已确认一条需求';
  }
  if (result.kind === SPEC_TASK_KIND) {
    const task = normalizeTask(data, 0);
    return task ? `已确认任务：${task.id} ${task.title}` : '已确认一条任务';
  }
  if (result.kind === WORKFLOW_STATE_OUTLINE_KIND) {
    const states = normalizeOutlineStates(data);
    return `已确认状态轮廓：${states.map((state) => state.name).join(' -> ')}`;
  }
  if (result.kind === WORKFLOW_STATE_STEPS_KIND) {
    return `已确认状态步骤：${cleanString(data.stateName) || '未命名状态'}`;
  }
  const labels: Record<WorkflowCreationItemKind, string> = {
    [WORKFLOW_CLARIFICATION_SUMMARY_KIND]: '已确认澄清摘要',
    [WORKFLOW_CLARIFICATION_FACTS_KIND]: '已确认已知事实',
    [WORKFLOW_CLARIFICATION_GAPS_KIND]: '已确认待补信息',
    [WORKFLOW_CLARIFICATION_QUESTION_KIND]: '已确认澄清问题',
    [SPEC_CODING_META_KIND]: '已确认计划摘要',
    [SPEC_REQUIREMENT_KIND]: '已确认需求',
    [SPEC_DESIGN_KIND]: '已确认设计概览',
    [SPEC_DECISION_KIND]: '已确认设计决策',
    [SPEC_TASK_KIND]: '已确认任务',
    [WORKFLOW_STATE_OUTLINE_KIND]: '已确认状态轮廓',
    [WORKFLOW_STATE_STEPS_KIND]: '已确认状态步骤',
    [WORKFLOW_PATCH_ITEM_KIND]: '已生成工作流优化补丁',
    [SPEC_REVISION_ITEM_KIND]: '已生成 Spec 修订决策',
  };
  return labels[result.kind] || `已确认 ${result.kind}`;
}
