import type {
  SpecCodingDocument,
  SpecCodingTask,
  SpecTaskBinding,
  UnifiedWorkflowConfig,
  WorkflowStep,
} from '@/lib/core/schemas';

export type StepTaskBindingSource = 'explicit' | 'auto-title' | 'auto-index' | 'auto-container' | 'missing';

export interface WorkflowStepRef {
  stepKey: string;
  containerKey: string;
  containerName: string;
  containerIndex: number;
  stepIndex: number;
  stepName: string;
  agent: string;
  phaseId?: string;
  step: WorkflowStep & { id?: string };
}

export interface LeafSpecTaskRef {
  id: string;
  title: string;
  phaseId?: string;
  ownerAgents: string[];
  task: SpecCodingTask;
}

export interface StepTaskBindingSnapshot {
  stepKey: string;
  containerName: string;
  stepName: string;
  agent: string;
  taskIds: string[];
  requirementIds: string[];
  artifactKeys: string[];
  source: StepTaskBindingSource;
}

export interface StepTaskBindingValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  bindings: StepTaskBindingSnapshot[];
  uncoveredTaskIds: string[];
  unboundStepKeys: string[];
  invalidTaskIds: string[];
  checkedAt: string;
}

export interface CompileStepTaskBindingOptions {
  /**
   * When true, every workflow step must provide a valid specTaskBinding in the
   * input config. The compiler may still populate fallback bindings for preview,
   * but validation will fail so the creator can ask the draft author to repair it.
   */
  requireExplicit?: boolean;
  /**
   * When true, every leaf task in tasks.md must be covered by at least one
   * workflow step binding. Uncovered tasks become validation errors.
   */
  requireFullCoverage?: boolean;
}

export function getSpecTaskBindingIds(binding?: SpecTaskBinding | null): string[] {
  if (!binding) return [];
  const ids = [
    ...(((binding as any).taskIds || []) as string[]),
    binding.taskId,
  ];
  return Array.from(new Set(ids
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter(Boolean)));
}

export function getWorkflowStepRefs(config: UnifiedWorkflowConfig | Record<string, any>): WorkflowStepRef[] {
  const workflow = (config as any)?.workflow || {};
  if (Array.isArray(workflow.states)) {
    return workflow.states.flatMap((state: any, stateIndex: number) => {
      const containerName = String(state?.name || `state-${stateIndex + 1}`);
      const phaseId = typeof state?.specPhaseId === 'string' ? state.specPhaseId : undefined;
      return (Array.isArray(state?.steps) ? state.steps : []).map((step: any, stepIndex: number) => {
        const stepName = String(step?.name || `step-${stepIndex + 1}`);
        const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : undefined;
        return {
          stepKey: stepId || `state:${containerName}#${stepIndex + 1}:${stepName}`,
          containerKey: `state:${containerName}`,
          containerName,
          containerIndex: stateIndex,
          stepIndex,
          stepName,
          agent: String(step?.agent || ''),
          phaseId,
          step,
        };
      });
    });
  }

  if (Array.isArray(workflow.phases)) {
    return workflow.phases.flatMap((phase: any, phaseIndex: number) => {
      const containerName = String(phase?.name || `phase-${phaseIndex + 1}`);
      return (Array.isArray(phase?.steps) ? phase.steps : []).map((step: any, stepIndex: number) => {
        const stepName = String(step?.name || `step-${stepIndex + 1}`);
        const stepId = typeof step?.id === 'string' && step.id.trim() ? step.id.trim() : undefined;
        return {
          stepKey: stepId || `phase:${containerName}#${stepIndex + 1}:${stepName}`,
          containerKey: `phase:${containerName}`,
          containerName,
          containerIndex: phaseIndex,
          stepIndex,
          stepName,
          agent: String(step?.agent || ''),
          phaseId: undefined,
          step,
        };
      });
    });
  }

  return [];
}

export function getLeafSpecTaskRefs(specCoding?: SpecCodingDocument | null): LeafSpecTaskRef[] {
  const result: LeafSpecTaskRef[] = [];
  const walk = (tasks: SpecCodingTask[]) => {
    for (const task of tasks || []) {
      const children = task.children || [];
      if (children.length > 0) {
        walk(children);
      } else {
        result.push({
          id: task.id,
          title: task.title,
          phaseId: task.phaseId,
          ownerAgents: task.ownerAgents || [],
          task,
        });
      }
    }
  };
  walk(specCoding?.tasks || []);
  return result;
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[\s_\-:：,，.。/\\()[\]【】]+/g, '');
}

function containerPhaseId(ref: WorkflowStepRef, specCoding?: SpecCodingDocument | null): string | undefined {
  if (ref.phaseId) return ref.phaseId;
  const byTitle = specCoding?.phases.find((phase) => phase.title === ref.containerName);
  if (byTitle) return byTitle.id;
  return specCoding?.phases[ref.containerIndex]?.id;
}

