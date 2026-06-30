import type { ReactNode } from 'react';
import type { ChatSession } from '@/contexts/ChatContext';
import type { HomeConversationMode } from '@/lib/chat/conversation-mode';
import type { useWorkflowLiveState } from '@/lib/workflow/live-store';
import type { SessionWorkbenchState } from '@/lib/core/home-sidebar-state';
import WorkflowRuntimeRightRail from '@/components/chat/WorkflowRuntimeRightRail';

export type ConversationRightRailDataSource =
  | 'chat-stream'
  | 'workflow-status'
  | 'workflow-events'
  | 'human-questions'
  | 'workspace-changes';

export type ConversationRightRailPermission =
  | 'read-chat'
  | 'read-workflow'
  | 'answer-human-question'
  | 'control-workflow'
  | 'read-workspace';

export interface ConversationRightRailContext {
  session: ChatSession | null;
  mode: HomeConversationMode;
  live: ReturnType<typeof useWorkflowLiveState>;
  setSessionWorkbenchState?: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
}

export interface ConversationRightRailPlugin {
  id: string;
  title: string;
  icon: string;
  priority: number;
  modes: HomeConversationMode[];
  permissions?: ConversationRightRailPermission[];
  subscribe?: (context: ConversationRightRailContext) => ConversationRightRailDataSource[];
  shouldActivate: (context: ConversationRightRailContext) => boolean;
  render: (context: ConversationRightRailContext) => ReactNode;
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/50 bg-background/55 px-3 py-2 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right text-foreground">{value}</span>
    </div>
  );
}

export function ConversationRightRailEmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border/70 p-4 text-center text-xs text-muted-foreground">
      {text}
    </div>
  );
}

export function createBuiltInConversationRightRailPlugins(legacyPanel?: ReactNode): ConversationRightRailPlugin[] {
  const plugins: ConversationRightRailPlugin[] = [
    {
      id: 'workflow-monitor',
      title: '工作流',
      icon: 'account_tree',
      priority: 100,
      modes: ['plain', 'agent-chat', 'workflow-drafting', 'workflow-running', 'workflow-completed'],
      permissions: ['read-workflow', 'answer-human-question', 'control-workflow'],
      subscribe: () => ['workflow-status', 'workflow-events', 'human-questions', 'chat-stream'],
      shouldActivate: ({ session, mode }) => {
        const binding = session?.workflowBinding;
        const embeddedWorkflow = session?.sessionWorkbenchState?.embeddedWorkflow;
        const hasRunContext = Boolean(
          (binding?.configFile && binding?.runId)
          || (embeddedWorkflow?.configFile && embeddedWorkflow?.runId)
        );
        return hasRunContext || mode === 'workflow-running' || mode === 'workflow-completed';
      },
      render: ({ session, live }) => {
        const binding = session?.workflowBinding;
        const embeddedWorkflow = session?.sessionWorkbenchState?.embeddedWorkflow;
        const configFile = binding?.configFile || embeddedWorkflow?.configFile || '';
        const runId = binding?.runId || embeddedWorkflow?.runId || '';
        return <WorkflowRuntimeRightRail key={`${configFile}:${runId}`} session={session} live={live} />;
      },
    },
    {
      id: 'changes-monitor',
      title: '变更',
      icon: 'difference',
      priority: 20,
      modes: ['workflow-drafting', 'workflow-running', 'workflow-completed'],
      permissions: ['read-workspace'],
      subscribe: () => ['workspace-changes'],
      shouldActivate: ({ session }) => Boolean(session?.sessionWorkbenchState?.chatWorkspace?.workingDirectory),
      render: ({ session }) => (
        <div className="space-y-3">
          <InfoRow label="工作区" value={<span className="break-all">{session?.sessionWorkbenchState?.chatWorkspace?.workingDirectory || '-'}</span>} />
          <ConversationRightRailEmptyState text="文件变更详情将在后续阶段接入 git diff 数据源" />
        </div>
      ),
    },
  ];

  if (legacyPanel) {
    plugins.push({
      id: 'legacy-command-tools',
      title: '工具',
      icon: 'right_panel_open',
      priority: 80,
      modes: ['workflow-drafting', 'workflow-running', 'workflow-completed'],
      permissions: ['read-chat', 'read-workflow', 'read-workspace'],
      shouldActivate: () => true,
      render: () => legacyPanel,
    });
  }

  return plugins;
}
