export interface WorkflowRunBindingLike {
  configFile: string;
  runId: string;
  supervisorAgent?: string;
  supervisorSessionId?: string | null;
  attachedAgentSessions?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface WorkflowCreationBindingLike {
  creationSessionId: string;
  filename: string;
  workflowName: string;
  status: 'draft' | 'confirmed' | 'config-generated' | 'run-bound' | 'archived';
  openSpecId: string;
  createdAt: number;
  updatedAt: number;
}

export interface ChatSessionSummaryLike {
  id: string;
  title: string;
  updatedAt: number;
  messageCount: number;
  lastMessage?: string;
  creationSession?: WorkflowCreationBindingLike;
  workflowBinding?: WorkflowRunBindingLike;
}

export interface WorkflowConversationDirectoryEntry {
  key: string;
  label: string;
  role: 'Supervisor' | 'Agent';
  sessionId: string | null;
  sessionStatus: 'connected' | 'pending';
}

export function buildWorkflowConversationDirectory(
  binding?: WorkflowRunBindingLike | null
): WorkflowConversationDirectoryEntry[] {
  if (!binding) return [];

  const entries: WorkflowConversationDirectoryEntry[] = [];
  const attached = binding.attachedAgentSessions || {};
  const supervisorName = binding.supervisorAgent || 'default-supervisor';
  const supervisorSessionId = binding.supervisorSessionId
    || attached[supervisorName]
    || null;

  entries.push({
    key: 'supervisor',
    label: supervisorName,
    role: 'Supervisor',
    sessionId: supervisorSessionId,
    sessionStatus: supervisorSessionId ? 'connected' : 'pending',
  });

  const agentNames = Object.keys(attached)
    .filter((agentName) => agentName && agentName !== supervisorName)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'));

  for (const agentName of agentNames) {
    const sessionId = attached[agentName] || null;
    entries.push({
      key: agentName,
      label: agentName,
      role: 'Agent',
      sessionId,
      sessionStatus: sessionId ? 'connected' : 'pending',
    });
  }

  return entries;
}

export function listWorkbenchSessions<T extends ChatSessionSummaryLike>(
  sessions: T[]
): T[] {
  return sessions
    .filter((session) => session.workflowBinding || session.creationSession)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getWorkbenchSessionKind(
  session: Pick<ChatSessionSummaryLike, 'workflowBinding' | 'creationSession'>
): 'run' | 'creation' | 'plain' {
  if (session.workflowBinding) return 'run';
  if (session.creationSession) return 'creation';
  return 'plain';
}

export function getConversationSessionStatusLabel(
  entry: Pick<WorkflowConversationDirectoryEntry, 'sessionStatus'>
): string {
  return entry.sessionStatus === 'connected' ? '已绑定会话' : '等待首次对话';
}

export function getCreationSessionStatusLabel(
  status?: WorkflowCreationBindingLike['status']
): string {
  if (!status) return '未开始';
  const labels: Record<WorkflowCreationBindingLike['status'], string> = {
    draft: '草稿',
    confirmed: '已确认',
    'config-generated': '已生成配置',
    'run-bound': '已绑定运行',
    archived: '已归档',
  };
  return labels[status];
}

export function sessionInvolvesAgent(
  session: Pick<ChatSessionSummaryLike, 'workflowBinding'>,
  agentName: string
): boolean {
  if (!session.workflowBinding || !agentName) return false;
  const supervisorName = session.workflowBinding.supervisorAgent || 'default-supervisor';
  if (supervisorName === agentName) return true;
  return Boolean(session.workflowBinding.attachedAgentSessions?.[agentName]);
}

export function listSessionsForAgent<T extends ChatSessionSummaryLike>(
  sessions: T[],
  agentName: string
): T[] {
  return sessions
    .filter((session) => sessionInvolvesAgent(session, agentName))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function listSessionsForWorkflow<T extends ChatSessionSummaryLike>(
  sessions: T[],
  configFile: string
): T[] {
  return sessions
    .filter((session) => session.workflowBinding?.configFile === configFile)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function resolveWorkflowChatSessionId(input: {
  agentName: string;
  workflowBinding?: WorkflowRunBindingLike | null;
  runtimeSessionId?: string | null;
  agentSessionId?: string | null;
}): string | null {
  const { agentName, workflowBinding, runtimeSessionId, agentSessionId } = input;
  if (runtimeSessionId) return runtimeSessionId;
  if (workflowBinding?.supervisorAgent === agentName && workflowBinding.supervisorSessionId) {
    return workflowBinding.supervisorSessionId;
  }
  if (workflowBinding?.attachedAgentSessions?.[agentName]) {
    return workflowBinding.attachedAgentSessions[agentName] || null;
  }
  return agentSessionId || null;
}

export function resolveAgentConversationSession(input: {
  mode: 'standalone-chat' | 'workflow-chat';
  agentName: string;
  workflowBinding?: WorkflowRunBindingLike | null;
  runtimeSessionId?: string | null;
  agentSessionId?: string | null;
}): {
  sessionId: string | null;
  reusePolicy: string;
} {
  if (input.mode === 'workflow-chat') {
    return {
      sessionId: resolveWorkflowChatSessionId(input),
      reusePolicy: 'workflow-chat 优先复用 run 绑定会话；不存在时才退回角色已有会话。',
    };
  }

  return {
    sessionId: input.agentSessionId || null,
    reusePolicy: 'standalone-chat 仅复用角色独立会话，不继承 run 绑定会话。',
  };
}
