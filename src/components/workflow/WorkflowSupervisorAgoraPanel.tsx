'use client';

import { useEffect, useMemo, type ReactNode } from 'react';
import { ClipboardCheck, UsersRound } from 'lucide-react';
import { useChat } from '@/contexts/ChatContext';
import { AgoraShell } from '@/components/collaboration/AgoraShell';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import { Badge } from '@/components/ui/badge';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run/state-persistence';
import type { CollaborationChatroomParticipant } from '@/lib/core/home-sidebar-state';
import { createInitialChatroomState, ensureChatroomRoomState } from '@/lib/agora/chatroom-state';

interface WorkflowSupervisorAgoraPanelProps {
  sessionId?: string | null;
  title?: string;
  configFile: string;
  runId?: string | null;
  supervisorAgent?: string | null;
  supervisorSessionId?: string | null;
  workingDirectory?: string | null;
  workflowStatus?: string | null;
  initialGuests?: Array<{
    name: string;
    sourceAgent?: string;
    runtimeAgentName?: string;
    engine?: string;
    model?: string;
  }>;
  agentSessionIds?: Record<string, string | null | undefined>;
  pendingHumanQuestion?: HumanQuestion | null;
  submittingHumanQuestion?: boolean;
  onSubmitHumanQuestion?: (answer: HumanQuestionAnswer) => Promise<void> | void;
  formationPanel?: ReactNode;
  summaryPanel?: ReactNode;
}

function normalizeSessionMap(input?: Record<string, string | null | undefined>) {
  const entries = Object.entries(input || {})
    .map(([name, sessionId]) => [name.trim(), String(sessionId || '').trim()] as const)
    .filter(([name, sessionId]) => Boolean(name && sessionId));
  return Object.fromEntries(entries);
}

function buildWorkflowRoster(initialGuests: WorkflowSupervisorAgoraPanelProps['initialGuests']): CollaborationChatroomParticipant[] {
  const names = new Set<string>();
  return (initialGuests || [])
    .map((guest) => ({
      ...guest,
      name: String(guest.name || '').trim(),
    }))
    .filter((guest) => {
      if (!guest.name || names.has(guest.name)) return false;
      names.add(guest.name);
      return true;
    })
    .map((guest, index) => ({
      id: `workflow-guest-${index}-${guest.name}`,
      name: guest.name,
      sourceType: 'agent' as const,
      sourceAgent: guest.sourceAgent || guest.name,
      runtimeAgentName: guest.runtimeAgentName || guest.name,
      useDefaultModel: true,
      engine: guest.engine || '',
      model: guest.model || '',
      createdAt: Date.now(),
    }));
}

function buildWorkflowPanelRoster(
  existingRoster: CollaborationChatroomParticipant[],
  incomingRoster: CollaborationChatroomParticipant[],
): CollaborationChatroomParticipant[] {
  if (!incomingRoster.length) return existingRoster;
  return incomingRoster;
}

