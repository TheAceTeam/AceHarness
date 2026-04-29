'use client';

import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ClipLoader } from 'react-spinners';
import { configApi, workflowApi, agentApi, runsApi, processApi, streamApi, workspaceApi, type NotebookScope } from '@/lib/api';
import { useWorkflowState } from '@/hooks/useWorkflowState';
import type { ViewMode } from '@/hooks/useWorkflowState';
import FlowDiagram from '@/components/FlowDiagram';
import StateMachineDiagram from '@/components/StateMachineDiagram';
import StateMachineDesignPanel from '@/components/StateMachineDesignPanel';
import StateMachineExecutionView from '@/components/StateMachineExecutionView';
import DesignPanel from '@/components/DesignPanel';
import AgentPanel from '@/components/AgentPanel';
import AgentConfigPanel from '@/components/AgentConfigPanel';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import EditNodeModal from '@/components/EditNodeModal';
import ProcessPanel from '@/components/ProcessPanel';
import DocumentsPanel from '@/components/DocumentsPanel';
import SchedulesPanel from '@/components/SchedulesPanel';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import Markdown from '@/components/Markdown';
import ResizablePanels from '@/components/ResizablePanels';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { MultiCombobox } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { WorkspaceEditor } from '@/components/workspace/WorkspaceEditor';
import { ButtonGroup } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import { EngineSelect } from '@/components/EngineSelect';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useAttentionSignal } from '@/hooks/useAttentionSignal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { RobotLogo } from '@/components/chat/ChatMessage';
import { resolveAgentSelection } from '@/lib/agent-engine-selection';
import {
  buildWorkflowConversationDirectory,
  getConversationSessionStatusLabel,
  listSessionsForAgent,
  listSessionsForWorkflow,
  resolveAgentConversationSession,
  type ChatSessionSummaryLike,
} from '@/lib/agent-conversations';
import { getEngineMeta } from '@/lib/engine-metadata';
import { createInitialAgentDraft, type AgentDraftState } from '@/lib/agent-draft';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run-state-persistence';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import styles from './page.module.css';

const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const UNC_ABSOLUTE_PATH = /^(?:\\\\|\/\/)/;

function isAbsoluteProjectPath(path: string) {
  return path.startsWith('/') || WINDOWS_DRIVE_ABSOLUTE_PATH.test(path) || UNC_ABSOLUTE_PATH.test(path);
}

type QualityCheckRecord = {
  id: string;
  stateName: string;
  stepName: string;
  agent: string;
  category: 'lint' | 'compile' | 'test' | 'custom';
  status: 'passed' | 'failed' | 'warning';
  origin?: 'workflow' | 'inferred';
  summary: string;
  createdAt: string;
  commands: Array<{
    command: string;
    exitCode: number | null;
    status: 'passed' | 'failed' | 'warning';
    stdout?: string;
    stderr?: string;
    errorText?: string | null;
  }>;
};

type WorkflowMemoryLayers = {
  schema?: {
    scopes: string[];
    rules: string[];
  };
  runtime: {
    specCodingSummary?: {
      id: string;
      version: number;
      summary?: string;
      progressSummary?: string;
    } | null;
    qualityChecks: Array<{
      id: string;
      stateName: string;
      stepName: string;
      agent: string;
      category: 'lint' | 'compile' | 'test' | 'custom';
      status: 'passed' | 'failed' | 'warning';
      summary: string;
      createdAt: string;
    }>;
  };
  review: {
    summary: string;
    nextFocus: string[];
    experience: string[];
    generatedAt: string;
  } | null;
  history: Array<{
    runId: string;
    status: 'completed' | 'failed' | 'stopped';
    summary: string;
    nextFocus: string[];
    experience: string[];
    generatedAt: string;
  }>;
  role?: {
    agent: string;
    memories: Array<{
      id: string;
      title: string;
      kind: string;
      content: string;
      source: string;
      createdAt: string;
      tags: string[];
    }>;
  };
  project?: {
    key: string;
    memories: Array<{
      id: string;
      title: string;
      kind: string;
      content: string;
      source: string;
      createdAt: string;
      tags: string[];
    }>;
  };
  workflow?: {
    key: string;
    memories: Array<{
      id: string;
      title: string;
      kind: string;
      content: string;
      source: string;
      createdAt: string;
      tags: string[];
    }>;
  };
  chat?: {
    sessionId: string | null;
    memories: Array<{
      id: string;
      title: string;
      kind: string;
      content: string;
      source: string;
      createdAt: string;
      tags: string[];
    }>;
  };
  recalledExperiences?: Array<{
    runId: string;
    status: 'completed' | 'failed' | 'stopped';
    summary: string;
    nextFocus: string[];
    experience: string[];
    generatedAt: string;
  }>;
};

type SpecCodingArtifactKey = 'proposal' | 'design' | 'tasks' | 'deltaSpec';

