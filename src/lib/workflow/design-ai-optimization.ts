import type {
  ReviewPolicy,
  StateMachineState,
  UnifiedWorkflowConfig,
  WorkflowStep,
} from '@/lib/core/schemas';
import { extractWorkflowPatchItemResult, WORKFLOW_PATCH_ITEM_KIND } from '@/lib/ai/workflow-patch-items';
import {
  createReviewEntityId,
  canonicalJson,
  fnv1a64,
  getReviewPolicyProtectedSlice,
  reconcileReviewPolicy,
  withReviewStepBaseline,
} from '@/lib/workflow/state-review-policy';

export type DesignOptimizationWorkflowMode = 'state-machine';

export type DesignOptimizationTarget =
  | {
      scope: 'workflow';
      workflowMode: DesignOptimizationWorkflowMode;
      workflowName: string;
    }
  | {
      scope: 'step';
      workflowMode: DesignOptimizationWorkflowMode;
      containerType: 'state';
      containerIndex: number;
      containerName: string;
      stepIndex: number;
      stepName: string;
    }
  | {
      scope: 'state';
      workflowMode: 'state-machine';
      stateIndex: number;
      stateName: string;
      stateId?: string;
      reviewPolicyOnly?: boolean;
      /** Explicit user intent to hand a locked policy back to AI. Applied only with the accepted diff. */
      unlockForAi?: boolean;
    };

export type WorkflowPatchPayload = {
  filename?: string;
  summary?: string;
  scope?: DesignOptimizationTarget['scope'];
  workflowMode?: DesignOptimizationWorkflowMode;
  patch?: {
    workflow?: Record<string, any>;
    state?: StateMachineState | Record<string, any>;
    step?: WorkflowStep | Record<string, any>;
  };
};

type PromptAgentOption = {
  name: string;
  team?: string;
  roleType?: string;
  description?: string;
  capabilities?: string[];
};

type PromptSkillOption = {
  name: string;
  description?: string;
};

type PromptSpecTaskOption = {
  id: string;
  title: string;
  phaseTitle?: string;
  ownerAgents?: string[];
};

type BuildDesignOptimizationPromptInput = {
  target: DesignOptimizationTarget;
  workflowName: string;
  configFile: string;
  instruction: string;
  currentConfig: UnifiedWorkflowConfig | Record<string, any>;
  currentSpecArtifacts?: {
    requirements: string;
    design: string;
    tasks: string;
  };
  requirements?: string;
  availableAgents?: PromptAgentOption[];
  availableSkills?: PromptSkillOption[];
  specTasks?: PromptSpecTaskOption[];
};

const PRESERVED_CONTEXT_KEYS = [
  'projectRoot',
  'workspaceMode',
  'requirements',
  'timeoutMinutes',
  'engine',
  'executionPolicy',
  'skills',
  'mcpServers',
];

function cloneValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function stepIdentity(step: Record<string, any> | null | undefined): string {
  return String(step?.id || step?.name || '').trim();
}

function isReviewPolicyManagedStep(step: Record<string, any> | null | undefined): boolean {
  return step?.provenance?.origin === 'review-policy'
    || step?.provenance?.managedRole === 'standard-closer';
}

function createOptimizationInstanceId(state: Record<string, any>, step: Record<string, any>, index: number): string {
  return `review-instance-${fnv1a64([state.id || state.name, step.id || step.name, step.role || 'step', index].join('/'))}`;
}

function matchBaseStep(
  baseSteps: Record<string, any>[],
  candidate: Record<string, any>,
  usedBaseSteps: Set<Record<string, any>>,
): Record<string, any> | undefined {
  if (candidate?.id) {
    const byId = baseSteps.find((step) => step.id === candidate.id);
    if (byId) return byId;
  }
  const name = String(candidate?.name || '').trim();
  return name ? baseSteps.find((step) => step.name === name && !usedBaseSteps.has(step)) : undefined;
}

function sanitizeNewAiStep(
  candidate: Record<string, any>,
  state: Record<string, any>,
  index: number,
): Record<string, any> {
  const semantic = cloneValue(candidate || {});
  delete semantic.id;
  delete semantic.provenance;
  delete semantic.agentInstanceId;
  delete semantic.role;
  let step: Record<string, any> = {
    ...semantic,
    id: createReviewEntityId(),
  };
  if (state.reviewPolicy?.mode === 'adversarial') {
    step.role = 'defender';
    step.agentInstanceId = createOptimizationInstanceId(state, step, index);
    const groupId = String(step.parallelGroup || step.concurrency?.groupId || '').trim();
    if (groupId) {
      step.concurrency = {
        ...(step.concurrency || {}),
        groupId,
        joinPolicy: { mode: 'all' },
      };
    }
  }
  step = withReviewStepBaseline(step as WorkflowStep, 'ai-draft');
  return step;
}

