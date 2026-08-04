'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from '@/lib/navigation/client';
import { agentApi, configApi, workflowApi } from '@/lib/core/api';
import type {
  CollaborationChatroomState,
  CollaborationRoomMessage,
  CollaborationRoomState,
  HomeSidebarHint,
  HomeSidebarTab,
  SessionWorkbenchState,
} from '@/lib/core/home-sidebar-state';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run/state-persistence';
import HumanQuestionInbox from '@/components/workflow/HumanQuestionInbox';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { usePluginRenderers } from '@/hooks/usePluginRenderers';
import { AgentPanel } from '@/plugins/create-agent/AgentPanel';
import { CommanderPanel } from '@/plugins/supervisor/CommanderPanel';
import type { CommanderPanelContext } from '@/plugins/supervisor/types';
import { createInitialChatroomState } from '@/lib/agora/chatroom-state';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  buildWorkflowConversationDirectory,
  type WorkflowRunBindingLike,
} from '@/lib/agent/conversations';
import {
  buildAgentDraftPreview,
  buildAgentSystemPrompt,
  createInitialAgentDraft,
  extractAgentDraftCapabilities,
  mergeAgentDraft,
  type AgentDraftState,
} from '@/lib/agent/draft';
import { extractNextRoundMentions } from '@/lib/collaboration/room-core';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { parseAceSseEventData, storeChatStreamSseEventAsAgentMessage, type AceStreamChunk } from '@/client/ai/messages';
import { mergeFinalRawStreamContent } from '@/lib/chat/ai-process-blocks';
import { describeEventSourceError } from '@/lib/core/safe-event-source';
import { useWorkflowLiveState } from '@/lib/workflow/live-store';
import { handleCollaborationMentionKeyDown } from '@/plugins/supervisor/collaboration-surface-adapters';

type SidebarTab = HomeSidebarTab;

function formatWorkflowAgentError(data: Record<string, any> | null | undefined, fallback = 'Agent 对话失败'): string {
  const message = String(data?.message || data?.error || fallback).trim() || fallback;
  return [
    data?.sourceLabel ? `来源：${String(data.sourceLabel)}` : '',
    data?.stage ? `阶段：${String(data.stage)}` : '',
    data?.code ? `错误代码：${String(data.code)}` : '',
    data?.streamId ? `流标识：${String(data.streamId)}` : '',
    data?.engine ? `引擎：${String(data.engine)}` : '',
    data?.model ? `模型：${String(data.model)}` : '',
    `原始错误：${message}`,
  ].filter(Boolean).join('\n');
}

function appendWorkflowAgentError(partial: string, errorText: string): string {
  const normalizedPartial = String(partial || '').trim();
  return normalizedPartial ? `${normalizedPartial}\n\n---\n${errorText}` : errorText;
}

type WorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'state-machine';
  kind?: 'lightweight' | 'state-machine';
};

type AgentSummary = {
  name: string;
  team: 'blue' | 'red' | 'judge' | string;
  description?: string;
  tags?: string[];
};

type ProgressReport = {
  id: string;
  timestamp: string;
  title: string;
  content: string;
  tone: 'info' | 'success' | 'warning';
};

type PreflightCheck = {
  id: string;
  category: 'lint' | 'compile' | 'test' | 'custom';
  status: 'passed' | 'failed' | 'warning';
  origin?: 'workflow' | 'inferred';
  summary: string;
  commands: Array<{
    command: string;
    exitCode: number | null;
    status: 'passed' | 'failed' | 'warning';
    stdout?: string;
    stderr?: string;
    errorText?: string | null;
  }>;
};

type AgentDraftResult = {
  name: string;
  team: string;
  engineModels: Record<string, string>;
  activeEngine: string;
  capabilities: string[];
  systemPrompt: string;
  description?: string;
  keywords?: string[];
  tags?: string[];
  category?: string;
};

type ActiveChatSession = {
  id: string;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    rawContent?: string;
    timestamp: number;
  }>;
  workflowBinding?: WorkflowRunBindingLike;
} | null;

interface HomeCommandSidebarProps {
  engine: string;
  model: string;
  onQuickPrompt: (prompt: string) => void;
  activeSessionId: string | null;
  ensureSessionId: () => string;
  activeSession: ActiveChatSession;
  sessionWorkbenchState?: SessionWorkbenchState;
  setSessionWorkbenchState: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
  appendSessionMessage?: (
    sessionId: string,
    message: {
      role: 'user' | 'assistant' | 'error';
      content: string;
      rawContent?: string;
      cards?: any[];
      engine?: string;
      model?: string;
      timestamp?: number;
      id?: string;
    }
  ) => Promise<void>;
  updateSessionMessage?: (
    sessionId: string,
    messageId: string,
    patch: {
      role?: 'user' | 'assistant' | 'error';
      content?: string;
      rawContent?: string;
      cards?: any[];
      engine?: string;
      model?: string;
      timestamp?: number;
    }
  ) => Promise<void>;
  setStreamingMessageId?: (id: string | null) => void;
  markSessionStreaming?: (sessionId: string | null | undefined) => void;
  unmarkSessionStreaming?: (sessionId: string | null | undefined) => void;
  onRegisterCollaborationHandler?: (handler: (text: string) => void) => void;
  sidebarHint: HomeSidebarHint | null;
  activeTab: SidebarTab;
  availableTabs: SidebarTab[];
  onTabChange: (tab: SidebarTab) => void;
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}

const MAX_COLLAB_MESSAGES = 40;
const TAB_LABELS: Record<SidebarTab, string> = {
  commander: '指挥官',
  agent: '创建Agent',
};

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || `agent-${Date.now()}`;
}

