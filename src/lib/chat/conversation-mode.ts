import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import { isActiveWorkflowRunStatus } from '@/lib/workflow/run-status';

export type HomeConversationMode = NonNullable<SessionWorkbenchState['conversationMode']>;

export interface ConversationModeSessionLike {
  conversationMode?: HomeConversationMode | null;
  workflowBinding?: { runId?: string | null } | null;
  sessionWorkbenchState?: SessionWorkbenchState | null;
}

export function resolveConversationMode(
  session?: ConversationModeSessionLike | null,
  options?: {
    runStatusById?: Record<string, string | undefined>;
    persistedRunStatus?: string | null;
  }
): HomeConversationMode {
  const explicit = session?.conversationMode || session?.sessionWorkbenchState?.conversationMode;
  if (explicit === 'plain' || explicit === 'agent-chat' || explicit === 'workflow-running' || explicit === 'workflow-completed') {
    return explicit;
  }

  const embeddedRunId = String(session?.sessionWorkbenchState?.embeddedWorkflow?.runId || '').trim();
  const runId = String(session?.workflowBinding?.runId || embeddedRunId || '').trim();
  const runStatus = runId
    ? options?.runStatusById?.[runId] || options?.persistedRunStatus || null
    : null;
  if (runId) {
    return isActiveWorkflowRunStatus(runStatus) ? 'workflow-running' : 'workflow-completed';
  }

  if (session?.sessionWorkbenchState?.collaborationRoom) {
    return 'agent-chat';
  }

  return 'plain';
}

export function normalizeSessionWorkbenchConversationMode<T extends ConversationModeSessionLike>(
  session: T,
  options?: {
    runStatusById?: Record<string, string | undefined>;
    persistedRunStatus?: string | null;
  }
): T & { conversationMode: HomeConversationMode; sessionWorkbenchState?: SessionWorkbenchState | null } {
  const conversationMode = resolveConversationMode(session, options);
  return {
    ...session,
    conversationMode,
    sessionWorkbenchState: {
      ...(session.sessionWorkbenchState || {}),
      conversationMode,
    },
  };
}
