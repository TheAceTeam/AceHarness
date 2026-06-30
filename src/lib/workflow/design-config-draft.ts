import type { WorkflowAgentExecutionOverride } from '@/lib/core/schemas';

export interface WorkflowDesignDraftState {
  projectRoot: string;
  workspaceMode: 'isolated-copy' | 'in-place';
  requirements: string;
  timeoutMinutes: number;
  engine: string;
  workflowDefaultModel: string;
  workflowAutoCompactOnStepChange: boolean;
  workflowAgentOverrides: Record<string, WorkflowAgentExecutionOverride>;
  skills: string[];
  mcpServers: string[];
  ragKnowledgeBases?: string[];
}

type WorkflowDesignConfigLike = {
  context?: Record<string, unknown>;
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
  return {
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
