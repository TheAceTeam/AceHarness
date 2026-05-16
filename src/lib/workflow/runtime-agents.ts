import type { StateMachineWorkflowConfig, WorkflowConfig } from '@/lib/core/schemas';

export function collectWorkflowRuntimeAgentNames(
  workflowConfig: WorkflowConfig | StateMachineWorkflowConfig | Record<string, any> | null | undefined,
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

  if (Array.isArray(workflow.phases)) {
    for (const phase of workflow.phases) {
      for (const step of phase?.steps || []) {
        pushName(step?.agent);
      }
    }
  }

  if (Array.isArray(workflow.states)) {
    for (const state of workflow.states) {
      for (const step of state?.steps || []) {
        pushName(step?.agent);
      }
    }
  }

  for (const instance of workflow.concurrency?.agentInstances || []) {
    pushName(instance?.id);
  }

  return Array.from(names);
}
