export function countWorkflowSteps(config: any): number {
  const phases = Array.isArray(config?.workflow?.phases) ? config.workflow.phases : [];
  const states = Array.isArray(config?.workflow?.states) ? config.workflow.states : [];
  const items = phases.length > 0 ? phases : states;
  return items.reduce((sum: number, item: any) => sum + (Array.isArray(item?.steps) ? item.steps.length : 0), 0);
}
