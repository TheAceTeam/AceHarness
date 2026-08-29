import type { WorkflowAgentExecutionOverride } from '@/lib/core/schemas';
import { normalizeLightweightWorkflowConfig } from '@/lib/workflow/lightweight';
import { materializeStateLevelReviewAdoption } from '@/lib/workflow/state-review-policy';

export interface WorkflowDesignDraftState {
  projectRoot: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  requirements: string;
  timeoutMinutes: number;
  engine: string;
  workflowDefaultModel: string;
  workflowAutoCompactOnStepChange: boolean;
  /** Supervisor 是否参与本工作流；关闭后阶段审阅与检查点建议都不会发起。 */
  workflowSupervisorEnabled: boolean;
  workflowAgentOverrides: Record<string, WorkflowAgentExecutionOverride>;
  skills: string[];
  mcpServers: string[];
  ragKnowledgeBases?: string[];
}

type WorkflowDesignConfigLike = {
  context?: Record<string, unknown>;
  workflow?: Record<string, unknown>;
  [key: string]: unknown;
};

export function normalizeWorkflowAgentOverridesForSave(
  overrides: Record<string, WorkflowAgentExecutionOverride> | undefined,
): Record<string, { enabled: true; engine?: string; model?: string }> {
  return Object.fromEntries(
    Object.entries(overrides || {})
      .filter(([, value]) => value?.enabled)
      .map(([name, value]) => [name, {
        enabled: true,
        engine: value.engine || undefined,
        model: value.model || undefined,
      }]),
  );
}

export function buildWorkflowDesignConfigForSave<T extends WorkflowDesignConfigLike>(
  baseConfig: T,
  draftState: WorkflowDesignDraftState,
): T {
  const ragKnowledgeBases = Array.isArray(draftState.ragKnowledgeBases) ? [...draftState.ragKnowledgeBases] : [];
  const skills = Array.isArray(draftState.skills) ? [...draftState.skills] : [];
  if (ragKnowledgeBases.length > 0 && !skills.includes('aceharness-rag')) skills.push('aceharness-rag');
  const draftConfig = {
    ...baseConfig,
    context: {
      ...(baseConfig.context || {}),
      projectRoot: draftState.projectRoot,
      workspaceMode: draftState.workspaceMode,
      requirements: draftState.requirements,
      timeoutMinutes: draftState.timeoutMinutes,
      engine: draftState.engine || undefined,
      executionPolicy: {
        defaultEngine: draftState.engine || undefined,
        defaultModel: draftState.workflowDefaultModel || undefined,
        autoCompactOnStepChange: draftState.workflowAutoCompactOnStepChange,
        agentOverrides: normalizeWorkflowAgentOverridesForSave(draftState.workflowAgentOverrides),
      },
      skills,
      mcpServers: Array.isArray(draftState.mcpServers) ? [...draftState.mcpServers] : [],
      capabilitySkills: {
        ...((baseConfig.context as any)?.capabilitySkills || {}),
        rag: {
          ...(((baseConfig.context as any)?.capabilitySkills || {}).rag || {}),
          enabled: ragKnowledgeBases.length > 0,
          knowledgeBases: ragKnowledgeBases,
          topK: Number((((baseConfig.context as any)?.capabilitySkills || {}).rag || {}).topK || 8),
          allowAgentQuery: true,
          autoInject: false,
        },
      },
    },
  } as T;
  const supervisorApplied = applySupervisorToggle(draftConfig, draftState.workflowSupervisorEnabled);
  // 轻量工作流不支持 Supervisor，必须让轻量规范化最后收口，避免界面开关把它重新写回。
  return materializeStateLevelReviewAdoption(normalizeLightweightWorkflowConfig(supervisorApplied));
}

/**
 * 把界面上的 Supervisor 开关写回 `workflow.supervisor`。
 *
 * 打开时连带把阶段审阅与检查点建议一起打开——只置 `enabled` 的话 Supervisor 虽然
 * 「开着」却什么都不做，对用户是个陷阱。关闭时只置 `enabled: false` 就够，它是总闸。
 * 轻量工作流不走 Supervisor，没有 workflow 段时原样返回。
 */
function applySupervisorToggle<T extends WorkflowDesignConfigLike>(config: T, enabled: boolean): T {
  const workflow = config.workflow;
  if (!workflow || typeof workflow !== 'object') return config;
  const existing = (workflow as any).supervisor;
  if (!enabled && !existing) return config;
  const supervisor = {
    agent: 'default-supervisor',
    ...(existing && typeof existing === 'object' ? existing : {}),
    enabled,
    ...(enabled ? { stageReviewEnabled: true, checkpointAdviceEnabled: true } : {}),
  };
  return { ...config, workflow: { ...workflow, supervisor } };
}

function normalizeComparableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, normalizeComparableValue(nestedValue)]),
    );
  }
  return value;
}

export function serializeComparableWorkflowDesignConfig(value: unknown): string {
  return JSON.stringify(normalizeComparableValue(value));
}

export function hasWorkflowDesignDraftChanges(
  persistedConfig: WorkflowDesignConfigLike | null | undefined,
  draftConfig: WorkflowDesignConfigLike | null | undefined,
): boolean {
  if (!persistedConfig || !draftConfig) return false;
  return serializeComparableWorkflowDesignConfig(persistedConfig)
    !== serializeComparableWorkflowDesignConfig(draftConfig);
}
