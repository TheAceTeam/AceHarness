export function countWorkflowSteps(config: any): number {
  const states = Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
  return states.reduce((sum: number, state: any) => sum + (Array.isArray(state?.steps) ? state.steps.length : 0), 0);
}