export default function WorkbenchPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const configFile = decodeURIComponent(params.config as string);

  // 格式化状态名称
  const formatStateName = (name: string) => {
    if (name === '__origin__') return '开始';
    if (name === '__human_approval__') return '人工审查';
    return name;
  };

  const initialMode = (searchParams.get('mode') as ViewMode) || 'run';
  const initialRunId = searchParams.get('run') || searchParams.get('runId');
  const focusTarget = searchParams.get('focus');
  const focusQuestionId = searchParams.get('questionId');

  // Update URL query params without full navigation
  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) sp.delete(key);
      else sp.set(key, val);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'run')) {
      sp.delete('runId');
    }
    const qs = sp.toString();
    router.replace(`/workbench/${encodeURIComponent(configFile)}${qs ? '?' + qs : ''}`, { scroll: false });
  }, [searchParams, configFile, router]);

  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const { state, dispatch, addLog } = useWorkflowState(initialMode);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [focusedState, setFocusedState] = useState<string | null>(null); // 用于流程图视图跳转
  const [executionViewTabOverride, setExecutionViewTabOverride] = useState<string | null>(null);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [viewingHistoryRun, setViewingHistoryRun] = useState(false);
  const [pendingCheckpointPhase, setPendingCheckpointPhase] = useState<string | null>(null);
  const [fullStepOutput, setFullStepOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ title: string; chunks: string[] } | null>(null);
  const [specCodingModalOpen, setSpecCodingModalOpen] = useState(false);
  const [specCodingModalFullscreen, setSpecCodingModalFullscreen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const [smStateHistory, setSmStateHistory] = useState<any[]>([]);
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false);
  const [workspaceEditorPath, setWorkspaceEditorPath] = useState('');
  const [workspaceEditorTitle, setWorkspaceEditorTitle] = useState<string | undefined>(undefined);
  const [workspaceEditorFilePath, setWorkspaceEditorFilePath] = useState<string | null>(null);
  const [smIssueTracker, setSmIssueTracker] = useState<any[]>([]);
  const [smTransitionCount, setSmTransitionCount] = useState(0);
  const [runStartTime, setRunStartTime] = useState<string | null>(null);
  const [runEndTime, setRunEndTime] = useState<string | null>(null);
  const [humanApprovalData, setHumanApprovalData] = useState<{
    currentState: string;
    nextState: string;
    result: any;
    availableStates: string[];
    supervisorAdvice?: string;
  } | null>(null);
  const [humanApprovalMinimized, setHumanApprovalMinimized] = useState(false);
  const [humanApprovalMinimizedPulse, setHumanApprovalMinimizedPulse] = useState(false);
  const humanApprovalSignatureRef = useRef<string | null>(null);
  const [pendingHumanQuestion, setPendingHumanQuestion] = useState<HumanQuestion | null>(null);
  const [submittingHumanQuestion, setSubmittingHumanQuestion] = useState(false);
  const humanQuestionSignatureRef = useRef<string | null>(null);
  const [openLatestAiDocRequest, setOpenLatestAiDocRequest] = useState(0);
  const [liveStream, setLiveStream] = useState<string[]>([]);
  const [showLiveStream, setShowLiveStream] = useState(false);
  const [liveStreamFullscreen, setLiveStreamFullscreen] = useState(false);
  const [isNewNode, setIsNewNode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);
  const [starting, setStarting] = useState(false);
  const [rehearsalMode, setRehearsalMode] = useState(false);
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [showRuntimeAgentCreator, setShowRuntimeAgentCreator] = useState(false);
  const [runtimeAgentDraft, setRuntimeAgentDraft] = useState<AgentDraftState>(createInitialAgentDraft());
  const [showDesignRequirements, setShowDesignRequirements] = useState(true);
  const [showRunRequirements, setShowRunRequirements] = useState(true);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [iterationFeedback, setIterationFeedback] = useState('');
  const [supervisorFlow, setSupervisorFlow] = useState<{
    type: 'question' | 'decision';
    from: string;
    to: string;
    question?: string;
    method?: string;
    round: number;
    timestamp: string;
    stateName?: string;
  }[]>([]);

  const openWorkspaceEditorAtPath = useCallback((path: string, title?: string, filePath?: string | null) => {
    if (!path) return;
    setWorkspaceEditorPath(path);
    setWorkspaceEditorTitle(title);
    setWorkspaceEditorFilePath(filePath || null);
    setWorkspaceEditorOpen(true);
  }, []);
  const [agentFlow, setAgentFlow] = useState<{
    id: string;
    type: 'stream' | 'request' | 'response' | 'supervisor';
    fromAgent: string;
    toAgent: string;
    message?: string;
    stateName: string;
    stepName: string;
    round: number;
    timestamp: string;
  }[]>([]);
  const [persistedStepLogs, setPersistedStepLogs] = useState<Array<{
    id: string;
    stepName: string;
    agent: string;
    status: 'completed' | 'failed';
    output: string;
    error: string;
    costUsd: number;
    durationMs: number;
    timestamp: string;
  }>>([]);
  const [runStatusReason, setRunStatusReason] = useState<string | null>(null);
  const [creationSessionSummary, setCreationSessionSummary] = useState<{
    id: string;
    workflowName: string;
    filename: string;
    status: string;
    updatedAt: number;
  } | null>(null);
  const [specCodingSummary, setSpecCodingSummary] = useState<{
    id: string;
    version: number;
    status: string;
    source?: 'run' | 'creation';
    summary?: string;
    phaseCount: number;
    taskCount?: number;
    assignmentCount: number;
    checkpointCount: number;
    progress?: {
      overallStatus?: string;
      completedPhaseIds?: string[];
      activePhaseId?: string;
      summary?: string;
    };
    latestRevision?: {
      id: string;
      version: number;
      summary: string;
      createdAt: string;
      createdBy?: string;
    } | null;
  } | null>(null);
  const [latestSupervisorReview, setLatestSupervisorReview] = useState<{
    type: 'state-review' | 'checkpoint-advice' | 'chat-revision' | 'human-question';
    stateName: string;
    content: string;
    timestamp: string;
    affectedArtifacts?: string[];
    impact?: string[];
  } | null>(null);
  const [rehearsalInfo, setRehearsalInfo] = useState<{
    enabled: boolean;
    summary: string;
    recommendedNextSteps: string[];
  } | null>(null);
  const [rehearsalResultDialogOpen, setRehearsalResultDialogOpen] = useState(false);
  const [specCodingDetails, setSpecCodingDetails] = useState<{
    phases: Array<{
      id: string;
      title: string;
      objective?: string;
      ownerAgents: string[];
      status: string;
    }>;
    tasks?: Array<{
      id: string;
      title: string;
      detail?: string;
      status: string;
      phaseId?: string;
      ownerAgents: string[];
      updatedAt?: string;
      updatedBy?: string;
      validation?: string;
    }>;
    assignments: Array<{
      agent: string;
      responsibility: string;
      phaseIds: string[];
    }>;
    checkpoints: Array<{
      id: string;
      title: string;
      phaseId?: string;
      status: string;
    }>;
    revisions: Array<{
      id: string;
      version: number;
      summary: string;
      createdAt: string;
      createdBy?: string;
    }>;
    artifacts?: {
      proposal?: string;
      design?: string;
      tasks?: string;
      deltaSpec?: string;
    };
  } | null>(null);
  const [specCodingSourceOfTruth, setSpecCodingSourceOfTruth] = useState<{
    mode: 'phase-based' | 'state-machine' | 'unknown';
    yamlSourceOfTruth: string[];
    derivedIntoSpecCoding: string[];
    runtimeSpecCodingSourceOfTruth: string[];
    counts: {
      yamlPhases: number;
      yamlStates: number;
      yamlSteps: number;
      yamlCheckpoints: number;
      specCodingPhases: number;
      specCodingTasks?: number;
      specCodingAssignments: number;
      specCodingCheckpoints: number;
    };
  } | null>(null);
  const [finalReview, setFinalReview] = useState<{
    runId: string;
    configFile: string;
    supervisorAgent: string;
    status: 'completed' | 'failed' | 'stopped';
    summary: string;
    nextFocus: string[];
    experience: string[];
    scoreCards: Array<{
      agent: string;
      score: number;
      strengths: string[];
      weaknesses: string[];
    }>;
    generatedAt: string;
  } | null>(null);
  const [qualityChecks, setQualityChecks] = useState<QualityCheckRecord[]>([]);
  const [preflightChecks, setPreflightChecks] = useState<QualityCheckRecord[]>([]);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummaryLike[]>([]);
  const [memoryLayers, setMemoryLayers] = useState<WorkflowMemoryLayers | null>(null);
  const [agentChatSessions, setAgentChatSessions] = useState<Record<string, string | null>>({});
  const [agentChatLoading, setAgentChatLoading] = useState<Record<string, boolean>>({});
  const [agentChatMessages, setAgentChatMessages] = useState<Record<string, Array<{
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    mode: 'workflow-chat';
    timestamp: number;
  }>>>({});
  const liveStreamFeedbackRef = useRef<HTMLInputElement>(null);
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [inlineFeedbacks, setInlineFeedbacks] = useState<{ message: string; timestamp: string; streamIndex: number }[]>([]);
  const [showContextEditor, setShowContextEditor] = useState(false);
  const [showPromptAnalysis, setShowPromptAnalysis] = useState(false);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<{ totalSteps: number; avgScore: number } | null>(null);
  const [selectedOptimizations, setSelectedOptimizations] = useState<Set<number>>(new Set());
  const [applyingOptimization, setApplyingOptimization] = useState(false);
  const [editingContextScope, setEditingContextScope] = useState<'global' | 'phase'>('global');
  const [editingContextPhase, setEditingContextPhase] = useState('');
  const [editingContextValue, setEditingContextValue] = useState('');
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [designTab, setDesignTab] = useState<'workflow' | 'spec-coding' | 'config'>('workflow');
  const [specCodingArtifactTab, setSpecCodingArtifactTab] = useState<SpecCodingArtifactKey>('proposal');
  const [forceTransitionModal, setForceTransitionModal] = useState<{ targetState: string; instruction: string } | null>(null);
  const [specCodingSaveDialogOpen, setSpecCodingSaveDialogOpen] = useState(false);
  const [specCodingSaveScope, setSpecCodingSaveScope] = useState<NotebookScope>('personal');
  const [specCodingSaveDirectory, setSpecCodingSaveDirectory] = useState('');
  const [savingSpecCodingArtifact, setSavingSpecCodingArtifact] = useState(false);
  const liveStreamRef = useRef<EventSource | ReturnType<typeof setInterval> | null>(null);
  const liveStreamLenRef = useRef(0);
  const liveStreamRawRef = useRef('');
  const liveStreamStepRef = useRef<string>('');
  const liveStreamScrollRef = useRef<HTMLDivElement | null>(null);
  const LIVE_STREAM_PAGE_SIZE = 30;
  const [liveStreamVisibleCount, setLiveStreamVisibleCount] = useState(LIVE_STREAM_PAGE_SIZE);
  const liveStreamUserScrolledUp = useRef(false);
  const [liveStreamScrollLocked, setLiveStreamScrollLocked] = useState(false);
  const {
    viewMode, workflowConfig, editingConfig, agentConfigs,
    workflowStatus, runId, currentPhase, currentStep, agents, logs, completedSteps, failedSteps,
    showCheckpoint, checkpointMessage, checkpointIsIterative, activeTab, selectedAgent, selectedStep,
    projectRoot, workspaceMode, requirements, timeoutMinutes, engine, skills, showProcessPanel,
    showEditNodeModal, editingNode, iterationStates, stepResults, stepIdMap,
    globalContext, phaseContexts,
  } = state;

  // Explicitly convert viewMode to string for conditional rendering
  const isDesignMode = state.viewMode === 'design';
  const isRunMode = state.viewMode === 'run';
  const isHistoryMode = state.viewMode === 'history';

  const switchViewMode = useCallback((mode: ViewMode) => {
    if (mode !== 'history') {
      setViewingHistoryRun(false);
    }
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
    if (mode === 'run') {
      updateUrl({ mode: 'run', run: runId || null });
    } else if (mode === 'design') {
      updateUrl({ mode: 'design', run: null });
    } else {
      updateUrl({ mode: 'history', run: null });
    }
  }, [dispatch, runId, updateUrl]);

  useEffect(() => {
    fetch('/api/engine')
      .then((res) => res.json())
      .then((data) => {
        setGlobalEngine(data.engine || '');
        setGlobalDefaultModel(data.defaultModel || '');
      })
      .catch(() => {});
  }, []);

  // Resolve projectRoot to absolute path using user's personalDir
  const resolvedProjectRoot = useMemo(() => {
    if (!projectRoot) return '';
    if (isAbsoluteProjectPath(projectRoot)) return projectRoot;
    try {
      const stored = localStorage.getItem('auth-user');
      if (stored) {
        const user = JSON.parse(stored);
        if (user.personalDir) return `${user.personalDir}/${projectRoot}`;
      }
    } catch {}
    return projectRoot;
  }, [projectRoot]);

  useEffect(() => {
    setRuntimeAgentDraft((prev) => ({
      ...prev,
      workingDirectory: resolvedProjectRoot || prev.workingDirectory || '',
    }));
  }, [resolvedProjectRoot]);

  useEffect(() => {
    const handleOpenWorkspacePath = (event: Event) => {
      const detail = (event as CustomEvent<{
        absolutePath?: string;
        workspacePath?: string;
        filePath?: string | null;
      }>).detail;
      if (!detail?.workspacePath) return;
      openWorkspaceEditorAtPath(detail.workspacePath, '文档链接', detail.absolutePath || detail.filePath || null);
    };
    window.addEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    return () => {
      window.removeEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    };
  }, [openWorkspaceEditorAtPath]);

  const activeSpecCodingPhase = useMemo(() => {
    if (!specCodingDetails?.phases?.length) return null;
    return specCodingDetails.phases.find((phase) => phase.id === specCodingSummary?.progress?.activePhaseId)
      || specCodingDetails.phases.find((phase) => phase.title === currentPhase)
      || null;
  }, [currentPhase, specCodingDetails, specCodingSummary?.progress?.activePhaseId]);

  const structuredTasksMarkdown = useMemo(() => {
    const tasks = specCodingDetails?.tasks || [];
    if (tasks.length === 0) return '';
    return [
      '# tasks.md',
      '',
      '## 任务列表',
      '',
      ...tasks.flatMap((task) => {
        const checkbox = task.status === 'completed'
          ? '[x]'
          : task.status === 'in-progress'
            ? '[-]'
            : '[ ]';
        const lines = [`- ${checkbox} ${task.title}`];
        if (task.detail?.trim()) {
          lines.push(...task.detail.trim().split(/\r?\n/));
        }
        return [...lines, ''];
      }),
    ].join('\n').trim();
  }, [specCodingDetails?.tasks]);

  const specCodingArtifactEntries = useMemo<Array<{
    key: SpecCodingArtifactKey;
    label: string;
    title: string;
    content: string;
  }>>(() => {
    const artifacts = specCodingDetails?.artifacts || {};
    return [
      {
        key: 'proposal',
        label: 'proposal.md',
        title: '提案',
        content: artifacts.proposal || '',
      },
      {
        key: 'design',
        label: 'design.md',
        title: '设计',
        content: artifacts.design || '',
      },
      {
        key: 'tasks',
        label: 'tasks.md',
        title: '任务',
        content: structuredTasksMarkdown || artifacts.tasks || '',
      },
      {
        key: 'deltaSpec',
        label: 'specs/.../spec.md',
        title: '增量规范',
        content: artifacts.deltaSpec || '',
      },
    ];
  }, [specCodingDetails?.artifacts, structuredTasksMarkdown]);

  const activeSpecCodingArtifact = useMemo(
    () => specCodingArtifactEntries.find((entry) => entry.key === specCodingArtifactTab) || specCodingArtifactEntries[0],
    [specCodingArtifactEntries, specCodingArtifactTab]
  );
  const sanitizeNotebookName = useCallback((name: string) => {
    return name
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }, []);
  const triggerDownload = useCallback((content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, []);
  const specCodingCodingSaveDialog = useCallback((artifactKey: SpecCodingArtifactKey) => {
    setSpecCodingArtifactTab(artifactKey);
    setSpecCodingSaveScope('personal');
    setSpecCodingSaveDirectory('');
    setSpecCodingSaveDialogOpen(true);
  }, []);
  const saveSpecCodingArtifactToNotebook = useCallback(async () => {
    if (!activeSpecCodingArtifact?.content?.trim()) return;
    setSavingSpecCodingArtifact(true);
    try {
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
      const base = sanitizeNotebookName(activeSpecCodingArtifact.label.replace(/\.md$/i, '') || activeSpecCodingArtifact.key);
      const fileName = `${base}-${stamp}.cj.md`;
      const normalizedDir = (specCodingSaveDirectory || '').replace(/^\/+|\/+$/g, '');
      const notebookPath = normalizedDir ? `${normalizedDir}/${fileName}` : fileName;
      await workspaceApi.manageNotebook('create-file', { path: notebookPath }, { scope: specCodingSaveScope });
      await workspaceApi.saveNotebookFile(notebookPath, activeSpecCodingArtifact.content, { scope: specCodingSaveScope });
      toast('success', `已保存到 Notebook：${notebookPath}`);
      setSpecCodingSaveDialogOpen(false);
    } catch (error: any) {
      toast('error', error?.message || '保存到 Notebook 失败');
    } finally {
      setSavingSpecCodingArtifact(false);
    }
  }, [activeSpecCodingArtifact, specCodingSaveDirectory, specCodingSaveScope, sanitizeNotebookName, toast]);

  const checkpointDeviationNotes = useMemo(() => {
    if (!humanApprovalData || !specCodingDetails?.phases?.length) return [];
    const notes: string[] = [];
    const reviewStateName = humanApprovalData.currentState === '__human_approval__'
      ? activeSpecCodingPhase?.title || null
      : humanApprovalData.currentState;
    const reviewPhase = reviewStateName
      ? specCodingDetails.phases.find((phase) => phase.title === reviewStateName)
      : null;

    if (!reviewPhase) {
      if (reviewStateName) {
        notes.push(`运行态 Spec Coding 投影中未找到与当前审查阶段「${formatStateName(reviewStateName)}」对应的阶段定义。`);
      }
      return notes;
    }

    if (reviewStateName && activeSpecCodingPhase && activeSpecCodingPhase.title !== reviewStateName) {
      notes.push(`Spec Coding 当前活跃阶段是「${activeSpecCodingPhase.title}」，与待审阶段「${formatStateName(reviewStateName)}」不一致。`);
    }

    if (reviewPhase.status === 'blocked' && humanApprovalData.result?.verdict !== 'fail') {
      notes.push(`Spec Coding 已将该阶段标记为 blocked，但本次判定为 ${humanApprovalData.result?.verdict || '未知'}，需要确认是否继续阻塞。`);
    }

    if (reviewStateName && humanApprovalData.nextState === reviewStateName && reviewPhase.status === 'completed') {
      notes.push(`Spec Coding 已将该阶段标记为 completed，但 AI 仍建议继续留在当前状态。`);
    }

    if (reviewStateName && humanApprovalData.nextState !== reviewStateName && reviewPhase.status === 'in-progress') {
      notes.push(`Spec Coding 当前仍显示该阶段 in-progress，但 AI 建议流转到「${humanApprovalData.nextState}」。`);
    }

    if (notes.length === 0) {
      notes.push('当前人工审查结论与运行态 Spec Coding 记录基本一致。');
    }

    return notes;
  }, [activeSpecCodingPhase, humanApprovalData, specCodingDetails]);

  const executionTrace = useMemo(() => ({
    designTitle: creationSessionSummary?.workflowName || specCodingSummary?.id || workflowConfig?.workflow?.name || configFile,
    designStatus: creationSessionSummary?.status || specCodingSummary?.status || null,
    designSummary: specCodingSummary?.summary || workflowConfig?.workflow?.description || requirements || null,
    activePhaseTitle: activeSpecCodingPhase?.title || (currentPhase ? formatStateName(currentPhase) : null),
    activePhaseStatus: activeSpecCodingPhase?.status || specCodingSummary?.progress?.overallStatus || workflowStatus || null,
    activeStepName: currentStep || null,
    latestSupervisorReview: supervisorFlow.length > 0 ? {
      type: supervisorFlow.at(-1)?.type || null,
      stateName: (() => {
        const raw = supervisorFlow.at(-1)?.stateName || supervisorFlow.at(-1)?.to || null;
        return raw ? formatStateName(raw) : null;
      })(),
      content: supervisorFlow.at(-1)?.question || null,
    } : latestSupervisorReview ? {
      type: latestSupervisorReview.type,
      stateName: latestSupervisorReview.stateName ? formatStateName(latestSupervisorReview.stateName) : null,
      content: latestSupervisorReview.content,
    } : null,
    latestRevision: specCodingSummary?.latestRevision
      ? {
        version: specCodingSummary.latestRevision.version,
        summary: specCodingSummary.latestRevision.summary,
        createdBy: specCodingSummary.latestRevision.createdBy,
      }
      : null,
    finalReview: finalReview
      ? {
        status: finalReview.status,
        summary: finalReview.summary,
      }
      : null,
  }), [
    activeSpecCodingPhase,
    configFile,
    creationSessionSummary,
    currentPhase,
    currentStep,
    finalReview,
    latestSupervisorReview,
    specCodingSummary,
    requirements,
    supervisorFlow,
    workflowConfig?.workflow?.description,
    workflowConfig?.workflow?.name,
    workflowStatus,
  ]);

  const designExecutionComparison = useMemo(() => {
    const checkpointForActivePhase = activeSpecCodingPhase
      ? specCodingDetails?.checkpoints?.find((checkpoint) => checkpoint.phaseId === activeSpecCodingPhase.id)
      : null;

    return {
      designInput: {
        workflowName: creationSessionSummary?.workflowName || workflowConfig?.workflow?.name || configFile,
        creationStatus: creationSessionSummary?.status || specCodingSummary?.status || 'unknown',
        baselineSummary: specCodingSummary?.summary || requirements || workflowConfig?.workflow?.description || '暂无设计摘要',
        phaseCount: specCodingSummary?.phaseCount || specCodingDetails?.phases?.length || 0,
      },
      runtime: {
        workflowStatus: workflowStatus || 'idle',
        activePhaseTitle: activeSpecCodingPhase?.title || currentPhase || '未进入阶段',
        activePhaseStatus: activeSpecCodingPhase?.status || specCodingSummary?.progress?.overallStatus || 'pending',
        activeStepName: currentStep || '未进入步骤',
        checkpointTitle: checkpointForActivePhase?.title || null,
        checkpointStatus: checkpointForActivePhase?.status || null,
      },
      latestRevision: specCodingSummary?.latestRevision || specCodingDetails?.revisions?.at(-1) || null,
    };
  }, [
    activeSpecCodingPhase,
    configFile,
    creationSessionSummary?.status,
    creationSessionSummary?.workflowName,
    currentPhase,
    currentStep,
    specCodingDetails?.checkpoints,
    specCodingDetails?.phases?.length,
    specCodingDetails?.revisions,
    specCodingSummary,
    requirements,
    workflowConfig?.workflow?.description,
    workflowConfig?.workflow?.name,
    workflowStatus,
  ]);

  const configuredWorkflowAgents = useMemo(() => {
    const workflow = workflowConfig?.workflow;
    const names: string[] = [];
    const seen = new Set<string>();
    const addName = (name?: string | null) => {
      const trimmed = name?.trim();
      if (!trimmed || seen.has(trimmed)) return;
      seen.add(trimmed);
      names.push(trimmed);
    };

    const supervisorFromWorkflow = workflow?.supervisor?.agent;
    const supervisorFromRoles = agentConfigs.find((agent: any) => agent?.roleType === 'supervisor')?.name;
    addName(supervisorFromWorkflow || supervisorFromRoles || 'default-supervisor');

    const nodes = workflow?.mode === 'state-machine'
      ? (workflow.states || [])
      : (workflow?.phases || []);
    for (const node of nodes) {
      addName(node?.agent);
      for (const step of node?.steps || []) {
        addName(step?.agent);
      }
    }

    return names.map((name) => {
      const roleConfig = agentConfigs.find((role: any) => role.name === name);
      const selection = roleConfig
        ? resolveAgentSelection(roleConfig, { engine: globalEngine, defaultModel: globalDefaultModel }, engine)
        : null;
      return {
        name,
        team: roleConfig?.team || (name === (supervisorFromWorkflow || supervisorFromRoles) ? 'black-gold' : 'blue'),
        model: selection?.effectiveModel || '',
        status: 'waiting' as const,
        currentTask: null,
        completedTasks: 0,
        sessionId: null,
      };
    });
  }, [agentConfigs, engine, globalDefaultModel, globalEngine, workflowConfig?.workflow]);

  const displayWorkflowAgents = useMemo(() => {
    const runtimeByName = new Map(agents.map((agent) => [agent.name, agent]));
    const configuredNames = new Set(configuredWorkflowAgents.map((agent) => agent.name));
    const configuredWithRuntime = configuredWorkflowAgents.map((agent) => runtimeByName.get(agent.name) || agent);
    const runtimeRemainder = agents.filter((agent) => !configuredNames.has(agent.name));
    return [...configuredWithRuntime, ...runtimeRemainder];
  }, [agents, configuredWorkflowAgents]);

  const appendAgentChatMessage = useCallback((agentName: string, message: {
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    mode: 'workflow-chat';
    timestamp: number;
  }) => {
    setAgentChatMessages((prev) => ({
      ...prev,
      [agentName]: [...(prev[agentName] || []), message],
    }));
  }, []);

  const handleAgentChat = useCallback(async (input: { message: string; mode: 'workflow-chat' }) => {
    if (!selectedAgent?.name) return;

    const agentName = selectedAgent.name;
    const timestamp = Date.now();
    appendAgentChatMessage(agentName, {
      id: `${timestamp}-user`,
      role: 'user',
      content: input.message,
      mode: 'workflow-chat',
      timestamp,
    });
    setAgentChatLoading((prev) => ({ ...prev, [agentName]: true }));

    try {
      const result = await agentApi.chat(agentName, {
        message: input.message,
        mode: 'workflow-chat',
        sessionId: resolveAgentConversationSession({
          mode: 'workflow-chat',
          agentName,
          runtimeSessionId: agentChatSessions[agentName] || null,
          workflowBinding: {
            configFile,
            runId: runId || selectedRun?.id || 'pending',
            supervisorAgent: finalReview?.supervisorAgent || workflowConfig?.workflow?.supervisor?.agent || agentConfigs.find((agent: any) => agent?.roleType === 'supervisor')?.name || 'default-supervisor',
            supervisorSessionId: displayWorkflowAgents.find((agent) => agent.name === (finalReview?.supervisorAgent || workflowConfig?.workflow?.supervisor?.agent || agentConfigs.find((role: any) => role?.roleType === 'supervisor')?.name || 'default-supervisor'))?.sessionId || null,
            attachedAgentSessions: Object.fromEntries(displayWorkflowAgents.map((agent) => [agent.name, agent.sessionId || ''])),
            createdAt: 0,
            updatedAt: 0,
          },
          agentSessionId: selectedAgent.sessionId || null,
        }).sessionId,
        workingDirectory: state.workingDirectory || resolvedProjectRoot || undefined,
        workflowContext: {
          workflowName: workflowConfig?.workflow?.name,
          configFile,
          runId,
          status: workflowStatus || null,
          currentPhase,
          currentStep,
          selectedStepName: selectedStep?.name || null,
          requirements,
          specCodingSummary,
          specCodingDetails,
          latestSupervisorReview: {
            content: supervisorFlow.at(-1)?.question || null,
            type: supervisorFlow.at(-1)?.type || null,
            stateName: supervisorFlow.at(-1)?.stateName || null,
          },
        },
      });

      setAgentChatSessions((prev) => ({
        ...prev,
        [agentName]: result.sessionId || prev[agentName] || selectedAgent.sessionId || null,
      }));
      appendAgentChatMessage(agentName, {
        id: `${Date.now()}-assistant`,
        role: result.isError ? 'error' : 'assistant',
        content: result.specCodingRevision?.applied
          ? `${result.output || result.error || '无输出'}\n\n---\n已由 Supervisor 刷新 Spec Coding：${result.specCodingRevision.summary}`
          : (result.output || result.error || '无输出'),
        mode: 'workflow-chat',
        timestamp: Date.now(),
      });
      if (result.specCodingRevision?.applied) {
        await fetchCurrentStatus();
      }
    } catch (error: any) {
      appendAgentChatMessage(agentName, {
        id: `${Date.now()}-error`,
        role: 'error',
        content: error?.message || 'Agent 对话失败',
        mode: 'workflow-chat',
        timestamp: Date.now(),
      });
    } finally {
      setAgentChatLoading((prev) => ({ ...prev, [agentName]: false }));
    }
  }, [
    agentChatSessions,
    appendAgentChatMessage,
    configFile,
    currentPhase,
    currentStep,
    specCodingSummary,
    requirements,
    resolvedProjectRoot,
    runId,
    selectedRun?.id,
    selectedAgent,
    selectedStep,
    state.workingDirectory,
    supervisorFlow,
    finalReview?.supervisorAgent,
    displayWorkflowAgents,
    agentConfigs,
    workflowConfig,
    workflowConfig?.workflow?.name,
    workflowStatus,
  ]);

  const isRunning = workflowStatus === 'running' || workflowStatus === 'preparing';
  const canStartWorkflow = isRunMode && !starting && !isRunning;
  const preparingProgress = useMemo(() => {
    if (workflowStatus !== 'preparing') return null;
    const text = currentStep || '';
    // e.g. "复制工作目录 (3.2 GB/10.5 GB，31%，文件 123/560，预计剩余42s)"
    const percentMatch = text.match(/(\d+)\s*%/);
    const filesMatch = text.match(/文件\s*(\d+)\s*\/\s*(\d+)/);
    const etaMatch = text.match(/预计剩余\s*(\d+)\s*(?:秒|s)/i);
    if (!percentMatch && !filesMatch && !etaMatch) {
      return { percent: null as number | null, copied: null as number | null, total: null as number | null, etaSec: null as number | null };
    }
    return {
      copied: filesMatch ? Number(filesMatch[1]) : null,
      total: filesMatch ? Number(filesMatch[2]) : null,
      percent: percentMatch ? Number(percentMatch[1]) : null,
      etaSec: etaMatch ? Number(etaMatch[1]) : null,
    };
  }, [workflowStatus, currentStep]);
  const workflowBaseTitle = useMemo(() => {
    const configuredName = workflowConfig?.workflow?.name?.trim();
    return configuredName || configFile.split('/').pop() || configFile;
  }, [workflowConfig?.workflow?.name, configFile]);
  const selectedRoleConfig = selectedStep
    ? agentConfigs.find((role: any) => role.name === selectedStep.agent)
    : null;
  const selectedRoleSelection = useMemo(() => {
    if (!selectedRoleConfig) return null;
    return resolveAgentSelection(
      selectedRoleConfig,
      { engine: globalEngine, defaultModel: globalDefaultModel },
      engine,
    );
  }, [selectedRoleConfig, globalEngine, globalDefaultModel, engine]);
  const workflowTitle = useMemo(() => {
    if (humanApprovalData) return `待人工审查 · ${workflowBaseTitle}`;
    if (viewingHistoryRun) return `查看运行 · ${workflowBaseTitle}`;
    if (rehearsalInfo?.enabled) return `演练模式 · ${workflowBaseTitle}`;
    if (workflowStatus === 'running') return `运行中 · ${workflowBaseTitle}`;
    if (workflowStatus === 'preparing') return `准备中 · ${workflowBaseTitle}`;
    if (workflowStatus === 'completed') return `已完成 · ${workflowBaseTitle}`;
    if (workflowStatus === 'failed' || workflowStatus === 'crashed') return `运行失败 · ${workflowBaseTitle}`;
    if (workflowStatus === 'stopped') return `已停止 · ${workflowBaseTitle}`;
    return `${workflowBaseTitle} · Workflow`;
  }, [humanApprovalData, viewingHistoryRun, rehearsalInfo?.enabled, workflowStatus, workflowBaseTitle]);
  const workflowDirectory = useMemo(() => {
    const supervisorFromConfig = workflowConfig?.workflow?.supervisor?.agent || agentConfigs.find((agent: any) => agent?.roleType === 'supervisor')?.name;
    const supervisorAgent = finalReview?.supervisorAgent || supervisorFromConfig || 'default-supervisor';
    const attachedAgentSessions = Object.fromEntries(
      displayWorkflowAgents
        .filter((agent) => agent?.name)
        .map((agent) => [agent.name, agent.sessionId || ''])
    );

    return buildWorkflowConversationDirectory({
      configFile,
      runId: runId || selectedRun?.id || 'pending',
      supervisorAgent,
      supervisorSessionId: attachedAgentSessions[supervisorAgent] || null,
      attachedAgentSessions,
      createdAt: 0,
      updatedAt: 0,
    });
  }, [agentConfigs, configFile, displayWorkflowAgents, finalReview?.supervisorAgent, runId, selectedRun?.id, workflowConfig?.workflow?.supervisor?.agent]);
  const orderedWorkflowAgents = useMemo(() => {
    const agentMap = new Map(displayWorkflowAgents.map((agent) => [agent.name, agent]));
    const ordered = workflowDirectory
      .map((entry) => agentMap.get(entry.label))
      .filter((agent): agent is (typeof displayWorkflowAgents)[number] => Boolean(agent));
    const remainder = displayWorkflowAgents.filter((agent) => !workflowDirectory.some((entry) => entry.label === agent.name));
    return [...ordered, ...remainder];
  }, [displayWorkflowAgents, workflowDirectory]);

  useEffect(() => {
    if (orderedWorkflowAgents.length === 0) return;
    if (selectedAgent && orderedWorkflowAgents.some((agent) => agent.name === selectedAgent.name)) return;
    dispatch({ type: 'SET_SELECTED_AGENT', payload: orderedWorkflowAgents[0] });
  }, [orderedWorkflowAgents, selectedAgent, dispatch]);

  const workflowRelatedSessions = useMemo(
    () => listSessionsForWorkflow(chatSessions, configFile),
    [chatSessions, configFile]
  );
  const displayQualityChecks = useMemo(() => {
    const merged = [...preflightChecks, ...qualityChecks];
    const seen = new Set<string>();
    return merged.filter((check) => {
      if (seen.has(check.id)) return false;
      seen.add(check.id);
      return true;
    });
  }, [preflightChecks, qualityChecks]);
  const formatQualityCheckScope = useCallback((check: QualityCheckRecord) => {
    if (check.stateName === '__preflight__' && check.stepName === '__preflight__') {
      return '启动前检查';
    }
    if (check.stateName === check.stepName) {
      return check.stateName;
    }
    return `${check.stateName} / ${check.stepName}`;
  }, []);
  const formatQualityCheckCategory = useCallback((category: QualityCheckRecord['category']) => {
    if (category === 'compile') return '编译检查';
    if (category === 'test') return '测试检查';
    if (category === 'lint') return '规范检查';
    return '自定义检查';
  }, []);
  const formatQualityCheckStatus = useCallback((status: QualityCheckRecord['status']) => {
    if (status === 'passed') return '通过';
    if (status === 'failed') return '失败';
    return '警告';
  }, []);
  const formatQualityCheckAgent = useCallback((agent: string) => {
    if (agent === 'system') return '系统';
    return agent;
  }, []);
  const formatSpecCodingTaskStatus = useCallback((status: string) => {
    if (status === 'completed') return '已完成';
    if (status === 'in-progress') return '进行中';
    if (status === 'blocked') return '阻塞';
    return '未开始';
  }, []);
  const getSpecCodingTaskPhaseTitle = useCallback((task: { phaseId?: string }) => {
    if (!task.phaseId) return '';
    return specCodingDetails?.phases?.find((phase) => phase.id === task.phaseId)?.title || '';
  }, [specCodingDetails?.phases]);
  const describeQualityCheck = useCallback((check: QualityCheckRecord) => {
    const command = check.commands?.[0]?.command?.trim() || '';
    if (!command) return check.summary;

    if (/mkdir\s+-p\s+/.test(command)) {
      const pathMatch = command.match(/mkdir\s+-p\s+(.+)$/);
      const target = pathMatch?.[1] || '';
      if (/\/samples\b/.test(target)) return '检查样例输出目录是否可以创建';
      if (/\/outputs\b/.test(target)) return '检查结果输出目录是否可以创建';
      if (/\/source-paths\b/.test(target)) return '检查源码路径输出目录是否可以创建';
      return '检查运行所需目录是否可以创建';
    }

    if (/cjc\s+--version|\/bin\/cjc\s+--version/.test(command)) {
      return '检查 cjc 编译器是否可用，并读取版本信息';
    }

    if (/cjpm\s+build/.test(command)) return '检查 cjpm build 是否可以执行';
    if (/cjpm\s+test/.test(command)) return '检查 cjpm test 是否可以执行';
    if (/npm\s+run\s+lint|eslint|cjlint/.test(command)) return '检查代码规范命令是否可以执行';
    if (/npm\s+run\s+typecheck|tsc\s+--noEmit/.test(command)) return '检查类型检查是否可以执行';
    if (/npm\s+run\s+build|\bbuild\b|compile/.test(command)) return '检查构建命令是否可以执行';
    if (/npm\s+run\s+test|pytest|jest|vitest/.test(command)) return '检查测试命令是否可以执行';

    return '检查配置中的预检查命令是否可以执行';
  }, []);
  const rehearsalCheckStats = useMemo(() => {
    const checks = preflightChecks.length > 0
      ? preflightChecks
      : displayQualityChecks.filter((check) => check.stateName === '__preflight__');
    return {
      total: checks.length,
      passed: checks.filter((check) => check.status === 'passed').length,
      warning: checks.filter((check) => check.status === 'warning').length,
      failed: checks.filter((check) => check.status === 'failed').length,
    };
  }, [displayQualityChecks, preflightChecks]);
  const overviewTasks = useMemo(() => {
    const tasks = specCodingDetails?.tasks || [];
    if (tasks.length <= 8) return tasks;
    const firstActiveIndex = tasks.findIndex((task) => task.status !== 'completed');
    if (firstActiveIndex === -1) {
      return tasks.slice(Math.max(0, tasks.length - 8));
    }
    const startIndex = Math.max(0, firstActiveIndex - 2);
    return tasks.slice(startIndex, startIndex + 8);
  }, [specCodingDetails?.tasks]);
  const focusTaskOnDiagram = useCallback((task: { phaseId?: string }) => {
    const phaseTitle = getSpecCodingTaskPhaseTitle(task);
    if (!phaseTitle) return;
    setFocusedState(phaseTitle);
    setExecutionViewTabOverride('diagram');
  }, [getSpecCodingTaskPhaseTitle]);
  const openAgentFromTask = useCallback((agentName: string) => {
    const matchedAgent = orderedWorkflowAgents.find((agent) => agent.name === agentName)
      || agents.find((agent) => agent.name === agentName);
    if (!matchedAgent) return;
    dispatch({ type: 'SET_SELECTED_AGENT', payload: matchedAgent as any });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' });
  }, [agents, dispatch, orderedWorkflowAgents]);
  const attentionSignal = useAttentionSignal({
    active: Boolean(humanApprovalData),
    title: `待人工审查 · ${workflowBaseTitle}`,
    notificationTitle: 'ACEHarness - 待人工审查',
    notificationBody: `${workflowBaseTitle} 进入人工审查点，请及时处理。`,
    toast,
    toastMessage: `${workflowBaseTitle} 已进入人工审查点`,
  });

  useDocumentTitle(attentionSignal.active ? attentionSignal.title || null : workflowTitle);

  const loadChatSessions = useCallback(async () => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth-token') : null;
    if (!token) {
      setChatSessions([]);
      return;
    }
    try {
      const response = await fetch('/api/chat/sessions', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (response.status === 401) {
        setChatSessions([]);
        return;
      }
      const data = await response.json();
      setChatSessions(data.sessions || []);
    } catch {
      setChatSessions([]);
    }
  }, []);

  useEffect(() => {
    void loadChatSessions();
  }, [loadChatSessions]);

  const totalSteps = workflowConfig?.workflow?.mode === 'state-machine'
    ? (workflowConfig?.workflow?.states?.reduce(
        (sum: number, state: any) => sum + (state.steps?.length ?? 0), 0
      ) ?? 0)
    : (workflowConfig?.workflow?.phases?.reduce(
        (sum: number, phase: any) => sum + phase.steps.length, 0
      ) ?? 0);

  const fetchCurrentStatus = async () => {
    try {
      const requestedRunId = runId || initialRunId || selectedRun?.id || undefined;
      const status = await workflowApi.getStatus(configFile, requestedRunId);
      if (!status?.status) return;
      const smStatus = status as typeof status & {
        mode?: 'state-machine' | 'phase-based';
        currentState?: string | null;
        pendingCheckpoint?: {
          suggestedNextState?: string;
          availableStates?: string[];
          supervisorAdvice?: string;
          message?: string;
          result?: {
            verdict?: string;
            issues?: any[];
            summary?: string;
            stepOutputs?: string[];
          };
        };
      };

      // Check if the running workflow is for this config file
      const isForCurrentConfig = !status.currentConfigFile || status.currentConfigFile === configFile;
      if (!isForCurrentConfig) {
        // Running workflow is for a different config, don't apply this status
        return;
      }

      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: status.status });
      setRunStatusReason(status.statusReason || null);
      const statusIsActive = status.status === 'running' || status.status === 'preparing';
      if (status.status === 'failed' && status.statusReason) {
        addLog('system', 'error', `工作流启动失败: ${status.statusReason}`);
      }
      if (status.runId) dispatch({ type: 'SET_RUN_ID', payload: status.runId });
      if (typeof status.currentPhase === 'string') dispatch({ type: 'SET_CURRENT_PHASE', payload: status.currentPhase });
      else if (!statusIsActive) dispatch({ type: 'SET_CURRENT_PHASE', payload: '' });
      if (typeof status.currentStep === 'string') dispatch({ type: 'SET_CURRENT_STEP', payload: status.currentStep });
      else if (!statusIsActive) dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      if (status.agents?.length) dispatch({ type: 'SET_AGENTS', payload: status.agents });
      if (status.agents?.length) {
        setAgentChatSessions((prev) => ({
          ...Object.fromEntries(
            status.agents
              .filter((agent: any) => agent?.name)
              .map((agent: any) => [agent.name, agent.sessionId || null])
          ),
          ...prev,
        }));
      }
      if (status.completedSteps) dispatch({ type: 'SET_COMPLETED_STEPS', payload: status.completedSteps });
      dispatch({ type: 'SET_FAILED_STEPS', payload: status.failedSteps || [] });

      // Restore workingDirectory
      if (status.workingDirectory) {
        dispatch({ type: 'SET_WORKING_DIRECTORY', payload: status.workingDirectory });
      }

        // Restore contexts
      if (status.globalContext !== undefined) {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: status.globalContext });
      }
      if (status.phaseContexts) {
        dispatch({ type: 'SET_PHASE_CONTEXTS', payload: status.phaseContexts });
      }
      if ((status as any).supervisorFlow) {
        setSupervisorFlow((status as any).supervisorFlow);
      }
      setLatestSupervisorReview((status as any).latestSupervisorReview || null);
      setRehearsalInfo((status as any).rehearsal || null);
      if ((status as any).agentFlow) {
        setAgentFlow((status as any).agentFlow);
      }
      setCreationSessionSummary((status as any).creationSession || null);
      setSpecCodingSummary((status as any).specCodingSummary || null);
      setSpecCodingDetails((status as any).specCodingDetails || null);
      setSpecCodingSourceOfTruth((status as any).sourceOfTruth || null);
      setFinalReview((status as any).finalReview || null);
      setQualityChecks((status as any).qualityChecks || []);
      setMemoryLayers((status as any).memoryLayers || null);
      const nextPendingHumanQuestion = (status as any).pendingHumanQuestion || null;
      setPendingHumanQuestionIfChanged(nextPendingHumanQuestion);

      {
        if (Array.isArray(status.stepLogs)) {
          setPersistedStepLogs(status.stepLogs as any[]);
        }
        if (status.stepLogs?.length) {
          const restoredResults: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number }> = {};
          const restoredIdMap: Record<string, string> = {};
          for (const log of status.stepLogs as any[]) {
            const key = log.id || log.stepName;
            restoredResults[key] = {
              output: log.output || '',
              error: log.error || undefined,
              costUsd: log.costUsd || undefined,
              durationMs: log.durationMs || undefined,
            };
            if (log.id) {
              restoredIdMap[log.stepName] = log.id;
            }
          }
          dispatch({ type: 'MERGE_STEP_RESULTS', payload: restoredResults });
          dispatch({ type: 'MERGE_STEP_ID_MAP', payload: restoredIdMap });
        }
      }
      if (status.iterationStates) {
        Object.entries(status.iterationStates).forEach(([phase, iterState]) => {
          dispatch({ type: 'SET_ITERATION_STATE', payload: { phase, state: iterState as any } });
        });
      }

      // Restore state machine specific data
      if (status.stateHistory) {
        setSmStateHistory(status.stateHistory);
      }
      if (status.issueTracker) {
        setSmIssueTracker(status.issueTracker);
      }
      if (status.transitionCount !== undefined) {
        setSmTransitionCount(status.transitionCount);
      }
      if (smStatus.mode === 'state-machine' && smStatus.currentState === '__human_approval__' && smStatus.pendingCheckpoint) {
        const workflowStates = (workflowConfig as any)?.workflow?.states?.map((state: any) => state.name) || [];
        const restoredAvailableStates = smStatus.pendingCheckpoint.availableStates
          || workflowStates.filter((stateName: string) => stateName !== '__human_approval__');
        const restoredResult = smStatus.pendingCheckpoint.result || { issues: [] };
        setHumanApprovalDataIfChanged({
          currentState: '__human_approval__',
          nextState: smStatus.pendingCheckpoint.suggestedNextState || restoredAvailableStates[0] || '',
          result: {
            verdict: restoredResult.verdict || (Array.isArray(restoredResult.issues) && restoredResult.issues.length > 0 ? 'conditional_pass' : 'pass'),
            issues: restoredResult.issues || [],
            summary: restoredResult.summary || smStatus.pendingCheckpoint.message || '等待人工审查',
            stepOutputs: restoredResult.stepOutputs || [],
          },
          availableStates: restoredAvailableStates,
          supervisorAdvice: smStatus.pendingCheckpoint.supervisorAdvice,
        });
      } else if (!requestedRunId) {
        clearHumanApprovalData();
        if (!nextPendingHumanQuestion) {
          clearPendingHumanQuestion();
        }
      }
      if (status.startTime) {
        setRunStartTime(status.startTime);
      }
      if (status.endTime) {
        setRunEndTime(status.endTime);
      }
    } catch { /* server might not be ready */ }
  };

  const loadHistory = async () => {
    try {
      const { runs } = await runsApi.listByConfig(configFile);
      setHistoryRuns(runs);
    } catch { /* ignore */ }
  };

  const loadContexts = async () => {
    try {
      const rid = runId || initialRunId || selectedRun?.id;
      const contexts = await workflowApi.getContexts(rid || undefined);
      if (contexts.globalContext !== undefined) {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: contexts.globalContext });
      }
      if (contexts.phaseContexts) {
        dispatch({ type: 'SET_PHASE_CONTEXTS', payload: contexts.phaseContexts });
      }
    } catch { /* ignore */ }
  };

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      const detail = await runsApi.getRunDetail(runId);
      setRunDetail(detail);
    } catch {
      setRunDetail(null);
    }
  }, []);

  const clearPendingHumanQuestion = useCallback(() => {
    humanQuestionSignatureRef.current = null;
    setPendingHumanQuestion(null);
  }, []);

  const setPendingHumanQuestionIfChanged = useCallback((next: HumanQuestion | null) => {
    if (!next) {
      clearPendingHumanQuestion();
      return;
    }

    const signature = JSON.stringify({
      id: next.id,
      status: next.status,
      title: next.title,
      message: next.message,
      suggestedNextState: next.suggestedNextState || null,
      availableStates: next.availableStates || [],
      answerSchema: next.answerSchema,
    });

    if (humanQuestionSignatureRef.current === signature) {
      return;
    }

    humanQuestionSignatureRef.current = signature;
    setPendingHumanQuestion(next);
    setHumanApprovalMinimized(false);
    setHumanApprovalMinimizedPulse(false);
  }, [clearPendingHumanQuestion]);

  const clearHumanApprovalData = useCallback(() => {
    humanApprovalSignatureRef.current = null;
    setHumanApprovalData(null);
    setHumanApprovalMinimized(false);
    setHumanApprovalMinimizedPulse(false);
  }, []);

  const minimizeHumanApprovalDialog = useCallback(() => {
    if (!humanApprovalData && !pendingHumanQuestion) return;
    setHumanApprovalMinimized(true);
    setHumanApprovalMinimizedPulse(true);
  }, [humanApprovalData, pendingHumanQuestion]);

  const restoreHumanApprovalDialog = useCallback(() => {
    setHumanApprovalMinimized(false);
    setHumanApprovalMinimizedPulse(false);
  }, []);

  const setHumanApprovalDataIfChanged = useCallback((next: {
    currentState: string;
    nextState: string;
    result: any;
    availableStates: string[];
    supervisorAdvice?: string;
  } | null) => {
    if (!next) {
      clearHumanApprovalData();
      return;
    }

    const signature = JSON.stringify({
      currentState: next.currentState,
      nextState: next.nextState,
      verdict: next.result?.verdict || null,
      summary: next.result?.summary || null,
      stepOutputs: next.result?.stepOutputs || [],
      issues: next.result?.issues || [],
      availableStates: next.availableStates,
      supervisorAdvice: next.supervisorAdvice || null,
    });

    if (humanApprovalSignatureRef.current === signature) {
      return;
    }

    humanApprovalSignatureRef.current = signature;
    setHumanApprovalData(next);
    setHumanApprovalMinimized(false);
    setHumanApprovalMinimizedPulse(false);
  }, [clearHumanApprovalData]);

  useEffect(() => {
    if (focusTarget !== 'human-question') return;
    setHumanApprovalMinimized(false);
    setHumanApprovalMinimizedPulse(false);
  }, [focusTarget, focusQuestionId]);

  useEffect(() => {
    if (!humanApprovalMinimizedPulse) return;
    const timer = window.setTimeout(() => {
      setHumanApprovalMinimizedPulse(false);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [humanApprovalMinimizedPulse]);

  const restoreHumanApprovalFromDetail = useCallback((detail: any) => {
    if (detail?.mode !== 'state-machine' || detail?.currentState !== '__human_approval__') {
      return false;
    }

    const approvalTransition = (detail.stateHistory || []).findLast?.((item: any) => item.to === '__human_approval__');
    const currentStateName = approvalTransition?.from || '未知状态';
    const derivedStepOutputs = Array.isArray(detail.stepLogs)
      ? detail.stepLogs
          .filter((log: any) => typeof log?.stepName === 'string' && log.stepName.startsWith(`${currentStateName}-`))
          .filter((log: any) => typeof log?.output === 'string' && log.output.trim().length > 0)
          .map((log: any) => log.output)
      : [];
    const workflowStates = (workflowConfig as any)?.workflow?.states?.map((state: any) => state.name) || [];
    const restoredAvailableStates = detail.pendingCheckpoint?.availableStates
      || workflowStates.filter((stateName: string) => stateName !== '__human_approval__');
    const suggestedNextState = detail.pendingCheckpoint?.suggestedNextState
      || restoredAvailableStates[0]
      || '完成';

    setHumanApprovalDataIfChanged({
      currentState: currentStateName,
      nextState: suggestedNextState,
      result: {
        verdict: detail.pendingCheckpoint?.result?.verdict || (approvalTransition?.issues?.length > 0 ? 'conditional_pass' : 'pass'),
        issues: detail.pendingCheckpoint?.result?.issues || approvalTransition?.issues || [],
        summary: detail.pendingCheckpoint?.result?.summary || approvalTransition?.reason || '等待人工审查',
        stepOutputs: detail.pendingCheckpoint?.result?.stepOutputs?.length
          ? detail.pendingCheckpoint.result.stepOutputs
          : derivedStepOutputs,
      },
      availableStates: restoredAvailableStates,
      supervisorAdvice: detail.pendingCheckpoint?.supervisorAdvice,
    });
    return true;
  }, [setHumanApprovalDataIfChanged, workflowConfig]);

  useEffect(() => {
    loadWorkflowConfig();
    loadContexts(); // Load contexts on page load
    if (isRunMode) {
      // 如果正在查看历史运行，不连接实时事件流
      if (viewingHistoryRun) {
        return;
      }
      // 否则连接实时事件流
      fetchCurrentStatus();
      const eventSource = workflowApi.connectEventStream((event: any) => {
        // If we receive a live event, we're no longer viewing history
        setViewingHistoryRun(false);
        handleEventRef.current(event);
      });
      eventSource.addEventListener('open', () => {
        fetchCurrentStatus();
      });
      return () => eventSource?.close();
    }
    if (isHistoryMode) {
      loadHistory();
    }
  }, [viewMode, viewingHistoryRun, initialRunId, runId]);

  useEffect(() => {
    const modeFromUrl = (searchParams.get('mode') as ViewMode) || 'run';
    if (modeFromUrl !== state.viewMode) {
      dispatch({ type: 'SET_VIEW_MODE', payload: modeFromUrl });
    }
    if (modeFromUrl !== 'history' && viewingHistoryRun) {
      setViewingHistoryRun(false);
    }
  }, [dispatch, searchParams, state.viewMode, viewingHistoryRun]);

  // Auto-load run from URL ?run=xxx on mount
  useEffect(() => {
    if (!initialRunId || runId || !workflowConfig) {
      return;
    }

    const modeFromUrl = (searchParams.get('mode') as ViewMode) || 'run';
    if (modeFromUrl === 'history') {
      viewHistoryRun(initialRunId);
      return;
    }

    dispatch({ type: 'SET_RUN_ID', payload: initialRunId });
    dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
    setViewingHistoryRun(false);
    fetchCurrentStatus();
  }, [dispatch, fetchCurrentStatus, initialRunId, restoreHumanApprovalFromDetail, runId, searchParams, workflowConfig]);

  useEffect(() => {
    const activeRunId = runId || initialRunId;
    if (viewMode !== 'run' || !activeRunId) {
      return;
    }
    void loadRunDetail(activeRunId);
  }, [initialRunId, loadRunDetail, runId, viewMode]);

  useEffect(() => {
    if (viewMode !== 'run' || viewingHistoryRun || !runDetail) {
      return;
    }
    restoreHumanApprovalFromDetail(runDetail);
  }, [restoreHumanApprovalFromDetail, runDetail, viewingHistoryRun, viewMode]);

  // Sync runId to URL
  useEffect(() => {
    const currentUrlRun = searchParams.get('run');
    if (runId && runId !== currentUrlRun) {
      updateUrl({ run: runId });
    }
  }, [runId]);

  // Smart polling: start at 5s, increase to 10s if stable
  useEffect(() => {
    if (viewMode !== 'run' || !isRunning) return;
    let interval = 5000;
    let stableCount = 0;
    const poll = async () => {
      await fetchCurrentStatus();
      stableCount++;
      if (stableCount > 3 && interval < 10000) {
        clearInterval(timer);
        interval = 10000;
        timer = setInterval(poll, interval);
      }
    };
    let timer = setInterval(poll, interval);
    return () => clearInterval(timer);
  }, [viewMode, isRunning]);

  useEffect(() => {
    if (isDesignMode && workflowConfig) {
      dispatch({ type: 'SET_EDITING_CONFIG', payload: JSON.parse(JSON.stringify(workflowConfig)) });
    }
  }, [viewMode, workflowConfig]);

  const viewHistoryRun = async (runId: string) => {
    try {
      const detail = await runsApi.getRunDetail(runId);
      if (!detail) return;

      // Map persisted agents to the Agent shape the run view expects
      const agents = (detail.agents || []).map((a: any) => {
        // Resolve model from current agent config (engineModels) if available
        const roleConfig = agentConfigs.find((r: any) => r.name === a.name);
        let model = a.model;
        if (roleConfig?.engineModels) {
          model = resolveAgentSelection(
            roleConfig,
            { engine: globalEngine, defaultModel: globalDefaultModel },
            workflowConfig?.context?.engine,
          ).effectiveModel || model;
        }
        return {
          name: a.name,
          team: a.team,
          model,
          status: a.status || 'waiting',
          currentTask: null,
          completedTasks: a.completedTasks || 0,
          tokenUsage: a.tokenUsage || { inputTokens: 0, outputTokens: 0 },
          iterationCount: a.iterationCount || 0,
          summary: a.summary || '',
          changes: [],
        };
      });

      // Restore all state into the run view
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: detail.status === 'crashed' ? 'failed' : detail.status });
      setRunStatusReason(detail.statusReason || null);
      dispatch({ type: 'SET_RUN_ID', payload: runId });
      dispatch({ type: 'SET_AGENTS', payload: agents });
      dispatch({ type: 'SET_COMPLETED_STEPS', payload: detail.completedSteps || [] });
      // Ensure the interrupted step is marked as failed for crashed runs
      const failed = [...(detail.failedSteps || [])];
      if ((detail.status === 'crashed' || detail.status === 'failed' || detail.status === 'stopped') && detail.currentStep
        && !detail.completedSteps?.includes(detail.currentStep) && !failed.includes(detail.currentStep)) {
        failed.push(detail.currentStep);
      }
      dispatch({ type: 'SET_FAILED_STEPS', payload: failed });
      if (detail.currentPhase) dispatch({ type: 'SET_CURRENT_PHASE', payload: detail.currentPhase });
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });

      // Restore step results from stepLogs
      const restoredResults: Record<string, any> = {};
      const restoredIdMap: Record<string, string> = {};
      if (detail.stepLogs) {
        setPersistedStepLogs(detail.stepLogs);
        for (const log of detail.stepLogs) {
          // Use step ID as key if available, fall back to stepName for legacy data
          const key = log.id || log.stepName;
          restoredResults[key] = {
            output: log.output || '',
            error: log.error || undefined,
            costUsd: log.costUsd || undefined,
            durationMs: log.durationMs || undefined,
          };
          if (log.id) {
            restoredIdMap[log.stepName] = log.id;
          }
        }
      }
      dispatch({ type: 'SET_STEP_RESULTS', payload: restoredResults });
      dispatch({ type: 'SET_STEP_ID_MAP', payload: restoredIdMap });

      // Restore iteration states
      if (detail.iterationStates) {
        Object.entries(detail.iterationStates).forEach(([phase, iter]: [string, any]) => {
          dispatch({
            type: 'SET_ITERATION_STATE',
            payload: {
              phase,
              state: {
                phaseName: iter.phaseName || phase,
                currentIteration: iter.currentIteration || 0,
                maxIterations: iter.maxIterations || 0,
                consecutiveClean: iter.consecutiveCleanRounds || 0,
                status: iter.status || 'completed',
              },
            },
          });
        });
      }

      // Restore state machine data
      if (detail.stateHistory) {
        setSmStateHistory(detail.stateHistory);
      }
      setFinalReview(detail.finalReview || null);
      setQualityChecks((detail as any).qualityChecks || []);
      setMemoryLayers((detail as any).memoryLayers || null);
      if (detail.agents?.length) {
        setAgentChatSessions((prev) => ({
          ...Object.fromEntries(
            detail.agents
              .filter((agent: any) => agent?.name)
              .map((agent: any) => [agent.name, agent.sessionId || null])
          ),
          ...prev,
        }));
      }
      if (detail.issueTracker) {
        setSmIssueTracker(detail.issueTracker);
      }
      if (detail.transitionCount !== undefined) {
        setSmTransitionCount(detail.transitionCount);
      }
      if (detail.supervisorFlow) {
        setSupervisorFlow(detail.supervisorFlow);
      }
      if (detail.agentFlow) {
        setAgentFlow(detail.agentFlow);
      }

      // Restore contexts
      if (detail.globalContext !== undefined) {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: detail.globalContext });
      }
      if (detail.phaseContexts) {
        dispatch({ type: 'SET_PHASE_CONTEXTS', payload: detail.phaseContexts });
      }
      // Restore workingDirectory for file tree
      dispatch({ type: 'SET_WORKING_DIRECTORY', payload: detail.workingDirectory || null });

      // Switch to run view
      setViewingHistoryRun(true);
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      updateUrl({ run: runId, mode: 'run' });
      if (agents.length > 0) {
        dispatch({ type: 'SET_SELECTED_AGENT', payload: agents[0] });
      }
      // If there's a pending checkpoint, show the checkpoint dialog (阶段模式专属)
      if (detail.pendingCheckpoint && detail.mode !== 'state-machine') {
        dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: detail.pendingCheckpoint.message });
        dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: !!detail.pendingCheckpoint.isIterativePhase });
        dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
        setPendingCheckpointPhase(detail.pendingCheckpoint.phase || null);
      } else {
        setPendingCheckpointPhase(null);
      }

      // Restore state-machine human approval dialog when viewing a historical run
      if (!restoreHumanApprovalFromDetail(detail)) {
        clearHumanApprovalData();
      }
      addLog('system', 'info', `查看历史运行: ${runId}`);
    } catch (error: any) {
      addLog('system', 'error', `加载历史运行失败: ${error.message}`);
    }
  };

  const loadWorkflowConfig = async () => {
    setPageLoading(true);
    setLoadError(null);
    try {
      const { config, agents: loadedAgents } = await configApi.getConfig(configFile);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      dispatch({ type: 'SET_EDITING_CONFIG', payload: config });
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: loadedAgents || [] });
      dispatch({ type: 'SET_PROJECT_ROOT', payload: config.context?.projectRoot || '' });
      dispatch({ type: 'SET_WORKSPACE_MODE', payload: config.context?.workspaceMode || 'isolated-copy' });
      dispatch({ type: 'SET_REQUIREMENTS', payload: config.context?.requirements || '' });
      dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: config.context?.timeoutMinutes || 30 });
      dispatch({ type: 'SET_ENGINE', payload: config.context?.engine || '' });
      dispatch({ type: 'SET_SKILLS', payload: config.context?.skills || [] });

      // Load available skills
      try {
        const skillsRes = await fetch('/api/skills');
        const skillsData = await skillsRes.json();
        setAvailableSkills(skillsData.skills?.map((s: any) => ({ name: s.name, description: s.description })) || []);
      } catch { /* ignore */ }
    } catch (error: any) {
      console.error('加载工作流配置失败:', error);
      setLoadError(error.message || '加载失败');
    } finally {
      setPageLoading(false);
    }
  };

  const handleEvent = useCallback((event: any) => {
    // For status events, only apply if they're for the current config file
    if (event.type === 'status' && event.data.currentConfigFile && event.data.currentConfigFile !== configFile) {
      return; // Ignore status events from other workflow configs
    }

    switch (event.type) {
      case 'status':
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: event.data.status });
        if (typeof event.data.currentPhase === 'string') {
          dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.currentPhase });
        }
        if (typeof event.data.currentStep === 'string') {
          dispatch({ type: 'SET_CURRENT_STEP', payload: event.data.currentStep });
        }
        if (event.data.runId) dispatch({ type: 'SET_RUN_ID', payload: event.data.runId });
        if (event.data.startTime) setRunStartTime(event.data.startTime);
        if (event.data.endTime) setRunEndTime(event.data.endTime);
        if (event.data.specCodingSummary) setSpecCodingSummary(event.data.specCodingSummary);
        if (event.data.specCodingDetails) setSpecCodingDetails(event.data.specCodingDetails);
        if (event.data.workingDirectory) dispatch({ type: 'SET_WORKING_DIRECTORY', payload: event.data.workingDirectory });
        addLog('system', 'info', event.data.message);
        break;
      case 'phase':
        dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.phase });
        addLog('system', 'info', `📍 ${event.data.message}`);
        break;
      case 'step':
        dispatch({ type: 'SET_CURRENT_STEP', payload: event.data.step });
        if (event.data.id) {
          dispatch({ type: 'MAP_STEP_ID', payload: { stepName: event.data.step, stepId: event.data.id } });
        }
        addLog(event.data.agent, 'info', `开始执行: ${event.data.step}`);
        break;
      case 'result': {
        const resultKey = event.data.id || event.data.step;
        if (event.data.error) {
          addLog(event.data.agent, 'error', event.data.output);
          dispatch({ type: 'ADD_FAILED_STEP', payload: event.data.step });
          dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
          dispatch({ type: 'SET_STEP_RESULT', payload: {
            step: resultKey,
            result: { output: '', error: event.data.errorDetail || event.data.output },
          }});
        } else {
          addLog(event.data.agent, 'success', `完成: ${event.data.step}`);
          dispatch({ type: 'ADD_COMPLETED_STEP', payload: event.data.step });
          dispatch({ type: 'SET_STEP_RESULT', payload: {
            step: resultKey,
            result: {
              output: event.data.fullOutput || event.data.output,
              costUsd: event.data.costUsd,
              durationMs: event.data.durationMs,
            },
          }});
        }
        break;
      }
      case 'agents':
        dispatch({ type: 'SET_AGENTS', payload: event.data.agents });
        if (!selectedAgent && event.data.agents.length > 0) {
          dispatch({ type: 'SET_SELECTED_AGENT', payload: event.data.agents[0] });
        }
        break;
      case 'checkpoint':
        // 阶段模式专属，状态机模式下不弹出
        if (workflowConfig?.workflow?.mode !== 'state-machine') {
          dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
          dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: event.data.message });
          dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: !!event.data.isIterativePhase });
          setPendingCheckpointPhase(event.data.phase || null);
        }
        addLog('system', 'warning', `✋ 检查点: ${event.data.checkpoint}`);
        break;
      case 'iteration':
        dispatch({
          type: 'SET_ITERATION_STATE',
          payload: {
            phase: event.data.phase,
            state: {
              phaseName: event.data.phase,
              currentIteration: event.data.iteration,
              maxIterations: event.data.maxIterations,
              consecutiveClean: event.data.consecutiveClean,
              status: 'running',
            },
          },
        });
        addLog('system', 'info', `🔄 迭代 ${event.data.iteration}/${event.data.maxIterations} - ${event.data.phase}`);
        break;
      case 'iteration-complete':
        addLog('system', 'success', `✅ 迭代完成: ${event.data.phase} (${event.data.totalIterations} 轮, 原因: ${event.data.reason})`);
        break;
      case 'escalation':
        addLog('system', 'warning', `⚠️ 升级人工: ${event.data.phase} - ${event.data.reason}`);
        break;
      case 'human-approval-required':
        addLog('system', 'info', `👤 等待人工审查: ${event.data.currentState} → ${event.data.nextState || event.data.suggestedNextState || ''}`);
        if (event.data.pendingHumanQuestion) {
          setPendingHumanQuestionIfChanged(event.data.pendingHumanQuestion);
        }
        // Show human approval dialog
        setHumanApprovalDataIfChanged({
          currentState: event.data.currentState,
          nextState: event.data.nextState || event.data.suggestedNextState || '',
          result: event.data.result,
          availableStates: event.data.availableStates || [],
          supervisorAdvice: event.data.supervisorAdvice,
        });
        break;
      case 'human-question-required':
        if (event.data.question) {
          addLog('system', 'info', `👤 Supervisor 等待回复: ${event.data.question.title}`);
          setPendingHumanQuestionIfChanged(event.data.question);
          if (event.data.question.kind === 'approval' && event.data.question.answerSchema?.type === 'approval-transition') {
            setHumanApprovalDataIfChanged({
              currentState: event.data.question.currentState || '__human_approval__',
              nextState: event.data.question.suggestedNextState || event.data.question.availableStates?.[0] || '',
              result: event.data.question.result || { issues: [], summary: event.data.question.message },
              availableStates: event.data.question.availableStates || [],
              supervisorAdvice: event.data.question.supervisorAdvice || event.data.question.message,
            });
          }
        }
        break;
      case 'human-question-answered':
        addLog('system', 'success', 'Supervisor 消息已回复');
        if (!event.data.question || event.data.question.id === pendingHumanQuestion?.id) {
          clearPendingHumanQuestion();
          clearHumanApprovalData();
        }
        break;
      case 'force-transition':
        addLog('system', 'warning', `⚡ 强制跳转请求: ${event.data.from} → ${event.data.targetState}`);
        break;
      case 'transition-forced':
        addLog('system', 'info', `⚡ 已强制跳转: ${event.data.from} → ${event.data.to}`);
        dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.to });
        break;
      case 'sm-transition':
        setSmStateHistory(prev => [...prev, {
          from: event.data.from,
          to: event.data.to,
          reason: event.data.reason || '',
          issues: event.data.issues || [],
          timestamp: new Date().toISOString(),
        }]);
        setSmTransitionCount(event.data.transitionCount || 0);
        break;
      case 'token-usage':
        dispatch({
          type: 'UPDATE_AGENT_TOKEN_USAGE',
          payload: { agent: event.data.agent, usage: event.data.delta },
        });
        break;
      case 'feedback-injected':
        addLog('system', 'info', `反馈已接收: ${event.data.message.substring(0, 50)}${event.data.message.length > 50 ? '...' : ''}`);
        setInlineFeedbacks(prev => [...prev, {
          message: event.data.message,
          timestamp: event.data.timestamp,
          streamIndex: liveStreamLenRef.current,
        }]);
        break;
      case 'feedback-recalled':
        addLog('system', 'info', `反馈已撤回: ${event.data.message.substring(0, 50)}${event.data.message.length > 50 ? '...' : ''}`);
        setInlineFeedbacks(prev => {
          const idx = prev.findIndex(f => f.message === event.data.message);
          if (idx === -1) return prev;
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        });
        break;
      case 'context-updated':
        if (event.data.scope === 'global') {
          dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: event.data.context });
        } else if (event.data.phase) {
          dispatch({ type: 'SET_PHASE_CONTEXT', payload: { phase: event.data.phase, context: event.data.context } });
        }
        addLog('system', 'info', `上下文已更新: ${event.data.scope === 'global' ? '全局' : event.data.phase}`);
        break;
      case 'route-decision':
        setSupervisorFlow(prev => [...prev, {
          type: 'decision',
          from: event.data.fromAgent || currentPhase || 'system',
          to: event.data.route_to,
          method: event.data.method,
          question: event.data.question,
          round: event.data.round,
          timestamp: new Date().toISOString(),
          stateName: currentPhase,
        }]);
        addLog('system', 'info', `🔀 Supervisor 路由: ${event.data.fromAgent || currentPhase || 'system'} → ${event.data.route_to} (${event.data.method})`);
        break;
      case 'agent-flow':
        setAgentFlow(event.data.agentFlow || []);
        break;
    }
  }, [selectedAgent, addLog, currentPhase, pendingHumanQuestion?.id, setPendingHumanQuestionIfChanged, setHumanApprovalDataIfChanged, clearPendingHumanQuestion, clearHumanApprovalData]);

  // Keep a ref to the latest handleEvent so SSE callback never goes stale
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const saveConfig = async () => {
    if (!workflowConfig) return;
    setSaving(true);
    try {
      const config = {
        ...workflowConfig,
        workflow: editingConfig?.workflow || workflowConfig.workflow,
        context: {
          ...(workflowConfig.context || {}),
          ...(editingConfig?.context || {}),
          projectRoot,
          workspaceMode,
          requirements,
          timeoutMinutes,
          engine: engine || undefined,
          skills,
        },
      };
      await configApi.saveConfig(configFile, config);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      dispatch({ type: 'SET_EDITING_CONFIG', payload: config });
      toast('success', '配置已保存');
    } catch (error: any) {
      toast('error', '保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const saveWorkflowName = async (newName: string) => {
    if (!newName.trim() || !workflowConfig) return;
    try {
      const config = { ...workflowConfig, workflow: { ...workflowConfig.workflow, name: newName.trim() } };
      await configApi.saveConfig(configFile, config);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
    } catch { /* non-critical */ }
    setEditingName(false);
  };

  const startWorkflow = async (mode: 'rehearsal' | 'real' = (rehearsalMode ? 'rehearsal' : 'real')) => {
    const isRehearsalStart = mode === 'rehearsal';
    const normalizedProjectRoot = (projectRoot || '').trim();
    if (!normalizedProjectRoot) {
      toast('error', '项目根目录不能为空');
      addLog('system', 'error', '启动失败: 项目根目录不能为空');
      return;
    }
    if (!isAbsoluteProjectPath(normalizedProjectRoot)) {
      toast('error', '项目根目录必须为绝对路径');
      addLog('system', 'error', `启动失败: 项目根目录必须为绝对路径（当前: ${normalizedProjectRoot}）`);
      return;
    }

    setStarting(true);
    try {
      if (!isRehearsalStart) {
        setRehearsalResultDialogOpen(false);
      }
      const preflight = await workflowApi.preflight(configFile);
      setPreflightChecks(preflight.checks || []);
      if (!preflight.ok) {
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
        addLog('system', 'error', `启动前检查未通过: ${preflight.failedCount} 项失败`);
        toast('error', `启动前检查未通过：${preflight.failedCount} 项失败`);
        return;
      }
      if (preflight.warningCount > 0) {
        const warningDescription = (preflight.checks || [])
          .filter((check) => check.status === 'warning')
          .slice(0, 3)
          .map((check) => `${check.summary}${check.commands[0]?.command ? `\n${check.commands[0].command}` : ''}`)
          .join('\n\n');
        const confirmed = await confirm({
          title: '启动前检查存在警告',
          description: warningDescription || '启动前检查存在警告，确认后将继续启动。',
          confirmLabel: '继续启动',
          cancelLabel: '取消',
          variant: 'default',
        });
        if (!confirmed) {
          addLog('system', 'warning', '已取消启动，等待处理 preflight 警告');
          toast('warning', '已取消启动，可先处理 preflight 警告');
          return;
        }
        addLog('system', 'warning', `启动前检查存在 ${preflight.warningCount} 项警告，已人工确认后继续执行`);
      }
      setViewingHistoryRun(false);
      dispatch({ type: 'RESET_RUN' });
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'preparing' });
      setPersistedStepLogs([]);
      setRunStatusReason(null);
      setSmStateHistory([]);
      setSmIssueTracker([]);
      setSmTransitionCount(0);
      setSupervisorFlow([]);
      setAgentFlow([]);
      addLog('system', 'info', isRehearsalStart ? '正在启动演练模式...' : '正在启动工作流...');
      const startResult = await workflowApi.start(configFile, undefined, {
        skipPreflight: true,
        rehearsal: isRehearsalStart,
        preflightChecks: preflight.checks || [],
      });
      if (isRehearsalStart && (startResult as any).rehearsal) {
        setRehearsalInfo((startResult as any).rehearsal);
        setRehearsalResultDialogOpen(true);
      }
      addLog('system', 'success', isRehearsalStart ? '演练模式执行完成' : '工作流启动成功，等待执行...');
      // Fetch status shortly after start to catch initial state
      setTimeout(fetchCurrentStatus, 500);
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `启动失败: ${error.message}`);
    } finally {
      setStarting(false);
    }
  };

  const stopWorkflow = async () => {
    try {
      await workflowApi.stop(configFile);
      // Directly update local state — don't rely solely on SSE
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'stopped' });
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      addLog('system', 'warning', '工作流已停止');
    } catch (error: any) {
      addLog('system', 'error', `停止失败: ${error.message}`);
    }
  };

  const requestStopWorkflow = async () => {
    const ok = await confirm({
      title: '确认停止工作流',
      description: '停止后当前运行将中断。是否继续？',
      confirmLabel: '确认停止',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    await stopWorkflow();
  };

  const handleForceTransition = (targetState: string) => {
    setForceTransitionModal({ targetState, instruction: '' });
  };

  const executeForceTransition = async () => {
    if (!forceTransitionModal) return;
    try {
      const rid = runId || selectedRun?.id;
      if (rid) {
        // 对人工审查跳转统一走专用 runId 驱动接口，避免服务热重载后丢失内存 manager。
        setViewingHistoryRun(false);
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
        dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
        await workflowApi.forceTransition(
          forceTransitionModal.targetState,
          forceTransitionModal.instruction || undefined,
          configFile,
          rid,
        );
      } else {
        // 兜底：没有 runId 时再直接命中当前内存态
        await workflowApi.forceTransition(forceTransitionModal.targetState, forceTransitionModal.instruction || undefined, configFile);
      }
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      fetchCurrentStatus();
      toast('success', `已请求跳转到: ${forceTransitionModal.targetState}`);
      setForceTransitionModal(null);
      clearHumanApprovalData();
      clearPendingHumanQuestion();
      setPendingCheckpointPhase(null);
    } catch (e: any) {
      toast('error', e.message);
    }
  };

  const handleSubmitHumanQuestion = async (answer: HumanQuestionAnswer) => {
    if (!pendingHumanQuestion) return;
    setSubmittingHumanQuestion(true);
    try {
      setViewingHistoryRun(false);
      await workflowApi.answerHumanQuestion({
        questionId: pendingHumanQuestion.id,
        runId: pendingHumanQuestion.runId || runId || selectedRun?.id,
        configFile: pendingHumanQuestion.configFile || configFile,
        answer,
      });
      toast('success', '已提交 Supervisor 回复');
      clearPendingHumanQuestion();
      clearHumanApprovalData();
      setPendingCheckpointPhase(null);
      fetchCurrentStatus();
    } catch (error: any) {
      toast('error', error.message || '提交回复失败');
    } finally {
      setSubmittingHumanQuestion(false);
    }
  };

  const forceCompleteStep = async () => {
    try {
      const result = await workflowApi.forceCompleteStep(configFile);
      addLog('system', 'info', `步骤 "${result.step}" 已完成 (${result.outputLength} 字符)`);
    } catch (error: any) {
      addLog('system', 'error', `完成失败: ${error.message}`);
      toast('error', error.message);
    }
  };

  const resumeWorkflow = async (resumeRunId?: string) => {
    const rid = resumeRunId || runId || selectedRun?.id;
    if (!rid) return;
    try {
      setViewingHistoryRun(false);
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
      dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
      dispatch({ type: 'SET_RUN_ID', payload: rid });
      addLog('system', 'info', `正在恢复运行: ${rid}...`);
      await workflowApi.resume(rid);
      addLog('system', 'success', '工作流恢复成功，继续执行...');
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      // Fetch immediately, then polling effect takes over (every 3s)
      fetchCurrentStatus();
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `恢复失败: ${error.message}`);
    }
  };

  const approveCheckpoint = async () => {
    try {
      const rid = runId || selectedRun?.id;

      // 先查后端内存里的实际状态，避免重复 resume
      const liveStatus = await workflowApi.getStatus(configFile);      const alreadyRunningInMemory = liveStatus.status === 'running' || liveStatus.status === 'preparing';

      if (!alreadyRunningInMemory) {
        // 内存里没有运行中的 workflow，先弹确认再 resume
        dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
        await new Promise(resolve => setTimeout(resolve, 0));

        const confirmed = await confirm({
          title: '恢复运行后继续批准？',
          description: '检测到该工作流当前可能未在服务内存中运行。这通常发生在服务重启或打开历史运行记录时。是否先恢复该运行，再自动执行"批准"？',
          confirmLabel: '恢复并批准',
          cancelLabel: '取消',
        });

        if (!confirmed) {
          dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
          return;
        }

        if (rid) {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
          await workflowApi.resume(rid, 'approve');
          dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
          fetchCurrentStatus();
        }
      } else {
        // 内存里已经有运行中的 workflow，直接 approve
        await workflowApi.approve(configFile);
      }

      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      setIterationFeedback('');
      setPendingCheckpointPhase(null);
      addLog('system', 'success', '✓ 检查点已批准，继续执行');
    } catch (error: any) {
      addLog('system', 'error', `批准失败: ${error.message}`);
    }
  };

  const rejectCheckpoint = async () => {
    const ok = await confirm({
      title: '确认拒绝并停止',
      description: '拒绝后将停止当前工作流运行。是否继续？',
      confirmLabel: '拒绝并停止',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
    setIterationFeedback(''); // 清空反馈
    setPendingCheckpointPhase(null);
    if (isRunning) {
      await stopWorkflow();
    }
    addLog('system', 'warning', '✗ 检查点被拒绝，工作流已停止');
  };

  const iterateCheckpoint = async () => {
    if (!iterationFeedback.trim()) {
      toast('error', '请输入迭代意见');
      return;
    }
    try {
      if (isRunning) {
        await workflowApi.iterate(iterationFeedback, configFile);
      } else {
        // Workflow not running — resume with iterate action
        const rid = runId || selectedRun?.id;
        if (rid) {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
          await workflowApi.resume(rid, 'iterate', iterationFeedback);
          dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
          fetchCurrentStatus();
        }
      }
      dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
      setIterationFeedback('');
      setPendingCheckpointPhase(null);
      addLog('system', 'info', '↻ 继续迭代，重新执行当前阶段');
    } catch (error: any) {
      addLog('system', 'error', `请求迭代失败: ${error.message}`);
    }
  };

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = { idle: '空闲', preparing: '准备中', running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止', crashed: '崩溃' };
    return texts[status] || status;
  };

  const handleDeleteRun = async (runId: string) => {
    const confirmed = await confirm({
      title: '删除运行记录',
      description: '确定要删除这个运行记录吗？此操作不可撤销。',
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;

    try {
      await runsApi.deleteRun(runId);
      toast('success', '运行记录已删除');
      // Reload history
      await loadHistory();
    } catch (error: any) {
      toast('error', `删除失败: ${error.message}`);
    }
  };

  const handleAnalyzeRunPrompts = async (runId: string) => {
    setAnalyzingRunId(runId);
    setShowPromptAnalysis(true);
    setAnalysisResults([]);
    setAnalysisSummary(null);
    setSelectedOptimizations(new Set());

    try {
      const response = await fetch(`/api/prompt-analysis?runId=${runId}`);
      const data = await response.json();

      if (data.success) {
        setAnalysisResults(data.steps || []);
        setAnalysisSummary(data.summary);
      } else {
        toast('error', data.error || '分析失败');
      }
    } catch (error: any) {
      toast('error', `分析失败: ${error.message}`);
    } finally {
      setAnalyzingRunId(null);
    }
  };

  const handleApplyOptimizations = async () => {
    if (selectedOptimizations.size === 0) {
      toast('warning', '请先选择要应用的优化');
      return;
    }

    setApplyingOptimization(true);

    try {
      for (const index of selectedOptimizations) {
        const result = analysisResults[index];
        if (!result || !result.analysis?.optimizedPrompt) continue;

        // Save optimized prompt to agent config
        const agentName = result.agentName;
        const agentConfig = agentConfigs.find((a: any) => a.name === agentName);

        if (agentConfig) {
          const updatedConfig = {
            ...agentConfig,
            systemPrompt: result.analysis.optimizedPrompt,
          };

          await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updatedConfig),
          });
        }
      }

      toast('success', `已应用 ${selectedOptimizations.size} 项优化`);
      setShowPromptAnalysis(false);
    } catch (error: any) {
      toast('error', `应用失败: ${error.message}`);
    } finally {
      setApplyingOptimization(false);
    }
  };

  const handleBatchDeleteRuns = async () => {
    if (selectedRunIds.length === 0) {
      toast('warning', '请先选择要删除的运行记录');
      return;
    }

    const confirmed = await confirm({
      title: '批量删除运行记录',
      description: `确定要删除选中的 ${selectedRunIds.length} 条运行记录吗？此操作不可撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;

    setBatchDeleting(true);
    try {
      const result = await runsApi.batchDeleteRuns(selectedRunIds);
      toast('success', result.message);
      setSelectedRunIds([]);
      await loadHistory();
    } catch (error: any) {
      toast('error', `批量删除失败: ${error.message}`);
    } finally {
      setBatchDeleting(false);
    }
  };

  const toggleRunSelection = (runId: string) => {
    setSelectedRunIds(prev =>
      prev.includes(runId) ? prev.filter(id => id !== runId) : [...prev, runId]
    );
  };

  const toggleAllRunsSelection = () => {
    if (selectedRunIds.length === historyRuns.filter(r => r.status !== 'running' && r.status !== 'preparing').length) {
      setSelectedRunIds([]);
    } else {
      setSelectedRunIds(historyRuns.filter(r => r.status !== 'running' && r.status !== 'preparing').map(r => r.id));
    }
  };

  const selectStep = (step: any) => {
    dispatch({ type: 'SET_SELECTED_STEP', payload: step });
    setShowSystemPrompt(false);
    setFullStepOutput(null);
    const agent = agents.find((a) => a.name === step.agent);
    if (agent) {
      dispatch({ type: 'SET_SELECTED_AGENT', payload: agent });
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' });
    }
  };

  const selectStepByLogName = (logStepName: string) => {
    const allSteps = workflowConfig?.workflow?.mode === 'state-machine'
      ? (workflowConfig.workflow.states || []).flatMap((state: any) =>
          (state.steps || []).map((step: any) => ({ ...step, __stateName: state.name }))
        )
      : (workflowConfig?.workflow?.phases || []).flatMap((phase: any) => phase.steps || []);

    const matchedStep = allSteps.find((step: any) =>
      step.name === logStepName ||
      logStepName.endsWith(`-${step.name}`) ||
      (step.__stateName && logStepName === `${step.__stateName}-${step.name}`)
    );

    if (matchedStep) {
      selectStep(matchedStep);
    }
  };

  const loadFullOutput = async (stepName: string) => {
    const rid = runId || selectedRun?.id;
    if (!rid) return;
    setLoadingOutput(true);
    try {
      const { content } = await runsApi.getStepOutput(rid, stepName);
      setFullStepOutput(content);
    } catch {
      setFullStepOutput(null);
    }
    setLoadingOutput(false);
  };

  const openMarkdownModal = async (resultKey: string) => {
    const result = stepResults[resultKey];
    if (!result) return;
    // For UUID keys, find the step name for file lookup
    const fileName = Object.entries(stepIdMap).find(([, id]) => id === resultKey)?.[0] || resultKey;
    const rid = runId || selectedRun?.id;
    if (rid) {
      try {
        // Try stream file first (has chunk separators for visual separation)
        const streamContent = await streamApi.getStreamContent(rid, fileName);
        if (streamContent) {
          const chunks = streamContent.split(CHUNK_SEP).filter(Boolean);
          if (chunks.length > 1) {
            setMarkdownModal({ title: fileName, chunks });
            return;
          }
        }
        // Fall back to output file
        const { content } = await runsApi.getStepOutput(rid, fileName);
        setMarkdownModal({ title: fileName, chunks: [content] });
        return;
      } catch { /* fall through to local */ }
    }
    setMarkdownModal({ title: fileName, chunks: [result.output] });
  };

  const openPersistedStepLogModal = async (log: {
    id: string;
    stepName: string;
    status: 'completed' | 'failed';
    output: string;
    error: string;
  }) => {
    const resultKey = log.id || log.stepName;
    const result = stepResults[resultKey];
    const fileName = Object.entries(stepIdMap).find(([, id]) => id === resultKey)?.[0] || log.stepName;
    const rid = runId || selectedRun?.id;

    if (rid && log.status !== 'failed') {
      try {
        const streamContent = await streamApi.getStreamContent(rid, fileName);
        if (streamContent) {
          const chunks = streamContent.split(CHUNK_SEP).filter(Boolean);
          if (chunks.length > 1) {
            setMarkdownModal({ title: fileName, chunks });
            return;
          }
        }
        const { content } = await runsApi.getStepOutput(rid, fileName);
        setMarkdownModal({ title: fileName, chunks: [content] });
        return;
      } catch { /* fall back below */ }
    }

    if (log.status === 'failed') {
      setMarkdownModal({ title: `${fileName}（错误详情）`, chunks: [log.error || result?.error || '执行失败，但没有记录到错误详情'] });
      return;
    }

    setMarkdownModal({ title: fileName, chunks: [result?.output || log.output || '无输出'] });
  };

  // Chunk separator used in persisted stream files
  const CHUNK_SEP = '\n\n<!-- chunk-boundary -->\n\n';
  const CHUNK_WITH_TIME_REGEX = /^<!-- timestamp: (.+?) -->\n/;

  /** Merge consecutive 🤖 sub-task <details> blocks into a single grouped block */
  const mergeSubtaskDetails = (text: string): string => {
    // Match <details><summary>🤖 子任务结果...  </summary>...\n</details>
    const pattern = /\n<details><summary>(🤖 子任务结果[^<]*)<\/summary>\n([\s\S]*?)\n<\/details>\n/g;
    const blocks: { start: number; end: number; label: string; inner: string }[] = [];
    let m;
    while ((m = pattern.exec(text)) !== null) {
      blocks.push({ start: m.index, end: m.index + m[0].length, label: m[1], inner: m[2].trim() });
    }
    if (blocks.length < 2) return text;

    // Group consecutive blocks (adjacent or separated only by whitespace)
    const groups: (typeof blocks)[] = [];
    let cur = [blocks[0]];
    for (let i = 1; i < blocks.length; i++) {
      const gap = text.substring(cur[cur.length - 1].end, blocks[i].start).trim();
      if (gap === '') {
        cur.push(blocks[i]);
      } else {
        groups.push(cur);
        cur = [blocks[i]];
      }
    }
    groups.push(cur);

    // Replace groups of 2+ with merged block (process in reverse to preserve indices)
    let result = text;
    for (let g = groups.length - 1; g >= 0; g--) {
      const group = groups[g];
      if (group.length < 2) continue;
      const innerParts = group.map((b, i) => {
        const shortLabel = b.label.replace(/🤖 子任务结果[：:]\s*/, '').replace(/\s*\(\d+ 行\)/, '');
        const summary = shortLabel || `结果 ${i + 1}`;
        return `<details><summary>${summary}</summary>\n${b.inner}\n</details>`;
      });
      const merged = `\n<details><summary>🤖 子任务结果（${group.length} 条记录）</summary>\n\n${innerParts.join('\n\n')}\n\n</details>\n`;
      result = result.substring(0, group[0].start) + merged + result.substring(group[group.length - 1].end);
    }
    return result;
  };

  const sanitizeProtocolBlocksForDisplay = (text: string): string => {
    if (!text) return text;
    return text
      .replace(/<spec-tasks>[\s\S]*?<\/spec-tasks>/gi, '')
      .replace(/<step-conclusion>\s*([\s\S]*?)\s*<\/step-conclusion>/gi, '$1')
      .trim();
  };

  const prepareChunkForDisplay = (text: string): string => {
    return sanitizeProtocolBlocksForDisplay(mergeSubtaskDetails(text));
  };

  const extractStepConclusion = (text: string): string => {
    if (!text) return '';
    const tagged = text.match(/<step-conclusion>\s*([\s\S]*?)\s*<\/step-conclusion>/i)?.[1]?.trim();
    if (tagged) {
      return tagged;
    }
    return prepareChunkForDisplay(text);
  };

  // Parse chunk with optional timestamp
  const HUMAN_FEEDBACK_REGEX = /^<!-- human-feedback: (.+?) -->\n/;

  const parseChunk = (chunk: string) => {
    // Check for human feedback marker first
    const fbMatch = chunk.match(HUMAN_FEEDBACK_REGEX);
    if (fbMatch) {
      return {
        timestamp: fbMatch[1],
        content: chunk.substring(fbMatch[0].length),
        isHumanFeedback: true,
      };
    }
    const match = chunk.match(CHUNK_WITH_TIME_REGEX);
    if (match) {
      return {
        timestamp: match[1],
        content: chunk.substring(match[0].length),
        isHumanFeedback: false,
      };
    }
    return { timestamp: null, content: chunk, isHumanFeedback: false };
  };

  // --- Live stream via SSE (opencode) or polling fallback (claude-code) ---
  const startLiveStream = () => {
    setShowLiveStream(true);
    if (liveStreamFeedbackRef.current) liveStreamFeedbackRef.current.value = '';
    liveStreamLenRef.current = 0;
    liveStreamRawRef.current = '';
    setLiveStreamVisibleCount(LIVE_STREAM_PAGE_SIZE);
    liveStreamUserScrolledUp.current = false;
    setLiveStreamScrollLocked(false);
    setInlineFeedbacks([]);
    setLiveStream([]);

    // Close previous connection
    if (liveStreamRef.current) {
      if (liveStreamRef.current instanceof EventSource) liveStreamRef.current.close();
      else clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }

    const rid = runId || selectedRun?.id;
    const activeStep = currentStep || selectedStep?.name;

    // Try SSE live stream if we have runId + step
    if (rid && activeStep) {
      let sseBuffer = '';
      let sseRaw = '';
      const es = streamApi.connectLiveStream(
        rid,
        activeStep,
        (content) => {
          // SSE may replay the full accumulated content after reconnect.
          // Normalize it into a monotonic raw stream before splitting chunks.
          const nextRaw = sseRaw && content.startsWith(sseRaw)
            ? content
            : content.length >= sseRaw.length && content.startsWith(sseRaw)
              ? content
              : sseRaw && sseRaw.startsWith(content)
                ? sseRaw
                : sseRaw + content;

          if (nextRaw === sseRaw) return;

          sseRaw = nextRaw;
          liveStreamRawRef.current = sseRaw;
          liveStreamLenRef.current = sseRaw.length;

          const parts = sseRaw.split(CHUNK_SEP);
          sseBuffer = parts.pop() || '';
          const rebuilt = [...parts.filter(Boolean), ...(sseBuffer ? [sseBuffer] : [])];
          setLiveStream(rebuilt);
        },
        (_status) => {
          // Stream done — don't auto-close panel, user may still be reading
        },
      );
      liveStreamRef.current = es;
      return;
    }

    // Fallback: polling for claude-code or when runId/step not yet available
    liveStreamRef.current = setInterval(async () => {
      try {
        const { processes } = await processApi.list();
        const curRid = runId || selectedRun?.id;

        // Only show workflow step processes, not dashboard chat processes
        const workflowProcesses = processes.filter((p: any) => !(p.agent === 'chat' && p.step === 'chat'));

        // If no runId yet, don't show anything — avoid cross-contamination
        if (!curRid) {
          if (!workflowProcesses.some((p: any) => p.status === 'running')) {
            // No workflow processes running, nothing to show
          }
          return;
        }

        const runningProc = workflowProcesses.find((p: any) => p.status === 'running' && p.runId === curRid);
        const curStep = runningProc?.step || currentStep || selectedStep?.name;

        if (curStep !== liveStreamStepRef.current) {
          liveStreamStepRef.current = curStep;
          liveStreamLenRef.current = 0;
          liveStreamRawRef.current = '';
          setLiveStream([]);
          setInlineFeedbacks([]);
        }

        let content: string | null = null;
        if (curRid && curStep) {
          content = await streamApi.getStreamContent(curRid, curStep);
        }
        if (!content) {
          const running = workflowProcesses.find((p: any) => p.status === 'running' && p.runId === curRid);
          content = running?.streamContent || workflowProcesses
            .filter((p: any) => p.runId === curRid)
            .sort((a: any, b: any) =>
              new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
            )[0]?.streamContent;
        }

        if (content) {
          const prevRaw = liveStreamRawRef.current;
          const isContinuous =
            content.length >= prevRaw.length &&
            content.startsWith(prevRaw);

          // Abnormal stream update (reset/overwrite/step mismatch): rebuild once from full content
          if (!isContinuous) {
            const parts = content.split(CHUNK_SEP);
            const trailing = parts.pop() || '';
            const rebuilt = [...parts.filter(Boolean), ...(trailing ? [trailing] : [])];
            liveStreamRawRef.current = content;
            liveStreamLenRef.current = content.length;
            setLiveStream(rebuilt);
          } else if (content.length > prevRaw.length) {
            // Continuous append: only process delta to keep UI responsive
            const delta = content.slice(prevRaw.length);
            liveStreamRawRef.current = content;
            liveStreamLenRef.current = content.length;

            setLiveStream(prev => {
              const next = [...prev];
              const oldTail = next.length > 0 ? next.pop() || '' : '';
              const merged = oldTail + delta;
              const segs = merged.split(CHUNK_SEP);
              const newTail = segs.pop() || '';
              const completed = segs.filter(Boolean);
              next.push(...completed);
              if (newTail) next.push(newTail);
              return next;
            });
          }
        }

        if (!processes.some((p: any) => p.status === 'running') && !isRunning) {
          stopLiveStream();
        }
      } catch (e) { console.error('[LiveStream] polling error:', e); }
    }, 2000);
  };

  const stopLiveStream = () => {
    if (liveStreamRef.current) {
      if (liveStreamRef.current instanceof EventSource) liveStreamRef.current.close();
      else clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }
    liveStreamRawRef.current = '';
    setShowLiveStream(false);
    setLiveStreamFullscreen(false);
    setLiveStreamScrollLocked(false);
  };

  // Auto-reconnect live stream when currentStep changes while modal is open
  useEffect(() => {
    if (showLiveStream && currentStep) {
      startLiveStream();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep]);

  const sendLiveFeedback = async (interrupt?: boolean) => {
    const feedback = liveStreamFeedbackRef.current?.value || '';
    if (!feedback.trim() || sendingFeedback) return;
    setSendingFeedback(true);
    try {
      // Add feedback to inline list immediately for display
      const timestamp = new Date().toISOString();
      setInlineFeedbacks(prev => [...prev, {
        message: feedback.trim(),
        timestamp,
        streamIndex: liveStream.length, // Insert after current chunks
      }]);
      
      const res = await workflowApi.injectFeedback(feedback.trim(), interrupt, configFile);
      if (liveStreamFeedbackRef.current) liveStreamFeedbackRef.current.value = '';
      if (interrupt) {
        if (res.interrupted) {
          toast('success', '已打断当前执行，反馈将立即处理');
        } else {
          toast('warning', '打断信号已发送，反馈已排队等待处理');
        }
      }
    } catch (error: any) {
      toast('error', `发送反馈失败: ${error.message}`);
      // Remove feedback from inline list if API call failed
      setInlineFeedbacks(prev => prev.slice(0, -1));
    }
    setSendingFeedback(false);
  };

  const recallFeedback = async (message: string) => {
    try {
      await workflowApi.recallFeedback(message, configFile);
    } catch (error: any) {
      toast('error', `撤回失败: ${error.message}`);
    }
  };

  const openContextEditor = (scope: 'global' | 'phase', phase?: string) => {
    setEditingContextScope(scope);
    setEditingContextPhase(phase || '');
    setEditingContextValue(
      scope === 'global' ? globalContext : (phase ? phaseContexts[phase] || '' : '')
    );
    setShowContextEditor(true);
  };

  const saveContext = async () => {
    try {
      const rid = runId || initialRunId || selectedRun?.id;
      await workflowApi.setContext(editingContextScope, editingContextValue, editingContextPhase || undefined, rid || undefined, configFile);
      if (editingContextScope === 'global') {
        dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: editingContextValue });
      } else if (editingContextPhase) {
        dispatch({ type: 'SET_PHASE_CONTEXT', payload: { phase: editingContextPhase, context: editingContextValue } });
      }
      setShowContextEditor(false);
      toast('success', '上下文已保存');
    } catch (error: any) {
      toast('error', `保存失败: ${error.message}`);
    }
  };

  const handleRerunFromStep = async (stepName: string) => {
    const rid = runId || selectedRun?.id;
    if (!rid) return;
    const ok = await confirm({
      title: '从此步骤重新运行',
      description: `将从步骤 "${stepName}" 开始重新运行，该步骤及之后的所有步骤结果将被清除。`,
      confirmLabel: '重新运行',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      setViewingHistoryRun(false);
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
      dispatch({ type: 'SET_FAILED_STEPS', payload: [] });
      dispatch({ type: 'SET_STEP_RESULTS', payload: {} });
      dispatch({ type: 'SET_RUN_ID', payload: rid });
      addLog('system', 'info', `正在从步骤 "${stepName}" 重新运行...`);
      await workflowApi.rerunFromStep(rid, stepName);
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      fetchCurrentStatus();
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `重新运行失败: ${error.message}`);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!liveStreamRef.current) return;
      if (liveStreamRef.current instanceof EventSource) liveStreamRef.current.close();
      else clearInterval(liveStreamRef.current as ReturnType<typeof setInterval>);
    };
  }, []);

  // Auto-scroll live stream to bottom when content updates (only if user hasn't scrolled up)
  useEffect(() => {
    if (liveStreamScrollRef.current && !liveStreamScrollLocked) {
      liveStreamScrollRef.current.scrollTop = liveStreamScrollRef.current.scrollHeight;
    }
  }, [liveStream, liveStreamScrollLocked]);

  const unlockLiveStreamScroll = useCallback(() => {
    liveStreamUserScrolledUp.current = false;
    setLiveStreamScrollLocked(false);
    if (liveStreamScrollRef.current) {
      liveStreamScrollRef.current.scrollTop = liveStreamScrollRef.current.scrollHeight;
    }
  }, []);

  // Find the latest iteration result key for a step (e.g. "代码审计" → UUID or "代码审计-迭代3" if that's the latest)
  const getLatestStepKey = (baseName: string): string => {
    if (!baseName) return baseName;

    // 0. If this step is currently running, prioritize the live key so the UI
    //    shows the running state instead of a stale historical result.
    //    Check whether the stepIdMap already points to a NEW id (no result yet)
    //    which means a re-execution is in progress.
    if (currentStep && (currentStep === baseName || currentStep.endsWith('-' + baseName))) {
      // If stepIdMap has an entry for currentStep whose id has no result yet,
      // this is a fresh re-execution — return currentStep so the live stream shows.
      const mappedId = stepIdMap[currentStep];
      if (mappedId && !stepResults[mappedId]) {
        return currentStep;
      }
      // Also check if currentStep itself has no result (no UUID mapping)
      if (!mappedId && !stepResults[currentStep]) {
        return currentStep;
      }
    }

    // 1. Exact match in stepIdMap (e.g. "问题复现-构造最小复现用例")
    if (stepIdMap[baseName] && stepResults[stepIdMap[baseName]]) {
      return stepIdMap[baseName];
    }

    // 2. State machine format: stepIdMap key is "stateName-stepName", baseName is just "stepName"
    for (const [mapKey, mapId] of Object.entries(stepIdMap)) {
      if (mapKey.endsWith('-' + baseName) && stepResults[mapId]) {
        return mapId;
      }
    }

    // 3. Check iteration variants in stepIdMap (e.g. "根因定位-定位空指针路径-迭代2")
    //    Find the highest iteration that has results
    let bestKey = '';
    let bestIter = -1;
    for (const [mapKey, mapId] of Object.entries(stepIdMap)) {
      if (!stepResults[mapId]) continue;
      // Match "stateName-baseName-迭代N" or "baseName-迭代N"
      const iterMatch = mapKey.match(new RegExp(`(?:^|-)${baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-迭代(\\d+)$`));
      if (iterMatch) {
        const n = parseInt(iterMatch[1], 10);
        if (n > bestIter) { bestIter = n; bestKey = mapId; }
      }
    }
    if (bestKey) return bestKey;

    // 4. Fallback: direct key match in stepResults (legacy, no UUID)
    if (stepResults[baseName]) return baseName;

    // 5. If currently running this step, return baseName for stream display
    if (currentStep && (currentStep === baseName || currentStep.endsWith('-' + baseName))) {
      return currentStep;
    }

    return baseName;
  };

  const handleSelectNode = (type: 'phase' | 'step', phaseIndex: number, stepIndex?: number) => {
    setIsNewNode(false);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type, phaseIndex, stepIndex } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleSaveNode = async (data: any) => {
    if (!editingNode || !editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    if (editingNode.type === 'phase') {
      newConfig.workflow.phases[editingNode.phaseIndex] = {
        ...newConfig.workflow.phases[editingNode.phaseIndex], ...data,
      };
    } else if (editingNode.stepIndex !== undefined) {
      newConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex] = {
        ...newConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex], ...data,
      };
    }
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false });
    dispatch({ type: 'SET_EDITING_NODE', payload: null });
  };

  const handleDeleteNode = async () => {
    if (!editingNode || !editingConfig) return;
    const ok = await confirm({
      title: '确认删除',
      description: '确定要删除吗？',
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    if (editingNode.type === 'phase') {
      newConfig.workflow.phases.splice(editingNode.phaseIndex, 1);
    } else if (editingNode.stepIndex !== undefined) {
      newConfig.workflow.phases[editingNode.phaseIndex].steps.splice(editingNode.stepIndex, 1);
    }
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false });
    dispatch({ type: 'SET_EDITING_NODE', payload: null });
  };

  const handleAddPhase = (afterIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const newPhase = {
      name: `新阶段 ${newConfig.workflow.phases.length + 1}`,
      steps: [],
      iteration: { enabled: false },
    };
    newConfig.workflow.phases.splice(afterIndex + 1, 0, newPhase);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    setIsNewNode(true);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type: 'phase' as const, phaseIndex: afterIndex + 1 } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleAddStep = (phaseIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const phase = newConfig.workflow.phases[phaseIndex];
    const newStep = {
      name: `新步骤 ${phase.steps.length + 1}`,
      agent: agentConfigs.length > 0 ? agentConfigs[0].name : '',
      task: '',
      role: 'defender',
    };
    phase.steps.push(newStep);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    setIsNewNode(true);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type: 'step' as const, phaseIndex, stepIndex: phase.steps.length - 1 } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleDeletePhase = async (phaseIndex: number) => {
    if (!editingConfig) return;
    const ok = await confirm({
      title: '确认删除阶段',
      description: `确定要删除阶段 "${editingConfig.workflow.phases[phaseIndex].name}" 吗？`,
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    newConfig.workflow.phases.splice(phaseIndex, 1);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleDeleteStep = async (phaseIndex: number, stepIndex: number) => {
    if (!editingConfig) return;
    const step = editingConfig.workflow.phases[phaseIndex].steps[stepIndex];
    const ok = await confirm({
      title: '确认删除步骤',
      description: `确定要删除步骤 "${step.name}" 吗？`,
      confirmLabel: '删除',
      variant: 'destructive',
    });
    if (!ok) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    newConfig.workflow.phases[phaseIndex].steps.splice(stepIndex, 1);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleAddStepAt = (phaseIndex: number, afterStepIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const phase = newConfig.workflow.phases[phaseIndex];
    const newStep = {
      name: `新步骤 ${phase.steps.length + 1}`,
      agent: agentConfigs.length > 0 ? agentConfigs[0].name : '',
      task: '',
      role: 'defender',
    };
    phase.steps.splice(afterStepIndex + 1, 0, newStep);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
    setIsNewNode(true);
    dispatch({ type: 'SET_EDITING_NODE', payload: { type: 'step' as const, phaseIndex, stepIndex: afterStepIndex + 1 } });
    dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: true });
  };

  const handleMoveStep = (phaseIndex: number, fromIndex: number, toIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const steps = newConfig.workflow.phases[phaseIndex].steps;
    if (toIndex < 0 || toIndex >= steps.length) return;
    const [moved] = steps.splice(fromIndex, 1);
    steps.splice(toIndex, 0, moved);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleToggleParallel = (phaseIndex: number, stepIndices: number[]) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const steps = newConfig.workflow.phases[phaseIndex].steps;
    // Reuse existing group ID if any target step is already in a group
    let groupId = stepIndices.map((si: number) => steps[si]?.parallelGroup).find((pg: string | undefined) => pg != null);
    if (!groupId) groupId = `parallel-${Date.now()}`;
    stepIndices.forEach((si: number) => {
      if (steps[si]) steps[si].parallelGroup = groupId;
    });
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleUngroup = (phaseIndex: number, stepIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const steps = newConfig.workflow.phases[phaseIndex].steps;
    const groupId = steps[stepIndex]?.parallelGroup;
    if (!groupId) return;
    steps.forEach((s: any) => { if (s.parallelGroup === groupId) delete s.parallelGroup; });
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleCrossPhaseMove = (fromPhase: number, fromIndex: number, toPhase: number, toIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const sourceSteps = newConfig.workflow.phases[fromPhase].steps;
    const targetSteps = newConfig.workflow.phases[toPhase].steps;
    const [moved] = sourceSteps.splice(fromIndex, 1);
    delete moved.parallelGroup;
    targetSteps.splice(Math.min(toIndex, targetSteps.length), 0, moved);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleMoveGroup = (fromPhase: number, groupStartIndex: number, toPhase: number, toIndex: number) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const sourceSteps = newConfig.workflow.phases[fromPhase].steps;
    const groupId = sourceSteps[groupStartIndex]?.parallelGroup;
    if (!groupId) return;
    const groupSteps: any[] = [];
    let i = groupStartIndex;
    while (i < sourceSteps.length && sourceSteps[i].parallelGroup === groupId) {
      groupSteps.push(sourceSteps[i]);
      i++;
    }
    sourceSteps.splice(groupStartIndex, groupSteps.length);
    const targetSteps = fromPhase === toPhase ? sourceSteps : newConfig.workflow.phases[toPhase].steps;
    let insertAt = Math.min(toIndex, targetSteps.length);
    if (fromPhase === toPhase && toIndex > groupStartIndex) {
      insertAt = Math.max(0, toIndex - groupSteps.length);
    }
    targetSteps.splice(insertAt, 0, ...groupSteps);
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleJoinGroup = (phaseIndex: number, stepIndex: number, groupId: string) => {
    if (!editingConfig) return;
    const newConfig = JSON.parse(JSON.stringify(editingConfig));
    const step = newConfig.workflow.phases[phaseIndex].steps[stepIndex];
    if (step) step.parallelGroup = groupId;
    dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
  };

  const handleSaveConfig = async () => {
    if (!editingConfig) return;
    setSaving(true);
    try {
      const config = {
        ...editingConfig,
        context: {
          ...(editingConfig.context || {}),
          projectRoot,
          workspaceMode,
          requirements,
          timeoutMinutes,
          engine: engine || undefined,
          skills,
        },
      };
      await configApi.saveConfig(configFile, config);
      toast('success', '配置已保存，下次运行时生效');
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      dispatch({ type: 'SET_EDITING_CONFIG', payload: config });
    } catch (error: any) {
      toast('error', '保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAgent = async (agent: any) => {
    try {
      await agentApi.saveAgent(agent.name, agent);
      // Reload agents
      const { agents: updatedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: updatedAgents });
    } catch (error: any) {
      toast('error', '保存 Agent 失败: ' + error.message);
    }
  };

  const handleDeleteAgent = async (name: string) => {
    try {
      await agentApi.deleteAgent(name);
      const { agents: updatedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: updatedAgents });
    } catch (error: any) {
      toast('error', '删除 Agent 失败: ' + error.message);
    }
  };

  const getEditingNodeData = () => {
    if (!editingNode || !editingConfig) return null;
    if (editingNode.type === 'phase') return editingConfig.workflow.phases[editingNode.phaseIndex];
    if (editingNode.stepIndex !== undefined) return editingConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex];
    return null;
  };

  const renderRuntimeInsightPanels = () => {
    const hasSpecCodingTasks = Boolean(specCodingSummary && specCodingDetails?.tasks?.length);
    const hasQualityChecks = displayQualityChecks.length > 0;
    const hasMemoryLayers = Boolean(memoryLayers);
    if (!hasSpecCodingTasks && !hasQualityChecks && !hasMemoryLayers) return null;

    return (
      <div className="mt-4 space-y-3">
        {hasSpecCodingTasks ? (
          <div className="rounded-2xl border bg-background/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>task_alt</span>
                <div>
                  <div className="text-sm font-semibold">当前 tasks.md 进度</div>
                  <div className="text-xs text-muted-foreground">
                    当前 run 派生出的 tasks.md 实时投影，带任务状态和 Agent 排布。
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">
                  {specCodingDetails?.tasks?.filter((task) => task.status === 'completed').length || 0}/{specCodingDetails?.tasks?.length || 0}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => {
                    setSpecCodingArtifactTab('tasks');
                    setSpecCodingModalOpen(true);
                  }}
                >
                  <span className="material-symbols-outlined text-sm mr-1">article</span>
                  查看当前 tasks.md
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {overviewTasks.map((task) => (
                <div
                  key={task.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    task.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-500/8'
                      : task.status === 'in-progress'
                        ? 'border-blue-500/40 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]'
                        : task.status === 'blocked'
                          ? 'border-red-500/30 bg-red-500/8'
                          : 'bg-muted/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {task.status === 'in-progress' ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                            进行中
                          </span>
                        ) : null}
                        <div className={`text-sm font-medium leading-6 ${
                          task.status === 'completed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : task.status === 'in-progress'
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-foreground'
                        }`}>{task.title}</div>
                      </div>
                      {task.detail ? (
                        <div className="mt-1 text-[11px] leading-5 text-muted-foreground line-clamp-2">{task.detail}</div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] text-muted-foreground">负责 Agent：</span>
                        {(task.ownerAgents || []).map((agent) => (
                          <button
                            key={`${task.id}-${agent}`}
                            type="button"
                            className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] text-foreground transition-colors hover:bg-background"
                            onClick={() => openAgentFromTask(agent)}
                            title={`查看 ${agent}`}
                          >
                            {agent}
                          </button>
                        ))}
                        {task.validation ? (
                          <span className="text-[10px] text-muted-foreground">验证：{task.validation}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {getSpecCodingTaskPhaseTitle(task) ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-6 px-2 text-[10px]"
                            onClick={() => focusTaskOnDiagram(task)}
                          >
                            <span className="material-symbols-outlined mr-1" style={{ fontSize: 12 }}>my_location</span>
                            定位状态图
                          </Button>
                        ) : null}
                      </div>
                    </div>
                    <Badge
                      className={`shrink-0 ${
                        task.status === 'completed'
                          ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                          : task.status === 'in-progress'
                            ? 'bg-blue-500/15 text-blue-600 border border-blue-500/30'
                            : task.status === 'blocked'
                              ? 'bg-red-500/15 text-red-600 border border-red-500/30'
                              : 'bg-muted text-muted-foreground border border-border'
                      }`}
                    >
                      {formatSpecCodingTaskStatus(task.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid gap-3 xl:grid-cols-2">
        {hasQualityChecks ? (
          <div className="rounded-2xl border bg-background/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>verified</span>
                <div className="text-sm font-semibold">质量门禁</div>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="查看质量门禁说明"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 space-y-2 text-xs leading-5">
                    <div className="font-medium text-foreground">这一块是做什么的</div>
                    <div className="text-muted-foreground">
                      这里汇总工作流里的检查项结果，比如启动前检查、编译、测试、lint 和自定义校验。
                    </div>
                    <div className="text-muted-foreground">
                      它的作用是告诉你：系统按什么命令检查过、检查是否通过、失败或告警出现在哪一步。
                    </div>
                    <div className="text-muted-foreground">
                      像“启动前检查”这一类记录，来源于 workflow 配置里的 preflight / 检查命令；如果页面里显示的是“[配置] ...”，表示这条命令来自当前 workflow 配置本身。
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              <Badge variant="outline" className="text-[10px]">{displayQualityChecks.length} 条</Badge>
            </div>
            <div className="space-y-2">
              {displayQualityChecks.slice(-4).reverse().map((check) => (
                <div key={check.id} className="rounded-xl border bg-muted/20 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-xs font-medium text-foreground">
                      {formatQualityCheckScope(check)}
                    </div>
                    <Badge variant={check.status === 'failed' ? 'destructive' : 'secondary'} className="shrink-0 text-[10px]">
                      {formatQualityCheckCategory(check.category)} · {formatQualityCheckStatus(check.status)}
                    </Badge>
                  </div>
                  <div className="text-[11px] leading-5 text-muted-foreground">{check.summary}</div>
                  <div className="text-[10px] text-muted-foreground/80">
                    {formatQualityCheckAgent(check.agent)} · {new Date(check.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {memoryLayers ? (
          <div className="rounded-2xl border bg-background/70 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>memory</span>
                <div className="text-sm font-semibold">记忆分层</div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {memoryLayers.schema?.scopes?.join(' / ') || 'runtime / review / history'}
              </Badge>
            </div>
            {memoryLayers.review ? (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                <div className="text-[11px] font-medium text-foreground">复盘记忆</div>
                <div className="text-[11px] leading-5 text-muted-foreground">{memoryLayers.review.summary}</div>
              </div>
            ) : null}
            {memoryLayers.role?.memories?.length ? (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-foreground">角色长期记忆 · {memoryLayers.role.agent}</div>
                {memoryLayers.role.memories.slice(0, 2).map((item) => (
                  <div key={item.id} className="space-y-1">
                    <div className="text-[11px] font-medium text-foreground">{item.title}</div>
                    <div className="text-[11px] leading-5 text-muted-foreground">{item.content}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {memoryLayers.project?.memories?.length ? (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-foreground">项目级共享记忆</div>
                {memoryLayers.project.memories.slice(0, 2).map((item) => (
                  <div key={item.id} className="space-y-1">
                    <div className="text-[11px] font-medium text-foreground">{item.title}</div>
                    <div className="text-[11px] leading-5 text-muted-foreground">{item.content}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {memoryLayers.workflow?.memories?.length ? (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-foreground">Workflow 记忆</div>
                {memoryLayers.workflow.memories.slice(0, 2).map((item) => (
                  <div key={item.id} className="space-y-1">
                    <div className="text-[11px] font-medium text-foreground">{item.title}</div>
                    <div className="text-[11px] leading-5 text-muted-foreground">{item.content}</div>
                  </div>
                ))}
              </div>
            ) : null}
            {(memoryLayers.history?.length || memoryLayers.recalledExperiences?.length) ? (
              <div className="grid gap-2 md:grid-cols-2">
                {memoryLayers.history?.length ? (
                  <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                    <div className="text-[11px] font-medium text-foreground">长期经验</div>
                    {memoryLayers.history.slice(0, 2).map((item) => (
                      <div key={item.runId} className="text-[11px] leading-5 text-muted-foreground">
                        {item.runId} · {item.status}
                      </div>
                    ))}
                  </div>
                ) : null}
                {memoryLayers.recalledExperiences?.length ? (
                  <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                    <div className="text-[11px] font-medium text-foreground">本次召回经验</div>
                    {memoryLayers.recalledExperiences.slice(0, 2).map((item) => (
                      <div key={`recalled-${item.runId}`} className="text-[11px] leading-5 text-muted-foreground">
                        {item.runId} · {item.status}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        </div>
      </div>
    );
  };

  const renderSpecCodingPanel = (options?: { className?: string }) => {
    const completedTaskCount = specCodingDetails?.tasks?.filter((task) => task.status === 'completed').length || 0;
    const totalTaskCount = specCodingDetails?.tasks?.length || 0;

    return (
      <div className={options?.className || 'space-y-4'}>
        <div className="rounded-2xl border bg-background/75 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
                <h3 className="text-base font-semibold">Spec Coding 草案</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                查看创建期确认的 proposal、design、tasks 和增量 spec；运行后这里会展示当前 run 的快照与进度投影。
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {specCodingSummary ? (
                <>
                  <Badge variant="outline" className="text-[10px]">v{specCodingSummary.version}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{specCodingSummary.status}</Badge>
                  {specCodingSummary.source ? (
                    <Badge variant="outline" className="text-[10px]">
                      {specCodingSummary.source === 'run' ? 'Run Snapshot' : 'Creation Baseline'}
                    </Badge>
                  ) : null}
                </>
              ) : (
                <Badge variant="outline" className="text-[10px]">未绑定</Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={!specCodingSummary}
                onClick={() => setSpecCodingModalOpen(true)}
                title="弹出 Spec Coding 文件管理器"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
              </Button>
            </div>
          </div>

          {specCodingSummary ? (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">任务</div>
                  <div className="mt-1 text-lg font-semibold">{completedTaskCount}/{totalTaskCount || specCodingSummary.taskCount || 0}</div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">制品</div>
                  <div className="mt-1 text-lg font-semibold">
                    {specCodingArtifactEntries.filter((entry) => entry.content.trim()).length}/{specCodingArtifactEntries.length}
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">修订</div>
                  <div className="mt-1 text-lg font-semibold">{specCodingDetails?.revisions?.length || 0}</div>
                </div>
              </div>
              {specCodingSummary.summary ? (
                <div className="rounded-xl border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                  {specCodingSummary.summary}
                </div>
              ) : null}
              {specCodingSummary.progress?.summary ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                  当前进度：{specCodingSummary.progress.summary}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              当前工作流没有绑定创建期 Spec Coding 制品。通过首页 AI 创建工作流并确认 Spec Coding 后，这里会显示完整草案。
            </div>
          )}
        </div>

        {specCodingSummary && (
          <div className="rounded-2xl border bg-background/75 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">制品列表</div>
                <div className="text-xs text-muted-foreground">在弹窗中查看完整内容。</div>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {specCodingArtifactEntries.filter((entry) => entry.content.trim()).length}/{specCodingArtifactEntries.length}
              </Badge>
            </div>
            <div className="space-y-2">
              {specCodingArtifactEntries.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                    activeSpecCodingArtifact.key === entry.key
                      ? 'border-primary bg-primary/10'
                      : 'bg-background/60 hover:bg-background'
                  }`}
                  onClick={() => {
                    setSpecCodingArtifactTab(entry.key);
                    setSpecCodingModalOpen(true);
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-foreground">{entry.label}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{entry.title}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {entry.content.trim() ? 'available' : 'empty'}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {specCodingDetails?.revisions?.length ? (
          <div className="rounded-2xl border bg-background/75 p-4 space-y-3">
            <div className="text-sm font-semibold">修订记录</div>
            <div className="space-y-2">
              {[...specCodingDetails.revisions].reverse().map((revision) => (
                <div key={revision.id} className="rounded-xl border bg-muted/10 p-3 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium text-foreground">v{revision.version}</span>
                    <span>{new Date(revision.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 leading-5">{revision.summary}</div>
                  {revision.createdBy ? (
                    <div className="mt-1 text-[10px]">修订者：{revision.createdBy}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderSpecCodingExplorer = () => (
    <>
      <div className="border-b border-border px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
                <div className="truncate text-sm font-semibold">Spec Coding 文件管理器</div>
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {specCodingSummary?.id || workflowConfig?.workflow?.name || configFile}
            </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => triggerDownload(activeSpecCodingArtifact.content, activeSpecCodingArtifact.label)}
                disabled={!activeSpecCodingArtifact.content.trim()}
                title="下载当前文档"
              >
                <span className="material-symbols-outlined text-sm">download</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => specCodingCodingSaveDialog(activeSpecCodingArtifact.key)}
                disabled={!activeSpecCodingArtifact.content.trim()}
                title="保存到 Notebook"
              >
                <span className="material-symbols-outlined text-sm">note_add</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setSpecCodingModalFullscreen((value) => !value)}
              title={specCodingModalFullscreen ? '退出全屏' : '全屏'}
            >
              <span className="material-symbols-outlined text-sm">
                {specCodingModalFullscreen ? 'fullscreen_exit' : 'fullscreen'}
              </span>
            </Button>
          </div>
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-border bg-muted/20">
          <div className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
            制品列表
          </div>
          <div className="space-y-1 p-2">
            {specCodingArtifactEntries.map((entry) => {
              const active = activeSpecCodingArtifact.key === entry.key;
              return (
                <button
                  key={entry.key}
                  type="button"
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-foreground'
                      : 'border-transparent hover:border-border hover:bg-background'
                  }`}
                  onClick={() => setSpecCodingArtifactTab(entry.key)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium">{entry.label}</span>
                    <Badge variant="outline" className="shrink-0 text-[9px]">
                      {entry.content.trim() ? 'ready' : 'empty'}
                    </Badge>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{entry.title}</div>
                </button>
              );
            })}
          </div>
          {specCodingDetails?.revisions?.length ? (
            <div className="border-t border-border p-3">
              <div className="text-xs font-medium text-muted-foreground">最近修订</div>
              <div className="mt-2 space-y-2">
                {[...specCodingDetails.revisions].reverse().slice(0, 3).map((revision) => (
                  <div key={revision.id} className="rounded-lg border bg-background/70 p-2 text-[11px] text-muted-foreground">
                    <div className="font-medium text-foreground">v{revision.version}</div>
                    <div className="mt-1 line-clamp-2">{revision.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{activeSpecCodingArtifact.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{activeSpecCodingArtifact.label}</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {specCodingSummary ? (
                <>
                  <Badge variant="outline" className="text-[10px]">v{specCodingSummary.version}</Badge>
                  <Badge variant="secondary" className="text-[10px]">{specCodingSummary.status}</Badge>
                </>
              ) : null}
              <Badge variant="outline" className="text-[10px]">
                {activeSpecCodingArtifact.content.trim() ? 'available' : 'empty'}
              </Badge>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-5">
            {activeSpecCodingArtifact.content.trim() ? (
              <div className={`${styles.markdownContent} max-w-none`}>
                <Markdown>{activeSpecCodingArtifact.content}</Markdown>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                这份 Spec Coding 制品还没有内容。
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );

  if (pageLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <ClipLoader color="hsl(var(--primary))" size={40} />
        <p className="text-sm text-muted-foreground">加载工作流配置...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <span className="material-symbols-outlined text-4xl text-destructive">error</span>
        <p className="text-sm text-destructive">{loadError}</p>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/">返回首页</Link></Button>
          <Button onClick={loadWorkflowConfig}>重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background/80 text-foreground">
      <div className="shrink-0 bg-muted border-b flex flex-wrap items-center px-4 py-2 gap-x-4 gap-y-2">
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => router.push('/workflows')}>
            <span className="material-symbols-outlined" style={{ fontSize: 14 }}>arrow_back</span><span className="hidden sm:inline"> 返回</span>
          </Button>
          <h1 className="text-xs font-semibold m-0 flex items-center gap-1.5 min-w-0 max-w-[160px] sm:max-w-[240px] lg:max-w-none">
            <RobotLogo size={18} className="shrink-0" />
            {isDesignMode ? (
              editingName ? (
                <Input
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onBlur={() => saveWorkflowName(nameValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveWorkflowName(nameValue);
                    if (e.key === 'Escape') setEditingName(false);
                  }}
                  className="h-6 text-xs font-semibold w-[150px]"
                  autoFocus
                />
              ) : (
                <button
                  onClick={() => { setEditingName(true); setNameValue(workflowConfig?.workflow?.name || ''); }}
                  className="flex items-center gap-1 text-xs font-semibold hover:bg-background/50 px-2 py-0.5 rounded min-w-0 max-w-full"
                  title={workflowConfig?.workflow?.name || configFile}
                >
                  <span className="truncate">{workflowConfig?.workflow?.name || configFile}</span>
                  <span className="material-symbols-outlined shrink-0" style={{ fontSize: 14 }}>edit</span>
                </button>
              )
            ) : (
              <span className="truncate" title={workflowConfig?.workflow?.name || configFile}>{workflowConfig?.workflow?.name || configFile}</span>
            )}
          </h1>
        </div>
        <div className="flex gap-0.5 bg-background/50 rounded-md p-0.5 shrink-0">
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${isRunMode ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => switchViewMode('run')}>
            <span className="material-symbols-outlined text-sm">home</span><span className="hidden sm:inline ml-1">首页</span>
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${isDesignMode ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => switchViewMode('design')}>
            <span className="material-symbols-outlined text-sm">edit</span><span className="hidden sm:inline ml-1">设计</span>
          </Button>
          <Button variant="ghost" size="sm" className={`h-7 px-2 text-xs ${isHistoryMode ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => switchViewMode('history')}>
            <span className="material-symbols-outlined text-sm">history</span><span className="hidden sm:inline ml-1">历史</span>
          </Button>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunMode && (<>
            <div className={`hidden md:flex items-center gap-2 rounded-md border px-2 py-1 transition-colors ${
              rehearsalMode ? 'bg-background/40' : 'bg-amber-500/10 border-amber-500/30'
            }`}>
              <Switch checked={rehearsalMode} onCheckedChange={setRehearsalMode} />
              <span className="text-xs text-muted-foreground">演练模式</span>
              <TooltipProvider delayDuration={150}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label="查看演练模式说明"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>help</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs text-xs leading-5">
                    演练模式会按真实流程做一次预演，生成阶段建议、风险和下一步，但不会进入正式执行链路，适合先检查流程设计是否合理。
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            <Button
              size="sm"
              className={`h-7 text-xs ${canStartWorkflow ? styles.startWorkflowGlow : ''}`}
              onClick={() => void startWorkflow()}
              disabled={starting || isRunning}
            >
              {starting ? (
                <ClipLoader color="currentColor" size={14} className="mr-1" />
              ) : (
                <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>play_arrow</span>
              )}
              <span className="hidden sm:inline">{starting ? '启动中...' : rehearsalMode ? '开始演练' : '启动工作流'}</span>
              <span className="sm:hidden">{starting ? '...' : '启动'}</span>
            </Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={requestStopWorkflow} disabled={!isRunning && workflowStatus !== 'running'}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>stop</span><span className="hidden sm:inline">停止</span>
            </Button>
            <ButtonGroup>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel })}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>settings</span><span className="hidden sm:inline">进程</span>
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openContextEditor('global')} title="全局上下文">
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit_note</span><span className="hidden sm:inline">上下文</span>
              </Button>
              {projectRoot && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openWorkspaceEditorAtPath(state.workingDirectory || resolvedProjectRoot || projectRoot, '工作区')} title="打开工作区编辑器">
                  <span className="material-symbols-outlined" style={{ fontSize: 14 }}>folder_open</span><span className="hidden sm:inline">工作区</span>
                </Button>
              )}
            </ButtonGroup>
          </>)}
          {isDesignMode && (
            <Button size="sm" className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white" onClick={handleSaveConfig} disabled={saving}>
              {saving ? (
                <ClipLoader color="currentColor" size={14} className="mr-1" />
              ) : (
                <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>save</span>
              )}
              {saving ? '保存中...' : '保存配置'}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {workflowStatus === 'idle' && (
            <Badge variant="secondary"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {workflowStatus === 'preparing' && (
            <Badge className="bg-yellow-500/20 text-yellow-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {workflowStatus === 'running' && (
            <Badge className="bg-blue-500/20 text-blue-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {workflowStatus === 'completed' && (
            <Badge className="bg-green-500/20 text-green-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          {(workflowStatus === 'failed' || workflowStatus === 'stopped' || workflowStatus === 'crashed') && (
            <Badge className="bg-red-500/20 text-red-400"><span className="w-2 h-2 rounded-full bg-current animate-pulse" />{getStatusText(workflowStatus)}</Badge>
          )}
          <ThemeToggle />
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {isRunMode && (
          <ResizablePanels
            leftPanel={
              <div className="flex flex-col h-full overflow-hidden">
              {/* Requirements panel - prominent at top */}
              <div className="border-b shrink-0 max-h-[50%] overflow-y-auto overflow-x-hidden">
                <button
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent hover:from-primary/15 transition-colors"
                  onClick={() => setShowRunRequirements(!showRunRequirements)}
                >
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>assignment</span>
                  <span className="text-sm font-semibold text-primary">配置</span>
                  {!showRunRequirements && requirements && <span className="text-[10px] text-muted-foreground truncate flex-1 text-left ml-1">{requirements.substring(0, 50)}{requirements.length > 50 ? '...' : ''}</span>}
                  <span className="material-symbols-outlined text-muted-foreground ml-auto" style={{ fontSize: 16 }}>{showRunRequirements ? 'expand_less' : 'expand_more'}</span>
                </button>
                {showRunRequirements && (
                  <div className="px-4 py-3 space-y-2.5 bg-card/50">
                    {projectRoot && (
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">项目根目录</Label>
                        <p className="text-sm mt-1">{projectRoot}</p>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">工作区模式</Label>
                      <p className="text-sm mt-1">{workspaceMode === 'isolated-copy' ? '先创建副本工程再执行' : '直接在工作目录执行'}</p>
                    </div>
                    {requirements && (
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">需求描述</Label>
                        <div className="text-sm mt-1 leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                          <Markdown>{requirements}</Markdown>
                        </div>
                      </div>
                    )}
                    {finalReview && (
                      <div className="rounded-xl border bg-background/60 p-3 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <Label className="text-xs font-medium text-muted-foreground">战后结算</Label>
                          <Badge variant="outline" className="text-[10px]">
                            {finalReview.supervisorAgent}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground space-y-1">
                          <div>结算状态：{finalReview.status}</div>
                          <div>生成时间：{new Date(finalReview.generatedAt).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <div className="text-[11px] font-medium text-foreground">总评</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">{finalReview.summary}</div>
                        </div>
                        {finalReview.scoreCards?.length ? (
                          <div className="space-y-2">
                            <div className="text-[11px] font-medium text-foreground">Agent 评分</div>
                            <div className="space-y-2">
                              {finalReview.scoreCards.map((card) => (
                                <div key={card.agent} className="rounded-lg border p-2 space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium text-foreground">{card.agent}</div>
                                    <Badge variant="secondary" className="text-[10px]">{card.score}/100</Badge>
                                  </div>
                                  <Progress value={Math.max(0, Math.min(100, card.score))} className="h-1.5" />
                                  {card.strengths?.length ? (
                                    <div className="text-[11px] text-muted-foreground">优点：{card.strengths.join(' / ')}</div>
                                  ) : null}
                                  {card.weaknesses?.length ? (
                                    <div className="text-[11px] text-muted-foreground">短板：{card.weaknesses.join(' / ')}</div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {finalReview.nextFocus?.length ? (
                          <div className="space-y-2">
                            <div className="text-[11px] font-medium text-foreground">下一步重点</div>
                            <div className="space-y-1">
                              {finalReview.nextFocus.map((item, index) => (
                                <div key={`${item}-${index}`} className="text-[11px] leading-5 text-muted-foreground">
                                  {index + 1}. {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {finalReview.experience?.length ? (
                          <div className="space-y-2">
                            <div className="text-[11px] font-medium text-foreground">经验沉淀</div>
                            <div className="space-y-1">
                              {finalReview.experience.map((item, index) => (
                                <div key={`${item}-${index}`} className="text-[11px] leading-5 text-muted-foreground">
                                  {index + 1}. {item}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )}
                    <div>
                      <Label className="text-xs font-medium text-muted-foreground">步骤超时</Label>
                      <p className="text-sm mt-1">{timeoutMinutes} 分钟</p>
                    </div>
                    {skills.length > 0 && (
                      <div>
                        <Label className="text-xs font-medium text-muted-foreground">Skills ({skills.length})</Label>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {skills.slice(0, showAllSkills ? skills.length : 6).map((s) => (
                            <Badge key={s} variant="secondary" className="text-[10px] font-normal">{s}</Badge>
                          ))}
                          {skills.length > 6 && (
                            <button
                              className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                              onClick={() => setShowAllSkills(!showAllSkills)}
                            >
                              {showAllSkills ? '收起' : `+${skills.length - 6} 更多`}
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <Tabs value={activeTab} onValueChange={(val) => dispatch({ type: 'SET_ACTIVE_TAB', payload: val })} className="flex flex-col flex-1 overflow-hidden">
                <TabsList className="w-full rounded-none border-b flex-shrink-0 px-1 !flex flex-wrap h-auto gap-0.5 py-1">
                  <TabsTrigger value="workflow" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>monitoring</span>工作流
                  </TabsTrigger>
                  <TabsTrigger value="agents" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>smart_toy</span>Agents
                  </TabsTrigger>
                  <TabsTrigger value="spec-coding" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>fact_check</span>Spec
                  </TabsTrigger>
        {(isDesignMode) && <TabsTrigger value="config" className="flex items-center justify-center gap-1 text-xs h-7 px-2"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>settings</span>配置</TabsTrigger>}
                  <TabsTrigger value="documents" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>文档
                  </TabsTrigger>
                  <TabsTrigger value="schedules" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>定时
                  </TabsTrigger>
                </TabsList>
                <div className="flex-1 overflow-hidden min-h-0">
                <TabsContent value="workflow" className="mt-0 overflow-y-auto h-full p-4">
                  {workflowConfig && (
                    <div>
                      <div>
                        <h3 className="text-base font-semibold mb-2">{workflowConfig.workflow.name}</h3>
                        <div className="text-sm text-muted-foreground mb-4 leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                          <Markdown>{workflowConfig.workflow.description}</Markdown>
                        </div>
                        <div className="flex gap-3">
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">{workflowConfig.workflow.mode === 'state-machine' ? '状态' : '阶段'}</span><span className="block text-xl font-semibold">{workflowConfig.workflow.mode === 'state-machine' ? (workflowConfig.workflow.states?.length ?? 0) : (workflowConfig.workflow.phases?.length ?? 0)}</span></div>
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">步骤</span><span className="block text-xl font-semibold">{totalSteps}</span></div>
                          <div className="flex-1 bg-muted p-3 rounded-md text-center"><span className="block text-xs text-muted-foreground mb-1">Agent</span><span className="block text-xl font-semibold">{agentConfigs.length}</span></div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 mt-4">
                        {(workflowConfig.workflow.mode === 'state-machine'
                          ? workflowConfig.workflow.states
                          : workflowConfig.workflow.phases
                        )?.map((phase: any, idx: number) => {
                          const phaseAgents = phase.steps 
                            ? phase.steps.map((s: any) => {
                                const role = agentConfigs.find((r: any) => r.name === s.agent);
                                return { name: s.agent, team: role?.team || 'blue', role: s.role };
                              })
                            : [{ name: phase.agent, team: 'blue', role: undefined }];
                          const iterState = iterationStates[phase.name];
                          const isActive = currentPhase === phase.name;
                          const isDone = phase.steps 
                            ? phase.steps.every((s: any) => completedSteps?.includes(s.name))
                            : completedSteps?.includes(phase.name);
                          return (<div key={idx}
                            className={`bg-muted rounded-md p-2.5 cursor-pointer transition-colors hover:bg-accent border-l-[3px] ${
                              isActive ? 'border-l-primary bg-accent' : isDone ? 'border-l-green-500' : 'border-transparent'
                            }`}
                            onClick={() => {
                              // 触发流程图跳转到该节点
                              setFocusedState(phase.name);
                              if (phase.steps.length > 0) {
                                selectStep(phase.steps[0]);
                              }
                            }}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-medium">{phase.name}</span>
                              <div className="flex items-center gap-1">
                                {phaseContexts[phase.name] && (
                                  <Badge variant="outline" className="text-[10px]"><span className="material-symbols-outlined" style={{ fontSize: 10 }}>edit_note</span></Badge>
                                )}
                                {phase.iteration?.enabled && (<Badge><span className="material-symbols-outlined" style={{ fontSize: 10 }}>loop</span> {iterState ? `${iterState.currentIteration}/${iterState.maxIterations}` : `max ${phase.iteration.maxIterations}`}</Badge>)}
                                {workflowConfig.workflow.mode !== 'state-machine' && (
                                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={(e) => { e.stopPropagation(); openContextEditor('phase', phase.name); }} title="设置阶段上下文">
                                    <span className="material-symbols-outlined" style={{ fontSize: 12 }}>edit_note</span>
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {phaseAgents.map((a: any, i: number) => (
                                <Badge key={i} variant="outline" className={`text-[10px] ${a.team === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : a.team === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30' : a.team === 'judge' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : ''}`}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{a.role === 'attacker' ? 'swords' : a.role === 'judge' ? 'gavel' : 'shield'}</span> {a.name}
                                </Badge>
                              ))}
                            </div>
                          </div>);
                        })}
                      </div>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="agents" className="mt-0 overflow-y-auto h-full p-4"><div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                    <div>
                      <div className="text-sm font-medium">运行通讯录</div>
                      <div className="text-xs text-muted-foreground">查看当前 run 中的 Agent，并补充新的角色草案。</div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setRuntimeAgentDraft(createInitialAgentDraft({
                          workingDirectory: resolvedProjectRoot || '',
                          referenceWorkflow: configFile,
                        }));
                        setShowRuntimeAgentCreator(true);
                      }}
                    >
                      <span className="material-symbols-outlined text-sm mr-1">person_add</span>
                      新增角色
                    </Button>
                  </div>
                  <div className="flex flex-col gap-2">
                  {orderedWorkflowAgents.map((agent) => {
                    const roleConfig = agentConfigs.find((role: any) => role.name === agent.name);
                    const entry = workflowDirectory.find((item) => item.label === agent.name);
                    const relatedSession = listSessionsForAgent(workflowRelatedSessions, agent.name)[0];
                    return (
                      <div key={agent.name} className="space-y-1">
                        <AgentHeroCard
                          compact
                          selected={selectedAgent?.name === agent.name}
                          onClick={() => dispatch({ type: 'SET_SELECTED_AGENT', payload: agent })}
                          agent={{
                            name: agent.name,
                            team: (roleConfig?.team || agent.team) as any,
                            roleType: roleConfig?.roleType,
                            avatar: roleConfig?.avatar,
                            category: roleConfig?.category,
                            tags: roleConfig?.tags,
                            description: roleConfig?.description,
                            capabilities: roleConfig?.capabilities,
                            alwaysAvailableForChat: roleConfig?.alwaysAvailableForChat,
                          }}
                        />
                        <div className="px-2 text-xs text-muted-foreground flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${agent.status === 'running' ? 'bg-blue-500 animate-pulse' : agent.status === 'completed' ? 'bg-green-500' : agent.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'}`} />
                          <span>{agent.status}</span>
                          <span>{agent.model}</span>
                          {entry ? (
                            <span className="truncate" title={entry.sessionId || getConversationSessionStatusLabel(entry)}>
                              {entry.sessionId || getConversationSessionStatusLabel(entry)}
                            </span>
                          ) : null}
                        </div>
                        {relatedSession ? (
                          <div className="px-2 pb-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-[11px]"
                              onClick={() => router.push(`/?sessionId=${encodeURIComponent(relatedSession.id)}&sidebarTab=${encodeURIComponent(agent.name === (finalReview?.supervisorAgent || 'default-supervisor') ? 'commander' : 'agent')}`)}
                            >
                              <span className="material-symbols-outlined text-sm mr-1">history</span>
                              继续最近会话
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  </div>
                </div></TabsContent>
                <TabsContent value="spec-coding" className="mt-0 overflow-y-auto h-full p-4">
                  {renderSpecCodingPanel()}
                </TabsContent>
{isDesignMode && <TabsContent value="config" className="mt-0 overflow-y-auto h-full p-4"><div><h4 className="text-sm font-semibold mb-4">高级配置</h4>
          </div></TabsContent>}
                <TabsContent value="documents" className="mt-0 h-full">
                  <DocumentsPanel
                    runId={runId || selectedRun?.id || null}
                    openLatestTimestampedRequest={openLatestAiDocRequest}
                    onOpenWorkspaceDirectory={(path) => openWorkspaceEditorAtPath(path, '文档目录')}
                  />
                </TabsContent>
                <TabsContent value="schedules" className="mt-0 h-full">
                  <SchedulesPanel configFile={configFile} />
                </TabsContent>
              </div>
            </Tabs>
            </div>
            }
            centerPanel={
              <div className="flex flex-col h-full">
                <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">运行状态图</h2></div>
                <div className="flex-1 min-h-0 overflow-auto">
                  {workflowConfig ? (
                    workflowConfig.workflow.mode === 'state-machine' ? (
                      isDesignMode ? (
                        <StateMachineDiagram
                          states={workflowConfig.workflow.states || []}
                          currentState={currentPhase}
                          currentStep={currentStep}
                          completedSteps={completedSteps}
                          stateHistory={smStateHistory}
                          isRunning={isRunning}
                          onStepClick={(step) => selectStep(step)}
                          onForceTransition={handleForceTransition}
                        />
                      ) : (
                        <div className="h-full p-4">
                          <StateMachineExecutionView
                            states={workflowConfig.workflow.states || []}
                            currentState={currentPhase}
                            currentStep={currentStep}
                            completedSteps={completedSteps}
                            stateHistory={smStateHistory}
                            issueTracker={smIssueTracker}
                            transitionCount={smTransitionCount}
                            maxTransitions={workflowConfig.workflow.maxTransitions || 50}
                            status={workflowStatus as any}
                            isRunning={isRunning}
                            focusedState={focusedState}
                            startTime={runStartTime}
                            endTime={runEndTime}
                            supervisorFlow={supervisorFlow}
                            agentFlow={agentFlow}
                            executionTrace={executionTrace}
                            overviewFooter={renderRuntimeInsightPanels()}
                            activeTabOverride={executionViewTabOverride}
                            onStateClick={(s) => setFocusedState(s)}
                            onStepClick={(step) => selectStep(step)}
                            onForceTransition={handleForceTransition}
                          />
                        </div>
                      )
                    ) : (
                      <FlowDiagram workflow={workflowConfig.workflow} currentPhase={currentPhase} currentStep={currentStep}
                        agents={agents} completedSteps={completedSteps} failedSteps={failedSteps} iterationStates={iterationStates} onSelectStep={selectStep}
                        pendingCheckpointPhase={pendingCheckpointPhase || undefined}
                        onSelectCheckpoint={(cp) => {
                          const phase = workflowConfig.workflow.phases?.find((p: any) => p.checkpoint?.name === cp.name);
                          dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: cp.message });
                          dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: !!phase?.iteration?.enabled });
                          dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: true });
                        }} />
                    )
                  ) : (<div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">monitoring</span><p>加载中...</p></div>)}
                </div>
              </div>
            }
            rightPanel={
              <div className="flex flex-col h-full">
                {(() => {
                  // Resolve the latest iteration key for the selected step
                  const stepKey = selectedStep ? getLatestStepKey(selectedStep.name) : '';
                  const stepResult = selectedStep ? stepResults[stepKey] : null;
                  const isCurrentStepRunning = selectedStep && isRunning && (
                    currentStep === selectedStep.name || currentStep?.startsWith(selectedStep.name + '-迭代')
                    || currentStep?.endsWith('-' + selectedStep.name)
                  );
                  // For steps with iteration suffix (e.g. "设计修复方案-迭代2"), also check the base name
                  // in completedSteps/failedSteps, since FlowDiagram marks non-last rounds as completed
                  // even if completedSteps only contains the base name or a different iteration key.
                  const stepBaseName = selectedStep?.name.match(/^(.+)-迭代\d+$/)
                    ? selectedStep.name.replace(/-迭代\d+$/, '')
                    : selectedStep?.name;
                  const isStepDone = selectedStep && (
                    completedSteps.includes(selectedStep.name) ||
                    (stepBaseName && completedSteps.some(s => s === stepBaseName || s.startsWith(stepBaseName + '-迭代'))) ||
                    !!stepResult
                  );
                  const isStepFailed = selectedStep && (
                    failedSteps.includes(selectedStep.name) ||
                    (stepBaseName && failedSteps.some(s => s === stepBaseName || s.startsWith(stepBaseName + '-迭代')))
                  );
                  return (<>
                <div className="h-10 bg-muted border-b flex items-center px-4"><h2 className="text-sm font-semibold m-0">{selectedStep ? (stepKey !== selectedStep.name ? stepKey : selectedStep.name) : selectedAgent ? selectedAgent.name : 'Agent 详情'}</h2></div>
                <div className="flex-1 min-h-0 overflow-auto">
              {selectedStep && (
                <div className="bg-muted border-b p-3.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="material-symbols-outlined text-base">
                      {selectedStep.role === 'attacker' ? 'swords' : selectedStep.role === 'judge' ? 'gavel' : 'shield'}
                    </span>
                    <span className="text-sm font-semibold flex-1">{selectedStep.name}</span>
                    {selectedRoleConfig && (
                      <Badge className={selectedRoleConfig.team === 'blue' ? 'bg-blue-500/20 text-blue-400' : selectedRoleConfig.team === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'}>{selectedRoleConfig.team}</Badge>
                    )}
                  </div>
                  <div className="mb-2.5">
                    <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">任务描述</div>
                    <div className="text-sm leading-relaxed max-h-[300px] overflow-y-auto"><Markdown>{selectedStep.task}</Markdown></div>
                  </div>
                  {selectedStep.constraints?.length > 0 && (
                    <div className="mb-2.5">
                      <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">约束条件</div>
                      <ul className="list-disc pl-4 text-xs leading-relaxed">
                        {selectedStep.constraints.map((c: string, i: number) => (
                          <li key={i}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selectedRoleConfig && (
                    <div className="border-t pt-2.5">
                      <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">Agent 配置</div>
                      <div className="flex gap-2 items-center mb-1.5">
                        <span className="text-xs text-muted-foreground">引擎</span>
                        <span className="text-xs font-mono">{getEngineMeta(selectedRoleSelection?.effectiveEngine || '')?.name || selectedRoleSelection?.effectiveEngine || '-'}</span>
                      </div>
                      <div className="flex gap-2 items-center mb-1.5">
                        <span className="text-xs text-muted-foreground">模型</span>
                        <span className="text-xs font-mono">{selectedRoleSelection?.effectiveModel || selectedRoleConfig.model || '-'}</span>
                      </div>
                      {selectedRoleConfig.temperature !== undefined && (
                        <div className="flex gap-2 items-center mb-1.5">
                          <span className="text-xs text-muted-foreground">Temperature</span>
                          <span className="text-xs font-mono">{selectedRoleConfig.temperature}</span>
                        </div>
                      )}
                      {selectedRoleConfig.capabilities?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-2">
                          {selectedRoleConfig.capabilities.map((cap: string, i: number) => (
                            <Badge key={i} variant="secondary" className="text-xs">{cap}</Badge>
                          ))}
                        </div>
                      )}
                      {selectedRoleConfig.constraints?.length > 0 && (
                        <div className="mb-2.5">
                          <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">Agent 约束</div>
                          <ul className="list-disc pl-4 text-xs leading-relaxed">
                            {selectedRoleConfig.constraints.map((c: string, i: number) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {selectedRoleConfig.systemPrompt && (
                        <div className="mt-1.5">
                          <Button variant="link" size="sm" className="p-0 h-auto text-xs" onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
                            {showSystemPrompt ? '▼' : '▶'} System Prompt
                          </Button>
                          {showSystemPrompt && (
                            <pre className="bg-background border rounded p-2 text-xs leading-relaxed max-h-[200px] overflow-y-auto mt-1.5 whitespace-pre-wrap break-words font-mono">{selectedRoleConfig.systemPrompt}</pre>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {selectedStep && stepResult && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wider">
                    {stepResult.error ? (<><span className="material-symbols-outlined text-xs text-red-400">error</span> 执行错误</>) : (<><span className="material-symbols-outlined text-xs text-green-400">check_circle</span> 执行结果</>)}
                  </div>
                  <div className="flex gap-3 mb-2 flex-wrap">
                    {stepResult.durationMs !== undefined && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">耗时: </span>
                        <span className="font-semibold">{(stepResult.durationMs! / 1000).toFixed(2)}s</span>
                      </div>
                    )}
                    {stepResult.costUsd !== undefined && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">费用: </span>
                        <span className="font-semibold">${stepResult.costUsd?.toFixed(4)}</span>
                      </div>
                    )}
                    {stepResult.startTime && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">开始: </span>
                        <span className="font-mono">{new Date(stepResult.startTime!).toLocaleTimeString('zh-CN')}</span>
                      </div>
                    )}
                    {stepResult.endTime && (
                      <div className="bg-background px-2 py-1 rounded text-[11px]">
                        <span className="text-muted-foreground">结束: </span>
                        <span className="font-mono">{new Date(stepResult.endTime!).toLocaleTimeString('zh-CN')}</span>
                      </div>
                    )}
                  </div>
                  {stepResult.error ? (
                    <pre className="bg-background border border-red-500 rounded p-2 text-xs leading-relaxed max-h-[200px] overflow-y-auto mt-1.5 whitespace-pre-wrap break-words font-mono text-red-400">
                      {stepResult.error}
                    </pre>
                  ) : (() => {
                    const raw = fullStepOutput || stepResult.output;
                    const displayText = !fullStepOutput && raw.length > 2000
                      ? raw.substring(0, 2000) + '\n\n...(已截断)'
                      : raw;
                    const chunks = displayText.split(CHUNK_SEP).filter(Boolean);
                    // Deduplicate TodoWrite: only keep the latest todo-list chunk
                    const TODO_MK2 = '<!-- todo-list-marker -->';
                    let lastTodo2 = -1;
                    for (let k = chunks.length - 1; k >= 0; k--) {
                      if (chunks[k].includes(TODO_MK2)) { lastTodo2 = k; break; }
                    }
                    const dedupedChunks = chunks.filter((c, idx) => {
                      if (c.includes(TODO_MK2) && idx !== lastTodo2) return false;
                      // Filter out filler chunks (e.g. lone "." between tool calls)
                      const stripped = c.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
                      if (stripped.length <= 1) return false;
                      return true;
                    });
                    return (
                      <>
                        <div className={`${styles.markdownContent} bg-background border rounded p-2 text-sm leading-relaxed max-h-[200px] overflow-y-auto mt-1.5`}>
                          {dedupedChunks.map((chunk, i) => (
                            <div key={i} className={i < dedupedChunks.length - 1 ? 'border-b border-border/50 pb-3 mb-3' : ''}>
                              <Markdown>{prepareChunkForDisplay(chunk)}</Markdown>
                            </div>
                          ))}
                        </div>
                        {!fullStepOutput && stepResult.output.length > 2000 && (runId || selectedRun?.id) && (
                          <Button variant="secondary" size="sm" className="mt-1.5 text-[11px]"
                            onClick={() => {
                              // For UUID keys, find the step name for file lookup
                              const fileName = Object.entries(stepIdMap).find(([, id]) => id === stepKey)?.[0] || stepKey;
                              loadFullOutput(fileName);
                            }}
                            disabled={loadingOutput}>
                            {loadingOutput ? '加载中...' : (<><span className="material-symbols-outlined text-xs">description</span> 查看完整输出</>)}
                          </Button>
                        )}
                      </>
                    );
                  })()}
                  {!stepResult.error && (
                    <Button variant="secondary" size="sm" className="mt-1.5 text-[11px]"
                      onClick={() => openMarkdownModal(stepKey)}>
                      查看 Markdown
                    </Button>
                  )}
                </div>
              )}
              {/* Resume button on failed/crashed step */}
              {selectedStep && isStepFailed && !isRunning && (runId || selectedRun?.id) && (
                <div className="bg-muted border-b p-3.5">
                  <Button className="bg-green-600 hover:bg-green-700 text-white text-xs w-full" onClick={() => resumeWorkflow()} disabled={isRunning}>
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    从此步骤恢复运行
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    将跳过已完成的 {completedSteps.length} 个步骤，从「{selectedStep.name}」重新开始执行
                  </div>
                </div>
              )}
              {/* Rerun from step button — for completed or failed steps when not running */}
              {selectedStep && !isRunning && (runId || selectedRun?.id) && (isStepDone || isStepFailed) && (
                <div className="bg-muted border-b p-3.5">
                  <Button variant="secondary" size="sm" className="text-xs w-full" onClick={() => handleRerunFromStep(selectedStep.name)}>
                    <span className="material-symbols-outlined text-sm">replay</span>
                    从此步骤重新运行
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    该步骤及之后的所有步骤将被重新执行
                  </div>
                </div>
              )}
              {/* Resume button when viewing crashed/stopped run without specific step selected */}
              {!selectedStep && !isRunning && (workflowStatus === 'failed' || workflowStatus === 'stopped' || workflowStatus === 'pending') && (runId || selectedRun?.id) && (
                <div className="bg-muted border-b p-3.5">
                  <Button className="bg-green-600 hover:bg-green-700 text-white text-xs w-full" onClick={() => resumeWorkflow()} disabled={isRunning}>
                    <span className="material-symbols-outlined text-sm">refresh</span>
                    {workflowStatus === 'pending' ? '启动运行' : '恢复运行'}
                  </Button>
                  <div className="text-[11px] text-muted-foreground mt-1.5">
                    {workflowStatus === 'pending'
                      ? '从当前状态开始执行工作流'
                      : `已完成 ${completedSteps.length} 步，将从中断处继续`}
                  </div>
                </div>
              )}
              {/* Preparing progress card */}
              {workflowStatus === 'preparing' && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider">
                    <span className="material-symbols-outlined text-xs">deployed_code_update</span> 准备阶段
                  </div>
                  <div className="text-xs mb-2">
                    {currentStep || '初始化运行上下文'}
                  </div>
                  <div className="w-full h-2 rounded bg-background border overflow-hidden">
                    {preparingProgress && preparingProgress.percent !== null ? (
                      <Progress value={Math.max(0, Math.min(100, preparingProgress.percent ?? 0))} className="h-2 rounded" />
                    ) : (
                      <Progress value={null} className="h-2 rounded [&>[data-slot=progress-indicator]]:w-1/3 [&>[data-slot=progress-indicator]]:animate-pulse [&>[data-slot=progress-indicator]]:bg-blue-500/70" />
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {preparingProgress && preparingProgress.percent !== null
                      ? `${preparingProgress.copied ?? 0}/${preparingProgress.total ?? 0} (${preparingProgress.percent}%)`
                      : '正在准备中...'}
                  </div>
                  {preparingProgress && preparingProgress.etaSec !== null && (
                    <div className="text-[11px] text-muted-foreground">
                      预计剩余：{preparingProgress.etaSec} 秒
                    </div>
                  )}
                </div>
              )}
              {/* Live stream button — visible only during actual execution */}
              {workflowStatus === 'running' && (
                <div className="bg-muted border-b p-3.5">
                  <div className="text-xs text-muted-foreground font-medium mb-1 uppercase tracking-wider"><span className="material-symbols-outlined text-xs">sync</span> {currentStep ? `当前步骤: ${currentStep}` : '工作流运行中'}</div>
                  <div className="flex gap-2 mt-1.5">
                    <Button size="sm" className="text-xs" onClick={startLiveStream}>
                      <span className="material-symbols-outlined text-sm">cell_tower</span> 查看实时输出
                    </Button>
                    <Button size="sm" variant="secondary" className="text-xs" onClick={forceCompleteStep}>
                      <span className="material-symbols-outlined text-sm">done</span> 完成
                    </Button>
                  </div>
                </div>
              )}
              {selectedAgent ? (<AgentPanel agent={selectedAgent} logs={logs} onClearLogs={(name) => dispatch({ type: 'CLEAR_AGENT_LOGS', payload: name })}
                stepSummary={selectedStep && stepResult?.output ? stepResult.output : undefined}
                persistedStepLogs={persistedStepLogs}
                selectedStepName={selectedStep?.name || null}
                selectedStepExecutionId={selectedStep ? stepKey : null}
                runStatus={workflowStatus}
                runStatusReason={runStatusReason}
                currentStepName={currentStep || null}
                onSelectPersistedStep={selectStepByLogName}
                onViewPersistedStepOutput={openPersistedStepLogModal}
                chatMessages={agentChatMessages[selectedAgent.name] || []}
                chatLoading={!!agentChatLoading[selectedAgent.name]}
                systemPrompt={agentConfigs.find((role: any) => role.name === selectedAgent.name)?.systemPrompt}
                iterationPrompt={agentConfigs.find((role: any) => role.name === selectedAgent.name)?.iterationPrompt}
                onSendChat={handleAgentChat} />
              ) : (<div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">smart_toy</span><p>选择一个 Agent 查看详情</p></div>)}
            </div>
                  </>);
                })()}
              </div>
            }
          />
        )}
        {isDesignMode && editingConfig && (<>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex-1 flex flex-col min-w-0">
              {/* Design Tabs */}
              <div className="shrink-0 border-b bg-muted/30">
                <div className="flex gap-0.5 px-2 pt-1">
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'workflow' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setDesignTab('workflow')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">account_tree</span>
                    工作流设计
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'spec-coding' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setDesignTab('spec-coding')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">fact_check</span>
                    SpecCoding
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'config' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => setDesignTab('config')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">settings</span>
                    配置
                  </button>
                </div>
              </div>

              {/* Workflow Design Tab */}
              {designTab === 'workflow' && editingConfig?.workflow && (
                <div className="flex-1 overflow-hidden">
                  {editingConfig.workflow.mode === 'state-machine' ? (
                    <StateMachineDesignPanel
                      states={editingConfig.workflow.states || []}
                      onStatesChange={(states) => {
                        const newConfig = JSON.parse(JSON.stringify(editingConfig));
                        newConfig.workflow.states = states;
                        dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
                      }}
                      availableAgents={agentConfigs}
                      availableSkills={availableSkills}
                    />
                  ) : (
                    <DesignPanel workflow={editingConfig.workflow}
                      onSelectNode={handleSelectNode}
                      onAddPhase={handleAddPhase}
                      onAddStep={handleAddStep}
                      onAddStepAt={handleAddStepAt}
                      onDeletePhase={handleDeletePhase}
                      onDeleteStep={handleDeleteStep}
                      onMoveStep={handleMoveStep}
                      onToggleParallel={handleToggleParallel}
                      onUngroup={handleUngroup}
                      onCrossPhaseMove={handleCrossPhaseMove}
                      onMoveGroup={handleMoveGroup}
                      onJoinGroup={handleJoinGroup} />
                  )}
                </div>
              )}

              {designTab === 'spec-coding' && (
                <div className="flex-1 overflow-auto bg-muted/20 p-6">
                  {renderSpecCodingPanel({ className: 'mx-auto max-w-5xl space-y-4' })}
                </div>
              )}

              {/* Config Tab */}
              {designTab === 'config' && (
                <div className="flex-1 overflow-auto bg-muted/20">
                  <div className="max-w-xl mx-auto p-6">
                    <div className="bg-card border rounded-lg shadow-sm">
                      <div className="p-5 border-b">
                        <h3 className="text-base font-semibold">工作流配置</h3>
                        <p className="text-xs text-muted-foreground mt-1">配置工作流运行时的基本参数</p>
                      </div>
                      <div className="p-5 space-y-5">
                        <div>
                          <Label className="text-sm font-medium">执行引擎</Label>
                          <div className="mt-2">
                            <EngineSelect
                              value={engine}
                              onChange={(v) => dispatch({ type: 'SET_ENGINE', payload: v })}
                              allowGlobal
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">工作流使用的引擎，Agent 会根据引擎自动选择对应模型</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">项目根目录</Label>
                          <Input
                            value={projectRoot}
                            onChange={(e) => dispatch({ type: 'SET_PROJECT_ROOT', payload: e.target.value })}
                            type="text"
                            placeholder="../cangjie_compiler"
                            className="mt-2"
                          />
                          <WorkspaceDirectoryPicker
                            workspaceRoot="/"
                            value={projectRoot}
                            onChange={(path) => dispatch({ type: 'SET_PROJECT_ROOT', payload: path })}
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">工作流执行时的项目根目录路径</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">工作区模式</Label>
                          <div className="mt-2">
                            <Select
                              value={workspaceMode}
                              onValueChange={(value: 'isolated-copy' | 'in-place') => dispatch({ type: 'SET_WORKSPACE_MODE', payload: value })}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="in-place">直接在工作目录执行</SelectItem>
                                <SelectItem value="isolated-copy">先创建副本工程再执行</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">默认推荐直接在工作目录执行；只有需要隔离原工程时再创建副本</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">工作流描述</Label>
                          <Textarea
                            value={workflowConfig?.workflow?.description || ''}
                            onChange={(e) => {
                              const newConfig = { ...workflowConfig, workflow: { ...workflowConfig.workflow, description: e.target.value } };
                              dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: newConfig });
                            }}
                            rows={2}
                            placeholder="请输入工作流描述..."
                            className="mt-2"
                          />
                        </div>

                        <div>
                          <Label className="text-sm font-medium">需求描述</Label>
                          <Textarea
                            value={requirements}
                            onChange={(e) => dispatch({ type: 'SET_REQUIREMENTS', payload: e.target.value })}
                            rows={4}
                            placeholder="请输入需求描述..."
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">详细描述本次工作流执行的目标和需求</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">步骤超时（分钟）</Label>
                          <Input
                            value={timeoutMinutes}
                            onChange={(e) => dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: Math.max(1, parseInt(e.target.value) || 1) })}
                            type="number"
                            min={1}
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">每个步骤的最大执行时间</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">最大转移次数</Label>
                          <Input
                            value={workflowConfig?.workflow?.maxTransitions ?? 50}
                            onChange={(e) => {
                              const val = Math.max(1, Math.min(200, parseInt(e.target.value) || 1));
                              const updated = { ...workflowConfig, workflow: { ...workflowConfig.workflow, maxTransitions: val } };
                              dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: updated });
                            }}
                            type="number"
                            min={1}
                            max={200}
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">状态机最大转移次数，防止死循环（1-200）</p>
                        </div>

                        {availableSkills.length > 0 && (
                          <div>
                            <Label className="text-sm font-medium">Skills</Label>
                            <div className="mt-2">
                              <MultiCombobox
                                value={skills}
                                onValueChange={(v) => dispatch({ type: 'SET_SKILLS', payload: v })}
                                options={availableSkills.map(skill => ({
                                  value: skill.name,
                                  label: skill.name,
                                  description: skill.description,
                                }))}
                                placeholder="选择 Skills..."
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">选择工作流运行时可用的 Skills</p>
                          </div>
                        )}
                      </div>
                      <div className="p-5 border-t bg-muted/30 flex justify-end">
                        <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={saveConfig} disabled={saving}>
                          {saving ? <ClipLoader color="currentColor" size={14} className="mr-2" /> : <span className="material-symbols-outlined text-sm mr-2">save</span>}
                          {saving ? '保存中...' : '保存配置'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Floating Agent config button - navigate to agents page */}
          <Link href="/agents">
            <button
              className="fixed right-4 top-1/2 -translate-y-1/2 z-30 w-10 h-10 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
              title="Agent 管理"
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>smart_toy</span>
            </button>
          </Link>
        </>)}
        {isHistoryMode && (<div className="flex-1 flex flex-col overflow-hidden">
          <div className="h-10 bg-muted border-b flex items-center justify-between px-4">
            <h2 className="text-sm font-semibold m-0">运行历史</h2>
            {selectedRunIds.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-500 hover:text-red-600"
                onClick={handleBatchDeleteRuns}
                disabled={batchDeleting}
              >
                <span className="material-symbols-outlined text-sm mr-1">delete</span>
                删除选中 ({selectedRunIds.length})
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {historyRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <span className="material-symbols-outlined text-5xl mb-4">history</span>
                <p>暂无运行记录</p>
              </div>
            ) : (
              <div className="bg-card border rounded-lg overflow-x-auto">
                <table className="w-full min-w-[800px]">
                  <thead className="bg-muted border-b sticky top-0">
                    <tr>
                      <th className="text-left p-3 text-sm font-semibold w-10">
                        <input
                          type="checkbox"
                          checked={selectedRunIds.length > 0 && selectedRunIds.length === historyRuns.filter(r => r.status !== 'running').length}
                          onChange={toggleAllRunsSelection}
                          className="cursor-pointer"
                        />
                      </th>
                      <th className="text-left p-3 text-sm font-semibold">运行ID</th>
                      <th className="text-left p-3 text-sm font-semibold">状态</th>
                      <th className="text-left p-3 text-sm font-semibold hidden md:table-cell">开始时间</th>
                      <th className="text-left p-3 text-sm font-semibold hidden md:table-cell">结束时间</th>
                      <th className="text-left p-3 text-sm font-semibold hidden sm:table-cell">阶段</th>
                      <th className="text-left p-3 text-sm font-semibold">进度</th>
                      <th className="text-left p-3 text-sm font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRuns.map((run) => (
                      <tr key={run.id} className="border-b hover:bg-accent transition-colors">
                        <td className="p-3">
                          {run.status !== 'running' && (
                            <input
                              type="checkbox"
                              checked={selectedRunIds.includes(run.id)}
                              onChange={() => toggleRunSelection(run.id)}
                              className="cursor-pointer"
                            />
                          )}
                        </td>
                        <td className="p-3 text-sm font-mono">{run.id}</td>
                        <td className="p-3">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full" style={{
                              background: run.status === 'completed' ? '#6a8759' : run.status === 'failed' || run.status === 'crashed' ? '#c75450' : run.status === 'stopped' ? '#cc7832' : '#4a88c7',
                            }}></span>
                            <span className="text-sm">
                              {run.status === 'crashed' ? '崩溃' : run.status === 'completed' ? '完成' : run.status === 'failed' ? '失败' : run.status === 'stopped' ? '已停止' : '运行中'}
                            </span>
                          </div>
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                          {new Date(run.startTime).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </td>
                        <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                          {run.endTime ? new Date(run.endTime).toLocaleString('zh-CN', {
                            year: 'numeric',
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          }) : '-'}
                        </td>
                        <td className="p-3 text-sm hidden sm:table-cell">{run.currentPhase ? formatStateName(run.currentPhase) : '-'}</td>
                        <td className="p-3 text-sm">{run.completedSteps}/{run.totalSteps}</td>
                        <td className="p-3">
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => { setSelectedRun(run); viewHistoryRun(run.id); }}>
                              <span className="material-symbols-outlined text-sm mr-1">visibility</span>
                              查看
                            </Button>
                            {(run.status === 'failed' || run.status === 'stopped' || run.status === 'pending') && (
                              <Button size="sm" variant="outline" className="text-green-600 hover:text-green-700" onClick={() => { setSelectedRun(run); resumeWorkflow(run.id); }}>
                                <span className="material-symbols-outlined text-sm mr-1">refresh</span>
                                恢复
                              </Button>
                            )}
                            {run.status !== 'running' && (
                              <Button size="sm" variant="outline" className="text-blue-500 hover:text-blue-600" onClick={() => handleAnalyzeRunPrompts(run.id)}>
                                <span className="material-symbols-outlined text-sm mr-1">psychology</span>
                                分析
                              </Button>
                            )}
                            {run.status !== 'running' && run.status !== 'preparing' && (
                              <Button size="sm" variant="outline" className="text-red-500 hover:text-red-600" onClick={() => handleDeleteRun(run.id)}>
                                <span className="material-symbols-outlined text-sm mr-1">delete</span>
                                删除
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>)}
      </div>

      {showProcessPanel && (<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"><div className="bg-card rounded-lg w-[90%] max-w-[1200px] h-[80%] border relative overflow-hidden">
        <ProcessPanel onClose={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: false })} />
      </div></div>)}
      {editingNode && (<EditNodeModal isOpen={showEditNodeModal} type={editingNode.type} data={getEditingNodeData()} roles={agentConfigs}
        availableSkills={availableSkills}
        isNew={isNewNode}
        existingPhases={editingConfig?.workflow?.phases || []}
        existingSteps={editingConfig?.workflow?.phases?.flatMap((p: any) => p.steps) || []}
        onClose={() => { dispatch({ type: 'SET_SHOW_EDIT_NODE_MODAL', payload: false }); dispatch({ type: 'SET_EDITING_NODE', payload: null }); setIsNewNode(false); }}
        onSave={handleSaveNode} onDelete={handleDeleteNode} />)}
      {showCheckpoint && (<div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false })}>
        <div className="bg-card rounded-lg w-[600px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
          <div className="p-5 border-b"><h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">person</span>人工检查点</h3></div>
          <div className="p-5"><p className="text-sm mb-4 leading-relaxed">{checkpointMessage}</p>
            <div className="bg-muted p-4 rounded-md border-l-[3px] border-l-yellow-500 mb-4">
              <p className="text-sm text-muted-foreground mb-2">当前阶段: <strong className="text-foreground">{formatStateName(currentPhase || '')}</strong></p>
              <p className="text-sm text-muted-foreground">请审查工作成果，决定是否继续执行</p>
            </div>
            {checkpointIsIterative && (
              <div className="mb-4">
                <Label htmlFor="iteration-feedback" className="text-sm font-medium mb-2 block">迭代意见（继续迭代时必填）</Label>
                <Textarea
                  id="iteration-feedback"
                  value={iterationFeedback}
                  onChange={(e) => setIterationFeedback(e.target.value)}
                  placeholder="请输入本轮迭代的评审意见，这些意见将作为下一轮迭代的检查项..."
                  rows={4}
                  className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">提示：评审意见将作为AI的检查项，指导下一轮迭代的改进方向</p>
              </div>
            )}
          </div>
          <div className="p-5 border-t flex gap-3 justify-end">
            <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={approveCheckpoint}><span className="material-symbols-outlined text-sm mr-1">check</span>通过</Button>
            {checkpointIsIterative && (
              <Button className="bg-blue-600 hover:bg-blue-700 text-white" onClick={iterateCheckpoint}><span className="material-symbols-outlined text-sm mr-1">refresh</span>继续迭代</Button>
            )}
            <Button variant="destructive" onClick={rejectCheckpoint}><span className="material-symbols-outlined text-sm mr-1">close</span>拒绝并停止</Button>
          </div>
        </div>
      </div>)}
      {showLiveStream && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={stopLiveStream}>
          <div className={`bg-card rounded-lg border flex flex-col ${liveStreamFullscreen ? 'w-full h-full rounded-none' : 'w-[80%] max-w-[800px] max-h-[80vh]'}`} onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold"><span className="material-symbols-outlined text-lg mr-2 align-middle">cell_tower</span>实时输出 {currentStep ? `- ${currentStep}` : ''}</h3>
              <div className="flex items-center gap-1">
                <Button
                  variant={liveStreamScrollLocked ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => {
                    if (liveStreamScrollLocked) {
                      unlockLiveStreamScroll();
                    } else {
                      liveStreamUserScrolledUp.current = true;
                      setLiveStreamScrollLocked(true);
                    }
                  }}
                  title={liveStreamScrollLocked ? '解除滚动锁并跳到底部' : '锁定当前滚动位置'}
                >
                  <span className="material-symbols-outlined text-sm mr-1">{liveStreamScrollLocked ? 'lock' : 'lock_open'}</span>
                  {liveStreamScrollLocked ? '滚动已锁定' : '跟随滚动'}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setLiveStreamFullscreen(f => !f)} title={liveStreamFullscreen ? '退出全屏' : '全屏'}>
                  <span className="material-symbols-outlined text-sm">{liveStreamFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={stopLiveStream}>关闭</Button>
              </div>
            </div>
            <div ref={liveStreamScrollRef} className="p-5 flex-1 overflow-auto" onScroll={(e) => {
              const el = e.currentTarget;
              const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
              liveStreamUserScrolledUp.current = !atBottom;
              setLiveStreamScrollLocked(!atBottom);
              if (el.scrollTop === 0 && liveStream.length > liveStreamVisibleCount) {
                setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE);
              }
            }}>
              {liveStream.length === 0 && inlineFeedbacks.length === 0 ? (
                <div className="text-muted-foreground text-sm text-center py-8">(等待输出...)</div>
              ) : (
                <div className="space-y-3">
                  {(() => {
                    // Merge stream chunks and inline feedbacks by position
                    type Item = { type: 'chunk'; content: string; index: number } | { type: 'feedback'; message: string; timestamp: string };
                    const items: Item[] = [];
                    // Collect feedback messages already embedded in stream chunks to avoid duplicates
                    const streamFeedbackMessages = new Set<string>();
                    for (const chunk of liveStream) {
                      const parsed = parseChunk(chunk);
                      if (parsed.isHumanFeedback) {
                        // Extract raw feedback content (without numbering)
                        const feedbackContent = parsed.content.trim();
                        // Split by double newlines to handle multiple feedbacks
                        const feedbacks = feedbackContent.split('\n\n').map(f => f.trim()).filter(Boolean);
                        for (const fb of feedbacks) {
                          streamFeedbackMessages.add(fb);
                        }
                      }
                    }
                    let fbIdx = 0;
                    for (let i = 0; i < liveStream.length; i++) {
                      // Insert any feedbacks that were sent before this chunk (skip if already in stream)
                      while (fbIdx < inlineFeedbacks.length && inlineFeedbacks[fbIdx].streamIndex <= i) {
                        if (!streamFeedbackMessages.has(inlineFeedbacks[fbIdx].message.trim())) {
                          items.push({ type: 'feedback', message: inlineFeedbacks[fbIdx].message, timestamp: inlineFeedbacks[fbIdx].timestamp });
                        }
                        fbIdx++;
                      }
                      items.push({ type: 'chunk', content: liveStream[i], index: i });
                    }
                    // Remaining feedbacks after all chunks (skip if already in stream)
                    while (fbIdx < inlineFeedbacks.length) {
                      if (!streamFeedbackMessages.has(inlineFeedbacks[fbIdx].message.trim())) {
                        items.push({ type: 'feedback', message: inlineFeedbacks[fbIdx].message, timestamp: inlineFeedbacks[fbIdx].timestamp });
                      }
                      fbIdx++;
                    }
                    // Deduplicate TodoWrite: only keep the latest todo-list chunk
                    const TODO_MARKER = '<!-- todo-list-marker -->';
                    let lastTodoIdx = -1;
                    for (let j = items.length - 1; j >= 0; j--) {
                      if (items[j].type === 'chunk' && (items[j] as any).content.includes(TODO_MARKER)) {
                        if (lastTodoIdx === -1) { lastTodoIdx = j; } else {
                          // Remove older todo chunks — replace content with empty
                          (items[j] as any).content = '';
                        }
                      }
                    }
                    const filteredItems = items.filter(it => {
                      if (it.type === 'feedback') return true;
                      const c = (it as any).content as string;
                      if (!c) return false;
                      // Filter out stream-embedded human-feedback chunks (already shown via inlineFeedbacks)
                      const parsedIt = parseChunk(c);
                      if (parsedIt.isHumanFeedback) return false;
                      // Filter out chunks that are just filler text between tool calls (e.g. lone ".")
                      const stripped = c.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
                      if (stripped.length <= 1) return false;
                      return true;
                    });
                    const hasMore = filteredItems.length > liveStreamVisibleCount;
                    const visibleItems = hasMore ? filteredItems.slice(filteredItems.length - liveStreamVisibleCount) : filteredItems;
                    return (<>
                      {hasMore && (
                        <div className="text-center py-2">
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            onClick={() => setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE)}
                          >
                            加载更早的 {filteredItems.length - liveStreamVisibleCount} 条内容...
                          </button>
                        </div>
                      )}
                      {visibleItems.map((item, i) => {
                      if (item.type === 'feedback') {
                        return (
                          <div key={`fb-${i}`} className="flex justify-end group">
                            <div className="bg-primary/15 border border-primary/30 rounded-lg px-3 py-2 max-w-[80%] relative">
                              <div className="text-[10px] text-muted-foreground mb-0.5 text-right font-mono flex items-center justify-end gap-1">
                                {new Date(item.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                {isRunning && (
                                  <button
                                    onClick={() => recallFeedback(item.message)}
                                    className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                                    title="撤回"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>undo</span>
                                  </button>
                                )}
                              </div>
                              <div className="text-sm">{item.message}</div>
                            </div>
                          </div>
                        );
                      }
                      const parsed = parseChunk(item.content);
                      if (parsed.isHumanFeedback) {
                        return (
                          <div key={`c-${i}`} className="flex justify-end">
                            <div className="bg-primary/15 border border-primary/30 rounded-lg px-3 py-2 max-w-[80%]">
                              {parsed.timestamp && (
                                <div className="text-[10px] text-muted-foreground mb-0.5 text-right font-mono">
                                  {new Date(parsed.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </div>
                              )}
                              <div className="text-sm">
                                <Markdown>{prepareChunkForDisplay(parsed.content)}</Markdown>
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={`c-${i}`} className="border-b border-border/50 pb-3 last:border-0">
                          {parsed.timestamp && (
                            <div className="text-[10px] text-muted-foreground mb-1 font-mono">
                              {new Date(parsed.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </div>
                          )}
                          <div className="text-sm">
                            <Markdown>{prepareChunkForDisplay(parsed.content)}</Markdown>
                          </div>
                        </div>
                      );
                    })}
                    </>);
                  })()}
                  {isRunning && (() => {
                    // Determine status: if last content ends with a tool call, show "执行中", otherwise "思考中"
                    const lastChunk = liveStream[liveStream.length - 1] || '';
                    const isExecuting = /\*\*🔧 .+?\*\*[^]*$/.test(lastChunk) && !/<\/details>\s*$/.test(lastChunk.trim());
                    const statusText = isExecuting ? '执行中' : '思考中';
                    return (
                    <div className={styles.thinkingBot}>
                      <svg className={styles.botSvg} width="28" height="28" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                          <linearGradient id="botBody" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor="#6C8EF2" />
                            <stop offset="100%" stopColor="#4A6CF7" />
                          </linearGradient>
                          <linearGradient id="botFace" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#E8F0FE" />
                            <stop offset="100%" stopColor="#C5D8F9" />
                          </linearGradient>
                        </defs>
                        <g transform="translate(0,800) scale(0.1,-0.1)" stroke="none">
                          {/* Body */}
                          <path fill="url(#botBody)" d="M4552 6155 c-67 -19 -85 -29 -136 -74 -30 -27 -60 -42 -111 -55 -332 -85 -548 -304 -619 -627 l-17 -75 -67 -12 c-140 -24 -291 -88 -355 -150 -42 -40 -87 -123 -87 -159 0 -14 -6 -23 -16 -23 -25 0 -186 -67 -325 -136 -137 -67 -286 -164 -381 -247 -94 -82 -217 -242 -279 -363 -30 -58 -58 -108 -64 -109 -92 -25 -102 -30 -155 -84 -67 -66 -128 -183 -161 -307 -32 -121 -38 -325 -11 -429 28 -112 67 -188 131 -258 61 -65 116 -96 172 -97 33 0 37 -3 48 -40 18 -60 103 -180 179 -251 200 -190 486 -332 852 -425 408 -104 751 -110 1225 -23 290 54 481 113 670 209 257 130 410 270 525 483 37 69 60 94 60 68 0 -16 86 -24 122 -12 159 52 236 422 168 803 -40 221 -177 406 -286 385 -22 -4 -28 2 -51 47 -96 190 -259 360 -505 527 -130 88 -335 191 -465 234 -54 17 -83 32 -83 41 0 20 -27 71 -59 112 -36 46 -143 115 -235 152 -74 30 -248 70 -302 70 -25 0 -26 2 -20 38 4 20 25 75 47 121 68 138 167 224 333 286 l66 25 15 -29 c21 -42 90 -98 143 -115 58 -20 157 -20 212 -1 58 20 115 68 148 123 22 39 27 58 26 112 -1 111 -54 199 -148 245 -66 32 -136 39 -204 20z m138 -245 c23 -44 -27 -77 -87 -57 -20 6 -38 17 -39 22 -2 6 16 24 39 41 45 33 67 32 87 -6z m-700 -845 c52 -8 124 -24 160 -36 138 -47 135 -47 -311 -51 -228 -2 -418 0 -423 4 -5 4 19 21 55 36 130 58 329 76 519 47z m480 -315 c310 -123 560 -279 738 -458 125 -127 188 -244 244 -452 31 -115 33 -389 4 -520 -28 -129 -63 -235 -113 -340 -75 -157 -208 -273 -437 -380 -174 -82 -369 -135 -676 -184 -311 -50 -435 -56 -631 -32 -478 60 -928 244 -1156 475 -78 79 -127 163 -164 282 -54 172 -64 240 -63 424 1 150 4 182 27 267 31 116 94 265 149 351 57 89 228 255 333 323 92 60 291 161 458 234 92 40 100 42 142 31 62 -15 273 -14 456 4 201 19 284 23 454 17 133 -4 145 -6 235 -42z m-2447 -1152 c-3 -93 -1 -200 5 -248 26 -198 25 -189 7 -157 -48 84 -70 306 -45 453 10 54 28 114 35 114 2 0 1 -73 -2 -162z m3711 -133 c1 -154 -2 -177 -23 -240 -13 -38 -27 -74 -32 -79 -13 -15 -11 54 6 179 8 61 15 180 16 265 l1 155 15 -55 c11 -38 16 -107 17 -225z"/>
                          {/* Face screen */}
                          <path fill="url(#botFace)" d="M3640 4394 c-194 -14 -558 -57 -625 -74 -224 -57 -381 -189 -480 -403 -56 -121 -76 -219 -82 -402 -6 -197 14 -311 77 -443 108 -225 363 -358 801 -418 179 -25 751 -25 1014 0 331 31 463 65 601 158 133 89 235 248 291 453 26 93 27 113 27 295 0 185 -2 199 -28 280 -43 131 -82 196 -171 286 -68 68 -97 89 -185 133 -215 105 -383 132 -845 136 -187 1 -365 1 -395 -1z m571 -234 c216 -22 460 -91 572 -162 172 -110 237 -232 237 -444 0 -245 -115 -458 -292 -542 -186 -89 -521 -129 -983 -118 -296 7 -440 22 -595 61 -378 96 -471 204 -474 545 -1 155 13 221 70 338 63 126 163 199 331 241 267 67 853 109 1134 81z"/>
                          {/* Left eye */}
                          <path fill="#2D3748" d="M3163 3865 c-156 -43 -257 -181 -257 -350 0 -144 60 -254 171 -312 78 -40 140 -50 218 -34 103 22 178 79 226 174 87 171 73 314 -42 429 -90 90 -205 124 -316 93z m44 -263 c-36 -38 -69 -81 -73 -96 -7 -30 9 -56 37 -56 22 0 123 103 145 148 13 28 18 31 30 21 9 -7 22 -26 30 -42 34 -65 -28 -179 -111 -207 -134 -44 -241 120 -150 229 29 34 99 71 134 71 22 0 17 -8 -42 -68z">
                            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
                          </path>
                          {/* Right eye */}
                          <path fill="#2D3748" d="M4373 3856 c-100 -32 -195 -114 -236 -204 -17 -37 -22 -66 -22 -137 0 -82 3 -97 33 -157 37 -77 90 -128 172 -167 47 -22 69 -26 145 -26 78 0 98 4 153 29 212 98 257 390 86 560 -92 92 -231 135 -331 102z m107 -212 c0 -3 -22 -31 -50 -61 -70 -80 -79 -133 -20 -133 22 0 35 10 64 50 20 27 44 66 55 85 l18 34 23 -24 c28 -29 37 -99 20 -150 -16 -48 -70 -74 -156 -75 -49 0 -67 5 -94 25 -44 32 -50 43 -50 87 0 44 36 90 107 137 42 28 83 40 83 25z">
                            <animate attributeName="opacity" values="1;1;0.1;1;1" keyTimes="0;0.42;0.46;0.50;1" dur="3s" repeatCount="indefinite" />
                          </path>
                        </g>
                      </svg>
                      <span className={styles.thinkingText}>{statusText}</span>
                      <span className={styles.thinkingDots}>
                        <span>.</span><span>.</span><span>.</span>
                      </span>
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
            <div className="p-3 border-t flex gap-2">
              <Input
                ref={liveStreamFeedbackRef}
                defaultValue=""
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendLiveFeedback(); } }}
                placeholder="输入反馈意见..."
                className="flex-1"
                disabled={sendingFeedback}
              />
              <Button size="sm" onClick={() => sendLiveFeedback()} disabled={sendingFeedback} title="发送反馈（等待当前执行完成后处理）">
                <span className="material-symbols-outlined text-sm">send</span>
              </Button>
              <Button size="sm" variant="destructive" onClick={() => sendLiveFeedback(true)} disabled={sendingFeedback} title="打断当前执行，立即处理反馈">
                <span className="material-symbols-outlined text-sm">bolt</span>
              </Button>
            </div>
          </div>
        </div>
      )}
      {markdownModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setMarkdownModal(null)}>
          <div className="bg-card rounded-lg border w-[80%] max-w-[900px] max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">{markdownModal.title}</h3>
              <Button variant="ghost" size="icon" onClick={() => setMarkdownModal(null)}>
                <span className="material-symbols-outlined">close</span>
              </Button>
            </div>
            <div className="p-5 flex-1 overflow-auto">
              {markdownModal.chunks.length > 1 ? (
                <div className="space-y-3">
                  {(() => {
                    // Deduplicate TodoWrite: only keep the latest todo-list chunk
                    const TODO_MK = '<!-- todo-list-marker -->';
                    let lastIdx = -1;
                    const filtered = markdownModal.chunks.filter((chunk, idx) => {
                      // Filter out filler chunks (e.g. lone "." between tool calls)
                      const stripped = chunk.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
                      if (stripped.length <= 1) return false;
                      if (!chunk.includes(TODO_MK)) return true;
                      if (lastIdx === -1) {
                        // Scan forward to find the last one
                        for (let k = markdownModal.chunks.length - 1; k >= 0; k--) {
                          if (markdownModal.chunks[k].includes(TODO_MK)) { lastIdx = k; break; }
                        }
                      }
                      return idx === lastIdx;
                    });
                    return filtered.map((chunk, i) => (
                      <div key={i} className={`${styles.markdownContent} text-sm border-b border-border/50 pb-3 last:border-0`}>
                        <Markdown>{prepareChunkForDisplay(chunk)}</Markdown>
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className={styles.markdownContent}>
                  <Markdown>{prepareChunkForDisplay(markdownModal.chunks[0])}</Markdown>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <Dialog open={specCodingModalOpen} onOpenChange={(open) => {
        setSpecCodingModalOpen(open);
        if (!open) setSpecCodingModalFullscreen(false);
      }}>
        <DialogContent className={`p-0 flex flex-col gap-0 ${specCodingModalFullscreen ? 'max-w-none w-screen h-screen rounded-none' : 'max-w-5xl w-[90vw] h-[80vh]'}`}>
          <DialogTitle className="sr-only">SpecCoding 文件管理器</DialogTitle>
          {renderSpecCodingExplorer()}
        </DialogContent>
      </Dialog>
      {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
      <AIAgentCreatorModal
        open={showRuntimeAgentCreator}
        engine={globalEngine || engine}
        model={globalDefaultModel}
        initialDraft={runtimeAgentDraft}
        onClose={() => setShowRuntimeAgentCreator(false)}
        onCreate={async (agent) => {
          try {
            await agentApi.saveAgent(agent.name, agent as any);
            toast('success', `已创建 Agent：${agent.name}`);
            setShowRuntimeAgentCreator(false);
            setRuntimeAgentDraft(createInitialAgentDraft({
              workingDirectory: resolvedProjectRoot || '',
              referenceWorkflow: configFile,
            }));
            return true;
          } catch (error: any) {
            toast('error', error?.message || '创建 Agent 失败');
            return false;
          }
        }}
        onContinueEdit={(agent) => {
          setShowRuntimeAgentCreator(false);
          toast('success', `已生成 Agent 草案：${agent.name}，请在 Agent 页面继续精修`);
          router.push('/agents');
        }}
      />

      {showContextEditor && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setShowContextEditor(false)}>
          <div className="bg-card rounded-lg w-[600px] max-w-[90%] border" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold">
                <span className="material-symbols-outlined text-lg mr-2 align-middle">edit_note</span>
                {editingContextScope === 'global' ? '全局上下文' : `阶段上下文 — ${editingContextPhase}`}
              </h3>
            </div>
            <div className="p-5">
              <p className="text-sm text-muted-foreground mb-3">
                {editingContextScope === 'global'
                  ? '全局上下文将注入到所有步骤的 prompt 中'
                  : `此上下文将注入到「${editingContextPhase}」阶段所有步骤的 prompt 中`}
              </p>
              <Textarea
                value={editingContextValue}
                onChange={(e) => setEditingContextValue(e.target.value)}
                placeholder="输入上下文信息，例如：注意代码风格要符合项目规范..."
                rows={6}
                className="w-full"
              />
            </div>
            <div className="p-5 border-t flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowContextEditor(false)}>取消</Button>
              <Button onClick={saveContext}>保存</Button>
            </div>
          </div>
        </div>
      )}

      {/* 人工审查对话框 */}
      {(humanApprovalData || pendingHumanQuestion) && !humanApprovalMinimized && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80" onClick={minimizeHumanApprovalDialog}>
          <div className="bg-card rounded-lg w-[700px] max-w-[90%] border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b bg-orange-50 dark:bg-orange-950">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <span className="material-symbols-outlined text-orange-500">person</span>
                  {pendingHumanQuestion ? pendingHumanQuestion.title : `人工审查 - ${formatStateName(humanApprovalData?.currentState || '__human_approval__')}`}
                </h3>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={minimizeHumanApprovalDialog} title="缩到右下角">
                  <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>close</span>
                </Button>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Supervisor 正在等待人类回复，工作流会保持人工审查状态。
              </p>
            </div>

            <div className="p-5 max-h-[60vh] overflow-y-auto">
              {pendingHumanQuestion ? (
                <HumanQuestionCard
                  key={pendingHumanQuestion.id}
                  question={pendingHumanQuestion}
                  autoFocus={focusTarget === 'human-question' && (!focusQuestionId || focusQuestionId === pendingHumanQuestion.id)}
                  submitting={submittingHumanQuestion}
                  onSubmit={handleSubmitHumanQuestion}
                />
              ) : null}

              {humanApprovalData ? (
                <>
              {/* 执行结果摘要 */}
              <div className="mb-4 p-3 bg-muted/30 rounded-lg">
                <div className="text-sm font-medium mb-2">执行结果</div>
                <div className="text-xs text-muted-foreground">
                  <div>判定: <span className="font-medium">{humanApprovalData.result?.verdict || 'N/A'}</span></div>
                  <div>问题数: <span className="font-medium">{humanApprovalData.result?.issues?.length || 0}</span></div>
                  {humanApprovalData.result?.summary && (
                    <div className="mt-2 text-xs leading-6">
                      <Markdown>{prepareChunkForDisplay(humanApprovalData.result.summary)}</Markdown>
                    </div>
                  )}
                </div>
              </div>

              {/* 步骤结论 */}
              {humanApprovalData.result?.stepOutputs?.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">步骤结论</div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        dispatch({ type: 'SET_ACTIVE_TAB', payload: 'documents' });
                        setOpenLatestAiDocRequest((value) => value + 1);
                      }}
                    >
                      <span className="material-symbols-outlined mr-1" style={{ fontSize: '14px' }}>description</span>
                      打开文档窗口
                    </Button>
                  </div>
                  <div className="space-y-2">
                    {humanApprovalData.result.stepOutputs.map((output: string, idx: number) => (
                      <details key={idx} open={humanApprovalData.result.stepOutputs.length === 1}>
                        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground py-1">
                          步骤 {idx + 1} 结论
                        </summary>
                        <div className="mt-1 p-3 bg-muted/20 rounded border text-xs max-h-[300px] overflow-y-auto">
                          <Markdown>{extractStepConclusion(output)}</Markdown>
                        </div>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              {/* AI 建议的下一步 */}
              <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="mb-2 text-sm font-medium text-blue-700 dark:text-blue-400">
                  AI 建议
                </div>
                <div className="text-sm">
                  → {humanApprovalData.nextState}
                </div>
              </div>

              {humanApprovalData.supervisorAdvice && (
                <div className="mb-4 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
                  <div className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
                    指挥官意见
                  </div>
                  <div className="text-sm leading-6">
                    <Markdown>{prepareChunkForDisplay(humanApprovalData.supervisorAdvice)}</Markdown>
                  </div>
                </div>
              )}

              {(specCodingSummary || activeSpecCodingPhase || checkpointDeviationNotes.length > 0) && (
                <div className="mb-4 p-3 rounded-lg border border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/30 space-y-3">
                  <div className="text-sm font-medium text-violet-700 dark:text-violet-300">
                    当前 Run SpecCoding
                  </div>
                  {specCodingSummary ? (
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>版本：v{specCodingSummary.version}</div>
                      <div>状态：{specCodingSummary.status}</div>
                      {specCodingSummary.source ? (
                        <div>来源：{specCodingSummary.source === 'run' ? 'run snapshot' : 'creation baseline'}</div>
                      ) : null}
                      {specCodingSummary.progress?.summary ? (
                        <div>进度：{specCodingSummary.progress.summary}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {activeSpecCodingPhase ? (
                    <div className="rounded-md border bg-background/70 p-3 text-xs text-muted-foreground space-y-1">
                      <div className="font-medium text-foreground">当前阶段记录</div>
                      <div>阶段：{activeSpecCodingPhase.title}</div>
                      <div>状态：{activeSpecCodingPhase.status}</div>
                      {activeSpecCodingPhase.objective ? <div>目标：{activeSpecCodingPhase.objective}</div> : null}
                      {specCodingDetails?.checkpoints?.find((checkpoint) => checkpoint.phaseId === activeSpecCodingPhase.id) ? (
                        <div>
                          检查点：{specCodingDetails?.checkpoints?.find((checkpoint) => checkpoint.phaseId === activeSpecCodingPhase.id)?.title}
                          {' / '}
                          {specCodingDetails?.checkpoints?.find((checkpoint) => checkpoint.phaseId === activeSpecCodingPhase.id)?.status}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {latestSupervisorReview?.type === 'chat-revision' ? (
                    <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground space-y-1">
                      <div className="font-medium text-foreground">本轮由 Supervisor 刷新的修订</div>
                      <div>阶段：{latestSupervisorReview.stateName}</div>
                      <div className="leading-5">{latestSupervisorReview.content}</div>
                      {latestSupervisorReview.affectedArtifacts?.length ? (
                        <div>影响制品：{latestSupervisorReview.affectedArtifacts.join('、')}</div>
                      ) : null}
                      {latestSupervisorReview.impact?.length ? (
                        <div className="space-y-1 pt-1">
                          <div className="text-foreground">影响范围</div>
                          {latestSupervisorReview.impact.map((item) => (
                            <div key={item}>- {item}</div>
                          ))}
                        </div>
                      ) : null}
                      <div>时间：{new Date(latestSupervisorReview.timestamp).toLocaleString()}</div>
                    </div>
                  ) : null}
                  {specCodingDetails?.revisions?.length ? (
                    <div className="rounded-md border bg-background/70 p-3 text-xs text-muted-foreground space-y-1">
                      <div className="font-medium text-foreground">最近修订</div>
                      <div>v{specCodingDetails.revisions.at(-1)?.version} · {specCodingDetails.revisions.at(-1)?.summary}</div>
                      {specCodingDetails.revisions.at(-1)?.createdBy ? (
                        <div>修订者：{specCodingDetails.revisions.at(-1)?.createdBy}</div>
                      ) : null}
                    </div>
                  ) : null}
                  {rehearsalInfo?.enabled ? (
                    <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 text-xs text-muted-foreground space-y-2">
                      <div className="font-medium text-foreground">演练模式总结</div>
                      <div>{rehearsalInfo.summary}</div>
                      {rehearsalInfo.recommendedNextSteps.length ? (
                        <div className="space-y-1">
                          {rehearsalInfo.recommendedNextSteps.map((item) => (
                            <div key={item}>- {item}</div>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRehearsalMode(false);
                            void startWorkflow('real');
                          }}
                          disabled={starting || isRunning}
                        >
                          基于演练结果正式启动
                        </Button>
                      </div>
                    </div>
                  ) : null}
                  {checkpointDeviationNotes.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-medium text-foreground">偏差说明</div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        {checkpointDeviationNotes.map((note) => (
                          <div key={note}>- {note}</div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* 可选的跳转目标 */}
              <div className="mb-2">
                <div className="text-sm font-medium mb-2">选择下一步：</div>
                <div className="space-y-2">
                  {humanApprovalData.availableStates.map((stateName) => (
                    <button
                      key={stateName}
                      onClick={() => handleForceTransition(stateName)}
                      className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-all ${
                        stateName === humanApprovalData.nextState
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50 hover:bg-blue-100 dark:hover:bg-blue-950'
                          : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600 hover:bg-muted/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{stateName}</span>
                        {stateName === humanApprovalData.nextState && (
                          <Badge variant="outline" className="text-xs bg-blue-100 dark:bg-blue-900">推荐</Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
              </>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {(humanApprovalData || pendingHumanQuestion) && humanApprovalMinimized && (
        <div className="fixed bottom-5 right-5 z-40">
          <Button
            type="button"
            onClick={restoreHumanApprovalDialog}
            className={`h-auto min-h-0 rounded-full border border-orange-300 bg-orange-500 px-4 py-3 text-white shadow-xl hover:bg-orange-600 ${
              humanApprovalMinimizedPulse ? 'animate-pulse' : ''
            }`}
          >
            <span className="material-symbols-outlined mr-2 text-[18px]">person_alert</span>
            <span className="flex flex-col items-start leading-tight">
              <span className="text-xs text-orange-50/90">待人工审查</span>
              <span className="text-sm font-medium">语义裁决与问题归类</span>
            </span>
          </Button>
        </div>
      )}

      {/* 强制跳转对话框 */}
      {forceTransitionModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setForceTransitionModal(null)}>
          <div className="bg-card rounded-lg w-[600px] max-w-[90%] border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-orange-500">alt_route</span>
                强制跳转到: {forceTransitionModal.targetState}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                可选：为 AI 提供跳转指令
              </p>
            </div>

            <div className="p-5">
              <Textarea
                value={forceTransitionModal.instruction}
                onChange={(e) => setForceTransitionModal({ ...forceTransitionModal, instruction: e.target.value })}
                placeholder="输入给 AI 的指令，例如：重点关注性能问题，忽略代码风格..."
                rows={4}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground mt-2">
                此指令将被添加到 AI 的 prompt 中，帮助 AI 更好地理解你的意图
              </p>
            </div>

            <div className="p-5 border-t flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setForceTransitionModal(null)}>取消</Button>
              <Button onClick={executeForceTransition}>
                <span className="material-symbols-outlined text-sm mr-1">check</span>
                确认跳转
              </Button>
            </div>
          </div>
        </div>
      )}

      <Dialog open={rehearsalResultDialogOpen} onOpenChange={setRehearsalResultDialogOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-hidden p-0">
          <div className="flex max-h-[85vh] flex-col">
            <div className="border-b px-6 py-4">
              <DialogTitle className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">theater_comedy</span>
                演练结果
              </DialogTitle>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="space-y-4 text-sm">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <div className="mb-3 text-xs font-medium text-muted-foreground">检查概览</div>
                  <div className="grid gap-2 sm:grid-cols-4">
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[10px] text-muted-foreground">检查项</div>
                      <div className="mt-1 text-lg font-semibold">{rehearsalCheckStats.total}</div>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[10px] text-muted-foreground">通过</div>
                      <div className="mt-1 text-lg font-semibold text-emerald-600">{rehearsalCheckStats.passed}</div>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[10px] text-muted-foreground">警告</div>
                      <div className="mt-1 text-lg font-semibold text-amber-600">{rehearsalCheckStats.warning}</div>
                    </div>
                    <div className="rounded-lg border bg-background p-3">
                      <div className="text-[10px] text-muted-foreground">失败</div>
                      <div className="mt-1 text-lg font-semibold text-red-600">{rehearsalCheckStats.failed}</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-xl border bg-background p-4">
                  <div className="mb-3 text-xs font-medium text-muted-foreground">本次已检查项目</div>
                  <div className="space-y-2">
                    {(preflightChecks.length > 0
                      ? preflightChecks
                      : displayQualityChecks.filter((check) => check.stateName === '__preflight__')
                    ).map((check) => (
                      <div key={check.id} className="rounded-lg border bg-muted/20 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-sm leading-6 text-foreground">{describeQualityCheck(check)}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              {formatQualityCheckCategory(check.category)} · {formatQualityCheckAgent(check.agent)} · {check.origin === 'inferred' ? '系统推断' : '配置预检查'}
                            </div>
                          </div>
                          <Badge
                            className={`shrink-0 ${
                              check.status === 'passed'
                                ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                                : check.status === 'failed'
                                  ? 'bg-red-500/15 text-red-600 border border-red-500/30'
                                  : 'bg-amber-500/15 text-amber-600 border border-amber-500/30'
                            }`}
                          >
                            {formatQualityCheckStatus(check.status)}
                          </Badge>
                        </div>
                      </div>
                    ))}
                    {rehearsalCheckStats.total === 0 ? (
                      <div className="rounded-lg border border-dashed p-3 text-muted-foreground">
                        这次没有拿到可展示的检查项。
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button variant="outline" onClick={() => setRehearsalResultDialogOpen(false)}>
                关闭
              </Button>
              <Button
                onClick={() => {
                  setRehearsalResultDialogOpen(false);
                  setRehearsalMode(false);
                  void startWorkflow('real');
                }}
                disabled={starting || isRunning}
              >
                基于演练结果正式启动
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <NotebookSaveDialog
        open={specCodingSaveDialogOpen}
        onOpenChange={setSpecCodingSaveDialogOpen}
        scope={specCodingSaveScope}
        onScopeChange={setSpecCodingSaveScope}
        directory={specCodingSaveDirectory}
        onDirectoryChange={setSpecCodingSaveDirectory}
        directories={[]}
        saving={savingSpecCodingArtifact}
        previewText={activeSpecCodingArtifact
          ? `将保存：${specCodingSaveDirectory ? `${specCodingSaveDirectory}/` : ''}${sanitizeNotebookName(activeSpecCodingArtifact.label.replace(/\.md$/i, '') || activeSpecCodingArtifact.key)}-YYYYMMDD-HHMMSS.cj.md`
          : '请选择文档'}
        onConfirm={() => {
          void saveSpecCodingArtifactToNotebook();
        }}
      />

      {(workspaceEditorPath || resolvedProjectRoot) && (
        <WorkspaceEditor
          open={workspaceEditorOpen}
          onOpenChange={setWorkspaceEditorOpen}
          workspacePath={workspaceEditorPath || state.workingDirectory || resolvedProjectRoot}
          initialFilePath={workspaceEditorFilePath}
          title={workspaceEditorTitle}
        />
      )}
    </div>
  );
}
