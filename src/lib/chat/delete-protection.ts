import { resolveConversationMode, type ConversationModeSessionLike } from '@/lib/chat/conversation-mode';
import { loadRunState } from '@/lib/run/state-persistence';
import { isActiveWorkflowRunStatus } from '@/lib/workflow/run-status';

export async function isProtectedRunningWorkflowSession(session: ConversationModeSessionLike): Promise<boolean> {
  if (resolveConversationMode(session) === 'workflow-running') return true;
  const runId = typeof session?.workflowBinding?.runId === 'string'
    ? session.workflowBinding.runId.trim()
    : '';
  if (!runId) return false;
  const runState = await loadRunState(runId).catch(() => null);
  return isActiveWorkflowRunStatus(runState?.status || null);
}
