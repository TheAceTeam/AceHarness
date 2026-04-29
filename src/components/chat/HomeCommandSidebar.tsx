'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { agentApi, configApi, workflowApi } from '@/lib/api';
import type { HomeSidebarHint, SessionWorkbenchState } from '@/lib/home-sidebar-state';
import type { HumanQuestion } from '@/lib/run-state-persistence';
import HumanQuestionInbox from '@/components/workflow/HumanQuestionInbox';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  buildWorkflowConversationDirectory,
  getConversationSessionStatusLabel,
  getCreationSessionStatusLabel,
  type WorkflowCreationBindingLike,
  type WorkflowRunBindingLike,
} from '@/lib/agent-conversations';
import {
  buildAgentDraftPreview,
  buildAgentSystemPrompt,
  createInitialAgentDraft,
  extractAgentDraftCapabilities,
  mergeAgentDraft,
  type AgentDraftState,
} from '@/lib/agent-draft';
import NewConfigModal from '@/components/NewConfigModal';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { SingleCombobox } from '@/components/ui/combobox';

type SidebarTab = 'commander' | 'workflow' | 'agent';

type WorkflowSummary = {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
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

function buildPreflightWarningDescription(checks: PreflightCheck[]): string {
  const warnings = checks.filter((check) => check.status === 'warning').slice(0, 3);
  if (warnings.length === 0) return '启动前检查存在警告，确认后将继续启动。';
  return warnings
    .map((check) => `${check.summary}${check.commands[0]?.command ? `\n${check.commands[0].command}` : ''}`)
    .join('\n\n');
}

type WorkflowDraftState = {
  name: string;
  requirements: string;
  description: string;
  referenceWorkflow: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
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

function formatSupervisorReviewType(type?: string | null): string {
  if (type === 'checkpoint-advice') return '检查点建议';
  if (type === 'chat-revision') return '对话修订';
  if (type === 'state-review') return '阶段审阅';
  return type || '未知';
}

function formatSidebarStage(stage?: string | null): string {
  switch (stage) {
    case 'clarifying':
      return '需求澄清';
    case 'spec-draft':
      return 'Spec Coding 草案';
    case 'spec-review':
      return 'Spec Coding 评审';
    case 'workflow-draft':
      return '工作流草案';
    case 'agent-draft':
      return 'Agent 草案';
    case 'preflight':
      return '启动前检查';
    case 'running':
      return '运行中';
    case 'review':
      return '复盘';
    default:
      return stage || '待命';
  }
}

type ActiveChatSession = {
  id: string;
  messages?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    rawContent?: string;
    timestamp: number;
  }>;
  creationSession?: WorkflowCreationBindingLike;
  workflowBinding?: WorkflowRunBindingLike;
} | null;

type CreationSessionBinding = NonNullable<Exclude<ActiveChatSession, null>['creationSession']>;

interface HomeCommandSidebarProps {
  engine: string;
  model: string;
  onQuickPrompt: (prompt: string) => void;
  activeSessionId: string | null;
  ensureSessionId: () => string;
  activeSession: ActiveChatSession;
  sessionWorkbenchState?: SessionWorkbenchState;
  setSessionWorkbenchState: (state: SessionWorkbenchState | ((prev: SessionWorkbenchState | undefined) => SessionWorkbenchState)) => void;
  sidebarHint: HomeSidebarHint | null;
  activeTab: SidebarTab;
  availableTabs: SidebarTab[];
  onTabChange: (tab: SidebarTab) => void;
  expanded: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}

const TAB_LABELS: Record<SidebarTab, string> = {
  commander: '指挥官',
  workflow: '工作流',
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

export default function HomeCommandSidebar({
  engine,
  model,
  onQuickPrompt,
  activeSessionId,
  ensureSessionId,
  activeSession,
  sessionWorkbenchState,
  setSessionWorkbenchState,
  sidebarHint,
  activeTab,
  availableTabs,
  onTabChange,
  expanded,
  onCollapse,
  onExpand,
}: HomeCommandSidebarProps) {
  const router = useRouter();
  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const [workflowModalOpen, setWorkflowModalOpen] = useState(false);
  const [agentModalOpen, setAgentModalOpen] = useState(false);
  const [workflowDraft, setWorkflowDraft] = useState<WorkflowDraftState>({
    name: '',
    requirements: '',
    description: '',
    referenceWorkflow: '',
    workingDirectory: '',
    workspaceMode: 'in-place',
  });
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [selectedWorkflow, setSelectedWorkflow] = useState('');
  const [inspectedWorkflow, setInspectedWorkflow] = useState<WorkflowSummary | null>(null);
  const [workflowStatus, setWorkflowStatus] = useState<any>(null);
  const [unansweredHumanQuestions, setUnansweredHumanQuestions] = useState<HumanQuestion[]>([]);
  const [currentCreationSession, setCurrentCreationSession] = useState<CreationSessionBinding | null>(activeSession?.creationSession || null);
  const [reports, setReports] = useState<ProgressReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingWorkflow, setStartingWorkflow] = useState(false);
  const [preflightChecks, setPreflightChecks] = useState<PreflightCheck[]>([]);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [draftingAgent, setDraftingAgent] = useState(false);
  const [agentDraftResult, setAgentDraftResult] = useState<AgentDraftResult | null>(null);
  const [agentDraftRaw, setAgentDraftRaw] = useState('');
  const lastStatusSignatureRef = useRef('');
  const lastAppliedSidebarHintRef = useRef<string>('');
  const [agentDraft, setAgentDraft] = useState<AgentDraftState>(createInitialAgentDraft());

  const binding = activeSession?.workflowBinding;
  const creationBinding = activeSession?.creationSession;
  const boundWorkflow = binding?.configFile || '';
  const boundCommander = binding?.supervisorAgent || 'default-supervisor';
  const workflowDirectory = useMemo(
    () => buildWorkflowConversationDirectory(binding),
    [binding]
  );
  const effectiveWorkflowTarget = selectedWorkflow || boundWorkflow || '';
  const persistedPreflight = sessionWorkbenchState?.latestPreflight;
  const recentConversation = useMemo(() => {
    return (activeSession?.messages || [])
      .filter((message) => message.role !== 'error')
      .slice(-6)
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: (message.rawContent || message.content || '').replace(/\s+/g, ' ').trim(),
      }))
      .filter((message) => Boolean(message.content));
  }, [activeSession?.messages]);
  const workflowFocusFacts = useMemo(() => {
    const facts = [
      workflowDraft.name ? `工作流：${workflowDraft.name}` : '',
      workflowDraft.workingDirectory ? `目录：${workflowDraft.workingDirectory}` : '',
      workflowDraft.referenceWorkflow ? `参考：${workflowDraft.referenceWorkflow}` : '',
      workflowDraft.workspaceMode ? `模式：${workflowDraft.workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}` : '',
    ].filter(Boolean);
    return facts.slice(0, 4);
  }, [workflowDraft]);
  const agentFocusFacts = useMemo(() => {
    const facts = [
      agentDraft.displayName ? `角色：${agentDraft.displayName}` : '',
      agentDraft.team ? `队伍：${agentDraft.team}` : '',
      agentDraft.mission ? `职责：${agentDraft.mission}` : '',
      agentDraft.referenceWorkflow ? `参考：${agentDraft.referenceWorkflow}` : '',
      sidebarHint?.agentDraft?.workingDirectory ? `目录：${sidebarHint.agentDraft.workingDirectory}` : '',
    ].filter(Boolean);
    return facts.slice(0, 4);
  }, [agentDraft, sidebarHint?.agentDraft?.workingDirectory]);
  const commanderFocusFacts = useMemo(() => {
    const facts = [
      effectiveWorkflowTarget ? `目标：${effectiveWorkflowTarget}` : '',
      workflowStatus?.currentPhase ? `阶段：${workflowStatus.currentPhase}` : '',
      workflowStatus?.currentStep ? `步骤：${workflowStatus.currentStep}` : '',
      workflowStatus?.status ? `状态：${workflowStatus.status}` : '',
    ].filter(Boolean);
    return facts.slice(0, 4);
  }, [effectiveWorkflowTarget, workflowStatus?.currentPhase, workflowStatus?.currentStep, workflowStatus?.status]);
  const agentDraftPreview = useMemo(() => (
    buildAgentDraftPreview({
      engine,
      model,
      draft: agentDraft,
      existingDraft: agentDraftResult,
    }) as AgentDraftResult | null
  ), [agentDraft, agentDraftResult, engine, model]);

  useEffect(() => {
    setCurrentCreationSession(creationBinding || null);
  }, [creationBinding]);

  useEffect(() => {
    if (!sidebarHint) return;
    const signature = JSON.stringify(sidebarHint);
    if (signature === lastAppliedSidebarHintRef.current) return;
    lastAppliedSidebarHintRef.current = signature;

    if (sidebarHint.workflowDraft) {
      setWorkflowDraft((prev) => ({
        name: sidebarHint.workflowDraft?.name ?? prev.name,
        requirements: sidebarHint.workflowDraft?.requirements ?? prev.requirements,
        description: sidebarHint.workflowDraft?.description ?? prev.description,
        referenceWorkflow: sidebarHint.workflowDraft?.referenceWorkflow ?? prev.referenceWorkflow,
        workingDirectory: sidebarHint.workflowDraft?.workingDirectory ?? prev.workingDirectory,
        workspaceMode: sidebarHint.workflowDraft?.workspaceMode ?? prev.workspaceMode,
      }));
    }

    if (sidebarHint.agentDraft) {
      setAgentDraft((prev) => mergeAgentDraft(prev, {
        displayName: sidebarHint.agentDraft?.displayName ?? prev.displayName,
        team: (sidebarHint.agentDraft?.team as AgentDraftState['team'] | undefined) ?? prev.team,
        mission: sidebarHint.agentDraft?.mission ?? prev.mission,
        style: sidebarHint.agentDraft?.style ?? prev.style,
        specialties: sidebarHint.agentDraft?.specialties ?? prev.specialties,
        workingDirectory: sidebarHint.agentDraft?.workingDirectory ?? prev.workingDirectory,
        referenceWorkflow: prev.referenceWorkflow,
      }));
    }
  }, [sidebarHint]);

  const clearModalOpenHint = useCallback(() => {
    setSessionWorkbenchState((prev) => ({
      ...(prev || {}),
      homeSidebar: prev?.homeSidebar
        ? { ...prev.homeSidebar, shouldOpenModal: false }
        : prev?.homeSidebar,
    }));
  }, [setSessionWorkbenchState]);

  const closeWorkflowModal = useCallback(() => {
    setWorkflowModalOpen(false);
    clearModalOpenHint();
  }, [clearModalOpenHint]);

  const closeAgentModal = useCallback(() => {
    setAgentModalOpen(false);
    clearModalOpenHint();
  }, [clearModalOpenHint]);

  const modalOpenHandledRef = useRef(false);

  useEffect(() => {
    if (!sidebarHint?.shouldOpenModal) {
      modalOpenHandledRef.current = false;
      return;
    }
    if (modalOpenHandledRef.current) return;
    modalOpenHandledRef.current = true;

    if (activeTab === 'workflow') {
      setWorkflowModalOpen(true);
    } else if (activeTab === 'agent') {
      setAgentModalOpen(true);
    }
    clearModalOpenHint();
  }, [activeTab, sidebarHint?.shouldOpenModal]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadSidebarData = useCallback(async () => {
    try {
      setLoading(true);
      const [configData, agentData] = await Promise.all([
        configApi.listConfigs(),
        agentApi.listAgents(),
      ]);

      setWorkflows((configData.configs || []) as WorkflowSummary[]);
      setAgents((agentData.agents || []) as AgentSummary[]);
    } catch (error: any) {
      toast('error', error?.message || '加载指挥官边栏数据失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSidebarData();
  }, [loadSidebarData]);

  useEffect(() => {
    setAgentDraftResult(null);
    setAgentDraftRaw('');
  }, [agentDraft.displayName, agentDraft.team, agentDraft.mission, agentDraft.style, agentDraft.specialties]);

  useEffect(() => {
    if (preflightChecks.length > 0) return;
    if (!persistedPreflight?.checks?.length) return;
    setPreflightChecks(
      persistedPreflight.checks.map((check) => ({
        id: check.id,
        category: check.category,
        status: check.status,
        origin: check.origin,
        summary: check.summary,
        commands: check.command ? [{
          command: check.command,
          exitCode: null,
          status: check.status,
        }] : [],
      }))
    );
  }, [persistedPreflight, preflightChecks.length]);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const result = await workflowApi.listHumanQuestions({ status: 'unanswered', limit: 20 });
        if (!cancelled) setUnansweredHumanQuestions(result.questions || []);
      } catch {
        // Inbox is best-effort.
      }
    };

    poll();
    const timer = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const navigateToHumanQuestion = useCallback((question: HumanQuestion) => {
    router.push(`/workbench/${encodeURIComponent(question.configFile)}?mode=run&focus=human-question&questionId=${encodeURIComponent(question.id)}&runId=${encodeURIComponent(question.runId)}`);
  }, [router]);

  useEffect(() => {
    if (!boundWorkflow) {
      setWorkflowStatus(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      try {
        const status = await workflowApi.getStatus(boundWorkflow);
        if (cancelled) return;
        setWorkflowStatus(status);

        const signature = [
          status?.status || '',
          status?.currentPhase || '',
          status?.currentStep || '',
          status?.currentConfigFile || '',
        ].join('|');

        if (signature && signature !== lastStatusSignatureRef.current) {
          lastStatusSignatureRef.current = signature;

          const matched = status?.currentConfigFile === boundWorkflow;
          const title = matched
            ? `指挥官汇报：${status?.currentPhase || '待命'}`
            : '指挥官待命';
          const content = matched
            ? `当前状态：${status?.status || '未知'}；阶段：${status?.currentPhase || '未进入'}；步骤：${status?.currentStep || '等待中'}。`
            : `已绑定工作流 ${boundWorkflow}，当前尚未启动或正在等待调度。`;
          const tone: ProgressReport['tone'] =
            status?.status === 'failed' ? 'warning' :
              status?.status === 'completed' ? 'success' : 'info';

          setReports((prev) => [
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              timestamp: new Date().toISOString(),
              title,
              content,
              tone,
            },
            ...prev,
          ].slice(0, 8));
        }
      } catch {
        // Ignore polling errors here; sidebar is best-effort.
      }
    };

    poll();
    const timer = window.setInterval(poll, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [boundWorkflow]);

  const handleStartWorkflow = useCallback(async () => {
    const targetWorkflow = selectedWorkflow || boundWorkflow;
    if (!targetWorkflow) {
      toast('warning', '请先创建或选择一个工作流');
      return;
    }
    try {
      setStartingWorkflow(true);
      const sessionId = activeSessionId || ensureSessionId();
      const preflight = await workflowApi.preflight(targetWorkflow);
      setPreflightChecks(preflight.checks || []);
      setSessionWorkbenchState((prev) => ({
        ...(prev || {}),
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
          })),
        },
      }));
      if (!preflight.ok) {
        toast('error', `启动前检查未通过：${preflight.failedCount} 项失败`);
        return;
      }
      if (preflight.warningCount > 0) {
        const confirmed = await confirm({
          title: '启动前检查存在警告',
          description: buildPreflightWarningDescription(preflight.checks || []),
          confirmLabel: '继续启动',
          cancelLabel: '取消',
          variant: 'default',
        });
        if (!confirmed) {
          toast('warning', '已取消启动，可先处理 preflight 警告');
          return;
        }
      }
      await workflowApi.start(targetWorkflow, sessionId || undefined, {
        skipPreflight: true,
        preflightChecks: preflight.checks || [],
      });
      toast('success', `已启动工作流：${targetWorkflow}`);
      router.push(`/workbench/${encodeURIComponent(targetWorkflow)}?mode=run`);
    } catch (error: any) {
      toast('error', error?.message || '启动工作流失败');
    } finally {
      setStartingWorkflow(false);
    }
  }, [activeSessionId, boundWorkflow, ensureSessionId, router, selectedWorkflow, setSessionWorkbenchState, toast]);

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
      keywords: agentDraft.specialties
        ? extractAgentDraftCapabilities(agentDraft.specialties)
        : [],
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
  }, [agentDraft, agentDraftResult, engine, model, loadSidebarData, toast]);

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
  }, [agentDraft, engine, model, toast]);

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col border-l bg-card/40 backdrop-blur-sm">
        <div className="border-b px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Command</p>
              <h2 className="text-lg font-semibold">首页指挥区</h2>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="border-amber-500/40 text-amber-600 dark:text-amber-300">
                指挥官
              </Badge>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={expanded ? onCollapse : onExpand}>
                <span className="material-symbols-outlined text-base">{expanded ? 'right_panel_close' : 'right_panel_open'}</span>
              </Button>
            </div>
          </div>
            <div className={`mt-4 grid gap-2 ${availableTabs.length <= 1 ? 'grid-cols-1' : availableTabs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {availableTabs.map((tab) => (
              <Button
                key={tab}
                size="sm"
                variant={activeTab === tab ? 'default' : 'outline'}
                className="justify-center"
                onClick={() => onTabChange(tab)}
              >
                {TAB_LABELS[tab]}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {(sidebarHint?.summary || sidebarHint?.reason || recentConversation.length > 0 || sidebarHint?.knownFacts?.length || sidebarHint?.missingFields?.length || sidebarHint?.questions?.length || sidebarHint?.recommendedNextAction) && (
            <div className="mb-4 space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">当前对话上下文</div>
                  <div className="mt-1 text-xs text-muted-foreground">由最近一条结构化 `home_sidebar` 结果驱动，侧边栏表单会按此自动预填。</div>
                </div>
                <div className="flex items-center gap-2">
                  {sidebarHint?.stage ? (
                    <Badge variant="secondary">{formatSidebarStage(sidebarHint.stage)}</Badge>
                  ) : null}
                  <Badge variant="outline">AI整理</Badge>
                </div>
              </div>
              {sidebarHint?.reason ? (
                <div className="text-xs text-muted-foreground leading-5">
                  触发原因：{sidebarHint.reason}
                </div>
              ) : null}
              {sidebarHint?.summary ? (
                <div className="rounded-xl border bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                  {sidebarHint.summary}
                </div>
              ) : null}
              {(activeTab === 'workflow' ? workflowFocusFacts : activeTab === 'agent' ? agentFocusFacts : commanderFocusFacts).length > 0 ? (
                <div className="grid gap-2 md:grid-cols-2">
                  {(activeTab === 'workflow' ? workflowFocusFacts : activeTab === 'agent' ? agentFocusFacts : commanderFocusFacts).map((fact) => (
                    <div key={fact} className="min-w-0 whitespace-normal break-all rounded-xl border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                      {fact}
                    </div>
                  ))}
                </div>
              ) : null}
              {sidebarHint?.knownFacts?.length ? (
                <div className="rounded-xl border bg-background/70 p-3">
                  <div className="text-xs font-medium text-foreground">已确认上下文</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sidebarHint.knownFacts.map((fact) => (
                      <Badge key={fact} variant="outline" className="max-w-full whitespace-normal break-all text-left">
                        {fact}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}
              {sidebarHint?.missingFields?.length ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                  <div className="text-xs font-medium text-foreground">仍缺信息</div>
                  <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    {sidebarHint.missingFields.map((field) => (
                      <div key={field}>- {field}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              {sidebarHint?.questions?.length ? (
                <div className="rounded-xl border bg-background/70 p-3">
                  <div className="text-xs font-medium text-foreground">建议下一轮补问</div>
                  <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                    {sidebarHint.questions.map((question) => (
                      <div key={question}>- {question}</div>
                    ))}
                  </div>
                </div>
              ) : null}
              {sidebarHint?.recommendedNextAction ? (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">推荐动作：</span>
                  {sidebarHint.recommendedNextAction}
                </div>
              ) : null}
              {recentConversation.length > 0 ? (
                <details className="rounded-xl border bg-background/70 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">展开最近对话摘录</summary>
                  <div className="mt-3 space-y-2">
                    {recentConversation.map((message) => (
                      <div key={message.id} className="rounded-xl border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
                        <span className="mr-2 font-medium text-foreground">{message.role === 'user' ? '用户' : '助手'}</span>
                        {message.content.length > 120 ? `${message.content.slice(0, 120)}...` : message.content}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          )}

          {availableTabs.includes('commander') && activeTab === 'commander' && (
            <div className="space-y-4">
              <HumanQuestionInbox
                questions={unansweredHumanQuestions}
                onNavigate={navigateToHumanQuestion}
              />

              <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-background to-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">当前指挥官</p>
                    <div className="mt-1 text-base font-semibold">{boundCommander || 'default-supervisor'}</div>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-400 to-stone-900 text-white flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined">military_tech</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">
                  指挥官会跟随当前会话最近一次启动的 workflow 运行自动切换，不再要求手动绑定。
                </p>
              </div>

              <div className="rounded-2xl border p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">工作流状态</span>
                  <Badge variant="secondary">{workflowStatus?.status || 'idle'}</Badge>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">当前阶段</div>
                    <div className="mt-1 text-sm font-medium">{workflowStatus?.currentPhase || '未开始'}</div>
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[11px] text-muted-foreground">当前步骤</div>
                    <div className="mt-1 text-sm font-medium">{workflowStatus?.currentStep || '未开始'}</div>
                  </div>
                </div>
                <details className="rounded-xl border bg-muted/10 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">展开运行上下文</summary>
                  <div className="mt-3 text-xs text-muted-foreground space-y-1">
                    <div>当前会话：{activeSessionId || '未创建'}</div>
                    <div>运行配置：{boundWorkflow || '尚未通过当前会话启动 workflow'}</div>
                    <div>候选配置：{effectiveWorkflowTarget || '未选择'}</div>
                    <div>指挥官：{boundCommander}</div>
                    {currentCreationSession ? (
                      <div>创建态：{currentCreationSession.workflowName} / {getCreationSessionStatusLabel(currentCreationSession.status)}</div>
                    ) : null}
                  </div>
                </details>
                {workflowDirectory.length > 0 ? (
                  <div className="rounded-xl border bg-muted/10 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs font-medium text-foreground">当前运行通讯录</div>
                      <Badge variant="outline">{workflowDirectory.length} 个角色</Badge>
                    </div>
                    <div className="space-y-2">
                      {workflowDirectory.map((entry) => (
                        <div key={entry.key} className="rounded-xl border bg-background/80 px-3 py-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                              {entry.role}
                            </span>
                            <span className="font-medium text-foreground">{entry.label}</span>
                          </div>
                          <div className="mt-1 truncate" title={entry.sessionId || getConversationSessionStatusLabel(entry)}>
                            {entry.sessionId || getConversationSessionStatusLabel(entry)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {workflowStatus?.specCodingSummary ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">运行绑定的 Spec Coding 制品</div>
                    <div>版本：v{workflowStatus.specCodingSummary.version}</div>
                    <div>状态：{workflowStatus.specCodingSummary.status}</div>
                    {workflowStatus.specCodingSummary.source ? (
                      <div>来源：{workflowStatus.specCodingSummary.source === 'run' ? 'run snapshot' : 'creation baseline'}</div>
                    ) : null}
                    <div>阶段：{workflowStatus.specCodingSummary.phaseCount}</div>
                    {typeof workflowStatus.specCodingSummary.taskCount === 'number' ? (
                      <div>任务：{workflowStatus.specCodingSummary.taskCount}</div>
                    ) : null}
                    <div>修订：{workflowStatus.specCodingSummary.revisionCount}</div>
                    {workflowStatus.specCodingSummary.progress?.summary ? (
                      <div>进度：{workflowStatus.specCodingSummary.progress.summary}</div>
                    ) : null}
                    {workflowStatus.specCodingSummary.latestRevision?.summary ? (
                      <div>最近修订：{workflowStatus.specCodingSummary.latestRevision.summary}</div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.latestSupervisorReview?.content ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">最近一次 Supervisor 审阅</div>
                    <div>类型：{formatSupervisorReviewType(workflowStatus.latestSupervisorReview.type)}</div>
                    <div>阶段：{workflowStatus.latestSupervisorReview.stateName}</div>
                    <div className="leading-5">{workflowStatus.latestSupervisorReview.content}</div>
                    {workflowStatus.latestSupervisorReview.affectedArtifacts?.length ? (
                      <div>
                        影响制品：{workflowStatus.latestSupervisorReview.affectedArtifacts.join('、')}
                      </div>
                    ) : null}
                    {workflowStatus.latestSupervisorReview.impact?.length ? (
                      <div className="space-y-1 pt-1">
                        <div className="text-foreground">影响范围</div>
                        {workflowStatus.latestSupervisorReview.impact.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.finalReview ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">运行结算</div>
                    <div>状态：{workflowStatus.finalReview.status}</div>
                    <div>总评：{workflowStatus.finalReview.summary}</div>
                    {workflowStatus.finalReview.scoreCards?.length ? (
                      <div>评分卡：{workflowStatus.finalReview.scoreCards.length}</div>
                    ) : null}
                  </div>
                ) : null}
                {workflowStatus?.rehearsal?.enabled ? (
                  <div className="rounded-xl border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">演练模式</div>
                    <div>{workflowStatus.rehearsal.summary}</div>
                    {workflowStatus.rehearsal.recommendedNextSteps?.length ? (
                      <div className="space-y-1 pt-1">
                        {workflowStatus.rehearsal.recommendedNextSteps.map((item: string) => (
                          <div key={item}>- {item}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {preflightChecks.length > 0 ? (
                  <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-2">
                    <div className="font-medium text-foreground">最近一次启动前检查</div>
                    {persistedPreflight?.configFile ? (
                      <div>目标：{persistedPreflight.configFile}</div>
                    ) : null}
                    {persistedPreflight ? (
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={persistedPreflight.ok ? 'secondary' : 'destructive'}>
                          {persistedPreflight.ok ? '通过' : '未通过'}
                        </Badge>
                        {persistedPreflight.warningCount > 0 ? (
                          <Badge variant="outline">警告 {persistedPreflight.warningCount}</Badge>
                        ) : null}
                        {persistedPreflight.policy?.inferredCommandCount ? (
                          <Badge variant="outline">推断命令 {persistedPreflight.policy.inferredCommandCount}</Badge>
                        ) : null}
                      </div>
                    ) : null}
                    {persistedPreflight?.checkedAt ? (
                      <div className="text-[11px] text-muted-foreground">
                        检查时间：{new Date(persistedPreflight.checkedAt).toLocaleString()}
                      </div>
                    ) : null}
                    {preflightChecks.slice(0, 4).map((check) => (
                      <div key={check.id} className="rounded-lg border bg-background/70 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span>{check.summary}</span>
                          <Badge variant={check.status === 'failed' ? 'destructive' : 'outline'}>
                            {check.category}
                          </Badge>
                        </div>
                        {check.origin === 'inferred' ? (
                          <div className="mt-1 text-[11px] text-muted-foreground">来源：项目默认推断</div>
                        ) : null}
                        <div className="mt-1 truncate text-[11px]" title={check.commands[0]?.command || ''}>
                          {check.commands[0]?.command || ''}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="pt-2 flex gap-2">
                  <Button size="sm" className="flex-1" onClick={handleStartWorkflow} disabled={startingWorkflow || !effectiveWorkflowTarget}>
                    {startingWorkflow ? '检查并启动中...' : '检查并启动'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onQuickPrompt(`请结合当前会话最近对话历史，以指挥官 ${boundCommander || 'default-supervisor'} 的视角，汇报当前会话最新运行 ${boundWorkflow || effectiveWorkflowTarget || '（暂无运行）'} 的进度、风险和下一步建议。`)}
                  >
                    询问
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium">最近汇报</h3>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onQuickPrompt(`请结合当前会话最近对话历史，以指挥官 ${boundCommander || 'default-supervisor'} 的视角，生成一份结构化进度汇报。`)}
                  >
                    立即汇报
                  </Button>
                </div>
                {reports.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                    还没有进度汇报。绑定并启动一个工作流后，指挥官会在这里持续汇报。
                  </div>
                ) : reports.map((report) => (
                  <div key={report.id} className="rounded-2xl border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-medium">{report.title}</div>
                      <Badge variant={report.tone === 'warning' ? 'destructive' : 'secondary'}>
                        {new Date(report.timestamp).toLocaleTimeString()}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground leading-5">{report.content}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {availableTabs.includes('workflow') && activeTab === 'workflow' && (
            <div className="space-y-4">
              <div className="rounded-2xl border p-4">
                <h3 className="text-sm font-medium">AI 引导创建工作流</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-5">
                  从首页直接进入结构化引导流程，而不是把所有创建逻辑都塞进聊天气泡里。
                </p>
                {currentCreationSession ? (
                  <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">当前创建态</div>
                    <div>工作流：{currentCreationSession.workflowName}</div>
                    <div>配置文件：{currentCreationSession.filename}</div>
                    <div>状态：{currentCreationSession.status}</div>
                    <div>Spec Coding：{currentCreationSession.specCodingId}</div>
                  </div>
                ) : null}
                {workflowDraft.workingDirectory ? (
                  <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">当前识别到的工作目录上下文</div>
                    <div className="whitespace-normal break-all">目录：{workflowDraft.workingDirectory}</div>
                    <div>模式：{workflowDraft.workspaceMode === 'isolated-copy' ? '创建副本工程后执行' : '直接在工作目录执行'}</div>
                  </div>
                ) : null}
                <div className="mt-4 space-y-3">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">工作流名称</label>
                    <Input
                      value={workflowDraft.name}
                      onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, name: e.target.value }))}
                      placeholder="例如：移动端重构流程"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">需求概述</label>
                    <Textarea
                      value={workflowDraft.requirements}
                      onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, requirements: e.target.value }))}
                      placeholder="例如：围绕首页重构、状态机工作流改造、Agent 角色化做一套协作流程"
                      rows={4}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">补充说明</label>
                    <Textarea
                      value={workflowDraft.description}
                      onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, description: e.target.value }))}
                      placeholder="可选：约束、目标目录、验收标准"
                      rows={3}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">参考工作流</label>
                    <SingleCombobox
                      value={workflowDraft.referenceWorkflow || '__none__'}
                      onValueChange={(value) => setWorkflowDraft((prev) => ({ ...prev, referenceWorkflow: value === '__none__' ? '' : value }))}
                      options={[
                        { value: '__none__', label: '不使用参考工作流' },
                        ...workflows.map((workflow) => ({
                          value: workflow.filename,
                          label: `${workflow.name} (${workflow.filename})`,
                        })),
                      ]}
                      placeholder={loading ? '加载中...' : '选择参考工作流'}
                    />
                    <p className="text-xs text-muted-foreground">
                      会沿用参考工作流的结构和 Agent 选用，只更新需求与任务分配。
                    </p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">工作目录</label>
                    <Input
                      value={workflowDraft.workingDirectory}
                      onChange={(e) => setWorkflowDraft((prev) => ({ ...prev, workingDirectory: e.target.value }))}
                      placeholder="例如：/workspace/project"
                    />
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => setWorkflowModalOpen(true)}>创建工作流</Button>
                  <Button size="sm" variant="outline" onClick={() => router.push('/workflows')}>
                    打开工作流页
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-medium">当前工作流目标</h3>
                  <Badge variant="outline">{effectiveWorkflowTarget ? '已锁定' : '待选择'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground leading-5">
                  {effectiveWorkflowTarget
                    ? `当前会以 ${effectiveWorkflowTarget} 作为运行目标。`
                    : '当前还没有选中的运行目标，可从下方已有工作流中挑一个，也可以先走右侧的创建态。'}
                </div>
                <details className="rounded-xl border bg-muted/10 p-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">展开已有工作流列表</summary>
                  <div className="mt-3 space-y-3">
                    {loading ? (
                      <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">加载中...</div>
                    ) : workflows.length === 0 ? (
                      <div className="rounded-xl border border-dashed p-4 text-xs text-muted-foreground">还没有工作流配置。</div>
                    ) : workflows.map((workflow) => (
                      <Button
                        key={workflow.filename}
                        variant={selectedWorkflow === workflow.filename || boundWorkflow === workflow.filename ? 'default' : 'outline'}
                        className="h-auto w-full justify-start rounded-2xl p-4 text-left"
                        onClick={() => {
                          setSelectedWorkflow(workflow.filename);
                          setInspectedWorkflow(workflow);
                        }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{workflow.name}</div>
                            <div className="mt-1 text-xs text-muted-foreground">{workflow.filename}</div>
                          </div>
                          <Badge variant="outline">{workflow.mode || 'workflow'}</Badge>
                        </div>
                        {workflow.description ? (
                          <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{workflow.description}</p>
                        ) : null}
                      </Button>
                    ))}
                  </div>
                </details>
              </div>
            </div>
          )}

          {availableTabs.includes('agent') && activeTab === 'agent' && (
            <div className="space-y-4">
              <div className="rounded-2xl border p-4">
                <h3 className="text-sm font-medium">AI 引导创建 Agent</h3>
                <p className="mt-2 text-xs text-muted-foreground leading-5">
                  右侧触发正式引导弹框，而不是把创建过程塞进聊天气泡。
                </p>
                {sidebarHint?.agentDraft?.workingDirectory ? (
                  <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                    <div className="font-medium text-foreground">当前识别到的工程上下文</div>
                    <div className="whitespace-normal break-all">目录：{sidebarHint.agentDraft.workingDirectory}</div>
                  </div>
                ) : null}
                <div className="mt-4 flex gap-2">
                  <Button size="sm" onClick={() => setAgentModalOpen(true)}>打开 Agent 引导</Button>
                  <Button size="sm" variant="outline" onClick={() => router.push('/agents')}>
                    打开 Agent 页
                  </Button>
                </div>
              </div>

              <div className="rounded-2xl border p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">当前 Agent 草案焦点</div>
                  <Badge variant="outline">{agentDraft.displayName ? '已识别' : '待补全'}</Badge>
                </div>
                <div className="text-xs text-muted-foreground leading-5">
                  {agentDraft.mission || '优先收敛名称、职责、工作目录和风格，剩余字段由 AI 草案补齐。'}
                </div>
              </div>

              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">名称</label>
                  <Input
                    value={agentDraft.displayName}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, displayName: e.target.value }))}
                    placeholder="例如：架构审查官"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">队伍</label>
                  <SingleCombobox
                    value={agentDraft.team}
                    onValueChange={(value) => setAgentDraft((prev) => ({ ...prev, team: value as AgentDraftState['team'] }))}
                    options={[
                      { value: 'blue', label: '蓝队' },
                      { value: 'red', label: '红队' },
                      { value: 'yellow', label: '黄队' },
                      { value: 'judge', label: '裁定席' },
                    ]}
                    searchable={false}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">职责</label>
                  <Textarea
                    value={agentDraft.mission}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, mission: e.target.value }))}
                    placeholder="例如：负责需求拆解、架构评审和关键风险识别"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">风格</label>
                  <Input
                    value={agentDraft.style}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, style: e.target.value }))}
                    placeholder="例如：冷静、严谨、强势"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">擅长领域</label>
                  <Textarea
                    value={agentDraft.specialties}
                    onChange={(e) => setAgentDraft((prev) => ({ ...prev, specialties: e.target.value }))}
                    placeholder="例如：架构设计, 评审, 风险识别"
                    rows={3}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground">参考工作流</label>
                  <SingleCombobox
                    value={agentDraft.referenceWorkflow || ''}
                    onValueChange={(value) => setAgentDraft((prev) => ({ ...prev, referenceWorkflow: value || '' }))}
                    options={[
                      { value: '', label: '不指定' },
                      ...workflows.map((workflow) => ({
                        value: workflow.filename,
                        label: workflow.name ? `${workflow.name} (${workflow.filename})` : workflow.filename,
                      })),
                    ]}
                    placeholder="可选：参考已有 workflow 角色分工"
                    searchable
                  />
                </div>
              </div>

              <div className="rounded-2xl border bg-gradient-to-br from-primary/10 via-background to-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{agentDraftPreview?.name || agentDraft.displayName || 'Agent 角色预览'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(agentDraftPreview?.team || agentDraft.team)} · {(agentDraftPreview?.activeEngine || engine || 'follow-global')}
                    </div>
                  </div>
                  <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-sky-400 to-indigo-600 text-white flex items-center justify-center shadow-lg">
                    <span className="material-symbols-outlined">smart_toy</span>
                  </div>
                </div>
                <p className="mt-3 text-xs text-muted-foreground leading-5">
                  {agentDraftPreview?.description || agentDraft.mission || '填写职责后会在这里显示角色卡预览。'}
                </p>
                {agentDraftPreview?.capabilities?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {agentDraftPreview.capabilities.slice(0, 4).map((capability) => (
                      <Badge key={capability} variant="outline">{capability}</Badge>
                    ))}
                  </div>
                ) : null}
              </div>

              {agentDraftPreview ? (
                <div className="rounded-2xl border p-4 space-y-2">
                  <div className="text-sm font-medium">AI 草案预览</div>
                  <div className="text-xs text-muted-foreground break-all">name: {agentDraftPreview.name}</div>
                  <div className="text-xs text-muted-foreground">team: {agentDraftPreview.team}</div>
                  <div className="text-xs text-muted-foreground line-clamp-4 whitespace-pre-wrap">
                    {agentDraftPreview.systemPrompt}
                  </div>
                </div>
              ) : null}

              <div className="flex gap-2">
                <Button className="flex-1" variant="outline" onClick={handleGenerateAgentDraft} disabled={draftingAgent}>
                  {draftingAgent ? '生成中...' : 'AI生成草案'}
                </Button>
                <Button className="flex-1" onClick={handleCreateAgent} disabled={creatingAgent}>
                  {creatingAgent ? '创建中...' : '保存 Agent 草案'}
                </Button>
              </div>

              {agentDraftRaw ? (
                <details className="rounded-2xl border p-4">
                  <summary className="cursor-pointer text-sm font-medium">查看原始草案输出</summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">{agentDraftRaw}</pre>
                </details>
              ) : null}
            </div>
          )}
        </div>
      </aside>

      <NewConfigModal
        isOpen={workflowModalOpen}
        onClose={closeWorkflowModal}
        homepageCompact
        resumeCreationSessionId={currentCreationSession?.creationSessionId || creationBinding?.creationSessionId || null}
        frontendSessionId={activeSessionId}
        onSuccess={(filename, result) => {
          const nextCreationSession = result?.creationSession;
          if (nextCreationSession) {
            setCurrentCreationSession({
              creationSessionId: nextCreationSession.id,
              filename: nextCreationSession.filename,
              workflowName: nextCreationSession.workflowName,
              status: nextCreationSession.status,
              specCodingId: nextCreationSession.specCoding.id,
              createdAt: nextCreationSession.createdAt,
              updatedAt: nextCreationSession.updatedAt,
            });
          }
          setSessionWorkbenchState((prev) => ({
            ...(prev || {}),
            homeSidebar: {
              type: 'home_sidebar',
              mode: 'peek',
              activeTab: 'commander',
              intent: 'workflow-run',
              stage: 'review',
              shouldOpenModal: false,
              summary: `工作流 ${filename} 已创建，可直接启动或继续完善。`,
            },
          }));
          setWorkflowModalOpen(false);
          setSelectedWorkflow(filename);
          onTabChange('commander');
          router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
        }}
        initialMode="ai-guided"
        initialWorkflowName={workflowDraft.name}
        initialReferenceWorkflow={workflowDraft.referenceWorkflow}
        initialRequirements={workflowDraft.requirements}
        initialDescription={workflowDraft.description}
        initialWorkingDirectory={workflowDraft.workingDirectory}
        initialWorkspaceMode={workflowDraft.workspaceMode}
      />

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

      <Sheet open={!!inspectedWorkflow} onOpenChange={(open) => !open && setInspectedWorkflow(null)}>
        <SheetContent side="right" className="w-[420px] sm:max-w-[420px]">
          <SheetHeader>
            <SheetTitle>{inspectedWorkflow?.name || '工作流详情'}</SheetTitle>
            <SheetDescription>{inspectedWorkflow?.filename || ''}</SheetDescription>
          </SheetHeader>
          <div className="mt-6 space-y-4 text-sm">
            <div className="rounded-2xl border p-4">
              <div className="text-xs text-muted-foreground">描述</div>
              <div className="mt-2 leading-6">{inspectedWorkflow?.description || '暂无描述'}</div>
            </div>
            <div className="rounded-2xl border p-4">
              <div className="text-xs text-muted-foreground">模式</div>
              <div className="mt-2">{inspectedWorkflow?.mode || 'workflow'}</div>
            </div>
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => {
                if (inspectedWorkflow?.filename) setSelectedWorkflow(inspectedWorkflow.filename);
                setInspectedWorkflow(null);
                onTabChange('commander');
              }}>
                设为当前目标
              </Button>
              <Button variant="outline" onClick={() => inspectedWorkflow?.filename && router.push(`/workbench/${encodeURIComponent(inspectedWorkflow.filename)}`)}>
                打开
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
      {confirmDialogProps ? <ConfirmDialog {...confirmDialogProps} /> : null}
    </>
  );
}