function restoreLockedReviewSlice(
  baseState: Record<string, any>,
  candidateState: Record<string, any>,
): Record<string, any> | null {
  const baseSteps = Array.isArray(baseState.steps) ? baseState.steps : [];
  const candidateSteps = Array.isArray(candidateState.steps) ? candidateState.steps : [];
  const usedBaseSteps = new Set<Record<string, any>>();
  const nextSteps: Record<string, any>[] = [];
  for (const [index, candidate] of candidateSteps.entries()) {
    const candidateName = String(candidate?.name || '').trim();
    const matchedById = candidate?.id
      ? baseSteps.find((step) => step.id === candidate.id)
      : undefined;
    const unusedNameMatches = candidateName
      ? baseSteps.filter((step) => step.name === candidateName && !usedBaseSteps.has(step))
      : [];
    if (!matchedById && (
      unusedNameMatches.some((step) => Boolean(step.id))
      || unusedNameMatches.length > 1
    )) return null;
    const baseStep = matchBaseStep(baseSteps, candidate, usedBaseSteps);
    if (baseStep) {
      if (usedBaseSteps.has(baseStep)) return null;
      usedBaseSteps.add(baseStep);
      if (isReviewPolicyManagedStep(baseStep)) continue;
      let next = {
        ...cloneValue(baseStep),
        ...cloneValue(candidate),
        ...(baseStep.id ? { id: baseStep.id } : {}),
        ...(baseStep.provenance ? { provenance: cloneValue(baseStep.provenance) } : {}),
        role: baseStep.role,
        agentInstanceId: baseStep.agentInstanceId,
      };
      if (baseState.reviewPolicy?.mode === 'adversarial') {
        next.parallelGroup = baseStep.parallelGroup;
        next.concurrency = cloneValue(baseStep.concurrency);
        if (baseState.reviewPolicy?.locked) next.agent = baseStep.agent;
      }
      if (baseStep.provenance?.origin === 'ai-draft') {
        next = withReviewStepBaseline(next as WorkflowStep, 'ai-draft');
      }
      nextSteps.push(next);
      continue;
    }
    nextSteps.push(sanitizeNewAiStep(candidate, baseState, index));
  }

  for (const [index, step] of baseSteps.entries()) {
    const managedStep = isReviewPolicyManagedStep(step);
    const protectsRoleStep = baseState.reviewPolicy?.locked && Boolean(step.role);
    if ((!managedStep && !protectsRoleStep) || (!managedStep && usedBaseSteps.has(step))) continue;
    if (step.provenance?.managedRole === 'standard-closer') {
      nextSteps.push(cloneValue(step));
    } else {
      nextSteps.splice(Math.min(index, nextSteps.length), 0, cloneValue(step));
    }
  }

  let structurallySafeSteps = nextSteps;
  if (baseState.reviewPolicy?.mode === 'adversarial') {
    const managedTail = baseSteps.filter((step: Record<string, any>) => step.role === 'attacker' || step.role === 'judge');
    const managedIds = new Set(managedTail.map(stepIdentity));
    const defenders = nextSteps
      .filter((step) => !managedIds.has(stepIdentity(step)) && step.role !== 'attacker' && step.role !== 'judge')
      .map((step, index) => ({
        ...step,
        role: 'defender',
        agentInstanceId: step.agentInstanceId || createOptimizationInstanceId(baseState, step, index),
      }));
    if (defenders.length === 0) return null;
    structurallySafeSteps = [...defenders, ...managedTail.map((step) => cloneValue(step))];
  }
  if (!baseState.isFinal && structurallySafeSteps.length === 0) return null;

  const restoredState = {
    ...candidateState,
    ...(baseState.id ? { id: baseState.id } : {}),
    name: baseState.name,
    isFinal: baseState.isFinal,
    reviewPolicy: cloneValue(baseState.reviewPolicy),
    ...(baseState.reviewPolicy?.locked ? { maxSelfTransitions: baseState.maxSelfTransitions } : {}),
    steps: structurallySafeSteps,
  };
  if (baseState.reviewPolicy?.locked
    && canonicalJson(getReviewPolicyProtectedSlice(baseState as StateMachineState))
      !== canonicalJson(getReviewPolicyProtectedSlice(restoredState as StateMachineState))) {
    return null;
  }
  return restoredState;
}

