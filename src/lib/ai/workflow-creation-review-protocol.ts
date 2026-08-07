import type { WorkflowStep } from '@/lib/core/schemas';
import {
  canonicalJson,
  createReviewStepProvenance,
  fnv1a64,
} from '@/lib/workflow/state-review-policy';

export type WorkflowCreationJourney = 'direct' | 'ai-guided';
export type WorkflowTargetKind = 'lightweight' | 'state-machine';
export type WorkflowPlanningDepth = 'compact' | 'detailed';
export type WorkflowCreationAdversarialIntent = 'disabled' | 'on-demand';
export type WorkflowReviewMode = 'standard' | 'adversarial';
export type WorkflowReviewConfidence = 'high' | 'medium' | 'low';

export interface WorkflowCreationReviewAssessment {
  requiresAdversarial: boolean;
  rationale: string;
  riskSignals: string[];
  confidence: WorkflowReviewConfidence;
}

export interface WorkflowCreationReviewPolicy {
  mode: WorkflowReviewMode;
  source: 'ai';
  locked: false;
  rationale: string;
  riskSignals: string[];
  confidence: WorkflowReviewConfidence;
}

export interface WorkflowReviewPolicyIssue {
  field: 'mode' | 'rationale' | 'riskSignals' | 'confidence';
  problem: string;
  fix: string;
}

export interface WorkflowReviewAssessmentIssue {
  field: 'requiresAdversarial' | 'rationale' | 'riskSignals' | 'confidence';
  problem: string;
  fix: string;
}

export type WorkflowStepProvenanceOrigin = 'user' | 'ai-draft' | 'review-policy' | 'legacy';
export type WorkflowManagedStepRole = 'attacker' | 'judge' | 'standard-closer';

const REVIEW_MODES = new Set<WorkflowReviewMode>(['standard', 'adversarial']);
const REVIEW_CONFIDENCE = new Set<WorkflowReviewConfidence>(['high', 'medium', 'low']);

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueTextList(value: unknown, limit = 12): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => text(item)).filter(Boolean))].slice(0, limit);
}

export function validateWorkflowReviewPolicyInput(value: unknown): WorkflowReviewPolicyIssue[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const issues: WorkflowReviewPolicyIssue[] = [];
  if (!REVIEW_MODES.has(source.mode as WorkflowReviewMode)) {
    issues.push({
      field: 'mode',
      problem: `mode 必须是 standard 或 adversarial，当前值为 ${JSON.stringify(source.mode)}`,
      fix: '根据当前状态的实际风险填写 "mode":"standard" 或 "mode":"adversarial"。',
    });
  }
  if (!text(source.rationale)) {
    issues.push({
      field: 'rationale',
      problem: 'rationale 缺失或为空',
      fix: '说明该状态的具体交付物、失败代价和采用此模式的原因。',
    });
  }
  if (!Array.isArray(source.riskSignals)) {
    issues.push({
      field: 'riskSignals',
      problem: 'riskSignals 缺失或不是字符串数组',
      fix: '提供具体风险信号数组；低风险状态可以使用空数组。',
    });
  } else if (source.riskSignals.some((item) => !text(item))) {
    issues.push({
      field: 'riskSignals',
      problem: 'riskSignals 包含空值或非字符串项',
      fix: '删除空值，并把每个风险信号写成非空字符串。',
    });
  }
  if (!REVIEW_CONFIDENCE.has(source.confidence as WorkflowReviewConfidence)) {
    issues.push({
      field: 'confidence',
      problem: `confidence 必须是 high、medium 或 low，当前值为 ${JSON.stringify(source.confidence)}`,
      fix: '填写 "confidence":"high"、"medium" 或 "low"。',
    });
  }
  return issues;
}

