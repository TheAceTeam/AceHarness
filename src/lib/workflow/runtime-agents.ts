import type { StateMachineWorkflowConfig } from '@/lib/core/schemas';

export function collectWorkflowRuntimeAgentNames(
  workflowConfig: StateMachineWorkflowConfig | Record<string, any> | null | undefined,
  supervisorAgent?: string | null,
): string[] {
  const names = new Set<string>();
  const pushName = (value: unknown) => {
    const name = typeof value === 'string' ? value.trim() : '';
    if (name) names.add(name);
  };

  pushName(supervisorAgent);

  const workflow = workflowConfig?.workflow as Record<string, any> | undefined;
  if (!workflow || typeof workflow !== 'object') {
    return Array.from(names);
  }

  pushName(workflow.supervisor?.agent);

  if (Array.isArray(workflow.states)) {
    for (const state of workflow.states) {
      for (const step of state?.steps || []) {
        const hasStepConcurrency = Boolean(step?.concurrency?.groupId || step?.parallelGroup);
        pushName(hasStepConcurrency ? (step?.agentInstanceId || step?.agent) : step?.agent);
      }
    }
  }

  return Array.from(names);
}