function restoreWorkflowReviewSlices(
  baseWorkflow: Record<string, any>,
  candidateWorkflow: Record<string, any>,
): Record<string, any> | null {
  if (baseWorkflow?.mode !== 'state-machine' || candidateWorkflow?.mode !== 'state-machine') {
    return candidateWorkflow;
  }
  const baseStates = Array.isArray(baseWorkflow.states) ? baseWorkflow.states : [];
  const candidateStates = Array.isArray(candidateWorkflow.states) ? candidateWorkflow.states : [];
  const usedBaseStates = new Set<Record<string, any>>();
  const findBaseState = (candidate: Record<string, any>) => {
    if (candidate?.id) {
      const byId = baseStates.find((state: Record<string, any>) => state.id === candidate.id);
      if (byId) return byId;
    }
    const byName = baseStates.find((state: Record<string, any>) => state.name === candidate?.name);
    return byName?.id ? undefined : byName;
  };

  const nextWorkflow = {
    ...candidateWorkflow,
    states: candidateStates.map((candidateState: Record<string, any>) => {
      const baseState = findBaseState(candidateState);
      if (!baseState) {
        const next = cloneValue(candidateState);
        next.id = createReviewEntityId();
        if (next.isFinal) {
          delete next.reviewPolicy;
        } else {
          const requestedMode = next.reviewPolicy?.mode === 'adversarial' ? 'adversarial' : 'standard';
          const confidence = ['high', 'medium', 'low'].includes(String(next.reviewPolicy?.confidence || ''))
            ? next.reviewPolicy.confidence
            : 'medium';
          next.reviewPolicy = {
            mode: confidence === 'low' && requestedMode === 'standard' ? 'adversarial' : requestedMode,
            source: 'ai',
            locked: false,
            confidence,
            riskSignals: Array.isArray(next.reviewPolicy?.riskSignals) ? next.reviewPolicy.riskSignals : [],
            rationale: String(next.reviewPolicy?.rationale || '').trim() || 'AI 优化新增状态，采用本地审查协议完成编排。',
          };
        }
        const candidateSteps = Array.isArray(next.steps) ? next.steps : [];
        next.steps = candidateSteps
          .filter((step: Record<string, any>) => next.isFinal || !['attacker', 'judge'].includes(String(step.role || '')))
          .map((step: Record<string, any>, index: number) => sanitizeNewAiStep(step, next, index));
        if (next.isFinal) return next;
        const reconciled = reconcileReviewPolicy(
          { ...next, reviewPolicy: undefined } as StateMachineState,
          next.reviewPolicy as ReviewPolicy,
          { availableAgents: next.steps.map((step: Record<string, any>) => step.agent).filter(Boolean) },
        );
        return reconciled.blocked ? null : reconciled.nextState;
      }
      if (usedBaseStates.has(baseState)) return null;
      if (candidateState.id === baseState.id && candidateState.name !== baseState.name) return null;
      usedBaseStates.add(baseState);
      return restoreLockedReviewSlice(baseState, candidateState);
    }),
  };
  if (nextWorkflow.states.some((state: unknown) => !state)) return null;
  if (baseStates.some((state: Record<string, any>) => state.reviewPolicy?.locked && !usedBaseStates.has(state))) return null;
  return nextWorkflow;
}