function chooseAutoBinding(
  ref: WorkflowStepRef,
  refsInContainer: WorkflowStepRef[],
  leafTasks: LeafSpecTaskRef[],
  specCoding?: SpecCodingDocument | null,
): { taskIds: string[]; source: StepTaskBindingSource } {
  const phaseId = containerPhaseId(ref, specCoding);
  const phaseTasks = phaseId ? leafTasks.filter((task) => task.phaseId === phaseId) : [];
  const candidateTasks = phaseTasks.length > 0 ? phaseTasks : leafTasks;
  if (candidateTasks.length === 0) return { taskIds: [], source: 'missing' };

  const normalizedStepName = normalizeText(ref.stepName);
  const titleMatch = candidateTasks.find((task) => {
    const normalizedTaskTitle = normalizeText(task.title);
    return normalizedTaskTitle.includes(normalizedStepName) || normalizedStepName.includes(normalizedTaskTitle);
  });
  if (titleMatch) return { taskIds: [titleMatch.id], source: 'auto-title' };

  const agentTasks = candidateTasks.filter((task) => ref.agent && task.ownerAgents.includes(ref.agent));
  if (agentTasks.length === 1) return { taskIds: [agentTasks[0].id], source: 'auto-container' };

  if (candidateTasks.length >= refsInContainer.length && candidateTasks[ref.stepIndex]) {
    return { taskIds: [candidateTasks[ref.stepIndex].id], source: 'auto-index' };
  }

  return { taskIds: [candidateTasks[Math.min(ref.stepIndex, candidateTasks.length - 1)].id], source: 'auto-container' };
}

export function compileStepTaskBindings(
  config: UnifiedWorkflowConfig | Record<string, any>,
  specCoding?: SpecCodingDocument | null,
  options: CompileStepTaskBindingOptions = {},
): { config: any; validation: StepTaskBindingValidation } {
  const cloned = JSON.parse(JSON.stringify(config || {}));
  const refs = getWorkflowStepRefs(cloned);
  const leafTasks = getLeafSpecTaskRefs(specCoding);
  const validTaskIds = new Set(leafTasks.map((task) => task.id));
  const refsByContainer = new Map<string, WorkflowStepRef[]>();
  for (const ref of refs) {
    refsByContainer.set(ref.containerKey, [...(refsByContainer.get(ref.containerKey) || []), ref]);
  }

  const bindings: StepTaskBindingSnapshot[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const invalidTaskIds: string[] = [];
  const unboundStepKeys: string[] = [];
  const covered = new Set<string>();

  for (const ref of refs) {
    const existingIds = getSpecTaskBindingIds(ref.step.specTaskBinding);
    const validExistingIds = existingIds.filter((id) => validTaskIds.has(id));
    const invalidExistingIds = existingIds.filter((id) => !validTaskIds.has(id));
    if (invalidExistingIds.length > 0) {
      invalidTaskIds.push(...invalidExistingIds);
      const message = `${ref.stepKey} 绑定了不存在的 tasks.md taskId: ${invalidExistingIds.join(', ')}`;
      if (options.requireExplicit) errors.push(message);
      else warnings.push(message);
    }

    const chosen = validExistingIds.length > 0
      ? { taskIds: validExistingIds, source: 'explicit' as const }
      : chooseAutoBinding(ref, refsByContainer.get(ref.containerKey) || [ref], leafTasks, specCoding);

    if (chosen.taskIds.length === 0) {
      unboundStepKeys.push(ref.stepKey);
      errors.push(`${ref.stepKey} 没有可绑定的 tasks.md 任务`);
    } else if (options.requireExplicit && validExistingIds.length === 0) {
      unboundStepKeys.push(ref.stepKey);
      errors.push(`${ref.stepKey} 必须在 workflow_draft.config 中显式提供 specTaskBinding.taskIds，不能依赖系统自动推断`);
    } else if (chosen.source !== 'explicit') {
      warnings.push(`${ref.stepKey} 已由系统自动绑定 tasks.md taskId: ${chosen.taskIds.join(', ')}`);
    }

    const requirementIds = ref.step.specTaskBinding?.requirementIds || [];
    const artifactKeys = ref.step.specTaskBinding?.artifactKeys || [];
    ref.step.specTaskBinding = chosen.taskIds.length > 0
      ? {
          taskId: chosen.taskIds[0],
          taskIds: chosen.taskIds,
          requirementIds,
          artifactKeys,
        }
      : undefined;

    for (const id of chosen.taskIds) covered.add(id);
    bindings.push({
      stepKey: ref.stepKey,
      containerName: ref.containerName,
      stepName: ref.stepName,
      agent: ref.agent,
      taskIds: chosen.taskIds,
      requirementIds,
      artifactKeys,
      source: chosen.source,
    });
  }

  const uncoveredTaskIds = leafTasks.map((task) => task.id).filter((id) => !covered.has(id));
  if (uncoveredTaskIds.length > 0) {
    const message = `以下 tasks.md 叶子任务尚未被 workflow step 覆盖: ${uncoveredTaskIds.join(', ')}`;
    if (options.requireFullCoverage) errors.push(message);
    else warnings.push(message);
  }

  return {
    config: cloned,
    validation: {
      ok: errors.length === 0,
      errors,
      warnings,
      bindings,
      uncoveredTaskIds,
      unboundStepKeys,
      invalidTaskIds: Array.from(new Set(invalidTaskIds)),
      checkedAt: new Date().toISOString(),
    },
  };
}

export function validateStepTaskBindings(
  config: UnifiedWorkflowConfig | Record<string, any>,
  specCoding?: SpecCodingDocument | null,
): StepTaskBindingValidation {
  return compileStepTaskBindings(config, specCoding).validation;
}