export function validateWorkflowReviewAssessmentInput(value: unknown): WorkflowReviewAssessmentIssue[] {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const issues: WorkflowReviewAssessmentIssue[] = [];
  if (typeof source.requiresAdversarial !== 'boolean') {
    issues.push({
      field: 'requiresAdversarial',
      problem: 'requiresAdversarial 缺失或不是 boolean',
      fix: '明确填写 true 或 false；它决定候选结果能否继续保持 lightweight。',
    });
  }
  if (!text(source.rationale)) {
    issues.push({
      field: 'rationale',
      problem: 'rationale 缺失或为空',
      fix: '说明整体任务的交付边界、失败代价和对抗需求。',
    });
  }
  if (!Array.isArray(source.riskSignals)) {
    issues.push({
      field: 'riskSignals',
      problem: 'riskSignals 缺失或不是字符串数组',
      fix: '提供整体风险信号数组；未发现风险时使用空数组。',
    });
  } else if (source.riskSignals.some((item) => !text(item))) {
    issues.push({
      field: 'riskSignals',
      problem: 'riskSignals 包含空值或非字符串项',
      fix: '删除空值，并把每个风险信号写成非空字符串。',
    });
  }
  if (!REVIEW_CONFIDENCE.has(source.confidence as WorkflowReviewConfidence)) {
    issues.push({
      field: 'confidence',
      problem: `confidence 必须是 high、medium 或 low，当前值为 ${JSON.stringify(source.confidence)}`,
      fix: '填写 "confidence":"high"、"medium" 或 "low"。',
    });
  }
  return issues;
}

export function normalizeWorkflowReviewPolicy(value: unknown): WorkflowCreationReviewPolicy | null {
  if (validateWorkflowReviewPolicyInput(value).length > 0) return null;
  const source = value as Record<string, unknown>;
  const confidence = source.confidence as WorkflowReviewConfidence;
  const requestedMode = source.mode as WorkflowReviewMode;
  const forceAdversarial = confidence === 'low' && requestedMode === 'standard';
  const rationale = text(source.rationale);
  return {
    mode: forceAdversarial ? 'adversarial' : requestedMode,
    source: 'ai',
    locked: false,
    rationale: forceAdversarial
      ? `${rationale}${rationale.endsWith('。') ? '' : '。'}判断把握不足，按保守规则采用对抗模式。`
      : rationale,
    riskSignals: uniqueTextList(source.riskSignals),
    confidence,
  };
}

export function normalizeWorkflowReviewAssessment(value: unknown): WorkflowCreationReviewAssessment | null {
  if (validateWorkflowReviewAssessmentInput(value).length > 0) return null;
  const source = value as Record<string, unknown>;
  const confidence = source.confidence as WorkflowReviewConfidence;
  const requested = source.requiresAdversarial === true;
  const forceAdversarial = confidence === 'low';
  const rationale = text(source.rationale);
  return {
    requiresAdversarial: requested || forceAdversarial,
    rationale: forceAdversarial && !requested
      ? `${rationale}${rationale.endsWith('。') ? '' : '。'}整体风险判断把握不足，按保守规则要求状态机对抗审查。`
      : rationale,
    riskSignals: uniqueTextList(source.riskSignals),
    confidence,
  };
}

export function createDefaultStandardReviewPolicy(rationale = '状态行为确定且可验证，默认采用标准模式。'): WorkflowCreationReviewPolicy {
  return {
    mode: 'standard',
    source: 'ai',
    locked: false,
    rationale,
    riskSignals: [],
    confidence: 'medium',
  };
}

export function workflowReviewFingerprint(value: unknown): string {
  return fnv1a64(canonicalJson(value));
}

export function createWorkflowStepProvenance(
  step: Record<string, unknown>,
  origin: WorkflowStepProvenanceOrigin,
  managedRole?: WorkflowManagedStepRole,
) {
  return createReviewStepProvenance(step as unknown as WorkflowStep, origin, managedRole);
}

const STATE_MACHINE_RULES = [
  '状态集合必须最小充分：至少 1 个可执行状态和 1 个终态，共至少 2 个状态。',
  '只有独立交付、独立验收/回退、人工审批、进度暂停、编队切换或单独重跑形成独立边界时才新增状态；不要为了凑数量拆状态。',
  '每个非终态必须返回 reviewPolicy；终态不得返回 reviewPolicy。',
  '模式只允许 standard 或 adversarial。判断把握不足时选择 adversarial；confidence=low 时不得选择 standard。',
  '架构、接口、权限、安全、隐私、数据模型、跨模块影响、不可逆操作、高失败代价和明显不确定性优先 adversarial。',
  '机械、可自动验证、易回滚的低风险操作优先 standard。判断理由必须引用当前状态的具体交付物和风险。',
];

