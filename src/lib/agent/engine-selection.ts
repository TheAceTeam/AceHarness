import type { ContextConfig, RoleConfig, WorkflowExecutionPolicy } from '@/lib/core/schemas';

export interface GlobalEngineSelection {
  engine?: string;
  defaultModel?: string;
}

export interface ResolvedAgentSelection {
  configuredEngine: string;
  effectiveEngine: string;
  effectiveModel: string;
  followsSystem: boolean;
}

function findFirstConfiguredModel(engineModels: Record<string, string>): string {
  return Object.values(engineModels).find(Boolean) || '';
}

export function resolveAgentSelection(
  roleConfig: Pick<RoleConfig, 'engineModels' | 'activeEngine'> | null | undefined,
  globalSelection?: GlobalEngineSelection,
  workflowEngine?: string,
): ResolvedAgentSelection {
  const engineModels = roleConfig?.engineModels || {};
  const configuredEngine = roleConfig?.activeEngine ?? '';
  const followsSystem = configuredEngine === '';
  const effectiveEngine = workflowEngine || (followsSystem ? (globalSelection?.engine || '') : configuredEngine);
  const fallbackModel = findFirstConfiguredModel(engineModels) || globalSelection?.defaultModel || '';
  const effectiveModel = followsSystem
    ? (globalSelection?.defaultModel || fallbackModel)
    : (engineModels[configuredEngine] || fallbackModel);

  return {
    configuredEngine,
    effectiveEngine,
    effectiveModel,
    followsSystem,
  };
}

export interface WorkflowSelectionOptions {
  agentName?: string;
  workflowContext?: Pick<ContextConfig, 'engine' | 'executionPolicy'> | null | undefined;
}

export function resolveWorkflowExecutionPolicy(
  workflowContext?: Pick<ContextConfig, 'engine' | 'executionPolicy'> | null,
): WorkflowExecutionPolicy {
  return {
    defaultEngine: workflowContext?.executionPolicy?.defaultEngine || workflowContext?.engine || '',
    defaultModel: workflowContext?.executionPolicy?.defaultModel || '',
    autoCompactOnStepChange: workflowContext?.executionPolicy?.autoCompactOnStepChange === true,
    agentOverrides: workflowContext?.executionPolicy?.agentOverrides || {},
  };
}

export function resolveWorkflowAgentSelection(
  roleConfig: Pick<RoleConfig, 'name' | 'engineModels' | 'activeEngine'> | null | undefined,
  globalSelection?: GlobalEngineSelection,
  options?: WorkflowSelectionOptions,
): ResolvedAgentSelection {
  const workflowPolicy = resolveWorkflowExecutionPolicy(options?.workflowContext);
  const agentName = options?.agentName || roleConfig?.name || '';
  const override = agentName ? workflowPolicy.agentOverrides?.[agentName] : undefined;
  const baseSelection = resolveAgentSelection(roleConfig, globalSelection, workflowPolicy.defaultEngine || undefined);
  const engineModels = roleConfig?.engineModels || {};
  const fallbackModel = findFirstConfiguredModel(engineModels) || globalSelection?.defaultModel || '';
  const hasWorkflowPolicy = Boolean(workflowPolicy.defaultEngine || workflowPolicy.defaultModel || Object.keys(workflowPolicy.agentOverrides || {}).length > 0);

  if (override?.enabled) {
    const effectiveEngine = override.engine || workflowPolicy.defaultEngine || baseSelection.effectiveEngine;
    const effectiveModel = override.model
      || (effectiveEngine ? engineModels[effectiveEngine] : '')
      || workflowPolicy.defaultModel
      || globalSelection?.defaultModel
      || fallbackModel;
    return {
      configuredEngine: override.engine || '',
      effectiveEngine,
      effectiveModel,
      followsSystem: false,
    };
  }

  if (hasWorkflowPolicy) {
    const effectiveEngine = workflowPolicy.defaultEngine || baseSelection.effectiveEngine;
    const effectiveModel = workflowPolicy.defaultModel
      || (effectiveEngine ? engineModels[effectiveEngine] : '')
      || globalSelection?.defaultModel
      || fallbackModel;
    return {
      configuredEngine: '',
      effectiveEngine,
      effectiveModel,
      followsSystem: true,
    };
  }

  return baseSelection;
}