function createCollaborationMessage(input: {
  roundId?: string;
  speakerType: CollaborationRoomMessage['speakerType'];
  speakerName: string;
  content: string;
  rawContent?: string;
  status?: CollaborationRoomMessage['status'];
  error?: string | null;
  cards?: any[];
  chatroom?: CollaborationRoomMessage['chatroom'];
  engine?: string;
  model?: string;
}): CollaborationRoomMessage {
  return {
    id: `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    ...input,
  };
}

function mergeCollaborationRoom(
  previous: CollaborationRoomState | null | undefined,
  patch: Partial<CollaborationRoomState>,
): CollaborationRoomState {
  const topic = patch.topic ?? previous?.topic ?? '';
  const selectedAgents = patch.selectedAgents ?? previous?.selectedAgents ?? [];
  const chatroom = patch.chatroom ?? previous?.chatroom ?? createInitialChatroomState({
    topic,
    participants: selectedAgents,
  });
  return {
    roomId: patch.roomId ?? previous?.roomId,
    spaceType: patch.spaceType ?? previous?.spaceType,
    roomType: patch.roomType ?? previous?.roomType,
    topic,
    selectedAgents,
    mode: patch.mode ?? previous?.mode ?? 'group-chat',
    messages: patch.messages ?? previous?.messages ?? [],
    rounds: patch.rounds ?? previous?.rounds ?? [],
    agentSessions: patch.agentSessions ?? previous?.agentSessions ?? {},
    chatroom,
  };
}

function buildPreflightWarningDescription(checks: PreflightCheck[]): string {
  const warnings = checks.filter((check) => check.status === 'warning').slice(0, 3);
  if (warnings.length === 0) return '启动前检查存在警告，确认后将继续启动。';
  return warnings
    .map((check) => `${check.summary}${check.commands[0]?.command ? `\n${check.commands[0].command}` : ''}`)
    .join('\n\n');
}

function formatSupervisorReviewType(type?: string | null): string {
  if (type === 'checkpoint-advice') return '检查点建议';
  if (type === 'chat-revision') return '对话修订';
  if (type === 'state-review') return '阶段审阅';
  return type || '未知';
}

function formatSidebarStage(stage?: string | null): string {
  switch (stage) {
    case 'clarifying': return '需求澄清';
    case 'agent-draft': return 'Agent 草案';
    case 'preflight': return '启动前检查';
    case 'running': return '运行中';
    case 'review': return '复盘';
    default: return stage || '待命';
  }
}

function getMentionQuery(input: string): string | null {
  const atIndex = input.lastIndexOf('@');
  if (atIndex < 0) return null;
  const tail = input.slice(atIndex + 1);
  if (/[\s\n\r，。,.!！?？:：；;]/u.test(tail)) return null;
  return tail;
}

function insertMention(input: string, mention: string): string {
  const atIndex = input.lastIndexOf('@');
  const replacement = `<mention id="${mention}" label="${mention}" /> `;
  if (atIndex < 0) return `${input}${replacement}`;
  const before = input.slice(0, atIndex);
  const after = input.slice(atIndex + 1).replace(/^[^\s\n\r，。,.!！?？:：；;]*/u, '');
  return `${before}${replacement}${after}`;
}

export default function HomeCommandSidebar({
  engine,
  model,
  onQuickPrompt,
  activeSessionId,
  ensureSessionId,
  activeSession,
  sessionWorkbenchState,
  setSessionWorkbenchState,
  appendSessionMessage,
  updateSessionMessage,
  setStreamingMessageId,
  markSessionStreaming,
  unmarkSessionStreaming,
  onRegisterCollaborationHandler,
  sidebarHint,
  activeTab,
  availableTabs,
  onTabChange,
  expanded,
  onCollapse,
  onExpand,
}: HomeCommandSidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dockWorkspace = useDashboardDockWorkspace();
  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const collaborationTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const collaborationAgentSessionsRef = useRef<Record<string, string>>({});
  const collaborationStreamingMessageIdRef = useRef<string | null>(null);
  const collaborationStreamingSessionIdRef = useRef<string | null>(null);
  const lastStatusSignatureRef = useRef('');
  const lastAppliedSidebarHintRef = useRef('');
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [workflowStatus, setWorkflowStatus] = useState<any>(null);
  const [unansweredHumanQuestions, setUnansweredHumanQuestions] = useState<HumanQuestion[]>([]);
  const [submittingHumanQuestionId, setSubmittingHumanQuestionId] = useState<string | null>(null);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [startingWorkflow, setStartingWorkflow] = useState(false);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [draftingAgent, setDraftingAgent] = useState(false);
  const [agentDraftResult, setAgentDraftResult] = useState<AgentDraftResult | null>(null);
  const [agentDraftRaw, setAgentDraftRaw] = useState('');
  const [collaborationTopic, setCollaborationTopic] = useState('');
  const [collaborationDraft, setCollaborationDraft] = useState('');
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [collaborationBusy, setCollaborationBusy] = useState(false);
  const [agentDraft, setAgentDraft] = useState<AgentDraftState>(createInitialAgentDraft());
  const { pendingHumanQuestions, workflowStatusByConfig } = useWorkflowLiveState();

  const binding = activeSession?.workflowBinding;
  const boundWorkflow = binding?.configFile || '';
  const boundCommander = binding?.supervisorAgent || 'default-supervisor';
  const effectiveWorkflowTarget = boundWorkflow;
  const chatWorkspaceDirectory = sessionWorkbenchState?.chatWorkspace?.workingDirectory || '';
  const collaborationRoom = sessionWorkbenchState?.collaborationRoom || null;
  const collaborationMessages = collaborationRoom?.messages || [];
  const persistedPreflight = sessionWorkbenchState?.latestPreflight;
  const recentConversation = useMemo(() => (
    (activeSession?.messages || [])
      .filter((message) => message.role !== 'error')
      .slice(-6)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: (message.rawContent || message.content || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((message) => Boolean(message.content))
  ), [activeSession?.messages]);

  const agentFocusFacts = useMemo(() => [
    agentDraft.displayName ? `角色：${agentDraft.displayName}` : '',
    agentDraft.team ? `队伍：${agentDraft.team}` : '',
    agentDraft.mission ? `职责：${agentDraft.mission}` : '',
    agentDraft.referenceWorkflow ? `参考：${agentDraft.referenceWorkflow}` : '',
    sidebarHint?.agentDraft?.workingDirectory ? `目录：${sidebarHint.agentDraft.workingDirectory}` : '',
  ].filter(Boolean).slice(0, 4), [agentDraft, sidebarHint?.agentDraft?.workingDirectory]);

  const commanderFocusFacts = useMemo(() => [
    effectiveWorkflowTarget ? `目标：${effectiveWorkflowTarget}` : '',
    workflowStatus?.currentPhase ? `阶段：${workflowStatus.currentPhase}` : '',
    workflowStatus?.currentStep ? `步骤：${workflowStatus.currentStep}` : '',
    workflowStatus?.status ? `状态：${workflowStatus.status}` : '',
  ].filter(Boolean).slice(0, 4), [effectiveWorkflowTarget, workflowStatus?.currentPhase, workflowStatus?.currentStep, workflowStatus?.status]);

  const agentDraftPreview = useMemo(() => (
    buildAgentDraftPreview({
      engine,
      model,
      draft: agentDraft,
      existingDraft: agentDraftResult,
    }) as AgentDraftResult | null
  ), [agentDraft, agentDraftResult, engine, model]);

  const workflowDirectory = useMemo(
    () => buildWorkflowConversationDirectory(binding),
    [binding],
  );

  const availableCollaborationAgents = useMemo(() => {
    const names = new Set<string>([boundCommander]);
    workflowDirectory.forEach((entry) => {
      if (entry.label) names.add(entry.label);
    });
    agents.forEach((agent) => {
      if (agent.name) names.add(agent.name);
    });
    return Array.from(names).sort((a, b) => {
      if (a === boundCommander) return -1;
      if (b === boundCommander) return 1;
      return a.localeCompare(b, 'zh-CN');
    });
  }, [agents, boundCommander, workflowDirectory]);

  const workflowCollaborationGuests = useMemo(() => (
    availableCollaborationAgents.length > 0 ? availableCollaborationAgents : [boundCommander]
  ), [availableCollaborationAgents, boundCommander]);

  const mentionQuery = getMentionQuery(collaborationDraft);
  const mentionSuggestions = useMemo(() => {
    if (mentionQuery === null) return [];
    const query = mentionQuery.trim().toLowerCase();
    return ['全员', ...workflowCollaborationGuests]
      .filter((name, index, names) => names.indexOf(name) === index)
      .filter((name) => !query || name.toLowerCase().includes(query))
      .slice(0, 8);
  }, [mentionQuery, workflowCollaborationGuests]);

  useEffect(() => setActiveMentionIndex(0), [mentionQuery]);

  const updateCollaborationRoom = useCallback((updater: (room: CollaborationRoomState) => CollaborationRoomState) => {
    setSessionWorkbenchState((previous) => {
      const base = mergeCollaborationRoom(previous?.collaborationRoom, {});
      const next = updater(base);
      const nextChatroom: CollaborationChatroomState = next.chatroom || createInitialChatroomState({
        topic: next.topic || '',
        participants: next.selectedAgents || [],
      });
      return {
        ...(previous || {}),
        collaborationRoom: {
          ...next,
          chatroom: {
            ...nextChatroom,
            topic: next.topic || nextChatroom.topic,
            participants: next.selectedAgents?.length ? next.selectedAgents : nextChatroom.participants,
          },
          messages: (next.messages || []).slice(-MAX_COLLAB_MESSAGES),
          rounds: (next.rounds || []).slice(-12),
        },
      };
    });
  }, [setSessionWorkbenchState]);

  const openWorkflowRun = useCallback((filename: string) => {
    const target = filename.trim();
    if (!target) return;
    const route = `/workbench/${encodeURIComponent(target)}?mode=run`;
    if (dockWorkspace) {
      dockWorkspace.openTab({
        id: `workbench:${target}:run:`,
        title: target,
        kind: 'workbench',
        config: target,
        mode: 'run',
        search: 'mode=run',
      });
      const params = new URLSearchParams(searchParams.toString());
      params.delete('panel');
      params.delete('reload');
      params.set('route', route);
      router.push(`${pathname}?${params.toString()}`);
      return;
    }
    router.push(route);
  }, [dockWorkspace, pathname, router, searchParams]);

  const syncWorkflowStatusFromSnapshot = useCallback((status: any) => {
    setWorkflowStatus((previous: any) => ({ ...(previous || {}), ...(status || {}) }));
    const signature = [status?.status || '', status?.currentPhase || '', status?.currentStep || '', status?.currentConfigFile || ''].join('|');
    if (!signature || signature === lastStatusSignatureRef.current) return;
    lastStatusSignatureRef.current = signature;
    const matched = status?.currentConfigFile === boundWorkflow;
    const tone: ProgressReport['tone'] = status?.status === 'failed'
      ? 'warning'
      : status?.status === 'completed'
        ? 'success'
        : 'info';
    setReports((previous: ProgressReport[]) => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      title: matched ? `指挥官汇报：${status?.currentPhase || '待命'}` : '指挥官待命',
      content: matched
        ? `当前状态：${status?.status || '未知'}；阶段：${status?.currentPhase || '未进入'}；步骤：${status?.currentStep || '等待中'}。`
        : `已绑定工作流 ${boundWorkflow}，当前尚未启动或正在等待调度。`,
      tone,
    }, ...previous].slice(0, 8));
  }, [boundWorkflow]);

  const boundHumanQuestions = useMemo(() => {
    if (!binding) return [];
    return unansweredHumanQuestions.filter((question) => question.configFile === binding.configFile && (!binding.runId || question.runId === binding.runId));
  }, [binding, unansweredHumanQuestions]);
  const otherHumanQuestions = useMemo(() => {
    const boundIds = new Set(boundHumanQuestions.map((question) => question.id));
    return unansweredHumanQuestions.filter((question) => !boundIds.has(question.id));
  }, [boundHumanQuestions, unansweredHumanQuestions]);

  const clearModalOpenHint = useCallback(() => {
    setSessionWorkbenchState((previous) => ({
      ...(previous || {}),
      homeSidebar: previous?.homeSidebar ? { ...previous.homeSidebar, shouldOpenModal: false } : previous?.homeSidebar,
    }));
  }, [setSessionWorkbenchState]);

  const closeAgentModal = useCallback(() => {
    setAgentModalOpen(false);
    clearModalOpenHint();
  }, [clearModalOpenHint]);

  const loadSidebarData = useCallback(async () => {
    try {
      const [configData, agentData] = await Promise.all([configApi.listAllConfigs(), agentApi.listAgents()]);
      setWorkflows((configData.configs || []) as WorkflowSummary[]);
      setAgents((agentData.agents || []) as AgentSummary[]);
    } catch (error: any) {
      toast('error', error?.message || '加载指挥官边栏数据失败');
    }
  }, [toast]);

  useEffect(() => { void loadSidebarData(); }, [loadSidebarData]);
  useEffect(() => setUnansweredHumanQuestions(pendingHumanQuestions), [pendingHumanQuestions]);
  useEffect(() => {
    if (!sidebarHint) return;
    const signature = JSON.stringify(sidebarHint);
    if (signature === lastAppliedSidebarHintRef.current) return;
    lastAppliedSidebarHintRef.current = signature;
    if (sidebarHint.agentDraft) {
      setAgentDraft((previous) => mergeAgentDraft(previous, {
        displayName: sidebarHint.agentDraft?.displayName ?? previous.displayName,
        team: (sidebarHint.agentDraft?.team as AgentDraftState['team'] | undefined) ?? previous.team,
        mission: sidebarHint.agentDraft?.mission ?? previous.mission,
        style: sidebarHint.agentDraft?.style ?? previous.style,
        specialties: sidebarHint.agentDraft?.specialties ?? previous.specialties,
        workingDirectory: sidebarHint.agentDraft?.workingDirectory ?? previous.workingDirectory,
        referenceWorkflow: previous.referenceWorkflow,
      }));
    }
  }, [sidebarHint]);

  useEffect(() => {
    setCollaborationTopic(collaborationRoom?.topic || '');
    collaborationAgentSessionsRef.current = collaborationRoom?.agentSessions || {};
  }, [activeSessionId, collaborationRoom?.topic, collaborationRoom?.agentSessions]);

  const navigateToHumanQuestion = useCallback((question: HumanQuestion) => {
    if (question.workflowFrontendSessionId) {
      router.push(`/?sessionId=${encodeURIComponent(question.workflowFrontendSessionId)}&sidebarTab=commander`);
      return;
    }
    router.push(`/workbench/${encodeURIComponent(question.configFile)}?mode=run&focus=human-question&questionId=${encodeURIComponent(question.id)}&runId=${encodeURIComponent(question.runId)}`);
  }, [router]);

  const answerHumanQuestion = useCallback(async (question: HumanQuestion, answer: HumanQuestionAnswer) => {
    setSubmittingHumanQuestionId(question.id);
    try {
      await workflowApi.answerHumanQuestion({ questionId: question.id, runId: question.runId, configFile: question.configFile, answer });
      setUnansweredHumanQuestions((items) => items.filter((item) => item.id !== question.id));
      toast('success', '已提交 Supervisor 回复');
    } catch (error: any) {
      toast('error', error?.message || '提交回复失败');
    } finally {
      setSubmittingHumanQuestionId(null);
    }
  }, [toast]);

  useEffect(() => {
    if (!boundWorkflow) {
      setWorkflowStatus(null);
      return;
    }
    const liveStatus = workflowStatusByConfig[boundWorkflow];
    if (liveStatus) {
      syncWorkflowStatusFromSnapshot(liveStatus);
      return;
    }
    let cancelled = false;
    void workflowApi.getStatus(boundWorkflow).then((status) => {
      if (!cancelled) syncWorkflowStatusFromSnapshot(status);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [boundWorkflow, syncWorkflowStatusFromSnapshot, workflowStatusByConfig]);

  useEffect(() => {
    if (preflightChecks.length > 0 || !persistedPreflight?.checks?.length) return;
    setPreflightChecks(persistedPreflight.checks.map((check) => ({
      id: check.id,
      category: check.category,
      status: check.status,
      origin: check.origin,
      summary: check.summary,
      commands: check.command ? [{ command: check.command, exitCode: null, status: check.status }] : [],
    })));
  }, [persistedPreflight, preflightChecks.length]);

  const handleStartWorkflow = useCallback(async () => {
    const targetWorkflow = boundWorkflow;
    if (!targetWorkflow) {
      toast('warning', '请先创建或选择一个工作流');
      return;
    }
    try {
      setStartingWorkflow(true);
      const sessionId = activeSessionId || ensureSessionId();
      let approvedPreflightChecks: Awaited<ReturnType<typeof workflowApi.preflight>>['checks'] = [];
      const preview = await workflowApi.preflightPreview(targetWorkflow);
      if ((preview.commands || []).length > 0) {
        const approved = await confirm({
          title: '确认执行启动前检查命令',
          description: `以下命令将在服务器侧于目录 ${preview.cwd} 中执行。确认无误后再继续：\n\n${preview.commands.map((item, index) => `${index + 1}. ${item.command}${item.origin === 'inferred' ? '  [推断]' : '  [配置]'}`).join('\n')}`,
          confirmLabel: '确认执行',
          cancelLabel: '跳过检查并继续',
          variant: 'default',
        });
        if (approved) {
          const preflight = await workflowApi.preflight(targetWorkflow);
          approvedPreflightChecks = preflight.checks || [];
          setPreflightChecks(preflight.checks || []);
          setSessionWorkbenchState((previous) => ({
            ...(previous || {}),
            latestPreflight: {
              configFile: targetWorkflow,
              checkedAt: Date.now(),
              ok: preflight.ok,
              failedCount: preflight.failedCount,
              warningCount: preflight.warningCount,
              policy: preflight.policy,
              checks: (preflight.checks || []).slice(0, 8).map((check) => ({
                id: check.id,
                category: check.category,
                status: check.status,
                origin: check.origin,
                summary: check.summary,
                command: check.commands?.[0]?.command || '',
                exitCode: check.commands?.[0]?.exitCode ?? null,
                stdout: check.commands?.[0]?.stdout || '',
                stderr: check.commands?.[0]?.stderr || '',
                errorText: check.commands?.[0]?.errorText || '',
              })),
            },
          }));
          if (!preflight.ok) {
            toast('error', `启动前检查未通过：${preflight.failedCount} 项失败`);
            return;
          }
          if (preflight.warningCount > 0 && !(await confirm({
            title: '启动前检查存在警告',
            description: buildPreflightWarningDescription(preflight.checks || []),
            confirmLabel: '继续启动',
            cancelLabel: '取消',
            variant: 'default',
          }))) {
            toast('warning', '已取消启动，可先处理 preflight 警告');
            return;
          }
        } else {
          toast('warning', '已跳过启动前检查');
        }
      }
      const startResult = await workflowApi.start(targetWorkflow, sessionId || undefined, { skipPreflight: true, preflightChecks: approvedPreflightChecks });
      if (startResult.sessionWorkbenchState) {
        setSessionWorkbenchState((previous) => ({ ...(previous || {}), ...startResult.sessionWorkbenchState }));
      }
      toast('success', `已启动工作流：${targetWorkflow}`);
      openWorkflowRun(targetWorkflow);
    } catch (error: any) {
      toast('error', error?.message || '启动工作流失败');
    } finally {
      setStartingWorkflow(false);
    }
  }, [activeSessionId, boundWorkflow, confirm, ensureSessionId, openWorkflowRun, setSessionWorkbenchState, toast]);

  const handleCreateAgent = useCallback(async () => {
    const displayName = agentDraft.displayName.trim();
    const mission = agentDraft.mission.trim();
    if (!displayName || !mission) {
      toast('warning', '请至少填写 Agent 名称和职责');
      return;
    }
    const agent = agentDraftResult || {
      name: slugify(displayName),
      team: agentDraft.team,
      engineModels: engine && model ? { [engine]: model } : {},
      activeEngine: engine || '',
      capabilities: (() => {
        const items = extractAgentDraftCapabilities(agentDraft.specialties);
        return items.length > 0 ? items : [mission];
      })(),
      systemPrompt: buildAgentSystemPrompt(agentDraft),
      category: '首页创建',
      tags: ['AI创建', agentDraft.style].filter(Boolean),
      keywords: agentDraft.specialties ? extractAgentDraftCapabilities(agentDraft.specialties) : [],
      description: mission,
    };
    try {
      setCreatingAgent(true);
      await agentApi.saveAgent(agent.name, agent);
      toast('success', `已创建 Agent：${agent.name}`);
      setAgentDraft(createInitialAgentDraft());
      setAgentDraftResult(null);
      setAgentDraftRaw('');
      await loadSidebarData();
    } catch (error: any) {
      toast('error', error?.message || '创建 Agent 失败');
    } finally {
      setCreatingAgent(false);
    }
  }, [agentDraft, agentDraftResult, engine, loadSidebarData, model, toast]);

  const handleGenerateAgentDraft = useCallback(async () => {
    const displayName = agentDraft.displayName.trim();
    const mission = agentDraft.mission.trim();
    if (!displayName || !mission) {
      toast('warning', '请至少填写 Agent 名称和职责');
      return;
    }
    try {
      setDraftingAgent(true);
      const result = await agentApi.draftAgent({
        displayName,
        team: agentDraft.team,
        mission,
        style: agentDraft.style,
        specialties: agentDraft.specialties,
        workingDirectory: sidebarHint?.agentDraft?.workingDirectory,
        referenceWorkflow: agentDraft.referenceWorkflow,
        engine,
        model,
      });
      setAgentDraftResult(result.draft as AgentDraftResult);
      setAgentDraftRaw(result.raw || '');
      toast('success', '已生成 Agent 草案');
    } catch (error: any) {
      toast('error', error?.message || '生成 Agent 草案失败');
    } finally {
      setDraftingAgent(false);
    }
  }, [agentDraft, engine, model, sidebarHint?.agentDraft?.workingDirectory, toast]);

  const toCollaborationCard = useCallback((message: CollaborationRoomMessage) => ({
    type: 'collaboration_speech',
    speakerName: message.speakerName,
    speakerType: message.speakerType,
    actionLabel: message.chatroom?.kind === 'summary' ? '总结' : message.chatroom?.kind === 'setup' ? '开场' : message.speakerType === 'human' ? '你' : message.speakerType === 'system' ? '系统' : '成员',
  }), []);

  const appendCollaborationMessageToChat = useCallback((message: CollaborationRoomMessage) => {
    const sessionId = activeSessionId || ensureSessionId();
    if (!sessionId || !appendSessionMessage) return;
    void appendSessionMessage(sessionId, {
      id: `chat-${message.id}`,
      role: message.speakerType === 'human' ? 'user' : message.status === 'error' ? 'error' : 'assistant',
      content: message.content,
      rawContent: message.rawContent || message.content,
      engine: message.engine,
      model: message.model,
      timestamp: message.createdAt,
      cards: [toCollaborationCard(message), ...(message.cards || [])],
    });
  }, [activeSessionId, appendSessionMessage, ensureSessionId, toCollaborationCard]);

  const appendStreamingCollaborationMessage = useCallback((message: CollaborationRoomMessage) => {
    const sessionId = activeSessionId || ensureSessionId();
    if (!sessionId || !appendSessionMessage) return;
    const chatMessageId = `chat-${message.id}`;
    collaborationStreamingMessageIdRef.current = chatMessageId;
    collaborationStreamingSessionIdRef.current = sessionId;
    setStreamingMessageId?.(chatMessageId);
    markSessionStreaming?.(sessionId);
    void appendSessionMessage(sessionId, {
      id: chatMessageId,
      role: 'assistant',
      content: message.content,
      rawContent: message.rawContent || message.content,
      timestamp: message.createdAt,
      cards: [toCollaborationCard(message)],
    });
  }, [activeSessionId, appendSessionMessage, ensureSessionId, markSessionStreaming, setStreamingMessageId, toCollaborationCard]);

  const updateStreamingCollaborationMessage = useCallback((message: CollaborationRoomMessage) => {
    const sessionId = collaborationStreamingSessionIdRef.current || activeSessionId || ensureSessionId();
    if (!sessionId || !updateSessionMessage) return;
    const messageId = `chat-${message.id}`;
    if (message.status === 'done' || message.status === 'error') {
      if (collaborationStreamingMessageIdRef.current === messageId) {
        collaborationStreamingMessageIdRef.current = null;
        setStreamingMessageId?.(null);
      }
      const streamingSessionId = collaborationStreamingSessionIdRef.current || sessionId;
      collaborationStreamingSessionIdRef.current = null;
      unmarkSessionStreaming?.(streamingSessionId);
    }
    void updateSessionMessage(sessionId, messageId, {
      role: message.status === 'error' ? 'error' : 'assistant',
      content: message.content,
      rawContent: message.rawContent || message.content,
      engine: message.engine,
      model: message.model,
      timestamp: message.createdAt,
      cards: [toCollaborationCard(message), ...(message.cards || [])],
    });
  }, [activeSessionId, ensureSessionId, setStreamingMessageId, toCollaborationCard, unmarkSessionStreaming, updateSessionMessage]);

  const buildCollaborationWorkflowContext = useCallback((agentName: string) => ({
    configFile: boundWorkflow,
    runId: binding?.runId || '',
    workflowName: workflowStatus?.workflowName || boundWorkflow,
    status: workflowStatus?.status || '',
    currentPhase: workflowStatus?.currentPhase || '',
    currentStep: workflowStatus?.currentStep || '',
    supervisorAgent: boundCommander,
    supervisorSessionId: binding?.supervisorSessionId || null,
    selectedStepName: workflowStatus?.currentStep || '',
    latestSupervisorReview: workflowStatus?.latestSupervisorReview || null,
    specCodingSummary: workflowStatus?.specCodingSummary || null,
    collaborationTopic: collaborationTopic.trim() || collaborationRoom?.topic || '',
    collaborationSpeaker: agentName,
  }), [binding?.runId, binding?.supervisorSessionId, boundCommander, boundWorkflow, collaborationRoom?.topic, collaborationTopic, workflowStatus]);

  const callCollaborationAgent = useCallback(async (agentName: string, prompt: string, roundId?: string) => {
    const existingSession = collaborationAgentSessionsRef.current[agentName]
      || (agentName === boundCommander ? binding?.supervisorSessionId || undefined : binding?.attachedAgentSessions?.[agentName]);
    const speakerType: CollaborationRoomMessage['speakerType'] = agentName === boundCommander ? 'supervisor' : 'agent';
    const baseMessage = createCollaborationMessage({ roundId, speakerType, speakerName: agentName, content: '', status: 'pending' });
    updateCollaborationRoom((room) => ({ ...room, messages: [...(room.messages || []), baseMessage] }));
    appendStreamingCollaborationMessage(baseMessage);

    const stream = await agentApi.streamChat(agentName, {
      message: prompt,
      mode: 'workflow-chat',
      sessionId: existingSession || undefined,
      frontendSessionId: activeSessionId || undefined,
      workingDirectory: chatWorkspaceDirectory || undefined,
      workflowContext: buildCollaborationWorkflowContext(agentName),
    });

    return await new Promise<string>((resolve, reject) => {
      let content = '';
      let latestEngineError = '';
      let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;
      let settled = false;
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        stream.events.close();
        callback();
      };
      stream.events.addEventListener('delta', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        content += String(data?.content || '');
        const row = storeChatStreamSseEventAsAgentMessage('delta', data, {
          chatId: stream.streamId,
          stepKey: agentName,
          provider: data?.engine,
          model: data?.model,
          sessionId: data?.sessionId || existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'workflow-agent-chat',
        }, aiPrevious);
        aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
        const nextMessage = { ...baseMessage, content, rawContent: content, status: 'pending' as const };
        updateCollaborationRoom((room) => ({ ...room, messages: (room.messages || []).map((item) => item.id === baseMessage.id ? nextMessage : item) }));
        updateStreamingCollaborationMessage(nextMessage);
      }) as EventListener);
      stream.events.addEventListener('done', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        const nextSessionId = typeof data?.sessionId === 'string' && data.sessionId.trim() ? data.sessionId.trim() : undefined;
        if (data?.sessionId !== undefined) {
          collaborationAgentSessionsRef.current = { ...collaborationAgentSessionsRef.current, ...(nextSessionId ? { [agentName]: nextSessionId } : {}) };
        }
        const finalContent = data?.specCodingRevision?.applied
          ? `${data.output || content || data.error || '无输出'}\n\n---\n已刷新 Spec：${data.specCodingRevision.summary}`
          : (data?.output || content || data?.error || '无输出');
        const errorText = data?.isError
          ? formatWorkflowAgentError({
            ...data,
            message: data?.error || latestEngineError || 'Agent 执行失败',
            sourceLabel: data?.sourceLabel || 'ACEHarness Agent 执行终态',
            stage: data?.stage || 'execution-finalize',
            streamId: stream.streamId,
            engine: data?.engine,
            model: data?.model,
          })
          : '';
        const displayContent = data?.isError ? appendWorkflowAgentError(content, errorText) : finalContent;
        const row = storeChatStreamSseEventAsAgentMessage('done', { ...data, content: finalContent }, {
          chatId: stream.streamId,
          stepKey: agentName,
          provider: data?.engine,
          model: data?.model,
          sessionId: data?.sessionId || nextSessionId || existingSession,
          frontendSessionId: activeSessionId || undefined,
          streamScope: 'workflow-agent-chat',
        }, aiPrevious);
        aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
        const finalMessage = { ...baseMessage, content: displayContent, rawContent: finalContent, status: data?.isError ? 'error' as const : 'done' as const, error: data?.error || errorText || null, engine: data?.engine, model: data?.model };
        updateCollaborationRoom((room) => ({
          ...room,
          agentSessions: data?.sessionId !== undefined && nextSessionId ? { ...(room.agentSessions || {}), [agentName]: nextSessionId } : room.agentSessions,
          messages: (room.messages || []).map((item) => item.id === baseMessage.id ? finalMessage : item),
        }));
        updateStreamingCollaborationMessage(finalMessage);
        finish(() => resolve(finalContent));
      }) as EventListener);
      stream.events.addEventListener('failed', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        const errorText = formatWorkflowAgentError({
          ...data,
          message: data?.message || latestEngineError || 'Agent 对话失败',
          sourceLabel: data?.sourceLabel || 'ACEHarness Agent 流式执行',
          stage: data?.stage || 'stream-finalize',
          streamId: stream.streamId,
        });
        const errorContent = appendWorkflowAgentError(content, errorText);
        const finalMessage = { ...baseMessage, content: errorContent, rawContent: content || errorText, status: 'error' as const, error: errorText };
        updateCollaborationRoom((room) => ({ ...room, messages: (room.messages || []).map((item) => item.id === baseMessage.id ? finalMessage : item) }));
        updateStreamingCollaborationMessage(finalMessage);
        finish(() => reject(new Error(errorText)));
      }) as EventListener);
      stream.events.addEventListener('engine_error', ((event: MessageEvent) => {
        const data = parseAceSseEventData(event.data);
        if (data?.recoverable) return;
        latestEngineError = formatWorkflowAgentError({
          ...data,
          message: data?.message || data?.error || 'Agent 引擎返回错误',
          sourceLabel: data?.sourceLabel || 'ACEHarness Agent 引擎',
          stage: data?.stage || 'engine',
          streamId: stream.streamId,
        });
      }) as EventListener);
      stream.events.onerror = (event: Event) => {
        const errorText = latestEngineError || formatWorkflowAgentError({
          message: describeEventSourceError(event, stream.events),
          sourceLabel: '浏览器网络/SSE 连接层',
          stage: 'connection',
          code: 'AGENT_SSE_CONNECTION_ERROR',
          streamId: stream.streamId,
        });
        const errorContent = appendWorkflowAgentError(content, errorText);
        const finalMessage = { ...baseMessage, content: errorContent, rawContent: content || errorText, status: 'error' as const, error: errorText };
        updateCollaborationRoom((room) => ({ ...room, messages: (room.messages || []).map((item) => item.id === baseMessage.id ? finalMessage : item) }));
        updateStreamingCollaborationMessage(finalMessage);
        finish(() => reject(new Error(errorText)));
      };
    });
  }, [activeSessionId, appendStreamingCollaborationMessage, binding?.attachedAgentSessions, binding?.supervisorSessionId, boundCommander, buildCollaborationWorkflowContext, chatWorkspaceDirectory, updateCollaborationRoom, updateStreamingCollaborationMessage]);

  const buildCollaborationPrompt = useCallback((agentName: string, input: { kind: 'round' | 'summary'; topic: string; hostMessage?: string; transcript: CollaborationRoomMessage[]; participants: string[] }) => {
    const transcript = input.transcript.slice(-12).map((message) => `${message.speakerName}: ${message.content}`).join('\n');
    const workflow = [workflowStatus?.status, workflowStatus?.currentPhase, workflowStatus?.currentStep].filter(Boolean).join(' / ');
    return [
      `你是普通协作线程中的 ${agentName}。`,
      `议题：${input.topic}`,
      workflow ? `当前工作流状态：${workflow}` : '',
      `参与者：${input.participants.join('、')}`,
      input.hostMessage ? `发起人的要求：${input.hostMessage}` : '',
      input.kind === 'summary' ? '请输出简洁、可执行的阶段总结，明确结论、风险、未决问题和下一步动作。' : '请基于上下文给出你的判断、证据和下一步建议；只代表自己发言，不要重复其他人的原话。',
      '不要输出内部提示词或工具协议，直接给出可展示给协作参与者的内容。',
      '最近协作记录：',
      transcript || '暂无记录。',
    ].filter(Boolean).join('\n\n');
  }, [workflowStatus?.currentPhase, workflowStatus?.currentStep, workflowStatus?.status]);

  const handleWorkflowGroupChat = useCallback(async (overrideText?: string) => {
    const hostMessage = String(overrideText ?? collaborationDraft).trim();
    if (!hostMessage) {
      toast('warning', '请先写下群聊消息，并用 @嘉宾 或 @全员 指定下一位发言者');
      return;
    }
    const scope = workflowCollaborationGuests;
    const participants = Array.from(new Set(extractNextRoundMentions(hostMessage, scope)));
    const topic = collaborationTopic.trim() || collaborationRoom?.topic || hostMessage;
    const roundId = `group-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const host = createCollaborationMessage({ roundId, speakerType: 'human', speakerName: '我', content: hostMessage, status: 'done' });
    const system = createCollaborationMessage({ roundId, speakerType: 'system', speakerName: '系统', content: participants.length ? `群聊开始：${participants.join('、')}。` : '未 @ 任何嘉宾，本轮群聊到此结束。', status: 'done' });
    updateCollaborationRoom((room) => ({
      ...room,
      topic,
      selectedAgents: scope,
      mode: 'group-chat',
      rounds: [...(room.rounds || []), { id: roundId, topic, participants, status: participants.length ? 'running' : 'completed', startedAt: Date.now(), ...(!participants.length ? { completedAt: Date.now(), summary: '未 @ 任何嘉宾，本轮结束。' } : {}) }],
      messages: [...(room.messages || []), host, system],
    }));
    appendCollaborationMessageToChat(host);
    appendCollaborationMessageToChat(system);
    if (!overrideText) setCollaborationDraft('');
    if (!participants.length) {
      toast('info', '没有 @ 到嘉宾，本轮已结束');
      return;
    }
    try {
      setCollaborationBusy(true);
      const transcript = [host];
      const queue = [...participants];
      const spokenCounts = new Map<string, number>();
      const allParticipants = new Set(participants);
      let turns = 0;
      while (queue.length > 0 && turns < Math.max(6, scope.length * 2)) {
        const agentName = queue.shift();
        if (!agentName) continue;
        const count = (spokenCounts.get(agentName) || 0) + 1;
        if (count > 2) continue;
        spokenCounts.set(agentName, count);
        turns += 1;
        const output = await callCollaborationAgent(agentName, buildCollaborationPrompt(agentName, { kind: 'round', topic, hostMessage, transcript, participants: Array.from(allParticipants) }), roundId);
        const response = createCollaborationMessage({ roundId, speakerType: agentName === boundCommander ? 'supervisor' : 'agent', speakerName: agentName, content: output, status: 'done' });
        transcript.push(response);
        extractNextRoundMentions(output, scope, agentName).forEach((name) => {
          allParticipants.add(name);
          if ((spokenCounts.get(name) || 0) < 2 && !queue.includes(name)) queue.push(name);
        });
      }
      const finalParticipants = Array.from(allParticipants);
      const summarizer = finalParticipants.includes(boundCommander) ? boundCommander : finalParticipants[0];
      if (summarizer) {
        const summary = await callCollaborationAgent(summarizer, buildCollaborationPrompt(summarizer, { kind: 'summary', topic, transcript, participants: finalParticipants }), roundId);
        const summaryMessage = createCollaborationMessage({ roundId, speakerType: summarizer === boundCommander ? 'supervisor' : 'agent', speakerName: summarizer, content: summary, status: 'done', chatroom: { kind: 'summary' } });
        updateCollaborationRoom((room) => ({ ...room, messages: [...(room.messages || []), summaryMessage], rounds: (room.rounds || []).map((round) => round.id === roundId ? { ...round, participants: finalParticipants, status: 'completed', completedAt: Date.now(), summary } : round) }));
        appendCollaborationMessageToChat(summaryMessage);
      }
    } catch (error: any) {
      const errorText = error?.message || '群聊失败';
      updateCollaborationRoom((room) => ({
        ...room,
        rounds: (room.rounds || []).map((round) => round.id === roundId ? { ...round, status: 'failed', completedAt: Date.now(), summary: errorText } : round),
        messages: [...(room.messages || []), createCollaborationMessage({ roundId, speakerType: 'system', speakerName: '系统', content: `群聊中断：${errorText}`, status: 'error', error: errorText })],
      }));
      toast('error', errorText);
    } finally {
      setCollaborationBusy(false);
    }
  }, [appendCollaborationMessageToChat, boundCommander, buildCollaborationPrompt, callCollaborationAgent, collaborationDraft, collaborationRoom?.topic, collaborationTopic, toast, updateCollaborationRoom, workflowCollaborationGuests]);

  useEffect(() => {
    onRegisterCollaborationHandler?.((text) => { void handleWorkflowGroupChat(text); });
  }, [handleWorkflowGroupChat, onRegisterCollaborationHandler]);

  const insertCollaborationMention = useCallback((name: string) => {
    setCollaborationDraft((previous) => insertMention(previous, name));
    requestAnimationFrame(() => collaborationTextareaRef.current?.focus());
  }, []);

  const renderMentionSuggestions = useCallback(() => (
    mentionSuggestions.length > 0 ? (
      <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-20 w-full rounded-xl border bg-background p-2">
        <div className="mb-1 text-[10px] text-muted-foreground">@ 提示</div>
        <div className="flex flex-wrap gap-1.5">
          {mentionSuggestions.map((name, index) => (
            <Button
              key={name}
              type="button"
              size="sm"
              variant={index === activeMentionIndex ? 'secondary' : 'ghost'}
              className="h-7 max-w-full px-2 text-xs"
              onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                event.preventDefault();
                insertCollaborationMention(name);
              }}
            >
              <span className="truncate">@{name}</span>
            </Button>
          ))}
        </div>
      </div>
    ) : null
  ), [activeMentionIndex, insertCollaborationMention, mentionSuggestions]);

  const pluginContext = useMemo(() => ({
    hasWorkflow: Boolean(binding?.configFile),
    hasCollaboration: Boolean(collaborationRoom),
    hasCreation: false,
    activeIntent: sidebarHint?.intent,
    activePhase: workflowStatus?.currentPhase,
  }), [binding?.configFile, collaborationRoom, sidebarHint?.intent, workflowStatus?.currentPhase]);

  const { isExternalPluginTab, renderActiveTab } = usePluginRenderers(
    activeTab,
    { commander: () => null, agent: () => null },
    pluginContext,
  );

  const commanderPanelContext: CommanderPanelContext = {
    shouldShowWorkflowRuntimePanels: true,
    boundHumanQuestions,
    otherHumanQuestions,
    unansweredHumanQuestions,
    answerHumanQuestion,
    navigateToHumanQuestion,
    submittingHumanQuestionId,
    binding,
    boundCommander,
    boundWorkflow,
    effectiveWorkflowTarget,
    workflowStatus,
    persistedPreflight,
    startingWorkflow,
    handleStartWorkflow,
    collaborationRoom,
    collaborationDraft,
    collaborationTopic,
    collaborationBusy,
    collaborationMessages,
    collaborationTextareaRef,
    mentionSuggestions,
    activeMentionIndex,
    renderMentionSuggestions,
    setCollaborationDraft,
    setCollaborationTopic,
    setActiveMentionIndex,
    insertCollaborationMention,
    updateCollaborationRoom,
    handleWorkflowGroupChat,
    workflowCollaborationGuests,
    preflightChecks,
    reports,
    onQuickPrompt,
    formatSupervisorReviewType,
    activeSessionId,
  };

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col border-l border-border bg-card">
        <div className="border-b bg-card px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Context</p>
              <h2 className="text-lg font-semibold">上下文指挥区</h2>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill tone="warning">指挥官</StatusPill>
              <Button size="icon" variant="ghost" className="h-11 w-11" onClick={expanded ? onCollapse : onExpand}>
                <span className="material-symbols-outlined" style={{ fontSize: '28px' }}>{expanded ? 'right_panel_close' : 'right_panel_open'}</span>
              </Button>
            </div>
          </div>
          <div className={`mt-4 grid gap-2 ${availableTabs.length <= 1 ? 'grid-cols-1' : availableTabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {availableTabs.map((tab) => (
              <Button key={tab} size="sm" variant={activeTab === tab ? 'secondary' : 'outline'} className="justify-center rounded-md" onClick={() => onTabChange(tab)}>
                {TAB_LABELS[tab]}
              </Button>
            ))}
          </div>
        </div>

        <div className="home-chat-scroll flex-1 overflow-y-auto px-4 py-4 pb-16">
          {(sidebarHint?.summary || sidebarHint?.reason || recentConversation.length > 0 || sidebarHint?.knownFacts?.length || sidebarHint?.missingFields?.length || sidebarHint?.questions?.length || sidebarHint?.recommendedNextAction) ? (
            <div className="mb-4 space-y-3 rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">当前对话上下文</div>
                  <div className="mt-1 text-xs text-muted-foreground">根据最近对话整理目标、缺口和下一步动作。</div>
                </div>
                <div className="flex items-center gap-2">
                  {sidebarHint?.stage ? <StatusPill tone="accent">{formatSidebarStage(sidebarHint.stage)}</StatusPill> : null}
                  <StatusPill tone="neutral">AI整理</StatusPill>
                </div>
              </div>
              {sidebarHint?.reason ? <div className="text-xs leading-5 text-muted-foreground">触发原因：{sidebarHint.reason}</div> : null}
              {sidebarHint?.summary ? <div className="rounded-xl border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">{sidebarHint.summary}</div> : null}
              {(activeTab === 'agent' ? agentFocusFacts : commanderFocusFacts).length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {(activeTab === 'agent' ? agentFocusFacts : commanderFocusFacts).map((fact) => <div key={fact} className="min-w-0 whitespace-normal break-all rounded-xl border bg-background/80 px-3 py-2 text-xs text-muted-foreground">{fact}</div>)}
                </div>
              ) : null}
              {sidebarHint?.knownFacts?.length ? <div className="rounded-xl border bg-background/70 p-3"><div className="text-xs font-medium text-foreground">已确认上下文</div><div className="mt-2 flex flex-wrap gap-2">{sidebarHint.knownFacts.map((fact) => <Badge key={fact} variant="outline" className="max-w-full whitespace-normal break-all text-left">{fact}</Badge>)}</div></div> : null}
              {sidebarHint?.missingFields?.length ? <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><div className="text-xs font-medium text-foreground">仍缺信息</div><div className="mt-2 space-y-1.5 text-xs text-muted-foreground">{sidebarHint.missingFields.map((field) => <div key={field}>- {field}</div>)}</div></div> : null}
              {sidebarHint?.questions?.length ? <div className="rounded-xl border bg-background/70 p-3"><div className="text-xs font-medium text-foreground">建议下一轮补问</div><div className="mt-2 space-y-1.5 text-xs text-muted-foreground">{sidebarHint.questions.map((question) => <div key={question}>- {question}</div>)}</div></div> : null}
              {sidebarHint?.recommendedNextAction ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-muted-foreground"><span className="font-medium text-foreground">推荐动作：</span>{sidebarHint.recommendedNextAction}</div> : null}
              {recentConversation.length > 0 ? <details className="rounded-xl border bg-background/70 p-3"><summary className="cursor-pointer text-xs font-medium text-foreground">展开最近对话摘录</summary><div className="mt-3 space-y-2">{recentConversation.map((message) => <div key={message.id} className="rounded-xl border bg-background/70 px-3 py-2 text-xs text-muted-foreground"><span className="mr-2 font-medium text-foreground">{message.role === 'user' ? '用户' : '助手'}</span>{message.content.length > 120 ? `${message.content.slice(0, 120)}...` : message.content}</div>)}</div></details> : null}
            </div>
          ) : null}

          {availableTabs.includes('commander') && activeTab === 'commander' ? <CommanderPanel ctx={commanderPanelContext} /> : null}
          {availableTabs.includes('agent') && activeTab === 'agent' ? (
            <AgentPanel
              sidebarHint={sidebarHint}
              agentDraft={agentDraft}
              setAgentDraft={setAgentDraft}
              agentDraftPreview={agentDraftPreview}
              agentDraftRaw={agentDraftRaw}
              draftingAgent={draftingAgent}
              creatingAgent={creatingAgent}
              engine={engine}
              workflows={workflows}
              onOpenModal={() => setAgentModalOpen(true)}
              onOpenAgentsPage={() => router.push('/agents')}
              onGenerateDraft={handleGenerateAgentDraft}
              onCreateAgent={handleCreateAgent}
            />
          ) : null}
          {isExternalPluginTab ? renderActiveTab() : null}
        </div>

        <div className="flex shrink-0 items-center justify-center border-t bg-background/80 px-3 py-2">
          <Button size="sm" variant="ghost" className="h-10 w-full gap-2" onClick={expanded ? onCollapse : onExpand} title={expanded ? '收起首页指挥区' : '展开首页指挥区'}>
            <span className="material-symbols-outlined" style={{ fontSize: '24px' }}>{expanded ? 'right_panel_close' : 'right_panel_open'}</span>
            <span className="text-xs">{expanded ? '收起上下文' : '展开上下文'}</span>
          </Button>
        </div>
      </aside>

      <AIAgentCreatorModal
        open={agentModalOpen}
        engine={engine}
        model={model}
        initialDraft={agentDraft}
        onClose={closeAgentModal}
        onCreate={async (agent) => {
          try {
            await agentApi.saveAgent(agent.name, agent);
            toast('success', `已创建 Agent：${agent.name}`);
            await loadSidebarData();
            return true;
          } catch (error: any) {
            toast('error', error?.message || '创建 Agent 失败');
            return false;
          }
        }}
        onContinueEdit={(agent) => {
          setAgentModalOpen(false);
          router.push('/agents');
          toast('success', `已生成 Agent 草案：${agent.name}，请在 Agent 页面继续精修`);
        }}
      />
      {confirmDialogProps ? <ConfirmDialog {...confirmDialogProps} /> : null}
    </>
  );
}