const STEP_RULES = [
  'standard：生成 1-N 个执行/验证步骤，不生成 attacker 或独立 judge；最后一个串行步骤必须在同一次输出中给出 pass|conditional_pass|fail verdict。',
  'adversarial：严格按一个或多个 defender → 一个串行 attacker → 一个串行 judge 排列，judge 必须是最后执行段。',
  'attacker 的 task/constraints 必须主动寻找反例、边界、遗漏和错误假设，不得仅复述 defender。',
  'judge 必须基于 defender 与 attacker 的证据独立输出 pass|conditional_pass|fail。',
  'Supervisor 不能作为步骤 Agent。只使用系统提供的普通执行 Agent；Agent 配置可复用，运行实例由本地系统隔离。',
  '不要返回或决定 id、agentInstanceId、provenance、baselineHash；这些管理字段由本地装配层生成。',
];

const PRODUCT_GATE_RULES = [
  'ai-guided 是创建旅程，不是可持久化 workflow mode；最终类型只能是 lightweight 或 state-machine。',
  '只有目标清晰、一个执行 Agent 可通过任务清单动态拆分和验收，并且不需要状态级对抗时，才推荐 lightweight。',
  'lightweight 固定为 1 个同时 initial/final 的状态、1 个 Agent 步骤、0 个转移，不返回状态级 reviewPolicy。',
  '只要需要显式多状态、条件转移、回退、并行步骤、子工作流、Supervisor 或任一环节需要对抗，就推荐 state-machine。',
  '不得为了保持 lightweight 而降低风险判断；lightweight + requiresAdversarial=true 或 confidence=low 是矛盾结果，必须局部修复为 state-machine。',
];

export function buildWorkflowCreationReviewProtocolPrompt(input: {
  creationJourney: WorkflowCreationJourney;
  targetWorkflowKind?: WorkflowTargetKind;
  planningDepth?: WorkflowPlanningDepth;
  stage: 'outline' | 'state-steps';
  creationAdversarialIntent: WorkflowCreationAdversarialIntent;
}): string {
  const intent = input.creationAdversarialIntent;
  const target = input.targetWorkflowKind || 'state-machine';
  const targetRule = input.creationJourney === 'ai-guided'
    ? '首轮必须返回 workflowKind、workflowKindRationale 和 reviewAssessment；在同一次调用里完成产品类型推荐、整体风险初判和必要的状态机大纲。'
    : target === 'lightweight' && intent === 'on-demand'
      ? '用户从直接 lightweight 入口进入；优先保持 lightweight，但若整体评估确认需要对抗，必须明确推荐 state-machine 并说明升级理由，再由用户二次确认。'
      : `用户直接选择了 ${target}；不得静默改成其他最终产品。若 ${target} 无法满足约束，返回需要重新规划的明确矛盾结果。`;
  const outputRule = intent === 'disabled'
    ? (input.stage === 'outline'
        ? '不判断对抗模式，不返回 reviewAssessment 或状态 reviewPolicy；本地系统会把普通状态机全部非终态强制装配为 standard。'
        : '只返回标准业务执行/验证步骤，不返回 reviewPolicy，不生成 defender、attacker 或独立 judge 角色。')
    : input.stage === 'outline'
      ? '返回 reviewAssessment={requiresAdversarial,rationale,riskSignals,confidence}；仅当 workflowKind=state-machine 时，每个非终态再返回 reviewPolicy={mode,rationale,riskSignals,confidence}。'
      : 'state_steps 必须再次返回最终 reviewPolicy={mode,rationale,riskSignals,confidence}，并让 steps 与最终 mode 一致；这次判断覆盖 outline 初判。';
  const stateRules = intent === 'disabled' ? STATE_MACHINE_RULES.slice(0, 2) : STATE_MACHINE_RULES;
  const stepRules = intent === 'disabled' ? [STEP_RULES[0], STEP_RULES[4], STEP_RULES[5]] : STEP_RULES;
  return [
    '# 工作流产品类型门禁',
    ...PRODUCT_GATE_RULES.map((rule) => `- ${rule}`),
    `- ${targetRule}`,
    input.planningDepth ? `- 内部规划深度：${input.planningDepth}；它只影响说明细度，不改变最终产品语义。` : '',
    '',
    '# 共享状态级审查协议',
    `- 创建全局意愿：${intent}。${intent === 'disabled' ? '这是硬约束，AI 不判断对抗模式。' : 'AI 可以按整体和状态风险判断是否开启对抗。'}`,
    ...stateRules.map((rule) => `- ${rule}`),
    ...stepRules.map((rule) => `- ${rule}`),
    '',
    '# 当前输出要求',
    `- ${outputRule}`,
  ].filter(Boolean).join('\n');
}