export default function WorkflowSupervisorAgoraPanel({
  sessionId,
  title,
  configFile,
  runId,
  supervisorAgent,
  supervisorSessionId,
  workingDirectory,
  workflowStatus,
  initialGuests = [],
  agentSessionIds,
  pendingHumanQuestion,
  submittingHumanQuestion,
  onSubmitHumanQuestion,
  formationPanel,
  summaryPanel,
}: WorkflowSupervisorAgoraPanelProps) {
  const {
    activeSessionId,
    activeSession,
    setActiveSessionId,
    setSessionWorkbenchState,
    appendSessionMessage,
  } = useChat();

  useEffect(() => {
    if (!sessionId) return;
    if (activeSessionId !== sessionId) {
      setActiveSessionId(sessionId);
    }
  }, [activeSessionId, sessionId, setActiveSessionId]);

  const loaded = Boolean(sessionId && activeSession?.id === sessionId);
  const roster = useMemo(() => buildWorkflowRoster(initialGuests), [initialGuests]);
  const sessionMap = useMemo(() => normalizeSessionMap({
    ...agentSessionIds,
    ...(supervisorAgent && supervisorSessionId ? { [supervisorAgent]: supervisorSessionId } : {}),
  }), [agentSessionIds, supervisorAgent, supervisorSessionId]);
  const rosterKey = useMemo(() => roster.map((guest) => `${guest.name}:${guest.runtimeAgentName || ''}`).join('|'), [roster]);
  const sessionMapKey = useMemo(() => JSON.stringify(sessionMap), [sessionMap]);
  const topic = title?.trim() || '工作流协作议题';

  useEffect(() => {
    if (!loaded) return;
    setSessionWorkbenchState((prev) => {
      const base = ensureChatroomRoomState(prev?.collaborationRoom);
      const currentChatroom = base.chatroom || createInitialChatroomState();
      const existingRoster = currentChatroom.participantRoster || [];
      const nextSessions = { ...(base.agentSessions || {}), ...sessionMap };
      const workspacePath = String(workingDirectory || '').trim();

      if (existingRoster.length > 0) {
        const nextRoster = buildWorkflowPanelRoster(existingRoster, roster);
        const participantNames = nextRoster.map((guest) => guest.name).filter(Boolean);
        const sessionsChanged = JSON.stringify(base.agentSessions || {}) !== JSON.stringify(nextSessions);
        const rosterChanged = JSON.stringify(nextRoster.map((guest) => `${guest.id}:${guest.name}:${guest.runtimeAgentName || ''}`)) !== JSON.stringify(existingRoster.map((guest) => `${guest.id}:${guest.name}:${guest.runtimeAgentName || ''}`));
        const workspaceChanged = Boolean(workspacePath && currentChatroom.settings?.workspacePath !== workspacePath);
        if (!sessionsChanged && !rosterChanged && !workspaceChanged && currentChatroom.topic) return prev || {};
        return {
          ...(prev || {}),
          collaborationRoom: {
            ...base,
            topic: currentChatroom.topic || topic,
            selectedAgents: participantNames,
            agentSessions: nextSessions,
            chatroom: {
              ...currentChatroom,
              topic: currentChatroom.topic || topic,
              participants: participantNames,
              participantRoster: nextRoster,
              status: currentChatroom.status === 'setup' ? 'running' : currentChatroom.status,
              settings: {
                ...currentChatroom.settings,
                workspacePath: workspacePath || currentChatroom.settings?.workspacePath || '',
              },
            },
          },
        };
      }

      const nextRoster = roster;
      const participantNames = nextRoster.map((guest) => guest.name);
      const nextChatroom = createInitialChatroomState({
        status: 'running',
        topic,
        participants: participantNames,
        participantRoster: nextRoster,
        settings: {
          ...currentChatroom.settings,
          responseMode: currentChatroom.settings?.responseMode || 'mention-driven',
          autoSummarize: currentChatroom.settings?.autoSummarize ?? true,
          workspacePath: workspacePath || currentChatroom.settings?.workspacePath || '',
        },
      });
      return {
        ...(prev || {}),
        collaborationRoom: {
          ...base,
          topic,
          selectedAgents: participantNames,
          agentSessions: nextSessions,
          chatroom: nextChatroom,
        },
      };
    });
  }, [loaded, roster, rosterKey, sessionMap, sessionMapKey, setSessionWorkbenchState, topic, workingDirectory]);

  const terminalWorkflowStatus = ['stopped', 'completed', 'failed', 'crashed'].includes(String(workflowStatus || '').toLowerCase());
  const chatBanner = !terminalWorkflowStatus && pendingHumanQuestion && onSubmitHumanQuestion ? (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="destructive" className="text-[10px]">等待人工审查</Badge>
        <span className="text-muted-foreground">{configFile}</span>
        {runId ? <span className="text-muted-foreground">Run: {runId}</span> : null}
      </div>
      <HumanQuestionCard
        question={pendingHumanQuestion}
        submitting={submittingHumanQuestion}
        onSubmit={onSubmitHumanQuestion}
        collapsible={false}
      />
    </div>
  ) : null;

  const auxiliaryTabs = [
    {
      id: 'formation',
      title: '编队',
      icon: <UsersRound className="h-4 w-4" />,
      badge: roster.length ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{roster.length}</Badge> : null,
      content: formationPanel || (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          暂无编队状态
        </div>
      ),
    },
    {
      id: 'summary',
      title: '结算',
      icon: <ClipboardCheck className="h-4 w-4" />,
      content: summaryPanel || (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          当前还没有战后总结
        </div>
      ),
    },
  ];

  if (!sessionId) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed bg-background/70 p-6 text-center text-sm text-muted-foreground">
        工作流启动后会自动创建工作流协作议题。
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border bg-background/70 p-6 text-sm text-muted-foreground">
        正在载入工作流协作议题...
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-hidden rounded-2xl border bg-background shadow-sm">
      <AgoraShell
        activeSessionId={sessionId}
        sessionTitle={topic}
        sessionWorkbenchState={activeSession?.sessionWorkbenchState}
        setSessionWorkbenchState={setSessionWorkbenchState}
        appendSessionMessage={appendSessionMessage}
        workingDirectory={workingDirectory || ''}
        hideComposer={false}
        auxiliaryTabs={auxiliaryTabs}
        chatBanner={chatBanner}
        chatBannerPlacement="inline"
        allowOpeningMessages={false}
        allowGuestManagement={false}
        allowTopicControls={false}
        showComposerControls={false}
        lockWorkspace
        inlineContentSpeakerName={supervisorAgent || 'Supervisor'}
      />
    </div>
  );
}
