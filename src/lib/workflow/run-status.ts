const ACTIVE_WORKFLOW_RUN_STATUSES = new Set([
  'preparing',
  'pending',
  'starting',
  'running',
  'waiting',
  'waiting-human',
  'waiting-approval',
]);

export function isActiveWorkflowRunStatus(status?: string | null): boolean {
  return ACTIVE_WORKFLOW_RUN_STATUSES.has(String(status || '').trim());
}

export function isRunningWorkflowConversation(input: {
  conversationMode?: string | null;
  workflowBinding?: { runId?: string | null } | null;
  runStatusById?: Record<string, string | undefined>;
  persistedRunStatus?: string | null;
}): boolean {
  if (input.conversationMode === 'workflow-running') return true;
  const runId = String(input.workflowBinding?.runId || '').trim();
  if (!runId) return false;
  const liveStatus = input.runStatusById?.[runId];
  return isActiveWorkflowRunStatus(liveStatus || input.persistedRunStatus);
}