function truncateForPrompt(value: string, maxChars: number): string {
  const text = String(value || '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n...(truncated)...` : text;
}

function stringifyForPrompt(value: unknown, maxChars: number): string {
  return truncateForPrompt(JSON.stringify(value, null, 2), maxChars);
}

function formatAgentList(agents: PromptAgentOption[]): string {
  return agents
    .slice(0, 24)
    .map((agent) => {
      const parts = [
        agent.name,
        agent.team || '',
        agent.roleType || '',
        agent.description || '',
        Array.isArray(agent.capabilities) && agent.capabilities.length > 0
          ? `capabilities=${agent.capabilities.slice(0, 5).join(', ')}`
          : '',
      ].filter(Boolean);
      return `- ${parts.join(' | ')}`;
    })
    .join('\n');
}

function formatSkillList(skills: PromptSkillOption[]): string {
  return skills
    .slice(0, 24)
    .map((skill) => `- ${skill.name}${skill.description ? ` | ${skill.description}` : ''}`)
    .join('\n');
}

function formatSpecTaskList(tasks: PromptSpecTaskOption[]): string {
  return tasks
    .slice(0, 36)
    .map((task) => {
      const owners = Array.isArray(task.ownerAgents) && task.ownerAgents.length > 0
        ? ` | owners=${task.ownerAgents.join(', ')}`
        : '';
      return `- ${task.id} | ${task.title}${task.phaseTitle ? ` | ${task.phaseTitle}` : ''}${owners}`;
    })
    .join('\n');
}

export function getWorkflowMode(_config: UnifiedWorkflowConfig | Record<string, any>): DesignOptimizationWorkflowMode {
  return 'state-machine';
}

export function getDesignOptimizationTargetLabel(target: DesignOptimizationTarget): string {
  if (target.scope === 'workflow') return `工作流 ${target.workflowName}`;
  if (target.scope === 'state') return `状态 ${target.stateName}`;
  return `状态 ${target.containerName} / 步骤 ${target.stepName}`;
}

export function getDesignOptimizationDialogTitle(target: DesignOptimizationTarget): string {
  if (target.scope === 'workflow') return 'AI 修订工作流';
  if (target.scope === 'state') return 'AI 优化状态';
  return 'AI 优化步骤';
}

export function getDesignOptimizationScopeHint(target: DesignOptimizationTarget): string {
  if (target.scope === 'workflow') {
    return '基于当前配置、需求和可用上下文生成 workflow 级 patch，只替换 workflow 本体，先看 diff，再应用。';
  }
  if (target.scope === 'state') {
    return '只生成当前状态的 patch，允许调整状态描述、内部步骤和转移，不直接改动其他状态。';
  }
  return '只生成当前步骤的 patch，允许优化 agent、任务、约束、skills 与 spec 绑定，不直接改动其他节点。';
}

export function extractDesignOptimizationSnapshot(
  config: UnifiedWorkflowConfig | Record<string, any>,
  target: DesignOptimizationTarget,
): any | null {
  const workflow = (config as any)?.workflow || {};
  if (target.scope === 'workflow') return cloneValue(workflow);
  if (target.scope === 'state') {
    const state = Array.isArray(workflow.states) ? workflow.states[target.stateIndex] : null;
    return state ? cloneValue(state) : null;
  }
  const containers = Array.isArray(workflow.states) ? workflow.states : [];
  const container = containers[target.containerIndex];
  const step = Array.isArray(container?.steps) ? container.steps[target.stepIndex] : null;
  return step ? cloneValue(step) : null;
}

function preserveBaseContext(
  baseConfig: Record<string, any>,
  nextConfig: Record<string, any>,
): Record<string, any> {
  const baseContext = baseConfig?.context && typeof baseConfig.context === 'object' ? baseConfig.context : {};
  const nextContext = nextConfig?.context && typeof nextConfig.context === 'object' ? nextConfig.context : {};
  const mergedContext = {
    ...baseContext,
    ...nextContext,
  };
  for (const key of PRESERVED_CONTEXT_KEYS) {
    if (Object.prototype.hasOwnProperty.call(baseContext, key)) {
      mergedContext[key] = cloneValue(baseContext[key]);
    }
  }
  return mergedContext;
}

export function doesWorkflowPatchMatchTarget(
  payload: WorkflowPatchPayload | null | undefined,
  target: DesignOptimizationTarget,
  baseConfig?: UnifiedWorkflowConfig | Record<string, any> | null,
): boolean {
  if (!payload) return false;
  if (payload.scope && payload.scope !== target.scope) return false;
  const expectedMode = baseConfig ? getWorkflowMode(baseConfig) : target.workflowMode;
  if (payload.workflowMode && payload.workflowMode !== expectedMode) return false;
  return true;
}

export function extractWorkflowPatchValue(
  payload: WorkflowPatchPayload | null | undefined,
  target: DesignOptimizationTarget,
): Record<string, any> | null {
  const patch = payload?.patch;
  if (!patch || typeof patch !== 'object') return null;
  if (target.scope === 'workflow') {
    return patch.workflow && typeof patch.workflow === 'object' ? cloneValue(patch.workflow) : null;
  }
  if (target.scope === 'state') {
    return patch.state && typeof patch.state === 'object' ? cloneValue(patch.state as Record<string, any>) : null;
  }
  return patch.step && typeof patch.step === 'object' ? cloneValue(patch.step as Record<string, any>) : null;
}

function patchStepIntoConfig(
  baseConfig: Record<string, any>,
  stepPatch: Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'step' }>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  const nextWorkflow = nextConfig?.workflow || {};
  const nextContainers = Array.isArray(nextWorkflow.states) ? nextWorkflow.states : [];
  const nextContainer = nextContainers[target.containerIndex];
  if (!nextContainer || !Array.isArray(nextContainer.steps) || !nextContainer.steps[target.stepIndex]) return null;
  const protectedReviewSlice = nextContainer.reviewPolicy?.locked
    ? getReviewPolicyProtectedSlice(nextContainer as StateMachineState)
    : null;
  const baseStep = nextContainer.steps[target.stepIndex];
  if (isReviewPolicyManagedStep(baseStep) || baseStep.role === 'attacker' || baseStep.role === 'judge') {
    return null;
  }
  const semanticPatch = cloneValue(stepPatch);
  delete semanticPatch.id;
  delete semanticPatch.provenance;
  delete semanticPatch.role;
  delete semanticPatch.agentInstanceId;
  let nextStep: Record<string, any> = {
    ...cloneValue(baseStep),
    ...semanticPatch,
    ...(baseStep.id ? { id: baseStep.id } : {}),
    ...(baseStep.provenance ? { provenance: cloneValue(baseStep.provenance) } : {}),
    role: baseStep.role,
    agentInstanceId: baseStep.agentInstanceId,
  };
  if (nextContainer.reviewPolicy?.mode === 'adversarial') {
    nextStep.parallelGroup = baseStep.parallelGroup;
    nextStep.concurrency = cloneValue(baseStep.concurrency);
    if (nextContainer.reviewPolicy.locked) nextStep.agent = baseStep.agent;
  }
  if (baseStep.provenance?.origin === 'ai-draft') {
    nextStep = withReviewStepBaseline(nextStep as WorkflowStep, 'ai-draft');
  }
  nextContainer.steps[target.stepIndex] = nextStep;
  if (protectedReviewSlice
    && canonicalJson(protectedReviewSlice)
      !== canonicalJson(getReviewPolicyProtectedSlice(nextContainer as StateMachineState))) {
    return null;
  }
  nextConfig.workflow = nextWorkflow;
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

function patchStateIntoConfig(
  baseConfig: Record<string, any>,
  statePatch: Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'state' }>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  const nextStates = Array.isArray(nextConfig?.workflow?.states) ? nextConfig.workflow.states : [];
  const baseState = nextStates[target.stateIndex];
  if (!baseState || baseState.name !== target.stateName || statePatch.name !== target.stateName) return null;
  const restoredState = restoreLockedReviewSlice(baseState, {
    ...cloneValue(statePatch),
    ...(baseState.id ? { id: baseState.id } : {}),
    name: baseState.name,
  });
  if (!restoredState) return null;
  nextStates[target.stateIndex] = restoredState;
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

function patchReviewPolicyIntoConfig(
  baseConfig: Record<string, any>,
  statePatch: Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'state' }>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  const states = Array.isArray(nextConfig?.workflow?.states) ? nextConfig.workflow.states : [];
  const stateIndex = states.findIndex((state: Record<string, any>) => (
    target.stateId ? state.id === target.stateId : state.name === target.stateName
  ));
  const baseState = states[stateIndex] as StateMachineState | undefined;
  if (!baseState || baseState.isFinal) return null;
  if (baseState.reviewPolicy?.locked && !target.unlockForAi) return null;
  const rawPolicy = statePatch.reviewPolicy && typeof statePatch.reviewPolicy === 'object'
    ? statePatch.reviewPolicy
    : statePatch;
  if (!['standard', 'adversarial'].includes(String(rawPolicy?.mode || ''))) return null;
  const confidence = ['high', 'medium', 'low'].includes(String(rawPolicy?.confidence || ''))
    ? rawPolicy.confidence as ReviewPolicy['confidence']
    : 'medium';
  const requestedMode = rawPolicy.mode as ReviewPolicy['mode'];
  const reviewPolicy: ReviewPolicy = {
    mode: confidence === 'low' && requestedMode === 'standard' ? 'adversarial' : requestedMode,
    source: 'ai',
    locked: false,
    confidence,
    riskSignals: Array.isArray(rawPolicy.riskSignals)
      ? Array.from(new Set(rawPolicy.riskSignals.map((item: unknown) => String(item).trim()).filter(Boolean))) as string[]
      : [],
    rationale: String(rawPolicy.rationale || '').trim() || 'AI 已重新评估当前状态的交付物与失败风险。',
  };
  const result = reconcileReviewPolicy(baseState, reviewPolicy, {
    availableAgents: (baseState.steps || []).map((step) => step.agent).filter(Boolean),
  });
  if (result.blocked) return null;
  states[stateIndex] = result.nextState;
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

function replaceWorkflowInConfig(
  baseConfig: Record<string, any>,
  workflowPatch: Record<string, any>,
): Record<string, any> | null {
  const nextConfig = cloneValue(baseConfig);
  const nextWorkflow = restoreWorkflowReviewSlices(baseConfig.workflow || {}, cloneValue(workflowPatch));
  if (!nextWorkflow) return null;
  nextConfig.workflow = nextWorkflow;
  nextConfig.context = preserveBaseContext(baseConfig, nextConfig);
  if (Object.prototype.hasOwnProperty.call(baseConfig, 'roles')) nextConfig.roles = cloneValue(baseConfig.roles);
  return nextConfig;
}

export function applyDesignOptimizationPatch(
  baseConfig: UnifiedWorkflowConfig | Record<string, any>,
  payload: WorkflowPatchPayload | null | undefined,
  target: DesignOptimizationTarget,
): Record<string, any> | null {
  if (!doesWorkflowPatchMatchTarget(payload, target, baseConfig)) return null;
  const patchValue = extractWorkflowPatchValue(payload, target);
  if (!patchValue) return null;
  const base = cloneValue(baseConfig as Record<string, any>);
  if (target.scope === 'workflow') {
    return replaceWorkflowInConfig(base, patchValue);
  }
  if (target.scope === 'state') {
    return target.reviewPolicyOnly
      ? patchReviewPolicyIntoConfig(base, patchValue, target)
      : patchStateIntoConfig(base, patchValue, target);
  }
  return patchStepIntoConfig(base, patchValue, target);
}

function buildScopeRules(target: DesignOptimizationTarget, hasSpecArtifacts: boolean): string[] {
  if (target.scope === 'workflow') {
    return [
      hasSpecArtifacts
        ? '- 允许根据当前 Spec 和需求调整状态、步骤拆分、Agent 分工、状态转移与 specTaskBinding。'
        : '- 允许根据当前需求和 workflow 配置调整状态、步骤拆分、Agent 分工与状态转移；禁止新增 specTaskBinding。',
      '- patch.workflow 是新的 workflow 对象；context.projectRoot、workspaceMode、executionPolicy、skills、mcpServers 等运行时设置由系统保留。',
      '- 第一版不支持重命名已有状态。带 reviewPolicy.locked=true 的状态不得修改 reviewPolicy 或 origin=review-policy 的托管步骤。',
      hasSpecArtifacts
        ? '- 保留已有的 preCommands、并发分组、人工审查和 supervisor 配置，除非用户要求或最新 Spec 明确冲突。'
        : '- 保留已有的 preCommands、并发分组、人工审查和 supervisor 配置，除非用户要求或当前需求明确冲突。',
    ];
  }
  if (target.scope === 'state') {
    if (target.reviewPolicyOnly) {
      return [
        `- 只重新评估状态 "${target.stateName}" 的 reviewPolicy。`,
        '- 只返回 mode、rationale、riskSignals、confidence；不得返回或修改状态名称、业务步骤、转移、ID、实例或 provenance。',
        '- 判断把握不足时选择 adversarial。步骤增删、角色和实例绑定由本地 reconciler 生成，模型不得编排。',
        '- patch.state 只包含 reviewPolicy 对象。',
      ];
    }
    return [
      `- 优化状态 "${target.stateName}"。`,
      `- 保持状态名称 "${target.stateName}" 不变。`,
      '- 如果 reviewPolicy.locked=true，不得修改 reviewPolicy 或 origin=review-policy 的托管步骤；系统也会在应用层强制回填。',
      '- 可以调整该状态的描述、内部步骤、Agent 选择、人工审查、最大自循环次数和转移规则；不要在步骤对象中写 skills。',
      '- patch.state 是这个状态对象；workflow mode、其他状态顺序、context 和运行时设置由系统保持原样。',
    ];
  }
  return [
    `- 优化状态 "${target.containerName}" 内的步骤 "${target.stepName}"。`,
    `- 保持该步骤在容器中的位置不变。`,
    hasSpecArtifacts
      ? '- 可以调整步骤的 agent、task、constraints、enableReviewPanel 与 specTaskBinding；不要在步骤对象中写 skills，技能归属 Agent 配置。'
      : '- 可以调整步骤的 agent、task、constraints、enableReviewPanel；禁止新增 specTaskBinding；不要在步骤对象中写 skills，技能归属 Agent 配置。',
    '- patch.step 是这个步骤对象；其他步骤、容器内容和 workflow mode 由系统保持原样。',
  ];
}

function buildPatchSchemaHint(target: DesignOptimizationTarget, configFile: string): string {
  const targetShape = target.scope === 'workflow'
    ? `"scope":"workflow","workflowMode":"${target.workflowMode}","patch":{"workflow":{完整 workflow 对象}}`
    : target.scope === 'state'
      ? target.reviewPolicyOnly
        ? `"scope":"state","workflowMode":"state-machine","patch":{"state":{"reviewPolicy":{"mode":"standard|adversarial","rationale":"具体理由","riskSignals":["风险"],"confidence":"high|medium|low"}}}`
        : `"scope":"state","workflowMode":"state-machine","patch":{"state":{完整状态对象}}`
      : `"scope":"step","workflowMode":"${target.workflowMode}","patch":{"step":{完整步骤对象}}`;
  return `{"kind":"${WORKFLOW_PATCH_ITEM_KIND}","data":{"filename":"${configFile}","summary":"一句话摘要",${targetShape}}}`;
}

export function buildDesignOptimizationPrompt(input: BuildDesignOptimizationPromptInput): string {
  const targetSnapshot = extractDesignOptimizationSnapshot(input.currentConfig, input.target);
  const workflowMode = getWorkflowMode(input.currentConfig);
  const specArtifacts = input.currentSpecArtifacts || { requirements: '', design: '', tasks: '' };
  const hasSpecArtifacts = Boolean(
    specArtifacts.requirements?.trim()
    || specArtifacts.design?.trim()
    || specArtifacts.tasks?.trim()
  );
  const lines = [
    hasSpecArtifacts
      ? '请基于当前最新 Spec、用户需求和当前工作流配置，生成一版工作流优化候选。'
      : '请基于用户需求、当前工作流配置、可用 Agent 和 Skills，生成一版工作流优化候选。',
    '你只生成候选 patch，不要声称已经保存；系统会先展示 diff，由用户确认后再应用。',
    `最终必须返回 kind="${WORKFLOW_PATCH_ITEM_KIND}" 的小 JSON。`,
    '',
    `当前优化目标：${getDesignOptimizationTargetLabel(input.target)}`,
    `工作流：${input.workflowName}`,
    `配置文件：${input.configFile}`,
    `工作流模式：${workflowMode}`,
    input.requirements ? `原始需求：${input.requirements}` : '',
    '',
    '范围规则：',
    ...buildScopeRules(input.target, hasSpecArtifacts),
    hasSpecArtifacts
      ? '- 如果需要引用 spec 任务，specTaskBinding.taskIds 只能使用下面列出的真实 task id。'
      : '- 当前没有 Spec 制品；不要新增 specTaskBinding，也不要把优化目标改成“创建/修订 Spec”。',
    '- 保持现有主语言、术语和重要命名风格一致。',
    '- 状态机 verdict 流向必须显式：pass / conditional_pass / fail 都只是转移条件枚举，下一步完全由当前状态 transitions 配置决定。不要根据名称假设 conditional_pass 一定前进或一定回退；优化时必须让目标状态和步骤说明保持一致。',
    '',
    '用户优化要求：',
    input.instruction.trim(),
    '',
    '当前目标快照：',
    '```json',
    stringifyForPrompt(targetSnapshot, input.target.scope === 'workflow' ? 18000 : 12000),
    '```',
    '',
    '当前完整 workflow 配置：',
    '```json',
    stringifyForPrompt(input.currentConfig, 24000),
    '```',
    '',
  ];

  if (hasSpecArtifacts) {
    lines.push(
      '',
      '当前 requirements.md：',
      '```markdown',
      truncateForPrompt(specArtifacts.requirements, 12000),
      '```',
      '',
      '当前 design.md：',
      '```markdown',
      truncateForPrompt(specArtifacts.design, 12000),
      '```',
      '',
      '当前 tasks.md：',
      '```markdown',
      truncateForPrompt(specArtifacts.tasks, 12000),
      '```',
    );
  } else {
    lines.push(
      '',
      'Spec 制品：当前工作流未绑定 Spec；优化必须直接围绕现有 workflow 和用户需求。',
    );
  }

  const executableAgents = (input.availableAgents || []).filter((agent) => (
    agent.roleType !== 'supervisor' && agent.team !== 'black-gold'
  ));
  if (executableAgents.length > 0) {
    lines.push(
      '',
      '可用普通执行 Agent：',
      formatAgentList(executableAgents),
      'Supervisor 或 black-gold Agent 只能负责调度，不得绑定到任何工作流步骤或对抗角色。',
    );
  }

  if (input.availableSkills && input.availableSkills.length > 0) {
    lines.push('', '可用 Skills：', formatSkillList(input.availableSkills));
  }

  if (input.specTasks && input.specTasks.length > 0) {
    lines.push('', '当前可绑定的叶子 Spec 任务：', formatSpecTaskList(input.specTasks));
  }

  lines.push(
    '',
    '输出要求：',
    '1. 可以先用 1-3 句简短说明优化思路。',
    '2. 最终必须在 <result>...</result> 内输出一个 JSON 对象，不要包 ```json 代码块。',
    `3. JSON 格式必须是 ${buildPatchSchemaHint(input.target, input.configFile)}。`,
    '4. patch 字段放当前目标作用域对应的对象。',
    '5. 输出 </result> 后不要追加任何文字。',
  );

  return lines.filter(Boolean).join('\n\n');
}

export function extractWorkflowPatchItemPayload(
  markdown: string,
  fallbackFilename?: string,
): { payload: WorkflowPatchPayload | null; parseError?: string } {
  const extracted = extractWorkflowPatchItemResult(markdown);
  if (!extracted.ok) {
    return { payload: null, parseError: extracted.error };
  }

  const data = extracted.result.data || {};
  const scope = data.scope === 'workflow' || data.scope === 'state' || data.scope === 'step'
    ? data.scope
    : undefined;
  const workflowMode = data.workflowMode === 'state-machine'
    ? 'state-machine'
    : undefined;
  const patch = data.patch && typeof data.patch === 'object' ? data.patch : null;
  const dataKeys = Object.keys(data || {});
  const describe = (value: unknown) => {
    if (value === undefined) return '未提供';
    if (value === null) return 'null';
    if (Array.isArray(value)) return `array(length=${value.length})`;
    if (typeof value === 'object') return `object(keys=${Object.keys(value as Record<string, unknown>).join(', ') || 'none'})`;
    return `${typeof value} ${JSON.stringify(value)}`;
  };
  if (!scope) {
    return {
      payload: null,
      parseError: [
        '错误字段：data.scope。',
        `问题：workflow_patch item 的 data.scope 必须是 workflow/state/step，当前值为 ${describe(data.scope)}；data keys=${dataKeys.join(', ') || 'none'}。`,
        '修改方式：按当前优化目标填写 "scope":"workflow"、"scope":"state" 或 "scope":"step"，并只返回该 scope 对应的 patch。',
      ].join(''),
    };
  }
  if (!workflowMode) {
    return {
      payload: null,
      parseError: [
        '错误字段：data.workflowMode。',
        `问题：workflow_patch item 的 data.workflowMode 必须是 state-machine，当前值为 ${describe(data.workflowMode)}。`,
        '修改方式：填写 "workflowMode":"state-machine"。',
      ].join(''),
    };
  }
  if (!patch) {
    return {
      payload: null,
      parseError: [
        '错误字段：data.patch。',
        `问题：workflow_patch item 的 data.patch 必须是对象，当前值为 ${describe(data.patch)}。`,
        '修改方式：在 data.patch 中放入当前 scope 对应的完整对象，例如 {"patch":{"state":{...}}} 或 {"patch":{"step":{...}}}。',
      ].join(''),
    };
  }
  const expectedKey = scope === 'workflow' ? 'workflow' : scope === 'state' ? 'state' : 'step';
  if (!patch[expectedKey] || typeof patch[expectedKey] !== 'object') {
    return {
      payload: null,
      parseError: [
        `错误字段：data.patch.${expectedKey}。`,
        `问题：当前 scope="${scope}" 要求 data.patch.${expectedKey} 是对象；当前 patch keys=${Object.keys(patch).join(', ') || 'none'}，当前值为 ${describe(patch[expectedKey])}。`,
        `修改方式：保留 scope="${scope}"，并把目标对象放到 data.patch.${expectedKey}；不要放到其他 key。`,
      ].join(''),
    };
  }

  return {
    payload: {
      filename: typeof data.filename === 'string' && data.filename.trim() ? data.filename.trim() : fallbackFilename,
      summary: typeof data.summary === 'string' ? data.summary : '',
      scope,
      workflowMode,
      patch,
    },
  };
}

export function workflowOptimizationModesMatch(
  baseConfig: UnifiedWorkflowConfig | Record<string, any>,
  payload: WorkflowPatchPayload | null | undefined,
  target?: DesignOptimizationTarget,
): boolean {
  const expectedMode = target?.workflowMode || getWorkflowMode(baseConfig);
  const actualMode = payload?.workflowMode || expectedMode;
  return expectedMode === actualMode;
}

export function extractWorkflowStepAt(
  config: UnifiedWorkflowConfig | Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'step' }>,
): WorkflowStep | null {
  const snapshot = extractDesignOptimizationSnapshot(config, target);
  return snapshot && typeof snapshot === 'object' ? (snapshot as WorkflowStep) : null;
}

export function extractWorkflowStateAt(
  config: UnifiedWorkflowConfig | Record<string, any>,
  target: Extract<DesignOptimizationTarget, { scope: 'state' }>,
): StateMachineState | null {
  const snapshot = extractDesignOptimizationSnapshot(config, target);
  return snapshot && typeof snapshot === 'object' ? (snapshot as StateMachineState) : null;
}
