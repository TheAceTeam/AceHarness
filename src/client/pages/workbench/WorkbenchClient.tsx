'use client';

import dynamic from '@/lib/navigation/dynamic';
import { memo, useEffect, useCallback, useState, useRef, useMemo } from 'react';
import type { ComponentProps } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, useSearchParams, useRouter } from '@/lib/navigation/client';
import Link from '@/lib/navigation/client';
import { useTheme } from 'next-themes';
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
import * as ReactSpinners from 'react-spinners';
import BrandLoadingScreen from '@/components/BrandLoadingScreen';
import { configApi, workflowApi, agentApi, runsApi, processApi, streamApi, workspaceApi, specCodingApi, type GitBrowserSummaryResponse, type NotebookScope, type RunDocumentSource } from '@/lib/core/api';
import { useWorkflowState } from '@/hooks/useWorkflowState';
import type { ViewMode } from '@/hooks/useWorkflowState';
import { fetchWorkflowEvents, fetchWorkflowStateHistory, fetchWorkflowStatusCompact, fetchWorkflowStepLogs } from '@/client/query/workflow-runtime';
import { useRuntimeEngineSelectionQuery } from '@/client/query/engines';
import { queryKeys } from '@/client/query/query-keys';
import {
  syncDocumentsMetadataToDb,
  syncWorkflowEventsToDb,
  syncWorkflowHumanQuestionsToDb,
  syncWorkflowStateHistoryToDb,
  syncWorkflowStepLogsToDb,
  useAgentMessageRows,
  useWorkflowStateHistoryRows,
  useWorkflowStepLogRows,
  useWorkflowHumanQuestionRows,
  useWorkflowEventRows,
} from '@/client/db/collections';
import { useGitBrowserSummaryQuery } from '@/client/query/workspace';
import { useLightweightRuntimeToolEventsQuery, useLightweightTasklistEvidenceQuery } from '@/client/query/lightweight-tasklist';

const { ClipLoader } = ReactSpinners;
import StateMachineExecutionView from '@/components/StateMachineExecutionView';
import LightweightWorkflowExecutionView from '@/components/workflow/LightweightWorkflowExecutionView';
import LightweightTaskBoard from '@/components/workflow/LightweightTaskBoard';
import LightweightTaskExecutionGraph from '@/components/workflow/LightweightTaskExecutionGraph';
import RuntimeStateStructurePanel from '@/components/workflow/RuntimeStateStructurePanel';
import WorkflowFinalReviewOutputCard, { parseWorkflowFinalReviewOutput } from '@/components/workflow/WorkflowFinalReviewOutputCard';
import AgentFormationDiagram from '@/components/AgentFormationDiagram';
import AgentPanel from '@/components/AgentPanel';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import NewConfigModal from '@/components/NewConfigModal';
import WorkflowPreflightManagerDialog from '@/components/WorkflowPreflightManagerDialog';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import Markdown from '@/components/Markdown';
import {
  dispatchWorkflowRunHide,
  WORKFLOW_RUN_VISIBILITY_EVENT,
  dispatchWorkflowRunResetLayout,
  dispatchWorkflowRunRestore,
  type WorkflowRunWindowId,
} from '@/components/ResizablePanels';
import { Button } from '@/components/ui/button';
import { WorkbenchActionButton, WorkbenchHeader, WorkbenchOverflowMenu, type WorkbenchAction, type WorkbenchModeOption } from '@/components/ui/workbench-header';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { Progress } from '@/components/ui/progress';
import { ComboboxPortalProvider, MultiCombobox } from '@/components/ui/combobox';
import { Skeleton } from '@/components/ui/skeleton';
import { ModelSelect } from '@/components/ModelSelect';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { ButtonGroup } from '@/components/ui/button-group';
import { Switch } from '@/components/ui/switch';
import { useDashboardDockWorkspace } from '@/components/dashboard/dashboard-dock-workspace-context';
import { EngineSelect } from '@/components/EngineSelect';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DetailDrawer, DetailDrawerBody, DetailDrawerContent, DetailDrawerDescription, DetailDrawerHeader, DetailDrawerTitle } from '@/components/ui/detail-drawer';
import { Check, ChevronDown, RotateCcw } from 'lucide-react';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useAttentionSignal } from '@/hooks/useAttentionSignal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { WrapperProcessBlocks } from '@/components/chat/ChatMessage';
import { RuntimeToolEventCard, RuntimeToolEventGroup } from '@/components/chat/RuntimeToolEventList';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { Shimmer } from '@/components/ai-elements/shimmer';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import { calculateWorkflowRunTiming, resolveWorkflowOverviewTiming } from '@/lib/workflow/run-timing';
import type {
  RunReviewOverride,
  RunReviewPlan,
  WorkflowAdversarialIntent,
} from '@/lib/workflow/run-review-types';
import { inferBaselineAdversarialIntent, isStateLevelReviewAdopted } from '@/lib/workflow/state-review-policy';
import { resolveWorkflowAgentSelection, resolveWorkflowExecutionPolicy } from '@/lib/agent/engine-selection';
import { compileStepTaskBindings, type StepTaskBindingValidation } from '@/lib/spec/task-binding';
import { getStreamingAceProcessReadyContent, mergeAceProcessChunkItems, mergeAceSubtaskChunkItems, mergeAceSubtaskChunks } from '@/lib/chat/ai-process-blocks';
import {
  diagnoseExtractionFailure,
  extractStructuredResultPayload,
} from '@/lib/ai/result-normalizers';
import {
  applyDesignOptimizationPatch,
  buildDesignOptimizationPrompt,
  doesWorkflowPatchMatchTarget,
  extractDesignOptimizationSnapshot,
  extractWorkflowPatchItemPayload,
  extractWorkflowPatchValue,
  getDesignOptimizationDialogTitle,
  getDesignOptimizationScopeHint,
  getDesignOptimizationTargetLabel,
  getWorkflowMode,
  type DesignOptimizationTarget,
  type WorkflowPatchPayload,
} from '@/lib/workflow/design-ai-optimization';
import {
  attachWorkflowTaskInputFieldLabels,
  DEFAULT_WORKFLOW_TASK_INPUT_FIELDS,
  getWorkflowTaskInputFieldValue,
  getWorkflowTaskInputTitle,
  hasWorkflowTaskInput,
  normalizeWorkflowTaskInput,
  resolveWorkflowTaskInputFields,
  setWorkflowTaskInputFieldValue,
  type WorkflowTaskInputFieldDefinition,
  type WorkflowTaskInput,
} from '@/lib/workflow/task-input';
import {
  buildWorkflowDesignConfigForSave,
  hasWorkflowDesignDraftChanges,
  type WorkflowDesignDraftState,
} from '@/lib/workflow/design-config-draft';
import type { TasksMarkdownValidationIssue } from '@/lib/spec/coding-store';
import {
  buildWorkflowConversationDirectory,
} from '@/lib/agent/conversations';
import {
  isLightweightWorkflowConfig,
  resolveWorkflowPolicyAgentNames,
  resolveWorkflowPolicySupervisorAgentName,
} from '@/lib/workflow/lightweight';
import { formatWorkflowFailureReason, formatWorkflowFailureReasonWithStepLogs, isLiveTextTruncated } from '@/lib/workflow/error-summary';
import { getEngineMeta } from '@/lib/core/engine-metadata';
import { createInitialAgentDraft, type AgentDraftState } from '@/lib/agent/draft';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import type { ManagedMcpServer } from '@/lib/mcp/types';
import type {
  DeltaMergeState,
  HumanQuestion,
  HumanQuestionAnswer,
  WorkflowGitState,
  WorkflowSpecRevisionVoteRecord,
} from '@/lib/run/state-persistence';
import type { StateMachineState, WorkflowAgentExecutionOverride } from '@/lib/core/schemas';
import { GitWorkspaceDiffPanel } from '@/components/workflow/GitWorkspaceDiffPanel';
import { cn } from '@/lib/core/utils';
import { createSafeEventSource } from '@/lib/core/safe-event-source';
import { resolveDockviewTabPolicy } from '@/lib/navigation/dockview-tab-policy';
import { resolveWorkspaceLinkTarget, resolveWorkspaceRootFromRoute } from '@/lib/workspace/link-target';
import { VirtualList } from '@/client/virtual/VirtualList';
import { parseAceSseEventData, storeAceAgentMessage, storeChatStreamSseEventAsAgentMessage, storeWorkflowSseEventAsAgentMessage, type AceStreamChunk } from '@/client/ai/messages';
import { mergeRuntimeToolEvents, type RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';
import { getStableLiveToolGroupIdentity } from './live-tool-group-identity';
import styles from './page.module.css';

const loadingPanel = () => (
  <div className="flex h-full min-h-[240px] flex-col justify-center gap-4 bg-background p-6">
    <div className="mx-auto w-full max-w-xl space-y-4">
      <BrandLoadingScreen message="正在加载工作台资源..." fullscreen={false} />
      <div className="rounded-2xl border bg-background/80 p-4 space-y-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-56" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  </div>
);
const designTabLoadingPanel = (message: string) => (
  <div className="flex h-full min-h-[320px] flex-col justify-center bg-background p-6">
    <div className="mx-auto w-full max-w-3xl space-y-4">
      <div className="rounded-2xl border bg-background/80 p-5">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>deployed_code</span>
          {message}
        </div>
        <div className="mt-4 space-y-3">
          <Skeleton className="h-8 w-40 rounded-xl" />
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
        </div>
      </div>
    </div>
  </div>
);
const ProcessPanel = dynamic(() => import('@/components/ProcessPanel'), {
  ssr: false,
  loading: () => loadingPanel(),
});
const DocumentsPanel = dynamic(() => import('@/components/DocumentsPanel'), {
  ssr: false,
  loading: () => loadingPanel(),
});
const SchedulesPanel = dynamic(() => import('@/components/SchedulesPanel'), {
  ssr: false,
  loading: () => loadingPanel(),
});
const WorkspaceEditor = dynamic(
  () => import('@/components/workspace/WorkspaceEditor').then((mod) => mod.WorkspaceEditor),
  {
    ssr: false,
    loading: () => loadingPanel(),
  }
);
const RichTextEditor = dynamic(() => import('@/components/ui/RichTextEditor'), {
  ssr: false,
  loading: () => <div className="h-24 rounded-[24px] border bg-muted/30" />,
});
const StateMachineDesignPanel = dynamic(() => import('@/components/StateMachineDesignPanel'), {
  ssr: false,
  loading: () => designTabLoadingPanel('正在加载状态机编排...'),
});
const WorkflowSupervisorAgoraPanel = dynamic(() => import('@/components/workflow/WorkflowSupervisorAgoraPanel'), {
  ssr: false,
  loading: () => loadingPanel(),
});
const MonacoEditor = dynamic(
  async () => {
    const monaco = await import('monaco-editor');
    const { loader, default: Editor } = await import('@monaco-editor/react');
    loader.config({ monaco });
    return Editor;
  },
  {
    ssr: false,
    loading: () => loadingPanel(),
  }
);

const WINDOWS_DRIVE_ABSOLUTE_PATH = /^[A-Za-z]:[\\/]/;
const UNC_ABSOLUTE_PATH = /^(?:\\\\|\/\/)/;
export type RunWorkbenchTab = 'overview' | 'state' | 'workspace' | 'changes' | 'documents' | 'agents' | 'agora' | 'live' | 'spec';
export type RunDetailSection = 'overview' | 'state' | 'workspace' | 'changes' | 'documents' | 'agents' | 'agora' | 'live' | 'spec';
export type DocumentSourceFilter = RunDocumentSource | 'all';
export type RunDetailNavItem = {
  id: string;
  key: RunDetailSection;
  label: string;
  icon: string;
  documentSource?: DocumentSourceFilter;
};
type RunLeftPanelTab = 'summary' | 'directory';
type RunRightPanelTab = 'detail' | 'live' | 'context' | 'questions' | 'diff';
const WORKFLOW_RUN_PANEL_TABS_STORAGE_PREFIX = 'aceharness:workflow-run:panel-tabs';

export function buildWorkflowConfigWithName(config: any, name: string) {
  const trimmedName = name.trim();
  if (!config || !trimmedName) return null;

  const nextConfig = JSON.parse(JSON.stringify(config));
  nextConfig.workflow = { ...(nextConfig.workflow || {}), name: trimmedName };
  return nextConfig;
}

export function upsertStartedRunInHistory(historyRuns: any[], startedRun: any) {
  return [startedRun, ...historyRuns.filter((run) => run?.id !== startedRun.id)];
}

export function resolveWorkbenchRuntimeWorkflowConfig(input: {
  baseConfig: any;
  activeRunId?: string | null;
  runDetail?: any;
  statusSnapshot?: any;
}) {
  const activeRunId = String(input.activeRunId || '').trim();
  for (const candidate of [input.statusSnapshot, input.runDetail]) {
    if (!candidate || typeof candidate !== 'object') continue;
    const candidateRunId = String(candidate.runId || candidate.id || '').trim();
    if (activeRunId && candidateRunId && candidateRunId !== activeRunId) continue;
    const runtimeWorkflow = candidate.workflow;
    if (!runtimeWorkflow || typeof runtimeWorkflow !== 'object' || !Array.isArray(runtimeWorkflow.states)) continue;
    return {
      ...(input.baseConfig || {}),
      workflow: runtimeWorkflow,
    };
  }
  return input.baseConfig;
}

export function resolveWorkbenchStateMapPresentation(input: {
  baseConfig: any;
  activeRunId?: string | null;
  runDetail?: any;
  statusSnapshot?: any;
}): {
  config: any;
  source: 'run' | 'configuration';
} {
  const config = resolveWorkbenchRuntimeWorkflowConfig(input);
  return {
    config,
    source: config === input.baseConfig ? 'configuration' : 'run',
  };
}

export function buildWorkbenchPreviewDetailNavItems(input: {
  isLightweightWorkflow: boolean;
  runtimeSpecAvailable?: boolean;
}): Array<{ key: RunDetailSection; label: string; icon: string }> {
  return [
    { key: 'overview', label: '总览', icon: 'dashboard' },
    { key: 'state', label: '状态图', icon: 'hub' },
    ...(!input.isLightweightWorkflow ? [{ key: 'agents' as const, label: 'Agents', icon: 'groups' }] : []),
    { key: 'workspace', label: '工作区', icon: 'folder_open' },
    ...(input.runtimeSpecAvailable ? [{ key: 'spec' as const, label: 'Spec', icon: 'fact_check' }] : []),
  ];
}

export function buildWorkbenchRunDetailNavItems(input: {
  isLightweightWorkflow: boolean;
  runtimeSpecAvailable?: boolean;
  includeStructuredTasklist?: boolean;
}): RunDetailNavItem[] {
  return [
    { id: 'overview', key: 'overview', label: '总览', icon: 'dashboard' },
    { id: 'state', key: 'state', label: '状态图', icon: 'hub' },
    ...(!input.isLightweightWorkflow ? [{ id: 'agents', key: 'agents' as const, label: 'Agents', icon: 'groups' }] : []),
    { id: 'workspace', key: 'workspace', label: '工作区', icon: 'folder_open' },
    { id: 'changes', key: 'changes', label: '变更', icon: 'difference' },
    ...(input.isLightweightWorkflow
      ? [{ id: 'tasklist', key: 'documents' as const, label: '任务清单', icon: 'checklist', documentSource: 'tasklist' as const }]
      : []),
    ...(!input.isLightweightWorkflow && input.includeStructuredTasklist
      ? [{ id: 'tasklist', key: 'documents' as const, label: '任务清单', icon: 'checklist', documentSource: 'tasklist' as const }]
      : []),
    ...(!input.isLightweightWorkflow
      ? [{ id: 'documents', key: 'documents' as const, label: '步骤文档', icon: 'description', documentSource: 'runtime-output' as const }]
      : []),
    ...(!input.isLightweightWorkflow ? [{ id: 'agora', key: 'agora' as const, label: '对话', icon: 'forum' }] : []),
    { id: 'live', key: 'live', label: '实时输出', icon: 'cell_tower' },
    ...(input.runtimeSpecAvailable ? [{ id: 'spec', key: 'spec' as const, label: 'Spec', icon: 'fact_check' }] : []),
  ];
}

export function resolveWorkbenchPreviewRouteSection(routeSection: string): RunDetailSection {
  return routeSection === 'preview-state'
    ? 'state'
    : routeSection === 'preview-agents'
      ? 'agents'
      : routeSection === 'preview-workspace'
        ? 'workspace'
        : routeSection === 'preview-spec'
          ? 'spec'
          : 'overview';
}

export function resolveLightweightWorkbenchRunTabRedirect(input: {
  requestedTab: RunWorkbenchTab;
  requestedDocumentSource: DocumentSourceFilter;
}): { section: RunDetailSection; tab: RunWorkbenchTab; documentSource: DocumentSourceFilter } | null {
  if (input.requestedTab === 'agents' || input.requestedTab === 'agora') {
    return { section: 'overview', tab: 'overview', documentSource: 'all' };
  }
  if (
    (input.requestedTab === 'documents' && input.requestedDocumentSource !== 'tasklist')
    || input.requestedDocumentSource === 'runtime-output'
  ) {
    return { section: 'documents', tab: 'documents', documentSource: 'tasklist' };
  }
  return null;
}

const WORKBENCH_STREAM_CHUNK_SEPARATOR = '\n\n<!-- chunk-boundary -->\n\n';
const WORKBENCH_STREAM_CHUNK_BOUNDARY_REGEX = /\r?\n*\s*<!--\s*chunk-boundary\s*-->\s*\r?\n*/gi;

export function splitWorkbenchLiveStreamContent(content: string): string[] {
  return String(content || '').split(WORKBENCH_STREAM_CHUNK_BOUNDARY_REGEX).filter(Boolean);
}

/**
 * Stream frames are transport increments, so they must be reassembled before
 * Markdown sees them. A double newline here would turn every frame into a p.
 */
export function reconstructWorkbenchCachedLiveStreamContent(
  rows: Array<{ id?: string; content?: string; chunks?: string[] }>,
  runId: string,
  stepKey: string,
): string {
  const liveMessageId = `workflow:${runId}:${stepKey}:live`;
  const liveMessage = rows.find((row) => row.id === liveMessageId);
  if (liveMessage) return liveMessage.content || liveMessage.chunks?.filter(Boolean).join('') || '';

  return rows.map((row) => {
    if (Array.isArray(row.chunks) && row.chunks.length > 0) {
      return row.chunks.filter(Boolean).join('');
    }
    return row.content || '';
  }).join('');
}

export function applyWorkbenchLiveStreamTransportFrame(
  currentRaw: string,
  frame: { kind: 'snapshot' | 'delta'; content: string },
): string {
  return frame.kind === 'snapshot' ? frame.content : `${currentRaw}${frame.content}`;
}

const WORKFLOW_RUN_DELETED_EVENT = 'ace:workflow-run-deleted';
const TERMINAL_WORKFLOW_STATUSES = new Set(['completed', 'failed', 'stopped', 'crashed']);
type StopProgressStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';
export type WorkbenchStopProgressStep = {
  id: string;
  label: string;
  status: StopProgressStatus;
  detail?: string;
  durationMs?: number;
};

export function selectCurrentStepAttemptLogs<T extends { superseded?: boolean }>(logs: T[]): T[] {
  return logs.filter((log) => !log?.superseded);
}

const USER_VISIBLE_STOP_PROGRESS_PHASES: ReadonlyArray<Pick<WorkbenchStopProgressStep, 'id' | 'label'>> = [
  { id: 'request', label: '发送停止请求' },
  { id: 'manager-stop', label: '停止运行实例' },
  { id: 'state-persist', label: '保存停止状态' },
  { id: 'process-cleanup', label: '清理运行资源' },
  { id: 'refresh', label: '刷新运行状态' },
];
const USER_VISIBLE_STOP_PROGRESS_PHASE_BY_ID = new Map(
  USER_VISIBLE_STOP_PROGRESS_PHASES.map((step) => [step.id, step]),
);

function isTerminalWorkflowStatus(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_WORKFLOW_STATUSES.has(status);
}

function isRuntimeWorkflowStatusActive(status: unknown): boolean {
  return status === 'running' || status === 'preparing' || status === 'waiting';
}

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function shouldEnableWorkbenchStatusSync(input: {
  viewMode: ViewMode;
  isHistoryRunView: boolean;
  configFile?: string | null;
  runId?: string | null;
}): boolean {
  if (input.viewMode === 'history' || !hasNonEmptyText(input.configFile)) return false;
  return !input.isHistoryRunView || hasNonEmptyText(input.runId);
}

export function shouldConnectWorkbenchRunStatusStream(input: {
  viewMode: ViewMode;
  isHistoryRunView: boolean;
  configFile?: string | null;
  runId?: string | null;
}): boolean {
  return input.viewMode === 'run' && shouldEnableWorkbenchStatusSync(input);
}

export async function applyAcceptedWorkbenchRecovery<T>(
  request: () => Promise<T>,
  applyAcceptedState: () => void,
): Promise<T> {
  const response = await request();
  applyAcceptedState();
  return response;
}

function normalizeStopProgressStatus(value: unknown): StopProgressStatus | null {
  return value === 'pending'
    || value === 'running'
    || value === 'success'
    || value === 'failed'
    || value === 'skipped'
    ? value
    : null;
}

export function createStopProgressSteps(): WorkbenchStopProgressStep[] {
  return USER_VISIBLE_STOP_PROGRESS_PHASES.map((phase) => ({
    ...phase,
    status: phase.id === 'request'
      ? 'success'
      : phase.id === 'manager-stop'
        ? 'running'
        : 'pending',
  }));
}

export function mergeUserVisibleStopProgressSteps(
  currentSteps: WorkbenchStopProgressStep[],
  backendSteps: unknown,
): WorkbenchStopProgressStep[] {
  const stepsById = new Map<string, WorkbenchStopProgressStep>();
  const addStep = (candidate: WorkbenchStopProgressStep) => {
    const phase = USER_VISIBLE_STOP_PROGRESS_PHASE_BY_ID.get(candidate.id);
    if (!phase) return;
    stepsById.set(candidate.id, {
      id: phase.id,
      label: phase.label,
      status: candidate.status,
      durationMs: candidate.durationMs,
    });
  };

  currentSteps.forEach(addStep);
  if (Array.isArray(backendSteps)) {
    for (const rawStep of backendSteps) {
      if (!rawStep || typeof rawStep !== 'object') continue;
      const raw = rawStep as Record<string, unknown>;
      const id = typeof raw.id === 'string' ? raw.id : '';
      const phase = USER_VISIBLE_STOP_PROGRESS_PHASE_BY_ID.get(id);
      if (!phase) continue;
      const current = stepsById.get(id);
      addStep({
        id,
        label: phase.label,
        status: normalizeStopProgressStatus(raw.status) || current?.status || 'pending',
        durationMs: typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
          ? raw.durationMs
          : current?.durationMs,
      });
    }
  }

  return USER_VISIBLE_STOP_PROGRESS_PHASES.map((phase) => (
    stepsById.get(phase.id) || { ...phase, status: 'pending' }
  ));
}

export function markStopProgressStatePersisted(
  steps: WorkbenchStopProgressStep[],
): WorkbenchStopProgressStep[] {
  return steps.map((step) => {
    if (step.id === 'request' || step.id === 'manager-stop' || step.id === 'state-persist') {
      return { ...step, status: 'success' as const };
    }
    if (step.id === 'process-cleanup' && step.status === 'pending') {
      return { ...step, status: 'running' as const };
    }
    return step;
  });
}

function completeStopProgressSteps(steps: WorkbenchStopProgressStep[]): WorkbenchStopProgressStep[] {
  return steps.map((step) => (
    step.status === 'pending' ? { ...step, status: 'skipped' } : step
  ));
}

function workflowStepKeyMatchesName(stepKey: string | null | undefined, stepName: string | null | undefined): boolean {
  const key = String(stepKey || '').trim();
  const name = String(stepName || '').trim();
  if (!key || !name) return false;
  const baseName = name.replace(/-迭代\d+$/, '');
  return (
    key === name
    || key === baseName
    || key.startsWith(`${name}-迭代`)
    || key.startsWith(`${baseName}-迭代`)
    || key.endsWith(`-${name}`)
    || key.endsWith(`-${baseName}`)
  );
}

function normalizeActiveWorkflowSteps(input: {
  activeSteps?: unknown;
  currentStep?: unknown;
  currentPhase?: unknown;
  currentState?: unknown;
  completedSteps?: unknown;
  failedSteps?: unknown;
  terminal?: boolean;
}): string[] {
  if (input.terminal) return [];
  const rawSteps = Array.isArray(input.activeSteps)
    ? input.activeSteps.map((step) => String(step || '').trim()).filter(Boolean)
    : [];
  const currentStep = typeof input.currentStep === 'string' ? input.currentStep.trim() : '';
  const currentState = String(input.currentPhase || input.currentState || '').trim();
  const completed = new Set(Array.isArray(input.completedSteps) ? input.completedSteps.map((step) => String(step || '').trim()).filter(Boolean) : []);
  const failed = new Set(Array.isArray(input.failedSteps) ? input.failedSteps.map((step) => String(step || '').trim()).filter(Boolean) : []);
  const normalized = rawSteps.filter((step) => {
    if (currentStep && step === currentStep) return true;
    if (currentState && !step.startsWith(`${currentState}-`)) return false;
    return !completed.has(step) && !failed.has(step);
  });
  if (currentStep && (!currentState || currentStep.startsWith(`${currentState}-`)) && !normalized.includes(currentStep)) {
    normalized.unshift(currentStep);
  }
  return Array.from(new Set(normalized));
}

function normalizeWorkflowStepName(value: unknown): string {
  return String(value || '').trim();
}

function uniqueWorkflowStepNames(values: unknown[]): string[] {
  return Array.from(new Set(values.map(normalizeWorkflowStepName).filter(Boolean)));
}

export function resolveWorkbenchLiveStreamStepKeys(input: {
  activeSteps?: unknown;
  currentStep?: unknown;
  currentPhase?: unknown;
  currentState?: unknown;
  completedSteps?: unknown;
  failedSteps?: unknown;
  terminal?: boolean;
  fallbackStepName?: unknown;
}): string[] {
  if (input.terminal) {
    const terminalSteps = uniqueWorkflowStepNames([
      ...(Array.isArray(input.completedSteps) ? input.completedSteps : []),
      ...(Array.isArray(input.failedSteps) ? input.failedSteps : []),
      input.currentStep,
      ...(Array.isArray(input.activeSteps) ? input.activeSteps : []),
    ]);
    return terminalSteps.length > 0 ? terminalSteps : uniqueWorkflowStepNames([input.fallbackStepName]);
  }

  const activeSteps = normalizeActiveWorkflowSteps(input);
  return activeSteps.length > 0 ? activeSteps : uniqueWorkflowStepNames([input.fallbackStepName]);
}

export function resolveSoleConfiguredWorkflowStepName(workflow: unknown): string {
  const states = Array.isArray((workflow as any)?.states) ? (workflow as any).states : [];
  const stepNames = uniqueWorkflowStepNames(states.flatMap((state: any) => (
    Array.isArray(state?.steps)
      ? state.steps.map((step: any) => step?.name)
      : []
  )));
  return stepNames.length === 1 ? stepNames[0] : '';
}

function countGitWorkingTreeFiles(summary?: GitBrowserSummaryResponse | null): number {
  if (!summary?.available) return 0;
  const changed = new Set<string>();
  for (const file of summary.workingTree.unstaged || []) changed.add(file.path);
  for (const file of summary.workingTree.staged || []) changed.add(file.path);
  for (const file of summary.workingTree.untracked || []) changed.add(file.path);
  return changed.size;
}

function getWorkflowStatusTone(status: string): ComponentProps<typeof StatusPill>['tone'] {
  const value = normalizeWorkflowStatusCode(status);
  if (value === 'completed') return 'success';
  if (value === 'running') return 'info';
  if (value === 'preparing') return 'warning';
  if (value === 'failed' || value === 'stopped' || value === 'crashed') return 'danger';
  return 'neutral';
}

function normalizeWorkflowStatusCode(status: unknown): string {
  const value = String(status || '').trim().toLowerCase();
  if (!value) return '';
  if (value === '已停止' || value === '停止' || value === 'stopped') return 'stopped';
  if (value === '运行中' || value === 'running') return 'running';
  if (value === '准备中' || value === 'preparing') return 'preparing';
  if (value === '完成' || value === '已完成' || value === 'completed') return 'completed';
  if (value === '失败' || value === 'failed') return 'failed';
  if (value === '崩溃' || value === 'crashed') return 'crashed';
  if (value === '等待中' || value === 'waiting') return 'waiting';
  if (value === '待处理' || value === 'pending') return 'pending';
  return value;
}

/**
 * Configs with no state-level policy at all (lightweight, or authored before the
 * protocol) report no baseline intent. Defaulting to `disabled` keeps them running
 * the way they always have — no AI planning pass, no derived state machine, no
 * extra cost nobody asked for — and, just as importantly, leaves the start dialog
 * with a selected option so its primary button is never disabled for a reason the
 * user cannot see. Both the initial state and the reset effect go through here so
 * the two cannot drift apart.
 */
export function resolveInitialAdversarialIntent(
  baselineIntent: WorkflowAdversarialIntent | null | undefined,
): WorkflowAdversarialIntent {
  return baselineIntent ?? 'disabled';
}

export function shouldShowWorkbenchHumanAttention(input: {
  workflowStatus: unknown;
  hasPendingQuestion: boolean;
  hasApproval: boolean;
  isHumanReviewLocation: boolean;
}): boolean {
  if (isTerminalWorkflowStatus(normalizeWorkflowStatusCode(input.workflowStatus))) return false;
  return input.hasPendingQuestion || input.hasApproval || input.isHumanReviewLocation;
}

export function getWorkflowStatusDotClass(status: unknown, isRunning: boolean): string {
  const value = normalizeWorkflowStatusCode(status);
  if (isRunning || value === 'running') return 'bg-blue-500';
  if (value === 'completed') return 'bg-emerald-500';
  if (value === 'failed' || value === 'crashed') return 'bg-red-500';
  if (value === 'stopped') return 'bg-slate-400';
  return 'bg-amber-500';
}

function isWeakWorkflowStatus(status: unknown): boolean {
  const value = normalizeWorkflowStatusCode(status);
  return !value || value === 'idle' || value === 'unknown';
}

function formatWorkflowStatusLabel(status: unknown): string {
  const value = normalizeWorkflowStatusCode(status);
  if (value === 'completed') return '完成';
  if (value === 'failed') return '失败';
  if (value === 'crashed') return '崩溃';
  if (value === 'stopped') return '已停止';
  if (value === 'preparing') return '准备中';
  if (value === 'running') return '运行中';
  if (value === 'waiting') return '等待中';
  if (value === 'pending') return '待处理';
  return value || '待处理';
}

export function formatWorkflowLocation(
  phase?: string | null,
  step?: string | null,
  fallback = 'Ready',
): string {
  const formatStateName = (name: string) => {
    if (name === '__origin__') return '开始';
    if (name === '__human_approval__') return '人工审查';
    return name;
  };
  const phaseName = String(phase || '').trim();
  const stepName = String(step || '').trim();
  const displayStepName = phaseName && stepName.startsWith(`${phaseName}-`)
    ? stepName.slice(phaseName.length + 1)
    : stepName;
  if (phaseName && displayStepName && phaseName !== displayStepName) {
    return `${formatStateName(phaseName)} / ${formatStateName(displayStepName)}`;
  }
  const value = phaseName || displayStepName;
  return value ? formatStateName(value) : fallback;
}

function formatRunClockTime(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '-';
  const time = new Date(raw);
  if (Number.isNaN(time.getTime())) return '-';
  return time.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatLiveOutputTimestamp(value: unknown): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const time = new Date(raw);
  if (Number.isNaN(time.getTime())) return null;
  return time.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatRunDuration(ms: number): string {
  const safeMs = Math.max(0, Math.floor(ms || 0));
  const totalSeconds = Math.floor(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分`;
  if (hours > 0) return `${hours}小时 ${minutes}分 ${seconds}秒`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
}

function WorkbenchExecutionLoadingSkeleton() {
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b px-6 py-5">
        <div className="text-sm font-semibold">执行追踪</div>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <div className="mx-auto flex h-full max-w-4xl flex-col justify-center gap-6">
          <BrandLoadingScreen message="正在加载工作流视图..." fullscreen={false} />
        </div>
      </div>
    </div>
  );
}

function WorkbenchRunInfoLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex shrink-0 gap-0.5 border-b bg-muted px-1 py-1">
        <Skeleton className="h-7 w-16 rounded-md" />
        <Skeleton className="h-7 w-16 rounded-md" />
        <Skeleton className="h-7 w-14 rounded-md" />
        <Skeleton className="h-7 w-14 rounded-md" />
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-hidden p-4">
        <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-4 w-24" />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
          <Skeleton className="mt-2 h-14 w-full rounded-xl" />
          <Skeleton className="mt-2 h-24 w-full rounded-xl" />
        </div>
        <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-4/5" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
            <Skeleton className="h-14 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}

function WorkbenchRunListLoadingSkeleton() {
  return (
    <>
      {[0, 1, 2].map((index) => (
        <div key={`run-list-skeleton-${index}`} className={styles.workbenchRunCard}>
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="mt-3 h-4 w-4/5" />
          <Skeleton className="mt-2 h-3 w-3/5" />
        </div>
      ))}
    </>
  );
}

function WorkbenchRunDetailLoadingSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="border-b bg-muted">
        <div className="flex gap-1 px-2 py-1">
          <Skeleton className="h-7 flex-1 rounded-md" />
          <Skeleton className="h-7 flex-1 rounded-md" />
        </div>
        <div className="flex h-9 items-center px-3">
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-hidden p-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    </div>
  );
}

function WorkbenchAgentDetailSkeleton() {
  return (
    <div className="h-full overflow-auto">
      <div className="bg-muted border-b p-3.5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-5 w-14 rounded-full" />
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-8 rounded-full" />
          </div>
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-3/4 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function isAbsoluteProjectPath(path: string) {
  return path.startsWith('/') || WINDOWS_DRIVE_ABSOLUTE_PATH.test(path) || UNC_ABSOLUTE_PATH.test(path);
}

function getRunWorkbenchTabFromSearchParams(searchParams: { get: (key: string) => string | null }): RunWorkbenchTab {
  const tab = searchParams.get('tab');
  if (isRunWorkbenchTab(tab)) return tab;
  if (searchParams.get('changes') === '1') return 'changes';
  if (searchParams.get('workspace') === '1') return 'workspace';
  return 'overview';
}

function getDocumentSourceFilterFromSearchParams(searchParams: { get: (key: string) => string | null }): DocumentSourceFilter {
  const source = searchParams.get('documentSource');
  return source === 'tasklist' || source === 'runtime-output' ? source : 'all';
}

function runWorkbenchTabToDetailSection(tab: RunWorkbenchTab, runtimeSpecAvailable = true): RunDetailSection {
  if (tab === 'state') return 'state';
  if (tab === 'workspace') return 'workspace';
  if (tab === 'changes') return 'changes';
  if (tab === 'documents') return 'documents';
  if (tab === 'agents') return 'agents';
  if (tab === 'agora') return 'agora';
  if (tab === 'live') return 'live';
  if (tab === 'spec' && runtimeSpecAvailable) return 'spec';
  return 'overview';
}

function runDetailSectionToWorkbenchTab(section: RunDetailSection): RunWorkbenchTab {
  return section === 'overview' ? 'overview' : section;
}

function hasRunWorkbenchTabSearchParam(searchParams: { get: (key: string) => string | null }) {
  return isRunWorkbenchTab(searchParams.get('tab')) || searchParams.get('changes') === '1' || searchParams.get('workspace') === '1';
}

const WORKBENCH_OUTER_QUERY_KEYS = [
  'mode',
  'run',
  'runId',
  'workspace',
  'workspaceRoot',
  'workspaceFile',
  'workspaceLine',
  'workspaceColumn',
  'changes',
  'tab',
  'documentSource',
  'history',
  'designTab',
  'focus',
  'questionId',
  'section',
  'autoStart',
];

function getWorkflowRunPanelTabsStorageKey(configFile: string) {
  return `${WORKFLOW_RUN_PANEL_TABS_STORAGE_PREFIX}:${configFile}`;
}

function isRunWorkbenchTab(value: unknown): value is RunWorkbenchTab {
  return value === 'overview'
    || value === 'state'
    || value === 'workspace'
    || value === 'changes'
    || value === 'documents'
    || value === 'agents'
    || value === 'agora'
    || value === 'live'
    || value === 'spec';
}

function normalizeViewMode(value: string | null): ViewMode {
  return value === 'design' ? 'design' : 'run';
}

function readWorkflowRunPanelTabs(configFile: string): {
  left?: RunLeftPanelTab;
  right?: RunRightPanelTab;
  center?: RunWorkbenchTab;
} {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(getWorkflowRunPanelTabsStorageKey(configFile)) || '{}');
    return {
      left: parsed.left === 'directory' || parsed.left === 'summary' ? parsed.left : undefined,
      right: parsed.right === 'live' || parsed.right === 'detail' || parsed.right === 'context' || parsed.right === 'questions' || parsed.right === 'diff' ? parsed.right : undefined,
      center: parsed.center === 'execution'
        ? 'overview'
        : parsed.center === 'overview'
          || parsed.center === 'state'
          || parsed.center === 'workspace'
          || parsed.center === 'changes'
          || parsed.center === 'documents'
          || parsed.center === 'agents'
          || parsed.center === 'agora'
          || parsed.center === 'live'
          || parsed.center === 'spec'
            ? parsed.center
            : undefined,
    };
  } catch {
    return {};
  }
}

function toRelativeWorkspaceFilePath(workspacePath: string, filePath?: string | null): string | null {
  const normalizedWorkspace = String(workspacePath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedFile = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedWorkspace || !normalizedFile) return null;
  const normalizedAbsoluteFile = String(filePath || '').replace(/\\/g, '/');
  if (normalizedAbsoluteFile === normalizedWorkspace) return null;
  if (isAbsoluteProjectPath(normalizedAbsoluteFile)) {
    const compareAsCaseInsensitive = WINDOWS_DRIVE_ABSOLUTE_PATH.test(normalizedWorkspace)
      || UNC_ABSOLUTE_PATH.test(normalizedWorkspace);
    const comparableWorkspace = compareAsCaseInsensitive ? normalizedWorkspace.toLowerCase() : normalizedWorkspace;
    const comparableFile = compareAsCaseInsensitive ? normalizedAbsoluteFile.toLowerCase() : normalizedAbsoluteFile;
    if (!comparableFile.startsWith(`${comparableWorkspace}/`)) return null;
    return normalizedAbsoluteFile.slice(normalizedWorkspace.length + 1) || null;
  }
  return normalizedFile || null;
}

function parseOptionalPositiveInt(value: string | null): number | null {
  const numeric = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

type RuntimeSpecTask = {
  id: string;
  title: string;
  detail?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'blocked';
  phaseId?: string;
  ownerAgents?: string[];
  updatedAt?: string;
  updatedBy?: string;
  validation?: string;
  children?: RuntimeSpecTask[];
};

type WorkflowStartRequest = {
  mode: 'rehearsal' | 'real';
  skipPreflight?: boolean;
  preflightChecks?: QualityCheckRecord[];
  preflightPreview?: Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null;
};

type WorkflowStartContexts = {
  globalContext: string;
  phaseContexts: Record<string, string>;
  taskInput?: WorkflowTaskInput;
  workingDirectory?: string;
};

const REVIEW_OPERATION_LABELS: Record<string, string> = {
  insert: '新增',
  delete: '删除',
  retag: '调整标记',
  convert: '转换',
};

type WorkflowStartReviewSelection = {
  planId: string;
  intent: WorkflowAdversarialIntent;
  overrides: RunReviewOverride[];
  plan: RunReviewPlan;
};

type ContextWorkspaceDialogProps = {
  title: string;
  description: string;
  modeLabel: string;
  globalDraft: string;
  phaseDrafts: Record<string, string>;
  taskInputDraft?: WorkflowTaskInput;
  taskInputEditable?: boolean;
  taskInputFields?: WorkflowTaskInputFieldDefinition[];
  workingDirectoryDraft?: string;
  workingDirectoryEditable?: boolean;
  footerText: string;
  actionLabel: string;
  actionBusyLabel: string;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  preflightPreview?: Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null;
  startContextTargets: string[];
  startContextScopeLabel: string;
  projectRoot?: string;
  runReviewPlanning?: {
    configFile: string;
    rehearsal: boolean;
    /** Intent this workflow was created under; preselected so the same question is not asked twice. */
    baselineIntent: WorkflowAdversarialIntent | null;
  };
  onReviewPlanIdChange?: (planId: string | null) => void;
  onCancel: () => void;
  onSkipPreflight?: (contexts: WorkflowStartContexts, review?: WorkflowStartReviewSelection) => void;
  onConfirm: (contexts: WorkflowStartContexts, review?: WorkflowStartReviewSelection) => void;
};

type MonacoEditorInstance = {
  getModel: () => any;
  revealLineInCenter: (lineNumber: number) => void;
  setPosition: (position: { lineNumber: number; column: number }) => void;
  focus: () => void;
  deltaDecorations: (oldDecorations: string[], newDecorations: any[]) => string[];
};

type MonacoNamespace = {
  editor: {
    setModelMarkers: (model: any, owner: string, markers: any[]) => void;
    MarkerSeverity: { Error: number };
  };
  Range: new (
    startLineNumber: number,
    startColumn: number,
    endLineNumber: number,
    endColumn: number
  ) => any;
};

const DESIGN_OPTIMIZATION_DIFF_ROW_LIMIT = 1200;
const DESIGN_OPTIMIZATION_STREAM_UPDATE_MS = 120;

function computeSimpleDiff(base: string, next: string, maxRows = Number.POSITIVE_INFINITY): Array<{ type: 'same' | 'add' | 'remove'; text: string }> {
  const baseLines = base.split('\n');
  const nextLines = next.split('\n');
  const rows: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
  const max = Math.max(baseLines.length, nextLines.length);
  for (let index = 0; index < max; index += 1) {
    if (rows.length >= maxRows) {
      rows.push({ type: 'same', text: `... diff 过大，已截断 ${max - index} 行；完整内容会在应用建议时写入草稿 ...` });
      break;
    }
    const before = baseLines[index];
    const after = nextLines[index];
    if (before === after) {
      rows.push({ type: 'same', text: before ?? '' });
    } else {
      if (before !== undefined) rows.push({ type: 'remove', text: before });
      if (after !== undefined) rows.push({ type: 'add', text: after });
    }
  }
  return rows;
}

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizeSpecArtifactDrafts(value: unknown, fallback?: Partial<SpecCodingArtifactDrafts>): SpecCodingArtifactDrafts {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    requirements: typeof source.requirements === 'string' ? source.requirements : fallback?.requirements || '',
    design: typeof source.design === 'string' ? source.design : fallback?.design || '',
    tasks: typeof source.tasks === 'string' ? source.tasks : fallback?.tasks || '',
  };
}

function normalizeSpecArtifactSnapshots(value: unknown): SpecArtifactSnapshot[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((snapshot) => {
      const source = snapshot && typeof snapshot === 'object' ? snapshot as Record<string, unknown> : {};
      return {
        version: Number(source.version) || 0,
        summary: typeof source.summary === 'string' ? source.summary : '',
        createdAt: typeof source.createdAt === 'string' ? source.createdAt : '',
        createdBy: typeof source.createdBy === 'string' ? source.createdBy : undefined,
        artifacts: normalizeSpecArtifactDrafts(source.artifacts),
      };
    })
    .filter((snapshot) => snapshot.version > 0)
    .sort((a, b) => a.version - b.version);
}

function extractSpecArtifactRevisionResult(markdown: string, fallback: SpecCodingArtifactDrafts): {
  summary: string;
  artifacts: SpecCodingArtifactDrafts;
  revisionPlan?: Array<{ artifact: string; op: string; targetId: string; reason?: string }>;
} | null {
  const parsed = extractStructuredResultPayload<{
    summary?: string;
    artifacts?: Partial<SpecCodingArtifactDrafts>;
    revisionPlan?: Array<{ artifact?: string; op?: string; targetId?: string; reason?: string }>;
  }>(markdown, 'spec_artifact_revision');
  if (!parsed?.artifacts || typeof parsed.artifacts !== 'object') return null;
  const artifacts = normalizeSpecArtifactDrafts(parsed.artifacts, fallback);
  const revisionPlan = Array.isArray(parsed.revisionPlan)
    ? parsed.revisionPlan
        .map((item) => ({
          artifact: typeof item.artifact === 'string' ? item.artifact : '',
          op: typeof item.op === 'string' ? item.op : '',
          targetId: typeof item.targetId === 'string' ? item.targetId : '',
          reason: typeof item.reason === 'string' ? item.reason : undefined,
        }))
        .filter((item) => item.artifact && item.op && item.targetId)
    : [];
  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim()
      ? parsed.summary.trim()
      : 'AI 优化 Spec 制品',
    artifacts,
    revisionPlan,
  };
}

type AggregatedTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
};

function emptyAggregatedTokenUsage(): AggregatedTokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    totalTokens: 0,
  };
}

function normalizeAggregatedTokenUsage(source?: Partial<AggregatedTokenUsage> | null): AggregatedTokenUsage {
  const raw = source as any;
  const inputTokens = typeof raw?.inputTokens === 'number' ? raw.inputTokens : typeof raw?.input === 'number' ? raw.input : 0;
  const outputTokens = typeof raw?.outputTokens === 'number' ? raw.outputTokens : typeof raw?.output === 'number' ? raw.output : 0;
  const cacheCreationInputTokens = typeof raw?.cacheCreationInputTokens === 'number' ? raw.cacheCreationInputTokens : 0;
  const cacheReadInputTokens = typeof raw?.cacheReadInputTokens === 'number' ? raw.cacheReadInputTokens : 0;
  const computedTotal = inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: computedTotal || (typeof raw?.totalTokens === 'number' ? raw.totalTokens : typeof raw?.total === 'number' ? raw.total : 0),
  };
}

function addAggregatedTokenUsage(target: AggregatedTokenUsage, source?: Partial<AggregatedTokenUsage> | null) {
  const usage = normalizeAggregatedTokenUsage(source);
  target.inputTokens += usage.inputTokens;
  target.outputTokens += usage.outputTokens;
  target.cacheCreationInputTokens += usage.cacheCreationInputTokens;
  target.cacheReadInputTokens += usage.cacheReadInputTokens;
  target.totalTokens += usage.totalTokens;
}

function formatTokenCount(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.round(value)));
}

function formatTokenPercent(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return '0%';
  return `${Math.round(Math.max(0, (part / total) * 100))}%`;
}

export type LightweightOverviewEvidenceTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type LightweightOverviewMetricEvidence = {
  status: string;
  value: string;
  details: string[];
  tone: LightweightOverviewEvidenceTone;
  available: boolean;
};

export type LightweightTokenConsumptionMetricInput = {
  total?: Partial<AggregatedTokenUsage> | null;
  hasData?: boolean;
} | null;

export function buildLightweightTokenConsumptionMetric(
  analytics?: LightweightTokenConsumptionMetricInput,
): LightweightOverviewMetricEvidence {
  const totalUsage = normalizeAggregatedTokenUsage(analytics?.total);
  const hasTokenEvidence = analytics?.hasData !== false && totalUsage.totalTokens > 0;
  if (!hasTokenEvidence) {
    return {
      status: '未记录',
      value: '不可用',
      details: ['当前运行没有 runtime tokenUsage 或 step log tokenUsage 证据。'],
      tone: 'neutral',
      available: false,
    };
  }

  const cacheHitTokens = totalUsage.cacheReadInputTokens;
  const cacheHitRatio = formatTokenPercent(cacheHitTokens, totalUsage.inputTokens + cacheHitTokens);
  return {
    status: '已记录',
    value: formatTokenCount(totalUsage.totalTokens),
    details: [
      `输入 ${formatTokenCount(totalUsage.inputTokens)} · 输出 ${formatTokenCount(totalUsage.outputTokens)}`,
      `缓存命中 ${formatTokenCount(cacheHitTokens)} / ${cacheHitRatio}`,
    ],
    tone: 'info',
    available: true,
  };
}

function flattenRuntimeSpecTasks(tasks: RuntimeSpecTask[]): RuntimeSpecTask[] {
  return tasks.flatMap((task) => [task, ...flattenRuntimeSpecTasks(task.children || [])]);
}

function flattenRuntimeSpecTasksWithDepth(tasks: RuntimeSpecTask[], depth = 0): Array<RuntimeSpecTask & { depth: number }> {
  return tasks.flatMap((task) => [
    { ...task, depth },
    ...flattenRuntimeSpecTasksWithDepth(task.children || [], depth + 1),
  ]);
}

function mapRuntimeSpecTasks(
  tasks: RuntimeSpecTask[],
  mapper: (task: RuntimeSpecTask) => RuntimeSpecTask,
): RuntimeSpecTask[] {
  return tasks.map((task) => mapper({
    ...task,
    children: mapRuntimeSpecTasks(task.children || [], mapper),
  }));
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

export function resolveStartPreflightStrategy(input: {
  plannedStart: boolean;
  skipRequested: boolean;
}): {
  runInClient: boolean;
  skipOnServer: boolean;
} {
  return {
    // Legacy starts execute their previewed commands in the client flow so
    // warnings can still be confirmed before launch. Planned starts execute
    // the effective projection exactly once on the server.
    runInClient: !input.plannedStart && !input.skipRequested,
    // A legacy start has already checked (or explicitly skipped) its project
    // commands. Planned starts only bypass them after an explicit user choice.
    skipOnServer: !input.plannedStart || input.skipRequested,
  };
}

function formatQualityCommandResult(command: QualityCheckRecord['commands'][number], index?: number) {
  const lines = [
    typeof index === 'number' ? `命令 ${index + 1}: ${command.command || '-'}` : `命令: ${command.command || '-'}`,
    `状态: ${command.status === 'passed' ? '通过' : command.status === 'warning' ? '警告' : '失败'}`,
    `退出码: ${command.exitCode ?? '无'}`,
  ];
  if (command.errorText) lines.push(`错误: ${command.errorText}`);
  if (command.stderr) lines.push(`stderr:\n${command.stderr}`);
  if (command.stdout) lines.push(`stdout:\n${command.stdout}`);
  return lines.join('\n');
}

function formatQualityCheckCommandResults(check: QualityCheckRecord) {
  const commands = check.commands || [];
  if (commands.length === 0) return '';
  return commands.map((command, index) => formatQualityCommandResult(command, commands.length > 1 ? index : undefined)).join('\n\n---\n\n');
}

type SpecCodingArtifactKey = 'requirements' | 'design' | 'tasks';
type SpecCodingArtifactDrafts = Record<SpecCodingArtifactKey, string>;

type SpecRevisionCandidate = {
  source: 'ai' | 'rollback';
  summary: string;
  artifacts: SpecCodingArtifactDrafts;
  createdAt: string;
  rawOutput?: string;
  targetVersion?: number;
  revisionPlan?: Array<{ artifact: string; op: string; targetId: string; reason?: string }>;
  qualityValidation?: SpecArtifactQualityReport | null;
};

type SpecArtifactQualityIssue = {
  level?: 'error' | 'warning' | string;
  artifact?: SpecCodingArtifactKey | 'all' | string;
  code?: string;
  message?: string;
  suggestion?: string;
};

type SpecArtifactQualityReport = {
  ok?: boolean;
  issues?: SpecArtifactQualityIssue[];
  errors?: SpecArtifactQualityIssue[];
  warnings?: SpecArtifactQualityIssue[];
  taskValidation?: {
    ok?: boolean;
    errors?: string[];
    issues?: TasksMarkdownValidationIssue[];
  };
};

type SpecRevisionMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'completed' | 'failed';
};

type WorkflowValidationIssue = {
  severity?: 'error' | 'warning' | string;
  path?: Array<string | number>;
  message?: string;
};

type DesignOptimizationCandidate = {
  summary: string;
  createdAt: string;
  rawOutput: string;
  filename?: string;
  payload: WorkflowPatchPayload;
  target: DesignOptimizationTarget;
  candidateConfig: any;
  baseSnapshot: any;
  candidateSnapshot: any;
  configValidation: {
    ok: boolean;
    issues: WorkflowValidationIssue[];
  } | null;
  bindingValidation: StepTaskBindingValidation | null;
};

type DesignOptimizationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  status?: 'streaming' | 'completed' | 'failed';
};

function buildSpecCodingRuntimePayload(specCoding: any, source: 'run' | 'creation') {
  const phases = Array.isArray(specCoding?.phases) ? specCoding.phases : [];
  const tasks = Array.isArray(specCoding?.tasks) ? specCoding.tasks : [];
  const assignments = Array.isArray(specCoding?.assignments) ? specCoding.assignments : [];
  const checkpoints = Array.isArray(specCoding?.checkpoints) ? specCoding.checkpoints : [];
  const revisions = Array.isArray(specCoding?.revisions) ? specCoding.revisions : [];
  return {
    specCodingSummary: {
      id: specCoding?.id,
      version: specCoding?.version,
      status: specCoding?.status,
      source,
      summary: specCoding?.summary,
      phaseCount: phases.length,
      taskCount: tasks.length,
      assignmentCount: assignments.length,
      checkpointCount: checkpoints.length,
      revisionCount: revisions.length,
      progress: specCoding?.progress,
      latestRevision: revisions.at(-1) || null,
    },
    specCodingDetails: {
      phases,
      tasks,
      assignments,
      checkpoints,
      revisions,
      artifacts: specCoding?.artifacts,
    },
  };
}

type SpecArtifactSnapshot = {
  version: number;
  summary: string;
  createdAt: string;
  createdBy?: string;
  artifacts: SpecCodingArtifactDrafts;
};

type SpecMergePreview = {
  masterBefore: string;
  mergedContent: string;
  diff: string;
  aiSummary: string;
  mergeState: DeltaMergeState;
};

const SPEC_MERGE_STATUS_LABELS: Record<DeltaMergeState['status'], string> = {
  'not-applicable': '不适用',
  available: '可合入',
  previewing: '生成预览中',
  'awaiting-confirmation': '等待确认',
  applying: '合入中',
  merged: '已合入',
  failed: '失败',
};

function getSpecMergeStatusLabel(status?: DeltaMergeState['status']) {
  return status ? SPEC_MERGE_STATUS_LABELS[status] || status : '未开始';
}

function normalizeStartupProgressLabel(label: string) {
  if (label === '正在正式启动，准备执行启动前检查') return '正在正式启动，正在执行启动前检查';
  if (label === '已进入演练模式，准备执行启动前检查') return '已进入演练模式，正在执行启动前检查';
  return label;
}

function splitMarkdownIntoVirtualPages(content: string, limit = 30000): string[] {
  const text = String(content || '');
  if (text.length <= limit || text.includes('<ace-process>')) return [text];
  const pages: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(text.length, cursor + limit);
    if (end < text.length) {
      const lineBreak = text.lastIndexOf('\n', end);
      if (lineBreak > cursor + Math.floor(limit * 0.55)) end = lineBreak + 1;
    }
    pages.push(text.slice(cursor, end));
    cursor = end;
  }
  return pages.filter((page) => page.trim().length > 0);
}

const AceAwareMarkdown = memo(function AceAwareMarkdown({
  content,
  isStreaming = false,
  className = '',
}: {
  content: string;
  isStreaming?: boolean;
  className?: string;
}) {
  const rawPrepared = isStreaming
    ? getStreamingAceProcessReadyContent(content)
    : String(content || '');
  const prepared = rawPrepared;
  if (prepared.includes('<ace-process>')) {
    return (
      <div className={className}>
        <WrapperProcessBlocks content={prepared} isStreaming={isStreaming} />
      </div>
    );
  }
  const finalReviewOutput = parseWorkflowFinalReviewOutput(prepared);
  if (finalReviewOutput) {
    return (
      <div className={className}>
        <WorkflowFinalReviewOutputCard review={finalReviewOutput} rawOutput={prepared} />
      </div>
    );
  }
  return (
    <div className={className}>
      <Markdown>{prepared}</Markdown>
    </div>
  );
});

function ContextWorkspaceDialog(props: ContextWorkspaceDialogProps) {
  const [planningStep, setPlanningStep] = useState<'contexts' | 'plan'>('contexts');
  const [adversarialIntent, setAdversarialIntent] = useState<WorkflowAdversarialIntent | null>(
    resolveInitialAdversarialIntent(props.runReviewPlanning?.baselineIntent),
  );
  const [reviewPlan, setReviewPlan] = useState<RunReviewPlan | null>(null);
  const [reviewOverrides, setReviewOverrides] = useState<RunReviewOverride[]>([]);
  const [reviewPreflightPreview, setReviewPreflightPreview] = useState<Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null>(null);
  const [reviewPlanningBusy, setReviewPlanningBusy] = useState(false);
  const [reviewPlanningError, setReviewPlanningError] = useState('');
  const effectivePreflightPreview = reviewPreflightPreview || props.preflightPreview;
  const startupFlowEnabled = (!props.runReviewPlanning || planningStep === 'plan')
    && (effectivePreflightPreview?.commands?.length || 0) > 0;
  const [localGlobalDraft, setLocalGlobalDraft] = useState(props.globalDraft);
  const [localPhaseDrafts, setLocalPhaseDrafts] = useState<Record<string, string>>(props.phaseDrafts);
  const [localTaskInput, setLocalTaskInput] = useState<WorkflowTaskInput>(() => normalizeWorkflowTaskInput(props.taskInputDraft));
  const [localWorkingDirectory, setLocalWorkingDirectory] = useState(props.workingDirectoryDraft || '');
  const [expandedTarget, setExpandedTarget] = useState(() => (
    props.startContextTargets.find((name) => (props.phaseDrafts[name] || '').trim()) || ''
  ));
  const previewCommands = effectivePreflightPreview?.commands || [];
  const taskInputFields = props.taskInputFields?.length ? props.taskInputFields : DEFAULT_WORKFLOW_TASK_INPUT_FIELDS;
  const shortTaskInputFields = taskInputFields.filter((field) => field.type !== 'textarea');
  const longTaskInputFields = taskInputFields.filter((field) => field.type === 'textarea');
  // Rebuilt exactly as the projection aggregates them, so the plan-level list can
  // drop what the per-target cards already show without matching on substrings.
  const cardScopedReviewWarnings = new Set([
    ...(reviewPlan?.states || []).flatMap((state) => state.warnings.map((warning) => `${state.stateName}: ${warning}`)),
    ...(reviewPlan?.workflows || []).flatMap((workflow) => workflow.warnings.map((warning) => `${workflow.workflowName}: ${warning}`)),
  ]);

  useEffect(() => {
    setLocalGlobalDraft(props.globalDraft);
  }, [props.globalDraft]);

  useEffect(() => {
    setLocalPhaseDrafts(props.phaseDrafts);
    setExpandedTarget((current) => (
      current && props.startContextTargets.includes(current)
        ? current
        : props.startContextTargets.find((name) => (props.phaseDrafts[name] || '').trim()) || ''
    ));
  }, [props.phaseDrafts, props.startContextTargets]);

  useEffect(() => {
    setLocalTaskInput(normalizeWorkflowTaskInput(props.taskInputDraft));
  }, [props.taskInputDraft]);

  useEffect(() => {
    setLocalWorkingDirectory(props.workingDirectoryDraft || '');
  }, [props.workingDirectoryDraft]);

  useEffect(() => {
    setPlanningStep('contexts');
    setAdversarialIntent(resolveInitialAdversarialIntent(props.runReviewPlanning?.baselineIntent));
    setReviewPlan(null);
    setReviewOverrides([]);
    setReviewPreflightPreview(null);
    setReviewPlanningError('');
  }, [
    props.runReviewPlanning?.configFile,
    props.runReviewPlanning?.rehearsal,
    props.runReviewPlanning?.baselineIntent,
  ]);

  const updateTaskInputField = (fieldId: string, value: string) => {
    setLocalTaskInput((current) => setWorkflowTaskInputFieldValue(current, fieldId, value));
  };
  const missingRequiredTaskFields = props.taskInputEditable
    ? taskInputFields.filter((field) => field.required && !getWorkflowTaskInputFieldValue(localTaskInput, field.id).trim())
    : [];
  const taskInputInvalid = missingRequiredTaskFields.length > 0;

  const buildContexts = (): WorkflowStartContexts => ({
    globalContext: localGlobalDraft,
    phaseContexts: localPhaseDrafts,
    taskInput: props.taskInputEditable
      ? attachWorkflowTaskInputFieldLabels(localTaskInput, taskInputFields)
      : undefined,
    workingDirectory: localWorkingDirectory.trim() || undefined,
  });

  const reviewSelection = (): WorkflowStartReviewSelection | undefined => (
    reviewPlan && adversarialIntent
      ? { planId: reviewPlan.id, intent: adversarialIntent, overrides: reviewOverrides, plan: reviewPlan }
      : undefined
  );

  const createRunReviewPlan = async () => {
    if (!props.runReviewPlanning || !adversarialIntent) return;
    setReviewPlanningBusy(true);
    setReviewPlanningError('');
    try {
      const response = await workflowApi.createStartPlan({
        configFile: props.runReviewPlanning.configFile,
        intent: adversarialIntent,
        initialContexts: buildContexts(),
        rehearsal: props.runReviewPlanning.rehearsal,
      });
      setReviewPlan(response.plan);
      props.onReviewPlanIdChange?.(response.plan.id);
      setReviewOverrides([]);
      setReviewPreflightPreview((response.preflightPreview || null) as Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null);
      setPlanningStep('plan');
    } catch (error: any) {
      setReviewPlanningError(error?.message || '无法生成本次运行方案');
    } finally {
      setReviewPlanningBusy(false);
    }
  };

  const discardRunReviewPlan = async () => {
    const planId = reviewPlan?.id;
    setReviewPlan(null);
    setReviewOverrides([]);
    setReviewPreflightPreview(null);
    props.onReviewPlanIdChange?.(null);
    if (planId) await workflowApi.discardStartPlan(planId).catch(() => {});
  };

  const updateRunReviewOverrides = async (nextOverrides: RunReviewOverride[]) => {
    if (!reviewPlan || !props.runReviewPlanning || adversarialIntent !== 'on-demand') return;
    const previousOverrides = reviewOverrides;
    setReviewOverrides(nextOverrides);
    setReviewPlanningBusy(true);
    setReviewPlanningError('');
    try {
      const response = await workflowApi.updateStartPlan({
        planId: reviewPlan.id,
        initialContexts: buildContexts(),
        rehearsal: props.runReviewPlanning.rehearsal,
        overrides: nextOverrides,
      });
      setReviewPlan(response.plan);
      setReviewPreflightPreview((response.preflightPreview || null) as Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null);
    } catch (error: any) {
      setReviewOverrides(previousOverrides);
      setReviewPlanningError(error?.message || '无法更新本次运行方案');
    } finally {
      setReviewPlanningBusy(false);
    }
  };

  const updateStateOverride = (state: RunReviewPlan['states'][number], mode: 'standard' | 'adversarial' | null) => {
    const next = reviewOverrides.filter((item) => item.kind === 'lightweight'
      || item.configFile !== state.configFile
      || item.stateId !== state.stateId);
    if (mode !== null) next.push({ kind: 'state', configFile: state.configFile, stateId: state.stateId, mode });
    void updateRunReviewOverrides(next);
  };

  const updateLightweightOverride = (
    workflow: RunReviewPlan['workflows'][number],
    requiresAdversarial: boolean | null,
  ) => {
    const next = reviewOverrides.filter((item) => item.kind !== 'lightweight' || item.configFile !== workflow.configFile);
    if (requiresAdversarial !== null) next.push({ kind: 'lightweight', configFile: workflow.configFile, requiresAdversarial });
    void updateRunReviewOverrides(next);
  };

  const renderTaskInputField = (field: WorkflowTaskInputFieldDefinition) => {
    const value = getWorkflowTaskInputFieldValue(localTaskInput, field.id);
    const label = (
      <div className="flex min-h-5 items-center justify-between gap-2">
        <Label className="min-w-0 truncate text-xs text-muted-foreground">{field.label}</Label>
        <Badge variant="outline" className="shrink-0 text-[10px]">
          {field.required ? '必填' : '选填'}
        </Badge>
      </div>
    );
    return (
      <div key={`task-input-${field.id}`} className="space-y-1.5">
        {label}
        {field.type === 'textarea' ? (
          <Textarea
            value={value}
            onChange={(event) => updateTaskInputField(field.id, event.target.value)}
            placeholder={field.placeholder || `填写${field.label}`}
            rows={field.id === 'description' ? 4 : 2}
            className="min-h-[88px] resize-y text-sm leading-6"
            disabled={props.actionBusy}
          />
        ) : (
          <Input
            type={field.type === 'url' ? 'url' : 'text'}
            value={value}
            onChange={(event) => updateTaskInputField(field.id, event.target.value)}
            placeholder={field.placeholder || `填写${field.label}`}
            disabled={props.actionBusy}
          />
        )}
        {field.description ? (
          <div className="text-xs leading-5 text-muted-foreground">{field.description}</div>
        ) : null}
      </div>
    );
  };

  return (
    <div className="flex max-h-[88vh] w-[960px] max-w-full flex-col overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="shrink-0 border-b border-border px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <DialogTitle className="text-lg font-semibold">{props.title}</DialogTitle>
            <DialogDescription className="mt-1 max-w-[680px] text-sm leading-5 text-muted-foreground">{props.description}</DialogDescription>
          </div>
          <Badge variant="secondary" className="shrink-0">{props.modeLabel}</Badge>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-6">
        {planningStep === 'plan' && reviewPlan ? (
          <div className="space-y-4 py-5">
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-medium">确认本次运行方案</h3>
                  <p className="mt-1 text-xs text-muted-foreground">只影响这一次 run；原工作流 YAML 不变，也不会创建副本。</p>
                </div>
                <Badge variant={adversarialIntent === 'disabled' ? 'outline' : 'secondary'}>
                  {adversarialIntent === 'disabled' ? '全局：不开启对抗' : '全局：按需开启'}
                </Badge>
              </div>
            </div>

            {reviewPlan.evaluationError ? (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-amber-800 dark:text-amber-200">
                {reviewPlan.workflows.some((workflow) => workflow.manualSelectionRequired)
                  || reviewPlan.states.some((state) => state.manualSelectionRequired)
                  ? 'AI 本次未能完成按需评估。你仍可继续：请为下面所有标记“等待人工选择”的目标明确选择一次运行模式；全部选完后即可启动。'
                  : 'AI 本次未能完成按需评估，已采用你的手工选择；现在可以继续启动。'}
              </div>
            ) : null}

            {reviewPlan.workflows.filter((workflow) => workflow.baseKind === 'lightweight').map((workflow) => {
              const workflowOverride = reviewOverrides.find((item) => item.kind === 'lightweight' && item.configFile === workflow.configFile);
              const hasOverride = Boolean(workflowOverride);
              const selectedRequiresAdversarial = workflowOverride?.kind === 'lightweight'
                ? workflowOverride.requiresAdversarial
                : null;
              return (
                <div key={`workflow-review-${workflow.configFile}`} className={cn('rounded-lg border p-3', workflow.blocked && 'border-destructive/50 bg-destructive/5')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{workflow.workflowName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{workflow.configFile} · 原配置为轻量工作流</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {workflow.suggestion ? <Badge variant="outline">AI：{workflow.suggestion.requiresAdversarial ? '建议对抗' : '保持轻量'}</Badge> : null}
                      <Badge variant={workflow.effectiveKind === 'state-machine' ? 'destructive' : 'secondary'}>
                        本次：{workflow.effectiveKind === 'state-machine' ? '派生状态机' : '保持轻量'}
                      </Badge>
                      {workflow.locked ? <Badge variant="outline">已锁定</Badge> : null}
                      {workflow.manualSelectionRequired ? <Badge variant="destructive">等待人工选择</Badge> : null}
                    </div>
                  </div>
                  {workflow.suggestion?.rationale ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{workflow.suggestion.rationale}</p> : null}
                  {workflow.operations.length ? (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        本次派生快照将进行 {workflow.operations.length} 项协调（含 lightweight 派生后果）
                      </summary>
                      <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                        {workflow.operations.map((operation, index) => (
                          <li key={`${workflow.configFile}-op-${index}`} className="leading-5">
                            <span className="font-medium">{REVIEW_OPERATION_LABELS[operation.op] || operation.op}</span>
                            <span className="text-muted-foreground">{' · '}{operation.stepName}</span>
                            {operation.safe ? null : <Badge variant="outline" className="ml-1.5 text-[10px]">需确认</Badge>}
                            <span className="block text-muted-foreground">{operation.reason}</span>
                            {operation.after?.agent ? <span className="block text-muted-foreground">实际指派 Agent：{operation.after.agent}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {workflow.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-600 dark:text-amber-400">{warning}</p>)}
                  {adversarialIntent === 'on-demand' ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={hasOverride && selectedRequiresAdversarial === false}
                        variant={hasOverride && selectedRequiresAdversarial === false ? 'primary' : 'outline'}
                        className={hasOverride && selectedRequiresAdversarial === false ? 'ring-2 ring-primary/20' : undefined}
                        onClick={() => updateLightweightOverride(workflow, false)}
                        disabled={reviewPlanningBusy}
                      >
                        {hasOverride && selectedRequiresAdversarial === false ? <Check className="mr-1.5 h-4 w-4" /> : null}
                        本次保持轻量
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={hasOverride && selectedRequiresAdversarial === true}
                        variant={hasOverride && selectedRequiresAdversarial === true ? 'primary' : 'outline'}
                        className={hasOverride && selectedRequiresAdversarial === true ? 'ring-2 ring-primary/20' : undefined}
                        onClick={() => updateLightweightOverride(workflow, true)}
                        disabled={reviewPlanningBusy}
                      >
                        {hasOverride && selectedRequiresAdversarial === true ? <Check className="mr-1.5 h-4 w-4" /> : null}
                        本次派生对抗状态机
                      </Button>
                      {hasOverride && workflow.suggestion ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => updateLightweightOverride(workflow, null)} disabled={reviewPlanningBusy}>
                          <RotateCcw className="mr-1.5 h-4 w-4" />
                          恢复 AI 建议
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {reviewPlan.states.map((state) => {
              const stateOverride = reviewOverrides.find((item) => item.kind !== 'lightweight' && item.configFile === state.configFile && item.stateId === state.stateId);
              const hasOverride = Boolean(stateOverride);
              const selectedMode = stateOverride?.kind !== 'lightweight' ? stateOverride?.mode : null;
              return (
                <div key={`${state.configFile}:${state.stateId}`} className={cn('rounded-lg border p-3', state.blocked && 'border-destructive/50 bg-destructive/5')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">{state.stateName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{state.workflowName} · {state.configFile}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">基线：{state.baseMode === 'adversarial' ? '对抗' : '标准'}</Badge>
                      {adversarialIntent === 'on-demand' && state.suggestion ? <Badge variant="outline">AI：{state.suggestedMode === 'adversarial' ? '对抗' : '标准'}</Badge> : null}
                      {state.configLocked ? <Badge variant="outline">配置锁</Badge> : null}
                      <Badge variant={state.effectiveMode === 'adversarial' ? 'destructive' : 'secondary'}>本次：{state.effectiveMode === 'adversarial' ? '对抗' : '标准'}</Badge>
                      {state.locked ? <Badge variant="outline">已锁定</Badge> : null}
                      {state.manualSelectionRequired ? <Badge variant="destructive">等待人工选择</Badge> : null}
                    </div>
                  </div>
                  {state.suggestion?.rationale ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{state.suggestion.rationale}</p> : null}
                  {state.operations.length ? (
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                        本次快照将进行 {state.operations.length} 项安全协调
                      </summary>
                      <ul className="mt-2 space-y-1.5 border-l border-border pl-3">
                        {state.operations.map((operation, index) => (
                          <li key={`${state.stateId}-op-${index}`} className="leading-5">
                            <span className="font-medium">{REVIEW_OPERATION_LABELS[operation.op] || operation.op}</span>
                            <span className="text-muted-foreground">{' · '}{operation.stepName}</span>
                            {operation.safe ? null : <Badge variant="outline" className="ml-1.5 text-[10px]">需确认</Badge>}
                            <span className="block text-muted-foreground">{operation.reason}</span>
                            {operation.after?.agent ? <span className="block text-muted-foreground">实际指派 Agent：{operation.after.agent}</span> : null}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  {state.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-600 dark:text-amber-400">{warning}</p>)}
                  {adversarialIntent === 'on-demand' ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={hasOverride && selectedMode === 'standard'}
                        variant={hasOverride && selectedMode === 'standard' ? 'primary' : 'outline'}
                        className={hasOverride && selectedMode === 'standard' ? 'ring-2 ring-primary/20' : undefined}
                        onClick={() => updateStateOverride(state, 'standard')}
                        disabled={reviewPlanningBusy}
                      >
                        {hasOverride && selectedMode === 'standard' ? <Check className="mr-1.5 h-4 w-4" /> : null}
                        本次用标准
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={hasOverride && selectedMode === 'adversarial'}
                        variant={hasOverride && selectedMode === 'adversarial' ? 'primary' : 'outline'}
                        className={hasOverride && selectedMode === 'adversarial' ? 'ring-2 ring-primary/20' : undefined}
                        onClick={() => updateStateOverride(state, 'adversarial')}
                        disabled={reviewPlanningBusy}
                      >
                        {hasOverride && selectedMode === 'adversarial' ? <Check className="mr-1.5 h-4 w-4" /> : null}
                        本次用对抗
                      </Button>
                      {hasOverride && (state.configLocked || state.suggestion) ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => updateStateOverride(state, null)} disabled={reviewPlanningBusy}>
                          <RotateCcw className="mr-1.5 h-4 w-4" />
                          {state.configLocked ? '恢复配置锁定' : '恢复 AI 建议'}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}

            {/* Per-target warnings are aggregated into plan.warnings with a name
                prefix for callers without this UI. Showing them again here would
                duplicate every card, so only plan-level notices remain. */}
            {reviewPlan.warnings
              .filter((warning) => !cardScopedReviewWarnings.has(warning))
              .map((warning) => <div key={warning} className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{warning}</div>)}
            {reviewPlanningError ? <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{reviewPlanningError}</div> : null}
            {startupFlowEnabled ? (
              <section className="border-t border-border pt-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">启动前检查</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">每条命令按本次有效配置的工作目录执行；根/子工作流不同时会分别标注。</p>
                  </div>
                  <Badge variant="outline">{previewCommands.length} 条</Badge>
                </div>
                <div className="mt-3 space-y-2">
                  {previewCommands.map((item, index) => (
                    <div key={`effective-preflight-${index}-${item.command}`} className="flex items-start gap-3 rounded-md border bg-muted/20 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <code className="whitespace-pre-wrap break-all text-xs leading-5">{item.command}</code>
                        {item.configFile || item.cwd ? (
                          <div className="mt-1 break-all text-[11px] text-muted-foreground">{[item.configFile, item.cwd].filter(Boolean).join(' · ')}</div>
                        ) : null}
                      </div>
                      <Badge variant={item.origin === 'inferred' ? 'outline' : 'secondary'}>{item.origin === 'inferred' ? '推断' : '配置'}</Badge>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : (
          <>
        {props.taskInputEditable ? (
          <section className="grid gap-3 border-b border-border py-5 sm:grid-cols-[190px_minmax(0,1fr)]">
            <div>
              <Label className="text-sm font-medium">本次任务</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                每次启动单独填写，写入当前 run；默认均为选填。
              </p>
            </div>
            <div className="min-w-0 space-y-3">
              {shortTaskInputFields.length ? (
                <div className="grid gap-3 md:grid-cols-2">
                  {shortTaskInputFields.map(renderTaskInputField)}
                </div>
              ) : null}
              {longTaskInputFields.map(renderTaskInputField)}
              {taskInputInvalid ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs leading-5 text-destructive">
                  请补齐必填项：{missingRequiredTaskFields.map((field) => field.label).join('、')}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {/* The only required decision in this dialog — everything else is optional —
            so it sits up here rather than below the fold. It also gates the primary
            button, which used to look broken when the choice was off screen. */}
        {props.runReviewPlanning ? (
          <section className="grid gap-3 border-b border-border py-5 sm:grid-cols-[190px_minmax(0,1fr)]">
            <div>
              <Label className="text-sm font-medium">本次运行是否使用对抗流程？</Label>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {props.runReviewPlanning.baselineIntent
                  ? '已按工作流创建时的选择预选，可直接继续。'
                  : '已预选「不开启对抗」，按需要改。'}
                只影响本次运行，不写回原配置。
              </p>
            </div>
            <div className="min-w-0">
              <div className="grid gap-2 sm:grid-cols-2">
                <button type="button" aria-pressed={adversarialIntent === 'disabled'} onClick={() => setAdversarialIntent('disabled')} className={cn('rounded-lg border p-3 text-left transition-colors', adversarialIntent === 'disabled' ? 'border-primary bg-primary/5' : 'hover:border-primary/40 hover:bg-muted/40')}>
                  <div className="font-medium">不开启对抗</div>
                  <div className="mt-1 text-xs text-muted-foreground">零次 AI 评估；轻量保持原样，普通状态机全部使用标准模式。</div>
                </button>
                <button type="button" aria-pressed={adversarialIntent === 'on-demand'} onClick={() => setAdversarialIntent('on-demand')} className={cn('rounded-lg border p-3 text-left transition-colors', adversarialIntent === 'on-demand' ? 'border-primary bg-primary/5' : 'hover:border-primary/40 hover:bg-muted/40')}>
                  <div className="font-medium">按需开启</div>
                  <div className="mt-1 text-xs text-muted-foreground">一次整体规划；轻量任务必要时只为本次运行派生状态机。</div>
                </button>
              </div>
              {reviewPlanningError ? <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">{reviewPlanningError}</div> : null}
            </div>
          </section>
        ) : null}

        <section className="grid gap-3 border-b border-border py-5 sm:grid-cols-[190px_minmax(0,1fr)]">
          <div>
            <Label className="text-sm font-medium">{props.workingDirectoryEditable ? '本次运行工作目录' : '当前运行工作目录'}</Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {props.workingDirectoryEditable ? '不选择时使用工作流配置。' : '运行开始后不支持切换。'}
            </p>
          </div>
          <div className="min-w-0">
            {props.workingDirectoryEditable ? (
              <div className="space-y-2">
                <WorkspaceDirectoryPicker
                  workspaceRoot={props.projectRoot || localWorkingDirectory}
                  value={localWorkingDirectory}
                  onChange={setLocalWorkingDirectory}
                  disabled={props.actionBusy}
                  emptyDisplayValue="使用工作流默认"
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0 break-all">
                    {localWorkingDirectory ? '仅覆盖本次运行，不修改工作流配置。' : `默认：${props.projectRoot || '工作流配置目录'}`}
                  </span>
                  {localWorkingDirectory ? (
                    <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setLocalWorkingDirectory('')} disabled={props.actionBusy}>
                      使用工作流默认
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="break-all rounded-md border border-border bg-muted/20 px-3 py-2 text-sm">
                {localWorkingDirectory || props.projectRoot || '未设置'}
              </div>
            )}
          </div>
        </section>

        <section className="grid gap-3 border-b border-border py-5 sm:grid-cols-[170px_minmax(0,1fr)]">
          <div>
            <Label className="text-sm font-medium">全局上下文</Label>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">所有步骤共享。</p>
          </div>
          <Textarea
            value={localGlobalDraft}
            onChange={(event) => setLocalGlobalDraft(event.target.value)}
            placeholder="输入本次运行共享的背景、约束或交付要求"
            rows={4}
            className="min-h-[104px] resize-y text-sm leading-6"
          />
        </section>

        <section className="py-5">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium">{props.startContextScopeLabel}上下文</h3>
              <p className="mt-1 text-xs text-muted-foreground">内容只注入对应{props.startContextScopeLabel}。</p>
            </div>
            <Badge variant="outline">{props.startContextTargets.length} 项</Badge>
          </div>

          {props.startContextTargets.length ? (
            <div className="mt-3 overflow-hidden rounded-md border border-border">
              {props.startContextTargets.map((name, index) => {
                const value = localPhaseDrafts[name] || '';
                const filled = value.trim().length > 0;
                const open = expandedTarget === name;
                return (
                  <Collapsible key={`context-target-${name}`} open={open} onOpenChange={(nextOpen) => setExpandedTarget(nextOpen ? name : '')}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex min-h-11 w-full items-center gap-3 border-b border-border px-3 text-left last:border-b-0 hover:bg-muted/35"
                      >
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-[11px] font-medium text-muted-foreground">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
                        <span className={`text-xs ${filled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                          {filled ? '已填写' : '未填写'}
                        </span>
                        <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="border-b border-border bg-muted/15 px-3 pb-3 pt-2 last:border-b-0">
                      <Textarea
                        id={`context-target-input-${index}`}
                        value={value}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setLocalPhaseDrafts((current) => ({ ...current, [name]: nextValue }));
                        }}
                        placeholder={`输入仅对「${name}」生效的上下文`}
                        rows={4}
                        className="min-h-[96px] resize-y bg-background text-sm leading-6"
                      />
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              当前工作流没有可设置的{props.startContextScopeLabel}。
            </div>
          )}
        </section>

        {!props.runReviewPlanning && startupFlowEnabled ? (
          <section className="border-t border-border py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-medium">启动前检查</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">每条命令按有效配置的工作目录执行；根/子工作流不同时会分别标注。</p>
              </div>
              <Badge variant="outline">{previewCommands.length} 条</Badge>
            </div>
            <div className="mt-3 space-y-2">
              {previewCommands.map((item, index) => (
                <div key={`preflight-preview-${index}-${item.command}`} className="flex items-start gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <code className="whitespace-pre-wrap break-all text-xs leading-5">{item.command}</code>
                    {item.configFile || item.cwd ? (
                      <div className="mt-1 break-all text-[11px] text-muted-foreground">{[item.configFile, item.cwd].filter(Boolean).join(' · ')}</div>
                    ) : null}
                  </div>
                  <Badge variant={item.origin === 'inferred' ? 'outline' : 'secondary'} className="shrink-0">
                    {item.origin === 'inferred' ? '推断' : '配置'}
                  </Badge>
                </div>
              ))}
            </div>
          </section>
        ) : null}

          </>
        )}
      </div>

      <div className="shrink-0 border-t border-border bg-background px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs leading-5 text-muted-foreground sm:max-w-[55%]">{props.footerText}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              onClick={planningStep === 'plan'
                ? () => { void discardRunReviewPlan(); setPlanningStep('contexts'); }
                : () => { void discardRunReviewPlan(); props.onCancel(); }}
              disabled={props.actionBusy || reviewPlanningBusy}
            >
              {planningStep === 'plan' ? '返回修改' : '取消'}
            </Button>
            {props.runReviewPlanning && planningStep === 'contexts' ? (
              <>
                {!adversarialIntent ? (
                  <span className="self-center text-xs text-muted-foreground">请先选择本次是否使用对抗流程</span>
                ) : null}
                <Button onClick={() => void createRunReviewPlan()} disabled={props.actionDisabled || taskInputInvalid || !adversarialIntent || reviewPlanningBusy}>
                  {reviewPlanningBusy ? '正在生成本次方案...' : '下一步：确认本次运行方案'}
                </Button>
              </>
            ) : null}
            {startupFlowEnabled && props.onSkipPreflight && (!props.runReviewPlanning || planningStep === 'plan') ? (
              <Button
                variant="secondary"
                onClick={() => props.onSkipPreflight?.(buildContexts(), reviewSelection())}
                disabled={props.actionBusy || reviewPlanningBusy || taskInputInvalid || Boolean(reviewPlan?.blocked)}
              >
                跳过项目检查并启动
              </Button>
            ) : null}
            {(!props.runReviewPlanning || planningStep === 'plan') ? (
              <Button
                onClick={() => props.onConfirm(buildContexts(), reviewSelection())}
                disabled={props.actionDisabled || reviewPlanningBusy || taskInputInvalid || Boolean(reviewPlan?.blocked)}
              >
                {props.actionBusy ? props.actionBusyLabel : planningStep === 'plan' ? '确认方案并启动' : props.actionLabel}
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export type WorkbenchClientProps = {
  embeddedConfig?: string;
  embeddedSearch?: string;
  embeddedInDashboard?: boolean;
};

export default function WorkbenchPage({
  embeddedConfig,
  embeddedSearch,
  embeddedInDashboard = false,
}: WorkbenchClientProps = {}) {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const dockWorkspace = useDashboardDockWorkspace();
  const [embeddedSearchState, setEmbeddedSearchState] = useState(embeddedSearch ?? '');

  useEffect(() => {
    if (!embeddedInDashboard && embeddedSearch === undefined) return;
    setEmbeddedSearchState(embeddedSearch ?? '');
  }, [embeddedInDashboard, embeddedSearch]);

  const effectiveSearchParams = useMemo(
    () => new URLSearchParams(
      embeddedInDashboard || embeddedSearch !== undefined
        ? embeddedSearchState
        : searchParams.toString(),
    ),
    [embeddedInDashboard, embeddedSearch, embeddedSearchState, searchParams]
  );
  const configFile = decodeURIComponent(embeddedConfig ?? (params.config as string));

  // 格式化状态名称
  const formatStateName = (name: string) => {
    if (name === '__origin__') return '开始';
    if (name === '__human_approval__') return '人工审查';
    return name;
  };

  const initialMode = normalizeViewMode(effectiveSearchParams.get('mode'));
  const initialRunId = effectiveSearchParams.get('run') || effectiveSearchParams.get('runId');
  const initialHistoryRun = effectiveSearchParams.get('history') === '1';
  const initialWorkbenchSection = effectiveSearchParams.get('section');
  const focusTarget = effectiveSearchParams.get('focus');
  const focusQuestionId = effectiveSearchParams.get('questionId');
  const searchParamsString = effectiveSearchParams.toString();
  const { resolvedTheme } = useTheme();
  const latestSearchParamsRef = useRef(searchParamsString);

  useEffect(() => {
    latestSearchParamsRef.current = searchParamsString;
  }, [searchParamsString]);

  // Update URL query params without full navigation
  const updateUrl = useCallback(async (updates: Record<string, string | null>): Promise<void> => {
    const currentSearchParams = latestSearchParamsRef.current;
    const sp = new URLSearchParams(currentSearchParams);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) sp.delete(key);
      else sp.set(key, val);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'run') && updates.run !== null) {
      sp.delete('runId');
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'runId') && updates.runId !== null) {
      sp.delete('run');
    }
    const qs = sp.toString();
    if (qs === currentSearchParams) {
      return;
    }
    if (embeddedInDashboard) {
      latestSearchParamsRef.current = qs;
      if (typeof window !== 'undefined') {
        const outerParams = new URLSearchParams(window.location.search);
        const currentRoute = outerParams.get('route') || '';
        const currentWorkbenchPrefix = `/workbench/${encodeURIComponent(configFile)}`;
        if (!currentRoute.startsWith(currentWorkbenchPrefix)) {
          return;
        }
        setEmbeddedSearchState(qs);
        dockWorkspace?.updateActiveWorkbenchSearch?.(configFile, qs);
        outerParams.delete('panel');
        outerParams.delete('reload');
        WORKBENCH_OUTER_QUERY_KEYS.forEach((key) => outerParams.delete(key));
        outerParams.set('route', `/workbench/${encodeURIComponent(configFile)}${qs ? `?${qs}` : ''}`);
        const nextOuterUrl = `${window.location.pathname}${outerParams.toString() ? `?${outerParams.toString()}` : ''}`;
        const currentOuterUrl = `${window.location.pathname}${window.location.search}`;
        if (nextOuterUrl !== currentOuterUrl) {
          try {
            await Promise.resolve(router.replace(nextOuterUrl, { scroll: false }));
          } catch {
            // Local UI state already reflects the requested section; a later route sync can retry.
          }
        }
      }
      setEmbeddedSearchState(qs);
      dockWorkspace?.updateActiveWorkbenchSearch?.(configFile, qs);
      return;
    }
    const currentUrl = `/workbench/${encodeURIComponent(configFile)}${currentSearchParams ? `?${currentSearchParams}` : ''}`;
    const nextUrl = `/workbench/${encodeURIComponent(configFile)}${qs ? `?${qs}` : ''}`;
    if (nextUrl === currentUrl) {
      return;
    }
    latestSearchParamsRef.current = qs;
    try {
      await Promise.resolve(router.replace(nextUrl, { scroll: false }));
    } catch {
      // Preserve the latest local intent; route effects will reconcile on the next update.
    }
  }, [dockWorkspace, embeddedInDashboard, searchParamsString, configFile, router]);

  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const queryClient = useQueryClient();
  const { state, dispatch, addLog } = useWorkflowState(initialMode);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyRuns, setHistoryRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const returnedRunIdRef = useRef<string | null>(null);
  const [historyRunAction, setHistoryRunAction] = useState<{ runId: string; action: 'view' | 'resume' | 'analyze' | 'delete' } | null>(null);
  const [focusedState, setFocusedState] = useState<string | null>(null); // 用于流程图视图跳转
  const [executionViewTabOverride, setExecutionViewTabOverride] = useState<string | null>(null);
  const [runtimeStateViewMode, setRuntimeStateViewMode] = useState<'structure' | 'diagram'>('structure');
  const [executionPolicyDialogOpen, setExecutionPolicyDialogOpen] = useState(false);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [viewingHistoryRun, setViewingHistoryRun] = useState(false);
  const [specCodingModalOpen, setSpecCodingModalOpen] = useState(false);
  const [specCodingModalFullscreen, setSpecCodingModalFullscreen] = useState(false);
  const [specCodingExplorerTab, setSpecCodingExplorerTab] = useState<'artifacts' | 'revisions'>('artifacts');
  const [specArtifactViewMode, setSpecArtifactViewMode] = useState<'preview' | 'edit' | 'diff'>('preview');
  const [specRevisionTarget, setSpecRevisionTarget] = useState<'requirements' | 'design' | 'tasks'>('design');
  const [specRevisionDraft, setSpecRevisionDraft] = useState('');
  const [specRevisionSummary, setSpecRevisionSummary] = useState('');
  const [specTaskFormatErrors, setSpecTaskFormatErrors] = useState<string[]>([]);
  const [specTaskValidationIssues, setSpecTaskValidationIssues] = useState<TasksMarkdownValidationIssue[]>([]);
  const [specTaskValidationDetails, setSpecTaskValidationDetails] = useState<string[]>([]);
  const [activeSpecTaskIssueKey, setActiveSpecTaskIssueKey] = useState<string | null>(null);
  const [savingSpecRevision, setSavingSpecRevision] = useState(false);
  const [specAiInstruction, setSpecAiInstruction] = useState('');
  const [specAiRevising, setSpecAiRevising] = useState(false);
  const [specAiStream, setSpecAiStream] = useState('');
  const [specAiMessages, setSpecAiMessages] = useState<SpecRevisionMessage[]>([]);
  const [specAiSessionId, setSpecAiSessionId] = useState<string | null>(null);
  const [specRevisionCandidate, setSpecRevisionCandidate] = useState<SpecRevisionCandidate | null>(null);
  const [specArtifactSnapshots, setSpecArtifactSnapshots] = useState<SpecArtifactSnapshot[]>([]);
  const [specRollbackTargetVersion, setSpecRollbackTargetVersion] = useState<string>('');
  const specTaskEditorRef = useRef<MonacoEditorInstance | null>(null);
  const specTaskMonacoRef = useRef<MonacoNamespace | null>(null);
  const specTaskDecorationIdsRef = useRef<string[]>([]);
  const [specBindingReview, setSpecBindingReview] = useState<{
    validation: StepTaskBindingValidation;
    suggestedConfig: any;
  } | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState('');
  const nameSaveInFlightRef = useRef(false);
  const [smStateHistory, setSmStateHistory] = useState<any[]>([]);
  const [runWorkbenchTab, setRunWorkbenchTab] = useState<RunWorkbenchTab>(() => {
    if (hasRunWorkbenchTabSearchParam(effectiveSearchParams)) return getRunWorkbenchTabFromSearchParams(effectiveSearchParams);
    return readWorkflowRunPanelTabs(configFile).center || 'overview';
  });
  const [documentSourceFilter, setDocumentSourceFilter] = useState<DocumentSourceFilter>(() => (
    getDocumentSourceFilterFromSearchParams(effectiveSearchParams)
  ));
  const [workspaceEditorPath, setWorkspaceEditorPath] = useState('');
  const [workspaceEditorTitle, setWorkspaceEditorTitle] = useState<string | undefined>(undefined);
  const [workspaceEditorFilePath, setWorkspaceEditorFilePath] = useState<string | null>(null);
  const [workspaceEditorLineNumber, setWorkspaceEditorLineNumber] = useState<number | null>(null);
  const [workspaceEditorColumn, setWorkspaceEditorColumn] = useState<number | null>(null);
  const [workspaceChangeCount, setWorkspaceChangeCount] = useState(0);
  const [runtimeGitBaselineEnabled, setRuntimeGitBaselineEnabled] = useState(true);
  const [smIssueTracker, setSmIssueTracker] = useState<any[]>([]);
  const [smTransitionCount, setSmTransitionCount] = useState(0);
  const [runStartTime, setRunStartTime] = useState<string | null>(null);
  const [runEndTime, setRunEndTime] = useState<string | null>(null);
  const [runClockNow, setRunClockNow] = useState(() => Date.now());
  const [runAccumulatedWaitMs, setRunAccumulatedWaitMs] = useState<number>(0);
  const [runWaitStartedAt, setRunWaitStartedAt] = useState<string | null>(null);
  const [humanApprovalData, setHumanApprovalData] = useState<{
    currentState: string;
    nextState: string;
    result: any;
    availableStates: string[];
    supervisorAdvice?: string;
  } | null>(null);
  const humanApprovalSignatureRef = useRef<string | null>(null);
  const [pendingHumanQuestion, setPendingHumanQuestion] = useState<HumanQuestion | null>(null);
  const [submittingHumanQuestion, setSubmittingHumanQuestion] = useState(false);
  const humanQuestionSignatureRef = useRef<string | null>(null);
  const appliedDbStateHistorySignatureRef = useRef<string | null>(null);
  const appliedDbStepLogSignatureRef = useRef<string | null>(null);
  const autoLoadedRunDetailKeyRef = useRef<string | null>(null);
  const [specRevisionVote, setSpecRevisionVote] = useState<WorkflowSpecRevisionVoteRecord | null>(null);
  const [specRevisionVoteHistory, setSpecRevisionVoteHistory] = useState<WorkflowSpecRevisionVoteRecord[]>([]);
  const pendingApprovalRedirectRef = useRef<string | null>(null);
  const [documentFocusRequest, setDocumentFocusRequest] = useState<{
    requestId: number;
    stepName: string;
    filename?: string;
  } | null>(null);
  const [liveStream, setLiveStream] = useState<string[]>([]);
  const [liveToolEvents, setLiveToolEvents] = useState<RuntimeToolEvent[]>([]);
  const [showLiveStream, setShowLiveStream] = useState(false);
  const [liveStreamFullscreen, setLiveStreamFullscreen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RunRightPanelTab>(() => readWorkflowRunPanelTabs(configFile).right || 'detail');
  const [leftRunPanelTab, setLeftRunPanelTab] = useState<RunLeftPanelTab>(() => readWorkflowRunPanelTabs(configFile).left || 'directory');
  const [runInspectorPanelOpen, setRunInspectorPanelOpen] = useState(false);
  const [runTimelineMode, setRunTimelineMode] = useState<'steps' | 'states'>('steps');
  const [overviewStepRecord, setOverviewStepRecord] = useState<any | null>(null);
  const [overviewStepExternalOutput, setOverviewStepExternalOutput] = useState('');
  const [overviewStepExternalOutputLoading, setOverviewStepExternalOutputLoading] = useState(false);
  const [designAssistantPanelOpen, setDesignAssistantPanelOpen] = useState(false);
  const [workbenchNavSection, setWorkbenchNavSection] = useState<'design' | 'preview' | 'runs'>(() => (
    initialWorkbenchSection?.startsWith('preview') ? 'preview' : initialMode === 'design' ? 'design' : 'runs'
  ));
  const [savedWorkflowRevision, setSavedWorkflowRevision] = useState(0);
  const [runRecordDrilled, setRunRecordDrilled] = useState(false);
  const [runDetailSection, setRunDetailSection] = useState<RunDetailSection>(() => (
    initialWorkbenchSection === 'preview-state'
      ? 'state'
      : initialWorkbenchSection === 'preview-agents'
        ? 'agents'
      : initialWorkbenchSection === 'preview-workspace'
        ? 'workspace'
        : initialWorkbenchSection === 'preview-spec'
          ? 'spec'
          : runWorkbenchTabToDetailSection(getRunWorkbenchTabFromSearchParams(effectiveSearchParams), true)
  ));
  const [runDetailNavigationPending, setRunDetailNavigationPending] = useState<RunDetailSection | null>(null);
  const runDetailNavigationTokenRef = useRef(0);
  const runDetailNavigationPendingRef = useRef<RunDetailSection | null>(null);
  const runStatusReasonLogRef = useRef<string | null>(null);
  const [workflowRunWindowVisibility, setWorkflowRunWindowVisibility] = useState<Partial<Record<WorkflowRunWindowId, boolean>>>({
    left: true,
    center: true,
    right: true,
  });
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<ManagedMcpServer[]>([]);
  const [availableKnowledgeBases, setAvailableKnowledgeBases] = useState<{ id: string; name: string; description?: string; chunkCount?: number }[]>([]);
  const [startRequesting, setStartRequesting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stopProgressDialogOpen, setStopProgressDialogOpen] = useState(false);
  const [stopProgressSummary, setStopProgressSummary] = useState('');
  const [stopProgressSteps, setStopProgressSteps] = useState<WorkbenchStopProgressStep[]>([]);
  const [forceTransitioning, setForceTransitioning] = useState(false);
  const [forceCompleting, setForceCompleting] = useState(false);
  const [rehearsalMode, setRehearsalMode] = useState(false);
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const runtimeSelectionQuery = useRuntimeEngineSelectionQuery();
  const [workflowDefaultModel, setWorkflowDefaultModel] = useState('');
  const [workflowAutoCompactOnStepChange, setWorkflowAutoCompactOnStepChange] = useState(false);
  const [workflowSupervisorEnabled, setWorkflowSupervisorEnabled] = useState(false);
  const [workflowAgentOverrides, setWorkflowAgentOverrides] = useState<Record<string, WorkflowAgentExecutionOverride>>({});
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [showRuntimeAgentCreator, setShowRuntimeAgentCreator] = useState(false);
  const [runtimeAgentDraft, setRuntimeAgentDraft] = useState<AgentDraftState>(createInitialAgentDraft());
  const [showDesignRequirements, setShowDesignRequirements] = useState(true);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [supervisorFlow, setSupervisorFlow] = useState<{
    type: string;
    from: string;
    to: string;
    question?: string;
    method?: string;
    round: number;
    timestamp: string;
    stateName?: string;
  }[]>([]);

  const openWorkspaceEditorAtPath = useCallback((path: string, title?: string, filePath?: string | null, lineNumber?: number | null, column?: number | null) => {
    if (!path) return;
    const relativeFilePath = toRelativeWorkspaceFilePath(path, filePath);
    setWorkspaceEditorPath(path);
    setWorkspaceEditorTitle(title);
    setWorkspaceEditorFilePath(filePath || null);
    setWorkspaceEditorLineNumber(lineNumber || null);
    setWorkspaceEditorColumn(column || null);
    setWorkbenchNavSection('runs');
    setRunRecordDrilled(true);
    setRunDetailSection('workspace');
    setRunWorkbenchTab('workspace');
    updateUrl({
      mode: 'run',
      section: null,
      tab: 'workspace',
      workspace: '1',
      workspaceRoot: path,
      changes: null,
      workspaceFile: relativeFilePath,
      workspaceLine: lineNumber && lineNumber > 0 ? String(lineNumber) : null,
      workspaceColumn: column && column > 0 ? String(column) : null,
    });
  }, [updateUrl]);

  const handleWorkspaceEditorFileLocationChange = useCallback((filePath: string | null, lineNumber?: number | null, column?: number | null) => {
    setWorkspaceEditorFilePath(filePath || null);
    setWorkspaceEditorLineNumber(lineNumber && lineNumber > 0 ? lineNumber : null);
    setWorkspaceEditorColumn(column && column > 0 ? column : null);
    setWorkbenchNavSection('runs');
    setRunRecordDrilled(true);
    setRunDetailSection('workspace');
    setRunWorkbenchTab('workspace');
    updateUrl({
      mode: 'run',
      section: null,
      tab: 'workspace',
      workspace: filePath ? '1' : null,
      workspaceRoot: workspaceEditorPath || null,
      changes: null,
      workspaceFile: filePath,
      workspaceLine: lineNumber && lineNumber > 0 ? String(lineNumber) : null,
      workspaceColumn: column && column > 0 ? String(column) : null,
    });
  }, [updateUrl, workspaceEditorPath]);

  const handlePreviewWorkspaceEditorFileLocationChange = useCallback((filePath: string | null, lineNumber?: number | null, column?: number | null) => {
    updateUrl({
      mode: 'run',
      designTab: null,
      section: 'preview-workspace',
      tab: filePath ? 'workspace' : null,
      workspace: filePath ? '1' : null,
      changes: null,
      workspaceFile: filePath,
      workspaceLine: lineNumber && lineNumber > 0 ? String(lineNumber) : null,
      workspaceColumn: column && column > 0 ? String(column) : null,
    });
  }, [updateUrl]);
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
  const [activeSteps, setActiveSteps] = useState<string[]>([]);
  const [activeConcurrencyGroups, setActiveConcurrencyGroups] = useState<Array<{
    id: string;
    stateName: string;
    steps: string[];
    joinPolicy?: any;
    status: 'running' | 'completed' | 'failed';
  }>>([]);
  const [subworkflowRuns, setSubworkflowRuns] = useState<any[]>([]);
  const [subworkflowSummary, setSubworkflowSummary] = useState<any>(null);
  const [activeSubworkflowRunId, setActiveSubworkflowRunId] = useState<string | null>(null);
  const [selectedSubworkflowRun, setSelectedSubworkflowRun] = useState<any | null>(null);
  const [subworkflowDrilldownStack, setSubworkflowDrilldownStack] = useState<any[]>([]);
  const [subworkflowDrilldownLoading, setSubworkflowDrilldownLoading] = useState(false);
  const [mainExecutionActiveTab, setMainExecutionActiveTab] = useState('overview');
  const [subworkflowExecutionTabs, setSubworkflowExecutionTabs] = useState<Record<string, string>>({});
  const subworkflowDrilldownCacheRef = useRef(new Map<string, any>());
  const subworkflowDrilldownPreloadRef = useRef(new Set<string>());
  const makeSubworkflowPreviewStatus = useCallback(() => ({
    status: 'idle',
    runId: null,
    currentPhase: null,
    currentStep: null,
    activeSteps: [],
    activeConcurrencyGroups: [],
    completedSteps: [],
    failedSteps: [],
    stateHistory: [],
    issueTracker: [],
    transitionCount: 0,
    subworkflowRuns: [],
    subworkflowSummary: null,
  }), []);
  const getSubworkflowCacheKey = useCallback((configFile: string, runId?: string | null) => {
    return `${String(configFile || '').trim()}::${String(runId || '')}`;
  }, []);
  const getSubworkflowConfigFileFromStep = useCallback((step: any): string => {
    const candidates = [
      step?.workflow,
      step?.workflowConfig,
      step?.configFile,
      step?.subworkflow,
      step?.subworkflow?.configFile,
      step?.subworkflow?.workflow,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
      if (candidate && typeof candidate === 'object' && typeof candidate.configFile === 'string' && candidate.configFile.trim()) {
        return candidate.configFile.trim();
      }
    }
    return '';
  }, []);
  const openSubworkflowConfigPreview = useCallback(async (step: any) => {
    const configFile = getSubworkflowConfigFileFromStep(step);
    if (!configFile) {
      toast('warning', '这个子工作流步骤没有配置 workflow 文件');
      return;
    }
    const cacheKey = getSubworkflowCacheKey(configFile);
    const cached = subworkflowDrilldownCacheRef.current.get(cacheKey);
    if (cached) {
      setSubworkflowDrilldownStack((prev) => [...prev, cached]);
      return;
    }
    setSubworkflowDrilldownLoading(true);
    try {
      const configResponse = await configApi.getConfig(configFile);
      const entry = {
          child: {
            configFile,
            runId: '',
            parentStateName: '',
            parentStepName: step?.name || '',
            status: 'draft',
          },
          configFile,
          runId: '',
          config: configResponse.config,
          agents: configResponse.agents || [],
          status: makeSubworkflowPreviewStatus(),
          previewOnly: true,
        };
      subworkflowDrilldownCacheRef.current.set(cacheKey, entry);
      setSubworkflowDrilldownStack((prev) => [...prev, entry]);
    } catch (error: any) {
      toast('error', error?.message || '打开子工作流配置失败');
    } finally {
      setSubworkflowDrilldownLoading(false);
    }
  }, [getSubworkflowCacheKey, getSubworkflowConfigFileFromStep, makeSubworkflowPreviewStatus, toast]);
  const openSubworkflowRun = useCallback(async (child: any) => {
    if (!child?.configFile || !child?.runId) return;
    const cacheKey = getSubworkflowCacheKey(child.configFile, child.runId);
    const cached = subworkflowDrilldownCacheRef.current.get(cacheKey);
    if (cached) {
      setSubworkflowDrilldownStack((prev) => {
        const existingIndex = prev.findIndex((entry) => entry.runId === child.runId);
        if (existingIndex >= 0) return [...prev.slice(0, existingIndex), cached];
        return [...prev, cached];
      });
      setSelectedSubworkflowRun(null);
      return;
    }
    const previewCached = subworkflowDrilldownCacheRef.current.get(getSubworkflowCacheKey(child.configFile));
    if (previewCached) {
      setSubworkflowDrilldownStack((prev) => [...prev, {
        ...previewCached,
        child,
        runId: child.runId,
        previewOnly: true,
      }]);
    } else {
      setSubworkflowDrilldownLoading(true);
    }
    try {
      const parentRunId = String(child.parentRunId || '').trim();
      const [configResponse, status] = await Promise.all([
        configApi.getConfig(child.configFile),
        queryClient.fetchQuery({
          queryKey: queryKeys.workflowChildStatusCompact(configFile, parentRunId, child.configFile, child.runId),
          queryFn: () => fetchWorkflowStatusCompact(child.configFile, child.runId),
          staleTime: 1_000,
        }),
      ]);
      queryClient.setQueryData(queryKeys.workflowStatusCompact(child.configFile, child.runId), status);
      setSubworkflowDrilldownStack((prev) => {
        const nextEntry = {
          child,
          configFile: child.configFile,
          runId: child.runId,
          config: configResponse.config,
          agents: configResponse.agents || [],
          status,
        };
        subworkflowDrilldownCacheRef.current.set(cacheKey, nextEntry);
        const existingIndex = prev.findIndex((entry) => entry.runId === child.runId);
        if (existingIndex >= 0) {
          return [...prev.slice(0, existingIndex), nextEntry, ...prev.slice(existingIndex + 1)];
        }
        return [...prev, nextEntry];
      });
      setSelectedSubworkflowRun(null);
    } catch (error: any) {
      toast('error', error?.message || '打开子工作流运行视图失败');
    } finally {
      setSubworkflowDrilldownLoading(false);
    }
  }, [configFile, getSubworkflowCacheKey, queryClient, toast]);
  const openSubworkflowRunPage = useCallback((child: any) => {
    if (!child?.configFile || !child?.runId) return;
    const route = `/workbench/${encodeURIComponent(child.configFile)}?mode=run&runId=${encodeURIComponent(child.runId)}&history=1`;
    if (embeddedInDashboard && dockWorkspace) {
      dockWorkspace.openTab({
        id: `workbench:${child.configFile}:run:${child.runId}`,
        title: child.configFile,
        kind: 'workbench',
        config: child.configFile,
        mode: 'run',
        runId: child.runId,
        search: `mode=run&runId=${encodeURIComponent(child.runId)}&history=1`,
      });
      return;
    }
    if (typeof window !== 'undefined') {
      window.open(route, '_blank', 'noopener,noreferrer');
    } else {
      router.push(route);
    }
  }, [dockWorkspace, embeddedInDashboard, router]);

  const openRunHistoryPage = useCallback(() => {
    const search = `configFile=${encodeURIComponent(configFile)}`;
    if (embeddedInDashboard && dockWorkspace) {
      dockWorkspace.openTab({
        id: 'run-history',
        title: '运行记录',
        kind: 'run-history',
        search,
      });
      return;
    }
    router.push(`/run-history?${search}`);
  }, [configFile, dockWorkspace, embeddedInDashboard, router]);

  const [persistedStepLogs, setPersistedStepLogs] = useState<Array<{
    id: string;
    stepName: string;
    agent: string;
    status: 'running' | 'completed' | 'failed';
    superseded?: boolean;
    supersededAt?: string;
    supersededByStep?: string;
    output: string;
    error: string;
    costUsd: number;
    durationMs: number;
    timestamp: string;
    tokenUsage?: {
      inputTokens: number;
      outputTokens: number;
      cacheCreationInputTokens?: number;
      cacheReadInputTokens?: number;
    };
  }>>([]);
  const [runStatusReason, setRunStatusReason] = useState<string | null>(null);
  const [creationSessionSummary, setCreationSessionSummary] = useState<{
    id: string;
    workflowName: string;
    filename: string;
    status: string;
    updatedAt: number;
    artifactSnapshots?: SpecArtifactSnapshot[];
  } | null>(null);
  const [creationDrafts, setCreationDrafts] = useState<any[]>([]);
  const [creationDraftsLoading, setCreationDraftsLoading] = useState(false);
  const [creationDraftModalOpen, setCreationDraftModalOpen] = useState(false);
  const [resumeCreationDraftId, setResumeCreationDraftId] = useState<string | null>(null);
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
  const [startupProgressMode, setStartupProgressMode] = useState<'rehearsal' | 'real'>('rehearsal');
  const [rehearsalProgressDialogOpen, setRehearsalProgressDialogOpen] = useState(false);
  const [rehearsalProgressSteps, setRehearsalProgressSteps] = useState<string[]>([]);
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
    artifactSnapshots?: SpecArtifactSnapshot[];
    artifacts?: {
      requirements?: string;
      design?: string;
      tasks?: string;
    };
  } | null>(null);
  const [specCodingSourceOfTruth, setSpecCodingSourceOfTruth] = useState<{
    mode: 'state-machine' | 'unknown';
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
  const liveStreamFeedbackRef = useRef<HTMLTextAreaElement>(null);
  const liveFeedbackEditorRef = useRef<RichTextEditorHandle>(null);
  const [liveFeedbackDraft, setLiveFeedbackDraft] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  type LiveFeedbackStatus = 'sending' | 'queued' | 'interrupting' | 'delivered' | 'failed';
  type InlineFeedback = {
    id: string;
    message: string;
    timestamp: string;
    streamIndex: number;
    mode: 'feedback' | 'interrupt';
    status: LiveFeedbackStatus;
    automatic?: boolean;
    error?: string;
  };
  const [inlineFeedbacks, setInlineFeedbacks] = useState<InlineFeedback[]>([]);
  const pendingLiveFeedbackRef = useRef<InlineFeedback[]>([]);
  const [liveStreamStepSelection, setLiveStreamStepSelection] = useState('');
  const [liveStreamSourceSelection, setLiveStreamSourceSelection] = useState('');
  const lastLiveStreamSelectedStepNameRef = useRef<string | null>(null);
  const [liveStreamSource, setLiveStreamSource] = useState<{ stateName: string | null; stepName: string | null }>({
    stateName: null,
    stepName: null,
  });
  const upsertInlineFeedback = useCallback((incoming: InlineFeedback) => {
    if (incoming.status === 'queued' || incoming.status === 'interrupting' || incoming.status === 'sending') {
      const index = pendingLiveFeedbackRef.current.findIndex((item) => item.id === incoming.id);
      if (index >= 0) {
        pendingLiveFeedbackRef.current = pendingLiveFeedbackRef.current.map((item, itemIndex) =>
          itemIndex === index ? { ...item, ...incoming } : item
        );
      } else {
        pendingLiveFeedbackRef.current = [...pendingLiveFeedbackRef.current, incoming];
      }
    } else {
      pendingLiveFeedbackRef.current = pendingLiveFeedbackRef.current.filter((item) => item.id !== incoming.id);
    }
    setInlineFeedbacks((prev) => {
      const idIndex = incoming.id ? prev.findIndex((item) => item.id === incoming.id) : -1;
      const recentMessageIndex = idIndex === -1
        ? prev.findIndex((item) =>
            item.message.trim() === incoming.message.trim()
            && Math.abs(new Date(item.timestamp).getTime() - new Date(incoming.timestamp).getTime()) < 10_000
          )
        : -1;
      const index = idIndex >= 0 ? idIndex : recentMessageIndex;
      if (index === -1) return [...prev, incoming];
      const next = [...prev];
      const current = next[index];
      next[index] = {
        ...current,
        ...incoming,
        id: current.id || incoming.id,
        timestamp: current.timestamp || incoming.timestamp,
        streamIndex: Math.min(current.streamIndex, incoming.streamIndex),
        mode: incoming.mode === 'interrupt' || current.mode === 'interrupt' ? 'interrupt' : 'feedback',
        status: current.status === 'delivered' && incoming.status !== 'failed' ? current.status : incoming.status,
        error: incoming.error,
      };
      return next;
    });
  }, []);
  const markInlineFeedbacksDelivered = useCallback((payload: any) => {
    const messages = Array.isArray(payload?.messages) && payload.messages.length > 0
      ? payload.messages
      : [{ id: payload?.id, message: payload?.message }];
    const ids = new Set<string>([
      ...(Array.isArray(payload?.ids) ? payload.ids : []),
      ...messages.map((item: any) => item?.id).filter(Boolean),
    ]);
    const messageSet = new Set<string>();
    for (const item of messages) {
      const raw = String(item?.message || '').trim();
      if (!raw) continue;
      messageSet.add(raw);
      for (const part of raw.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)) {
        messageSet.add(part);
      }
      for (const line of raw.split('\n')) {
        const numbered = line.trim().match(/^\d+\.\s+(.+)$/);
        if (numbered?.[1]) messageSet.add(numbered[1].trim());
      }
    }
    const deliveredIds = new Set(ids);
    const deliveredMessages = new Set(messageSet);
    pendingLiveFeedbackRef.current = pendingLiveFeedbackRef.current.filter((item) =>
      !(deliveredIds.has(item.id) || deliveredMessages.has(item.message.trim()))
    );
    setInlineFeedbacks((prev) => {
      const matchedMessageSet = new Set<string>();
      const next = prev.map((item) => {
        if ((item.id && ids.has(item.id)) || messageSet.has(item.message.trim())) {
          matchedMessageSet.add(item.message.trim());
          if (item.id) ids.delete(item.id);
          messageSet.delete(item.message.trim());
          for (const line of item.message.split('\n')) {
            const numbered = line.trim().match(/^\d+\.\s+(.+)$/);
            if (numbered?.[1]) messageSet.delete(numbered[1].trim());
          }
          return {
            ...item,
            status: 'delivered' as LiveFeedbackStatus,
            mode: payload?.interrupt ? 'interrupt' : item.mode,
            timestamp: item.timestamp || payload?.timestamp || new Date().toISOString(),
          };
        }
        return item;
      });
      const additions: InlineFeedback[] = [];
      const baseStreamIndex = next.reduce((max, item) => Math.max(max, item.streamIndex), 0);
      for (const item of messages) {
        const message = String(item?.message || '').trim();
        if (!message || matchedMessageSet.has(message)) continue;
        const id = String(item?.id || payload?.id || '');
        if (id && next.some((feedback) => feedback.id === id)) continue;
        additions.push({
          id: id || `delivered-feedback-${payload?.timestamp || Date.now()}-${additions.length}`,
          message,
          timestamp: item?.timestamp || payload?.timestamp || new Date().toISOString(),
          streamIndex: baseStreamIndex + additions.length + 1,
          mode: payload?.interrupt || item?.interrupt ? 'interrupt' : 'feedback',
          status: 'delivered',
          automatic: payload?.automatic || item?.automatic,
        });
      }
      return additions.length ? [...next, ...additions] : next;
    });
  }, []);
  const [showContextEditor, setShowContextEditor] = useState(false);
  const [contextEditorGlobalDraft, setContextEditorGlobalDraft] = useState('');
  const [contextEditorPhaseDrafts, setContextEditorPhaseDrafts] = useState<Record<string, string>>({});
  const [savingContextEditor, setSavingContextEditor] = useState(false);
  const [showPromptAnalysis, setShowPromptAnalysis] = useState(false);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<any | null>(null);
  const [selectedOptimizations, setSelectedOptimizations] = useState<Set<number>>(new Set());
  const [applyingOptimization, setApplyingOptimization] = useState(false);
  const [showStartWorkflowDialog, setShowStartWorkflowDialog] = useState(false);
  const [pendingStartRequest, setPendingStartRequest] = useState<WorkflowStartRequest | null>(null);
  const [pendingStartReviewPlanId, setPendingStartReviewPlanId] = useState<string | null>(null);
  const autoStartHandledRef = useRef(false);
  const [startGlobalContextDraft, setStartGlobalContextDraft] = useState('');
  const [startPhaseContextDrafts, setStartPhaseContextDrafts] = useState<Record<string, string>>({});
  const [startTaskInputDraft, setStartTaskInputDraft] = useState<WorkflowTaskInput>({});
  const [startWorkingDirectoryDraft, setStartWorkingDirectoryDraft] = useState('');
  const [startupCancelRequested, setStartupCancelRequested] = useState(false);
  const startupCancelRequestedRef = useRef(false);
  const startupCreatedRunIdRef = useRef<string | null>(null);
  const startupExpectedRunIdRef = useRef<string | null>(null);
  const startupInProgressRef = useRef(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  type DesignTab = 'orchestration' | 'spec' | 'config';
  const normalizeDesignTab = (value: string | null): DesignTab => (
    value === 'orchestration' || value === 'spec' || value === 'config'
      ? value
      : 'orchestration'
  );
  const [designTab, setDesignTab] = useState<DesignTab>(() => normalizeDesignTab(effectiveSearchParams.get('designTab')));
  const [preflightManagerOpen, setPreflightManagerOpen] = useState(false);
  const [designOptimizationDialogOpen, setDesignOptimizationDialogOpen] = useState(false);
  const [designOptimizationTarget, setDesignOptimizationTarget] = useState<DesignOptimizationTarget | null>(null);
  const [designOptimizationInstruction, setDesignOptimizationInstruction] = useState('');
  const [designOptimizationGenerating, setDesignOptimizationGenerating] = useState(false);
  const [designOptimizationStream, setDesignOptimizationStream] = useState('');
  const [designOptimizationCandidate, setDesignOptimizationCandidate] = useState<DesignOptimizationCandidate | null>(null);
  const [designOptimizationMessages, setDesignOptimizationMessages] = useState<DesignOptimizationMessage[]>([]);
  const [designOptimizationSessionId, setDesignOptimizationSessionId] = useState<string | null>(null);

  const refreshDesignPickerOptions = useCallback(async () => {
    try {
      const { agents: loadedAgents } = await agentApi.listAgents();
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: loadedAgents || [] });
    } catch {
      /* ignore */
    }
    try {
      const skillsRes = await fetch('/api/skills');
      const skillsData = await skillsRes.json();
      setAvailableSkills(skillsData.skills?.map((s: any) => ({ name: s.name, description: s.description })) || []);
    } catch {
      /* ignore */
    }
    try {
      const mcpRes = await fetch('/api/mcp');
      const mcpData = await mcpRes.json();
      setAvailableMcpServers(Array.isArray(mcpData.servers) ? mcpData.servers : []);
    } catch {
      /* ignore */
    }
    try {
      const ragRes = await fetch('/api/rag/knowledge-bases', { headers: getAuthHeaders() });
      const ragData = await ragRes.json();
      setAvailableKnowledgeBases(Array.isArray(ragData.knowledgeBases)
        ? ragData.knowledgeBases.map((kb: any) => ({ id: kb.id, name: kb.name || kb.id, description: kb.description || '', chunkCount: kb.chunkCount || 0 }))
        : []);
    } catch {
      /* ignore */
    }
  }, [dispatch]);

  const handleDesignTabChange = useCallback((tab: DesignTab) => {
    setDesignTab(tab);
    updateUrl({ designTab: tab });
  }, [updateUrl]);

  useEffect(() => {
    const nextTab = normalizeDesignTab(effectiveSearchParams.get('designTab'));
    setDesignTab((current) => current === nextTab ? current : nextTab);
  }, [effectiveSearchParams, searchParamsString]);
  const [specCodingArtifactTab, setSpecCodingArtifactTab] = useState<SpecCodingArtifactKey>('requirements');
  const [forceTransitionModal, setForceTransitionModal] = useState<{ targetState: string; instruction: string } | null>(null);
  const [specCodingSaveDialogOpen, setSpecCodingSaveDialogOpen] = useState(false);
  const [specCodingSaveScope, setSpecCodingSaveScope] = useState<NotebookScope>('personal');
  const [specCodingSaveDirectory, setSpecCodingSaveDirectory] = useState('');
  const [savingSpecCodingArtifact, setSavingSpecCodingArtifact] = useState(false);
  const [persistMode, setPersistMode] = useState<'none' | 'repository' | undefined>(undefined);
  const [deltaSpecMerged, setDeltaSpecMerged] = useState(false);
  const [deltaMergeState, setDeltaMergeState] = useState<DeltaMergeState | undefined>(undefined);
  const [masterSpecPath, setMasterSpecPath] = useState<string | undefined>(undefined);
  const [specMergeDialogOpen, setSpecMergeDialogOpen] = useState(false);
  const [specMergePreview, setSpecMergePreview] = useState<SpecMergePreview | null>(null);
  const [specMergeLoading, setSpecMergeLoading] = useState(false);
  const [specMergeApplying, setSpecMergeApplying] = useState(false);
  const [specMergeError, setSpecMergeError] = useState<string | null>(null);
  const [specImporting, setSpecImporting] = useState(false);
  const liveStreamRef = useRef<EventSource | ReturnType<typeof setInterval> | null>(null);
  const liveStreamRunRef = useRef<string>('');
  const liveStreamLenRef = useRef(0);
  const liveStreamRawRef = useRef('');
  const liveStreamStepRef = useRef<string>('');
  const runtimeEventSeqRef = useRef(0);
  const liveStreamScrollRef = useRef<HTMLDivElement | null>(null);
  const LIVE_STREAM_PAGE_SIZE = 30;
  const [liveStreamVisibleCount, setLiveStreamVisibleCount] = useState(LIVE_STREAM_PAGE_SIZE);
  const liveStreamUserScrolledUp = useRef(false);
  const [liveStreamScrollLocked, setLiveStreamScrollLocked] = useState(false);
  const {
    viewMode, workflowConfig, editingConfig, agentConfigs,
    workflowStatus, runId, currentPhase, currentStep, agents, logs, completedSteps, failedSteps,
    activeTab, selectedAgent, selectedStep,
    projectRoot, workspaceMode, requirements, timeoutMinutes, engine, skills, mcpServers, ragKnowledgeBases, showProcessPanel,
    stepResults, stepIdMap,
    globalContext, phaseContexts,
  } = state;
  const latestEditingConfigRef = useRef<any>(editingConfig);
  const hasUnsavedDesignConfigChangesRef = useRef(false);
  const specCodingDisabled = workflowConfig?.context?.specCodingEnabled === false
    || workflowConfig?.context?.skipSpecCoding === true;
  const runtimeSpecAvailable = !specCodingDisabled && Boolean(
    specCodingSummary
      || specCodingDetails
      || persistMode === 'repository'
      || masterSpecPath
      || deltaMergeState
      || specRevisionVote
      || specRevisionVoteHistory.length > 0,
  );
  const isLightweightWorkflow = isLightweightWorkflowConfig(workflowConfig);
  const specDesignEnabled = !specCodingDisabled && Boolean(
    workflowConfig?.context?.specCodingEnabled === true
      || editingConfig?.context?.specCodingEnabled === true
      || workflowConfig?.context?.specCoding
      || editingConfig?.context?.specCoding
      || runtimeSpecAvailable
      || specArtifactSnapshots.length > 0
  );
  const workflowTaskInputFields = useMemo(
    () => resolveWorkflowTaskInputFields((workflowConfig?.context as any)?.taskInput),
    [workflowConfig?.context]
  );
  useEffect(() => {
    if (designTab !== 'spec' || specDesignEnabled) return;
    setDesignTab('orchestration');
    updateUrl({ designTab: 'orchestration' });
  }, [designTab, specDesignEnabled, updateUrl]);
  const isHistoryRunView = viewingHistoryRun || initialHistoryRun;
  const activeRuntimeRunId = runId || selectedRun?.id || initialRunId || '';
  const statusQueryRunId = startupExpectedRunIdRef.current
    || runId
    || selectedRun?.id
    || (startupInProgressRef.current ? undefined : initialRunId)
    || undefined;
  const shouldSyncWorkbenchStatus = shouldEnableWorkbenchStatusSync({
    viewMode,
    isHistoryRunView,
    configFile,
    runId: statusQueryRunId,
  });
  const statusCompactQuery = useQuery({
    queryKey: queryKeys.workflowStatusCompact(configFile, statusQueryRunId),
    queryFn: () => fetchWorkflowStatusCompact(configFile, statusQueryRunId),
    enabled: shouldSyncWorkbenchStatus,
    staleTime: 1_000,
    refetchInterval: isRuntimeWorkflowStatusActive(workflowStatus) ? 2_000 : false,
  });
  const runtimeWorkflowPresentation = useMemo(() => resolveWorkbenchStateMapPresentation({
    baseConfig: workflowConfig,
    activeRunId: activeRuntimeRunId,
    runDetail,
    statusSnapshot: statusCompactQuery.data,
  }), [activeRuntimeRunId, runDetail, statusCompactQuery.data, workflowConfig]);
  const runtimeWorkflowConfig = runtimeWorkflowPresentation.config;
  const stateMapUsesRuntimeSnapshot = runtimeWorkflowPresentation.source === 'run';
  const isRuntimeLightweightWorkflow = isLightweightWorkflowConfig(runtimeWorkflowConfig);
  const isPromotedLightweightRun = isLightweightWorkflow && !isRuntimeLightweightWorkflow;
  const lightweightTasklistQuery = useLightweightTasklistEvidenceQuery(
    activeRuntimeRunId,
    isRuntimeLightweightWorkflow,
    isRuntimeWorkflowStatusActive(workflowStatus),
  );
  const lightweightTaskBoardStepNames = useMemo(() => Array.from(new Set([
    currentStep,
    ...activeSteps,
    ...completedSteps,
    ...failedSteps,
    ...(runtimeWorkflowConfig?.workflow?.states || []).flatMap((stateNode: any) => (stateNode.steps || [])
      .map((step: any) => String(step?.name || step?.task || '').trim())),
  ].map((step) => String(step || '').trim()).filter(Boolean))), [
    activeSteps,
    completedSteps,
    currentStep,
    failedSteps,
    runtimeWorkflowConfig?.workflow?.states,
  ]);
  const lightweightRuntimeToolEventsQuery = useLightweightRuntimeToolEventsQuery(
    activeRuntimeRunId,
    lightweightTaskBoardStepNames,
    isRuntimeLightweightWorkflow,
    isRuntimeWorkflowStatusActive(workflowStatus),
  );
  const lightweightTaskBoardToolEvents = useMemo(() => {
    let events: RuntimeToolEvent[] = [];
    for (const event of [...(lightweightRuntimeToolEventsQuery.data || []), ...liveToolEvents]) {
      events = mergeRuntimeToolEvents(events, event);
    }
    return events;
  }, [lightweightRuntimeToolEventsQuery.data, liveToolEvents]);
  const lightweightTaskBoardInput = useMemo(() => ({
    workflow: {
      profile: runtimeWorkflowConfig?.workflow?.profile,
      primaryAgent: runtimeWorkflowConfig?.workflow?.states?.[0]?.steps?.[0]?.agent,
      states: runtimeWorkflowConfig?.workflow?.states,
    },
    run: {
      profile: runtimeWorkflowConfig?.workflow?.profile,
      status: workflowStatus,
      currentPhase,
      currentStep,
      primaryAgent: runtimeWorkflowConfig?.workflow?.states?.[0]?.steps?.[0]?.agent,
      agents: Array.isArray((statusCompactQuery.data as any)?.agents)
        ? (statusCompactQuery.data as any).agents
        : (Array.isArray(runDetail?.agents) ? runDetail.agents : agents),
      runtimeAgents: Array.isArray((statusCompactQuery.data as any)?.runtimeAgents)
        ? (statusCompactQuery.data as any).runtimeAgents
        : runDetail?.runtimeAgents,
      agentActivity: Array.isArray((statusCompactQuery.data as any)?.agentActivity)
        ? (statusCompactQuery.data as any).agentActivity
        : runDetail?.agentActivity,
      toolEvents: lightweightTaskBoardToolEvents,
      activeSteps,
      completedSteps,
      failedSteps,
    },
    tasklist: lightweightTasklistQuery.data?.tasklist || (statusCompactQuery.data as any)?.tasklist || runDetail?.tasklist,
  }), [activeSteps, agents, completedSteps, currentPhase, currentStep, failedSteps, lightweightTaskBoardToolEvents, lightweightTasklistQuery.data?.tasklist, runDetail, runtimeWorkflowConfig?.workflow, statusCompactQuery.data, workflowStatus]);
  const appliedStatusCacheSignatureRef = useRef<string | null>(null);
  const workflowEventSeqByRunIdRef = useRef<Map<string, number>>(new Map());
  const workflowEventSyncInflightRef = useRef<Map<string, Promise<void>>>(new Map());
  const dbStateHistoryRows = useWorkflowStateHistoryRows(activeRuntimeRunId);
  const dbStepLogRows = useWorkflowStepLogRows(activeRuntimeRunId);
  const dbWorkflowEventRows = useWorkflowEventRows(activeRuntimeRunId);
  const dbUnansweredHumanQuestionRows = useWorkflowHumanQuestionRows({
    runId: activeRuntimeRunId,
    configFile,
    status: 'unanswered',
  });
  const latestRunIdRef = useRef<string | null>(runId || null);
  useEffect(() => {
    const workflow = workflowConfig?.workflow;
    if (workflow?.mode !== 'state-machine') return;
    const steps = (workflow.states || [])
      .flatMap((stateNode: any) => (stateNode.steps || []).map((step: any) => ({
        step,
        stateName: stateNode.name,
        configFile: getSubworkflowConfigFileFromStep(step),
      })))
      .filter((item: any) => item.step?.type === 'subworkflow' && item.configFile);
    if (!steps.length) return;

    let cancelled = false;
    const runs = Array.isArray(subworkflowRuns) ? subworkflowRuns : [];
    for (const item of steps) {
      const matchingRuns = runs.filter((child: any) => {
        const sameConfig = String(child?.configFile || '').trim().toLowerCase() === String(item.configFile || '').trim().toLowerCase();
        const sameStep = !child?.parentStepName || child.parentStepName === item.step.name;
        return sameConfig && sameStep;
      });
      const previewKey = getSubworkflowCacheKey(item.configFile);
      if (!subworkflowDrilldownCacheRef.current.has(previewKey) && !subworkflowDrilldownPreloadRef.current.has(previewKey)) {
        subworkflowDrilldownPreloadRef.current.add(previewKey);
        configApi.getConfig(item.configFile)
          .then((configResponse) => {
            if (cancelled) return;
            subworkflowDrilldownCacheRef.current.set(previewKey, {
              child: {
                configFile: item.configFile,
                runId: '',
                parentStateName: item.stateName || '',
                parentStepName: item.step?.name || '',
                status: 'draft',
              },
              configFile: item.configFile,
              runId: '',
              config: configResponse.config,
              agents: configResponse.agents || [],
              status: makeSubworkflowPreviewStatus(),
              previewOnly: true,
            });
          })
          .catch(() => {})
          .finally(() => subworkflowDrilldownPreloadRef.current.delete(previewKey));
      }

      for (const child of matchingRuns) {
        if (!child?.runId || !child?.configFile) continue;
        const runKey = getSubworkflowCacheKey(child.configFile, child.runId);
        if (subworkflowDrilldownCacheRef.current.has(runKey) || subworkflowDrilldownPreloadRef.current.has(runKey)) continue;
        subworkflowDrilldownPreloadRef.current.add(runKey);
        const parentRunId = String(child.parentRunId || activeRuntimeRunId || '').trim();
        Promise.all([
          configApi.getConfig(child.configFile),
          queryClient.fetchQuery({
            queryKey: queryKeys.workflowChildStatusCompact(configFile, parentRunId, child.configFile, child.runId),
            queryFn: () => fetchWorkflowStatusCompact(child.configFile, child.runId),
            staleTime: 1_000,
          }),
        ])
          .then(([configResponse, status]) => {
            if (cancelled) return;
            queryClient.setQueryData(queryKeys.workflowStatusCompact(child.configFile, child.runId), status);
            subworkflowDrilldownCacheRef.current.set(runKey, {
              child,
              configFile: child.configFile,
              runId: child.runId,
              config: configResponse.config,
              agents: configResponse.agents || [],
              status,
            });
          })
          .catch(() => {})
          .finally(() => subworkflowDrilldownPreloadRef.current.delete(runKey));
      }
    }

    return () => {
      cancelled = true;
    };
  }, [
    activeRuntimeRunId,
    configFile,
    getSubworkflowCacheKey,
    getSubworkflowConfigFileFromStep,
    makeSubworkflowPreviewStatus,
    queryClient,
    subworkflowRuns,
    workflowConfig?.workflow,
  ]);

  const handleAgentSkillsChange = useCallback(async (agentName: string, skills: string[]) => {
    const agent = agentConfigs.find((item: any) => item?.name === agentName);
    if (!agent) {
      toast('error', `找不到 Agent: ${agentName}`);
      throw new Error(`找不到 Agent: ${agentName}`);
    }
    const nextSkills = Array.from(new Set(skills.map((item) => String(item || '').trim()).filter(Boolean)));
    const nextAgent = { ...agent, skills: nextSkills };
    await agentApi.saveAgent(agentName, nextAgent);
    const nextAgents = agentConfigs.map((item: any) => item?.name === agentName ? nextAgent : item);
    dispatch({ type: 'SET_AGENTS_CONFIG', payload: nextAgents });
    toast('success', `已更新 ${agentName} 的 Agent Skills`);
  }, [agentConfigs, dispatch, toast]);

  const handleAgentMcpServersChange = useCallback(async (agentName: string, servers: string[]) => {
    const agent = agentConfigs.find((item: any) => item?.name === agentName);
    if (!agent) {
      toast('error', `找不到 Agent: ${agentName}`);
      throw new Error(`找不到 Agent: ${agentName}`);
    }
    const nextServers = Array.from(new Set(servers.map((item) => String(item || '').trim()).filter(Boolean)));
    const nextAgent = { ...agent, mcpServers: nextServers };
    await agentApi.saveAgent(agentName, nextAgent);
    const nextAgents = agentConfigs.map((item: any) => item?.name === agentName ? nextAgent : item);
    dispatch({ type: 'SET_AGENTS_CONFIG', payload: nextAgents });
    toast('success', `已更新 ${agentName} 的 MCP Servers`);
  }, [agentConfigs, dispatch, toast]);

  const handleAgentRagKnowledgeBasesChange = useCallback(async (agentName: string, knowledgeBases: string[]) => {
    const agent = agentConfigs.find((item: any) => item?.name === agentName);
    if (!agent) {
      toast('error', `找不到 Agent: ${agentName}`);
      throw new Error(`找不到 Agent: ${agentName}`);
    }
    const nextKnowledgeBases = Array.from(new Set(knowledgeBases.map((item) => String(item || '').trim()).filter(Boolean)));
    const nextSkills = nextKnowledgeBases.length > 0
      ? Array.from(new Set([...(Array.isArray(agent.skills) ? agent.skills : []), 'aceharness-rag']))
      : (Array.isArray(agent.skills) ? agent.skills : []);
    const nextAgent = { ...agent, ragKnowledgeBases: nextKnowledgeBases, skills: nextSkills };
    await agentApi.saveAgent(agentName, nextAgent);
    const nextAgents = agentConfigs.map((item: any) => item?.name === agentName ? nextAgent : item);
    dispatch({ type: 'SET_AGENTS_CONFIG', payload: nextAgents });
    toast('success', `已更新 ${agentName} 的 RAG 知识库`);
  }, [agentConfigs, dispatch, toast]);

  const handleWorkflowRagKnowledgeBasesChange = useCallback((knowledgeBases: string[]) => {
    const nextKnowledgeBases = Array.from(new Set(knowledgeBases.map((item) => String(item || '').trim()).filter(Boolean)));
    dispatch({ type: 'SET_RAG_KNOWLEDGE_BASES', payload: nextKnowledgeBases });
    if (nextKnowledgeBases.length > 0 && !skills.includes('aceharness-rag')) {
      dispatch({ type: 'SET_SKILLS', payload: [...skills, 'aceharness-rag'] });
    }
  }, [dispatch, skills]);

  useEffect(() => {
    latestRunIdRef.current = runId || null;
    if (runId && startupExpectedRunIdRef.current) {
      startupExpectedRunIdRef.current = null;
    }
  }, [runId]);

  const shouldApplyRuntimePayload = useCallback((payload: any) => {
    if (!payload) return true;
    const eventConfigFile = payload.currentConfigFile || payload.configFile || payload.statusSnapshot?.currentConfigFile || payload.statusSnapshot?.configFile;
    if (eventConfigFile && eventConfigFile !== configFile) return false;

    const payloadRunId = payload.runId || payload.statusSnapshot?.runId || payload.question?.runId;
    if (startupInProgressRef.current && !startupExpectedRunIdRef.current && payloadRunId) {
      return false;
    }
    if (!payloadRunId) return true;
    const expectedRunId = startupExpectedRunIdRef.current || latestRunIdRef.current;
    return !expectedRunId || payloadRunId === expectedRunId;
  }, [configFile]);
  const currentWorkflowExecutionPolicy = useMemo(() => ({
    defaultEngine: engine || '',
    defaultModel: workflowDefaultModel || '',
    autoCompactOnStepChange: workflowAutoCompactOnStepChange,
    agentOverrides: workflowAgentOverrides,
  }), [engine, workflowAgentOverrides, workflowAutoCompactOnStepChange, workflowDefaultModel]);
  const currentWorkflowDesignDraftState = useMemo<WorkflowDesignDraftState>(() => ({
    projectRoot,
    workspaceMode,
    requirements,
    timeoutMinutes,
    engine,
    workflowDefaultModel,
    workflowAutoCompactOnStepChange,
    workflowSupervisorEnabled,
    workflowAgentOverrides,
    skills,
    mcpServers,
    ragKnowledgeBases,
  }), [
    engine,
    mcpServers,
    projectRoot,
    ragKnowledgeBases,
    requirements,
    skills,
    timeoutMinutes,
    workflowAgentOverrides,
    workflowAutoCompactOnStepChange,
    workflowSupervisorEnabled,
    workflowDefaultModel,
    workspaceMode,
  ]);
  const [timeoutMinutesInput, setTimeoutMinutesInput] = useState(() => String(timeoutMinutes ?? 30));
  const maxTransitionsValue = editingConfig?.workflow?.maxTransitions ?? workflowConfig?.workflow?.maxTransitions ?? 50;
  const [maxTransitionsInput, setMaxTransitionsInput] = useState(() => String(maxTransitionsValue));

  useEffect(() => {
    setTimeoutMinutesInput(String(timeoutMinutes ?? 30));
  }, [timeoutMinutes]);

  useEffect(() => {
    setMaxTransitionsInput(String(maxTransitionsValue));
  }, [maxTransitionsValue]);

  const persistedWorkflowDesignDraftState = useMemo<WorkflowDesignDraftState | null>(() => {
    if (!workflowConfig) return null;
    const persistedExecutionPolicy = resolveWorkflowExecutionPolicy(workflowConfig.context);
    return {
      projectRoot: typeof workflowConfig.context?.projectRoot === 'string' ? workflowConfig.context.projectRoot : '',
      workspaceMode: workflowConfig.context?.workspaceMode === 'in-place' ? 'in-place' : 'isolated-copy',
      requirements: typeof workflowConfig.context?.requirements === 'string' ? workflowConfig.context.requirements : '',
      timeoutMinutes: Number.isFinite(workflowConfig.context?.timeoutMinutes) ? Number(workflowConfig.context.timeoutMinutes) : 30,
      engine: persistedExecutionPolicy.defaultEngine || '',
      workflowDefaultModel: persistedExecutionPolicy.defaultModel || '',
      workflowAutoCompactOnStepChange: persistedExecutionPolicy.autoCompactOnStepChange === true,
      workflowSupervisorEnabled: (workflowConfig as any)?.workflow?.supervisor?.enabled === true,
      workflowAgentOverrides: persistedExecutionPolicy.agentOverrides || {},
      skills: Array.isArray(workflowConfig.context?.skills) ? workflowConfig.context.skills.filter((item: unknown): item is string => typeof item === 'string') : [],
      mcpServers: Array.isArray(workflowConfig.context?.mcpServers) ? workflowConfig.context.mcpServers.filter((item: unknown): item is string => typeof item === 'string') : [],
      ragKnowledgeBases: Array.isArray(workflowConfig.context?.capabilitySkills?.rag?.knowledgeBases) ? workflowConfig.context.capabilitySkills.rag.knowledgeBases.filter((item: unknown): item is string => typeof item === 'string') : [],
    };
  }, [workflowConfig]);
  const persistedDesignConfigComparable = useMemo(
    () => (
      workflowConfig && persistedWorkflowDesignDraftState
        ? buildWorkflowDesignConfigForSave(workflowConfig, persistedWorkflowDesignDraftState)
        : null
    ),
    [persistedWorkflowDesignDraftState, workflowConfig],
  );
  const editingDesignConfigComparable = useMemo(
    () => (
      editingConfig
        ? buildWorkflowDesignConfigForSave(editingConfig, currentWorkflowDesignDraftState)
        : null
    ),
    [currentWorkflowDesignDraftState, editingConfig],
  );
  const hasUnsavedDesignConfigChanges = useMemo(
    () => hasWorkflowDesignDraftChanges(persistedDesignConfigComparable, editingDesignConfigComparable),
    [editingDesignConfigComparable, persistedDesignConfigComparable],
  );
  useEffect(() => {
    latestEditingConfigRef.current = editingConfig;
  }, [editingConfig]);
  useEffect(() => {
    hasUnsavedDesignConfigChangesRef.current = hasUnsavedDesignConfigChanges;
  }, [hasUnsavedDesignConfigChanges]);
  const configuredWorkflowOverrideCount = useMemo(
    () => Object.values(workflowAgentOverrides).filter((value) => value?.enabled).length,
    [workflowAgentOverrides],
  );
  const workflowAgentNames = useMemo(() => {
    const workflow = editingConfig?.workflow || workflowConfig?.workflow;
    return resolveWorkflowPolicyAgentNames({
      workflow,
      agentConfigs,
      supervisorPosition: 'last',
    });
  }, [agentConfigs, editingConfig?.workflow, workflowConfig?.workflow]);
  const designSpecBindingValidation = useMemo(() => {
    const sourceConfig = editingConfig || workflowConfig;
    if (!specDesignEnabled || !sourceConfig || !specCodingDetails) return null;
    try {
      return compileStepTaskBindings(sourceConfig as any, specCodingDetails as any, { requireFullCoverage: true }).validation;
    } catch {
      return null;
    }
  }, [editingConfig, specCodingDetails, specDesignEnabled, workflowConfig]);
  const startContextTargets = useMemo(() => {
    const workflow = workflowConfig?.workflow;
    if (!workflow) return [] as string[];
    return (workflow.states || []).map((state: any) => state.name).filter((value: string) => !!value);
  }, [workflowConfig]);
  const startContextScopeLabel = '状态';

  // Explicitly convert viewMode to string for conditional rendering
  const isDesignMode = state.viewMode === 'design';
  const isRunMode = state.viewMode === 'run';

  const switchViewMode = useCallback((mode: ViewMode) => {
    const nextMode: ViewMode = mode === 'design' ? 'design' : 'run';
    setWorkbenchNavSection(nextMode === 'design' ? 'design' : 'runs');
    if (nextMode === 'run') setRunRecordDrilled(false);
    setViewingHistoryRun(false);
    dispatch({ type: 'SET_VIEW_MODE', payload: nextMode });
    if (nextMode === 'design') {
      setDesignTab('orchestration');
    }
    if (nextMode === 'run') {
      updateUrl({ mode: 'run', run: runId || null, runId: null, history: null, designTab: null });
    } else {
      updateUrl({ mode: 'design', run: null, runId: null, history: null, designTab: 'orchestration' });
    }
  }, [dispatch, runId, updateUrl]);

  useEffect(() => {
    const data = runtimeSelectionQuery.data;
    if (!data) return;
    setGlobalEngine(typeof data.engine === 'string' ? data.engine : '');
    setGlobalDefaultModel(typeof data.defaultModel === 'string' ? data.defaultModel : '');
  }, [runtimeSelectionQuery.data]);

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

  const currentRunWorkspacePath = useMemo(
    () => state.workingDirectory || resolvedProjectRoot || projectRoot || '',
    [projectRoot, resolvedProjectRoot, state.workingDirectory],
  );
  const previewWorkspacePath = resolvedProjectRoot || projectRoot || '';
  const requestedWorkspaceFile = effectiveSearchParams.get('workspaceFile') || '';
  const requestedWorkspaceRoot = effectiveSearchParams.get('workspaceRoot') || '';
  const requestedWorkspaceLineNumber = parseOptionalPositiveInt(effectiveSearchParams.get('workspaceLine'));
  const requestedWorkspaceColumn = parseOptionalPositiveInt(effectiveSearchParams.get('workspaceColumn'));
  const appliedWorkspaceFileRequestRef = useRef('');
  const workspaceRouteRunId = runId || selectedRun?.id || '';
  const configGitBaselineEnabled = workflowConfig?.context?.gitBaselineEnabled !== false;
  const effectiveGitBaselineEnabled = configGitBaselineEnabled && runtimeGitBaselineEnabled;
  const workspaceChangeSummaryQuery = useGitBrowserSummaryQuery(
    String(currentRunWorkspacePath || '').trim(),
    { commitLimit: 1 },
    {
      enabled: viewMode === 'run' && Boolean(currentRunWorkspacePath) && effectiveGitBaselineEnabled,
      refetchInterval: viewMode === 'run' && currentRunWorkspacePath && effectiveGitBaselineEnabled ? 5000 : false,
    },
  );

  useEffect(() => {
    const nextEnabled = workflowConfig?.context?.gitBaselineEnabled !== false;
    setRuntimeGitBaselineEnabled((current) => current === nextEnabled ? current : nextEnabled);
  }, [workflowConfig?.context?.gitBaselineEnabled]);

  useEffect(() => {
    if (requestedWorkspaceRoot || !requestedWorkspaceFile || !workspaceRouteRunId) return;
    const requestedFilename = requestedWorkspaceFile.split(/[\\/]/).filter(Boolean).pop() || '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-.+\.(?:md|txt)$/i.test(requestedFilename)) return;

    let cancelled = false;
    void runsApi.listDocuments(workspaceRouteRunId, {
      scope: 'root',
      documentKind: 'detail',
      pageSize: 500,
    }).then((documents) => {
      if (cancelled || !documents.documentDirectory) return;
      const isRunDocument = (documents.files || []).some((file) => file.filename === requestedFilename);
      if (!isRunDocument) return;
      const documentRoot = documents.documentDirectory;
      setWorkspaceEditorPath(documentRoot);
      setWorkspaceEditorTitle(requestedFilename);
      setWorkspaceEditorFilePath(requestedFilename);
      updateUrl({ workspaceRoot: documentRoot });
    }).catch(() => {
      // Keep the project workspace fallback when the historical run is no longer available.
    });

    return () => { cancelled = true; };
  }, [requestedWorkspaceFile, requestedWorkspaceRoot, updateUrl, workspaceRouteRunId]);

  useEffect(() => {
    if ((!requestedWorkspaceFile && !requestedWorkspaceRoot) || !currentRunWorkspacePath) return;
    const requestedRoot = resolveWorkspaceRootFromRoute(currentRunWorkspacePath, requestedWorkspaceRoot);
    const requestKey = [
      requestedRoot,
      requestedWorkspaceFile,
      requestedWorkspaceLineNumber || '',
      requestedWorkspaceColumn || '',
    ].join('::');
    if (appliedWorkspaceFileRequestRef.current === requestKey) return;
    appliedWorkspaceFileRequestRef.current = requestKey;
    setRunWorkbenchTab('workspace');
    setWorkspaceEditorPath(requestedRoot);
    setWorkspaceEditorTitle(requestedWorkspaceFile.split(/[\\/]/).filter(Boolean).pop() || '工作区');
    setWorkspaceEditorFilePath(requestedWorkspaceFile || null);
    setWorkspaceEditorLineNumber(requestedWorkspaceLineNumber);
    setWorkspaceEditorColumn(requestedWorkspaceColumn);
    setWorkbenchNavSection('runs');
    setRunRecordDrilled(true);
    setRunDetailSection('workspace');
  }, [currentRunWorkspacePath, requestedWorkspaceColumn, requestedWorkspaceFile, requestedWorkspaceLineNumber, requestedWorkspaceRoot]);

  const handleRunWorkbenchTabChange = useCallback((
    tab: RunWorkbenchTab,
    options: { documentSource?: DocumentSourceFilter } = {},
  ) => {
    const nextDocumentSource = tab === 'documents'
      ? (options.documentSource || documentSourceFilter)
      : 'all';
    setRunWorkbenchTab(tab);
    if (tab === 'documents') setDocumentSourceFilter(nextDocumentSource);
    if (tab === 'workspace') {
      setWorkspaceEditorPath(currentRunWorkspacePath);
      setWorkspaceEditorTitle('工作区');
      setWorkspaceEditorFilePath(null);
      setWorkspaceEditorLineNumber(null);
      setWorkspaceEditorColumn(null);
    }
    updateUrl({
      tab,
      documentSource: tab === 'documents' && nextDocumentSource !== 'all' ? nextDocumentSource : null,
      workspace: tab === 'workspace' ? '1' : null,
      workspaceRoot: tab === 'workspace' ? currentRunWorkspacePath : null,
      changes: tab === 'changes' ? '1' : null,
      workspaceFile: null,
      workspaceLine: null,
      workspaceColumn: null,
    });
  }, [currentRunWorkspacePath, documentSourceFilter, updateUrl]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(getWorkflowRunPanelTabsStorageKey(configFile), JSON.stringify({
        left: leftRunPanelTab,
        right: rightPanelTab,
        center: runWorkbenchTab,
      }));
    } catch {}
  }, [configFile, leftRunPanelTab, rightPanelTab, runWorkbenchTab]);

  useEffect(() => {
    if (isRuntimeLightweightWorkflow && (runWorkbenchTab === 'agents' || runWorkbenchTab === 'agora')) {
      handleRunWorkbenchTabChange('overview');
      return;
    }
    if (runWorkbenchTab === 'changes' && !currentRunWorkspacePath) {
      handleRunWorkbenchTabChange('overview');
    }
    if (runWorkbenchTab === 'spec' && !runtimeSpecAvailable) {
      handleRunWorkbenchTabChange('overview');
    }
  }, [currentRunWorkspacePath, handleRunWorkbenchTabChange, isRuntimeLightweightWorkflow, runWorkbenchTab, runtimeSpecAvailable]);

  useEffect(() => {
    setRunDetailSection((current) => {
      const next = runWorkbenchTabToDetailSection(runWorkbenchTab, runtimeSpecAvailable);
      return current === next ? current : next;
    });
  }, [runWorkbenchTab, runtimeSpecAvailable]);

  useEffect(() => {
    if (viewMode !== 'run' || !currentRunWorkspacePath || !effectiveGitBaselineEnabled) {
      setWorkspaceChangeCount(0);
      return;
    }
    if (workspaceChangeSummaryQuery.data) {
      setWorkspaceChangeCount(countGitWorkingTreeFiles(workspaceChangeSummaryQuery.data));
      return;
    }
    if (workspaceChangeSummaryQuery.error) {
      setWorkspaceChangeCount(0);
    }
  }, [
    currentRunWorkspacePath,
    effectiveGitBaselineEnabled,
    viewMode,
    workspaceChangeSummaryQuery.data,
    workspaceChangeSummaryQuery.error,
  ]);

  useEffect(() => {
    setRuntimeAgentDraft((prev) => ({
      ...prev,
      workingDirectory: resolvedProjectRoot || prev.workingDirectory || '',
    }));
  }, [resolvedProjectRoot]);

  const loadCreationDrafts = useCallback(async () => {
    setCreationDraftsLoading(true);
    try {
      const data = await specCodingApi.listCreationSessions();
      setCreationDrafts(Array.isArray(data?.sessions) ? data.sessions : []);
    } catch {
      setCreationDrafts([]);
    } finally {
      setCreationDraftsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCreationDrafts();
  }, [loadCreationDrafts]);

  const workbenchCreationDrafts = useMemo(() => {
    const isResumable = (status: string) => ['draft', 'confirmed'].includes(status) && !['config-generated', 'run-bound', 'archived'].includes(status);
    const drafts = creationDrafts
      .filter((session) => session?.id && isResumable(session.status))
      .map((session) => ({
        ...session,
        isRelated: Boolean(
          (configFile && session.filename === configFile)
          || (configFile && session.referenceWorkflow === configFile)
          || (resolvedProjectRoot && session.workingDirectory === resolvedProjectRoot)
        ),
      }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const related = drafts.filter((session) => session.isRelated);
    return (related.length ? related : drafts).slice(0, 6);
  }, [configFile, creationDrafts, resolvedProjectRoot]);

  useEffect(() => {
    const handleOpenWorkspacePath = (event: Event) => {
      const detail = (event as CustomEvent<{
        absolutePath?: string;
        workspacePath?: string;
        filePath?: string | null;
        lineNumber?: number | null;
        column?: number | null;
      }>).detail;
      if (!detail?.workspacePath) return;
      const target = resolveWorkspaceLinkTarget({
        currentWorkspacePath: currentRunWorkspacePath,
        linkWorkspacePath: detail.workspacePath,
        absolutePath: detail.absolutePath,
        filePath: detail.filePath,
      });
      openWorkspaceEditorAtPath(target.workspacePath, '文档链接', target.initialFilePath, target.lineNumber || detail.lineNumber || null, target.column || detail.column || null);
    };
    window.addEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    return () => {
      window.removeEventListener('ace:open-workspace-path', handleOpenWorkspacePath as EventListener);
    };
  }, [currentRunWorkspacePath, openWorkspaceEditorAtPath]);

  const activeSpecCodingPhase = useMemo(() => {
    if (specCodingDisabled) return null;
    if (!specCodingDetails?.phases?.length) return null;
    return specCodingDetails.phases.find((phase) => phase.id === specCodingSummary?.progress?.activePhaseId)
      || specCodingDetails.phases.find((phase) => phase.title === currentPhase)
      || null;
  }, [currentPhase, specCodingDetails, specCodingDisabled, specCodingSummary?.progress?.activePhaseId]);

  const effectiveSpecCodingTasks = useMemo(() => {
    if (specCodingDisabled) return [];
    const tasks = (specCodingDetails?.tasks || []) as RuntimeSpecTask[];
    const workflow = runtimeWorkflowConfig?.workflow as any;
    if (!tasks.length || !workflow) return tasks;

    const runningStepKeys = new Set<string>([...activeSteps, currentStep].filter(Boolean));
    const completedStepKeys = new Set<string>(completedSteps || []);
    const failedStepKeys = new Set<string>(failedSteps || []);
    const derivedStatusByTaskId = new Map<string, 'pending' | 'in-progress' | 'completed' | 'blocked'>();

    const stepMatchesKey = (stepName: string, scopeName: string | null | undefined, key: string) => {
      const variants = [stepName, scopeName ? `${scopeName}-${stepName}` : ''].filter(Boolean);
      return variants.some((variant) =>
        key === variant
        || key.startsWith(`${variant}-迭代`)
        || key.endsWith(`-${variant}`)
      );
    };

    const applyDerivedStatus = (taskId: string, status: 'pending' | 'in-progress' | 'completed' | 'blocked') => {
      const previous = derivedStatusByTaskId.get(taskId);
      const priority = { pending: 0, 'in-progress': 1, blocked: 2, completed: 3 } as const;
      if (!previous || priority[status] > priority[previous]) {
        derivedStatusByTaskId.set(taskId, status);
      }
    };

    const getStepTaskIds = (step: any): string[] => {
      const ids = [
        ...((step?.specTaskBinding?.taskIds || []) as string[]),
        step?.specTaskBinding?.taskId,
      ];
      return Array.from(new Set(ids.map((id) => typeof id === 'string' ? id.trim() : '').filter(Boolean)));
    };

    const bindStepStatus = (step: any, scopeName?: string) => {
      const taskIds = getStepTaskIds(step);
      if (taskIds.length === 0) return;

      for (const key of runningStepKeys) {
        if (stepMatchesKey(step.name, scopeName, key)) {
          taskIds.forEach((taskId) => applyDerivedStatus(taskId, 'in-progress'));
          return;
        }
      }
      for (const key of failedStepKeys) {
        if (stepMatchesKey(step.name, scopeName, key)) {
          taskIds.forEach((taskId) => applyDerivedStatus(taskId, 'blocked'));
          return;
        }
      }
      for (const key of completedStepKeys) {
        if (stepMatchesKey(step.name, scopeName, key)) {
          taskIds.forEach((taskId) => applyDerivedStatus(taskId, 'completed'));
          return;
        }
      }
    };

    (workflow.states || []).forEach((state: any) => {
      (state.steps || []).forEach((step: any) => bindStepStatus(step, state.name));
    });

    return mapRuntimeSpecTasks(tasks, (task) => {
      if (task.status === 'completed' || task.status === 'blocked') return task;
      const derivedStatus = derivedStatusByTaskId.get(task.id);
      return derivedStatus && derivedStatus !== task.status
        ? { ...task, status: derivedStatus }
        : task;
    });
  }, [activeSteps, completedSteps, currentStep, failedSteps, runtimeWorkflowConfig, specCodingDetails?.tasks, specCodingDisabled]);

  const specCodingTaskProgress = useMemo(() => {
    const tasks = flattenRuntimeSpecTasks((effectiveSpecCodingTasks || []) as RuntimeSpecTask[]);
    const total = tasks.length;
    const completed = tasks.filter((task) => task.status === 'completed').length;
    const inProgress = tasks.filter((task) => task.status === 'in-progress').length;
    const blocked = tasks.filter((task) => task.status === 'blocked').length;
    const pending = Math.max(0, total - completed - inProgress - blocked);
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
    const activeTasks = tasks.filter((task) => task.status === 'in-progress');
    const blockedTasks = tasks.filter((task) => task.status === 'blocked');
    const recentlyUpdatedTasks = [...tasks]
      .filter((task) => task.updatedAt)
      .sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())
      .slice(0, 5);

    return {
      total,
      completed,
      inProgress,
      blocked,
      pending,
      percentage,
      activeTasks,
      blockedTasks,
      recentlyUpdatedTasks,
    };
  }, [effectiveSpecCodingTasks]);

  const structuredTasksMarkdown = useMemo(() => {
    const tasks = effectiveSpecCodingTasks || [];
    if (tasks.length === 0) return '';
    const renderTask = (task: RuntimeSpecTask, depth = 0): string[] => {
      const checkbox = task.status === 'completed'
        ? '[x]'
        : task.status === 'in-progress'
          ? '[-]'
          : task.status === 'blocked'
            ? '[!]'
            : '[ ]';
      const metadata = [
        `status:${task.status}`,
        task.phaseId ? `phase:${task.phaseId}` : null,
        task.updatedBy ? `updatedBy:${task.updatedBy}` : null,
      ].filter(Boolean).join(' ');
      const indent = '  '.repeat(depth);
      const lines = [
        `${indent}<!-- spec-coding-task:${task.id} ${metadata} -->`,
        `${indent}- ${checkbox} ${task.id} ${task.title}`,
      ];
      if (task.detail?.trim()) {
        lines.push(...task.detail.trim().split(/\r?\n/).map((line) => `${indent}  ${line}`));
      }
      for (const child of task.children || []) {
        lines.push(...renderTask(child, depth + 1));
      }
      return [...lines, ''];
    };
    return [
      '# tasks.md',
      '',
      '## 任务列表',
      '',
      ...tasks.flatMap((task) => renderTask(task)),
    ].join('\n').trim();
  }, [effectiveSpecCodingTasks]);

  const specCodingArtifactEntries = useMemo<Array<{
    key: SpecCodingArtifactKey;
    label: string;
    title: string;
    content: string;
  }>>(() => {
    if (specCodingDisabled) return [];
    const artifacts = specCodingDetails?.artifacts || {};
    return [
      {
        key: 'requirements',
        label: 'requirements.md',
        title: '需求',
        content: artifacts.requirements || '',
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
    ];
  }, [specCodingDetails?.artifacts, specCodingDisabled, structuredTasksMarkdown]);

  const currentSpecArtifacts = useMemo<SpecCodingArtifactDrafts>(
    () => specCodingDisabled ? normalizeSpecArtifactDrafts(null) : normalizeSpecArtifactDrafts(specCodingDetails?.artifacts, {
      tasks: structuredTasksMarkdown || specCodingDetails?.artifacts?.tasks || '',
    }),
    [specCodingDetails?.artifacts, specCodingDisabled, structuredTasksMarkdown]
  );
  const designOptimizationSpecTaskOptions = useMemo(() => (
    specCodingDisabled ? [] :
    (specCodingDetails?.tasks || [])
      .filter((task: any) => !(Array.isArray(task?.children) && task.children.length > 0))
      .map((task: any) => ({
        id: task.id,
        title: task.title,
        phaseTitle: specCodingDetails?.phases?.find((phase: any) => phase.id === task.phaseId)?.title,
        ownerAgents: task.ownerAgents || [],
      }))
  ), [specCodingDetails?.phases, specCodingDetails?.tasks, specCodingDisabled]);
  const effectiveSpecRevisionDraft = specRevisionCandidate
    ? specRevisionCandidate.artifacts[specRevisionTarget]
    : specRevisionDraft;

  const activeSpecCodingArtifact = useMemo(
    () => specCodingArtifactEntries.find((entry) => entry.key === specCodingArtifactTab) || specCodingArtifactEntries[0],
    [specCodingArtifactEntries, specCodingArtifactTab]
  );

  useEffect(() => {
    if (runtimeSpecAvailable) return;
    setSpecCodingModalOpen(false);
    setSpecCodingSaveDialogOpen(false);
  }, [runtimeSpecAvailable]);
  const specRevisionBaseArtifact = useMemo(
    () => specCodingArtifactEntries.find((entry) => entry.key === specRevisionTarget) || specCodingArtifactEntries[1] || specCodingArtifactEntries[0],
    [specCodingArtifactEntries, specRevisionTarget]
  );
  const specArtifactDiffRows = useMemo(
    () => computeSimpleDiff(specRevisionBaseArtifact?.content || '', effectiveSpecRevisionDraft),
    [effectiveSpecRevisionDraft, specRevisionBaseArtifact?.content]
  );
  const specRevisionQualityErrors = useMemo(
    () => specRevisionCandidate?.qualityValidation?.errors || [],
    [specRevisionCandidate?.qualityValidation?.errors]
  );
  const specRevisionQualityWarnings = useMemo(
    () => specRevisionCandidate?.qualityValidation?.warnings || [],
    [specRevisionCandidate?.qualityValidation?.warnings]
  );
  const specRevisionTaskValidation = specRevisionCandidate?.qualityValidation?.taskValidation || null;
  const designOptimizationDiffRows = useMemo(() => {
    if (!designOptimizationCandidate) return [] as Array<{ type: 'same' | 'add' | 'remove'; text: string }>;
    return computeSimpleDiff(
      JSON.stringify(designOptimizationCandidate.baseSnapshot ?? {}, null, 2),
      JSON.stringify(designOptimizationCandidate.candidateSnapshot ?? {}, null, 2),
      DESIGN_OPTIMIZATION_DIFF_ROW_LIMIT,
    );
  }, [designOptimizationCandidate]);
  const designOptimizationValidationIssues = useMemo(
    () => designOptimizationCandidate?.configValidation?.issues || [],
    [designOptimizationCandidate]
  );
  const designOptimizationValidationErrors = useMemo(
    () => designOptimizationValidationIssues.filter((issue) => issue?.severity === 'error'),
    [designOptimizationValidationIssues]
  );
  const designOptimizationValidationWarnings = useMemo(
    () => designOptimizationValidationIssues.filter((issue) => issue?.severity === 'warning'),
    [designOptimizationValidationIssues]
  );
  const sortedSpecArtifactSnapshots = useMemo(
    () => [...specArtifactSnapshots].sort((a, b) => b.version - a.version),
    [specArtifactSnapshots]
  );
  const rollbackSpecArtifactSnapshots = useMemo(
    () => sortedSpecArtifactSnapshots.filter((snapshot) => snapshot.version !== specCodingSummary?.version),
    [sortedSpecArtifactSnapshots, specCodingSummary?.version]
  );
  const canImportDeltaSpec = Boolean(runId || initialRunId || selectedRun?.id);
  const canMergeSpec = persistMode === 'repository'
    && canImportDeltaSpec
    && !deltaSpecMerged
    && ['completed', 'failed', 'stopped', 'crashed'].includes(workflowStatus)
    && ['available', 'failed', 'awaiting-confirmation'].includes(deltaMergeState?.status || '');
  const openSpecArtifactEditor = useCallback((artifactKey: SpecCodingArtifactKey) => {
    const artifact = specCodingArtifactEntries.find((entry) => entry.key === artifactKey);
    setSpecCodingArtifactTab(artifactKey);
    setSpecRevisionTarget(artifactKey);
    setSpecRevisionDraft(artifact?.content || '');
    setSpecRevisionSummary('');
    setSpecTaskFormatErrors([]);
    setSpecTaskValidationIssues([]);
    setSpecTaskValidationDetails([]);
    setActiveSpecTaskIssueKey(null);
    setSpecRevisionCandidate(null);
    setSpecArtifactViewMode('edit');
    setSpecCodingExplorerTab('artifacts');
    setSpecCodingModalOpen(true);
  }, [specCodingArtifactEntries]);
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
  const focusSpecTaskIssue = useCallback((issue: TasksMarkdownValidationIssue, index: number) => {
    const editor = specTaskEditorRef.current;
    const model = editor?.getModel?.();
    const lineNumber = issue.lineNumber && issue.lineNumber > 0 ? issue.lineNumber : 1;
    setActiveSpecTaskIssueKey(`${issue.code}:${issue.lineNumber ?? 'global'}:${index}`);
    if (!editor || !model) return;
    const lineLength = model.getLineLength?.(lineNumber) ?? 1;
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column: Math.max(1, lineLength) });
    editor.focus();
  }, []);

  useEffect(() => {
    const editor = specTaskEditorRef.current;
    const monaco = specTaskMonacoRef.current;
    const model = editor?.getModel?.();
    if (!editor || !monaco || !model) return;

    const taskIssues = specRevisionTarget === 'tasks' ? specTaskValidationIssues : [];
    const markers = taskIssues
      .filter((issue) => issue.lineNumber && issue.lineNumber > 0)
      .map((issue) => {
        const lineNumber = issue.lineNumber as number;
        const lineLength = model.getLineLength?.(lineNumber) ?? 1;
        return {
          startLineNumber: lineNumber,
          startColumn: 1,
          endLineNumber: lineNumber,
          endColumn: Math.max(lineLength, 1),
          message: issue.suggestion ? `${issue.message}\n建议修改：${issue.suggestion}` : issue.message,
          severity: monaco.editor.MarkerSeverity.Error,
        };
      });

    monaco.editor.setModelMarkers(model, 'spec-task-validation', markers);

    const nextDecorations = taskIssues
      .filter((issue) => issue.lineNumber && issue.lineNumber > 0)
      .map((issue, index) => {
        const lineNumber = issue.lineNumber as number;
        const key = `${issue.code}:${issue.lineNumber ?? 'global'}:${index}`;
        return {
          range: new monaco.Range(lineNumber, 1, lineNumber, 1),
          options: {
            isWholeLine: true,
            className: key === activeSpecTaskIssueKey ? 'ace-spec-task-line-active' : 'ace-spec-task-line-error',
            glyphMarginClassName: key === activeSpecTaskIssueKey ? 'ace-spec-task-glyph-active' : 'ace-spec-task-glyph-error',
            linesDecorationsClassName: key === activeSpecTaskIssueKey ? 'ace-spec-task-lines-active' : 'ace-spec-task-lines-error',
          },
        };
      });

    specTaskDecorationIdsRef.current = editor.deltaDecorations(specTaskDecorationIdsRef.current, nextDecorations);

    return () => {
      monaco.editor.setModelMarkers(model, 'spec-task-validation', []);
      specTaskDecorationIdsRef.current = editor.deltaDecorations(specTaskDecorationIdsRef.current, []);
    };
  }, [activeSpecTaskIssueKey, specRevisionTarget, specTaskValidationIssues]);
  const specCodingCodingSaveDialog = useCallback((artifactKey: SpecCodingArtifactKey) => {
    setSpecCodingArtifactTab(artifactKey);
    setSpecCodingSaveScope('personal');
    setSpecCodingSaveDirectory('');
    setSpecCodingSaveDialogOpen(true);
  }, []);
  const applySuggestedSpecTaskBindings = useCallback(() => {
    if (!specBindingReview?.suggestedConfig) return;
    latestEditingConfigRef.current = specBindingReview.suggestedConfig;
    dispatch({ type: 'SET_EDITING_CONFIG', payload: specBindingReview.suggestedConfig });
    setDesignTab('orchestration');
    setSpecBindingReview(null);
    toast('success', '已把建议的 task 绑定写入当前工作流草稿，请保存工作流配置使其生效');
  }, [dispatch, specBindingReview, toast]);
  const handleSaveSpecRevision = useCallback(async () => {
    if (!creationSessionSummary?.id || !specCodingDetails || !specCodingSummary) {
      toast('error', '当前工作流没有可修订的创建期 Spec');
      return;
    }
    setSpecTaskFormatErrors([]);
    const content = specRevisionDraft.trimEnd();
    if (!content.trim()) {
      toast('error', '修订内容不能为空');
      return;
    }
    const currentContent = specRevisionBaseArtifact?.content || '';
    if (content === currentContent.trimEnd()) {
      toast('warning', '修订内容没有变化');
      return;
    }

    const label = specRevisionBaseArtifact?.label || `${specRevisionTarget}.md`;
    const revisionSummary = specRevisionSummary.trim() || `设计页手动修订 ${label}`;
    const nextArtifacts = {
      ...(specCodingDetails.artifacts || {}),
      [specRevisionTarget]: content,
    };
    const nextSpecCoding = {
      id: specCodingSummary.id,
      version: specCodingSummary.version,
      status: specCodingSummary.status,
      summary: specCodingSummary.summary || revisionSummary,
      workflowName: workflowConfig?.workflow?.name || creationSessionSummary.workflowName || configFile,
      phases: specCodingDetails.phases || [],
      assignments: specCodingDetails.assignments || [],
      checkpoints: specCodingDetails.checkpoints || [],
      tasks: specCodingDetails.tasks || [],
      progress: specCodingSummary.progress || {
        overallStatus: 'pending',
        completedPhaseIds: [],
        activePhaseId: specCodingDetails.phases?.[0]?.id,
      },
      revisions: specCodingDetails.revisions || [],
      artifacts: nextArtifacts,
      linkedConfigFilename: configFile,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      setSavingSpecRevision(true);
      const isTasksArtifact = specRevisionTarget === 'tasks';
      const data = await specCodingApi.updateCreationSession(creationSessionSummary.id, {
        specCoding: nextSpecCoding,
        specCodingStatus: specCodingSummary.status,
        revisionSummary,
        config: isTasksArtifact ? (editingConfig || workflowConfig) : undefined,
      });
      const session = data.session;
      if (!session?.specCoding) {
        throw new Error('保存后没有返回 Spec 内容');
      }
      const updatedSpec = session.specCoding;
      const snapshots = normalizeSpecArtifactSnapshots(session.artifactSnapshots);
      setSpecCodingSummary({
        id: updatedSpec.id,
        version: updatedSpec.version,
        status: updatedSpec.status,
        source: 'creation',
        summary: updatedSpec.summary,
        phaseCount: updatedSpec.phases?.length || 0,
        taskCount: updatedSpec.tasks?.length || 0,
        assignmentCount: updatedSpec.assignments?.length || 0,
        checkpointCount: updatedSpec.checkpoints?.length || 0,
        progress: updatedSpec.progress,
        latestRevision: updatedSpec.revisions?.at(-1) || null,
      });
      setSpecCodingDetails({
        phases: updatedSpec.phases || [],
        tasks: updatedSpec.tasks || [],
        assignments: updatedSpec.assignments || [],
        checkpoints: updatedSpec.checkpoints || [],
        revisions: updatedSpec.revisions || [],
        artifactSnapshots: snapshots,
        artifacts: updatedSpec.artifacts || {},
      });
      setSpecArtifactSnapshots(snapshots);
      setSpecRevisionDraft('');
      setSpecRevisionSummary('');
      setSpecCodingArtifactTab(specRevisionTarget);
      setSpecCodingExplorerTab('revisions');
      setSpecTaskFormatErrors([]);
      setSpecTaskValidationIssues([]);
      setSpecTaskValidationDetails([]);
      setActiveSpecTaskIssueKey(null);
      if (isTasksArtifact) {
        const sourceConfig = editingConfig || workflowConfig;
        if (sourceConfig) {
          const compiled = compileStepTaskBindings(sourceConfig as any, updatedSpec as any);
          if (compiled.validation.errors.length > 0 || compiled.validation.warnings.length > 0) {
            setSpecBindingReview({
              validation: compiled.validation,
              suggestedConfig: compiled.config,
            });
          } else {
            setSpecBindingReview(null);
          }
        }
      }
      toast('success', `${label} 修订已保存`);
    } catch (error: any) {
      const taskErrors = Array.isArray(error?.data?.taskValidation?.errors)
        ? error.data.taskValidation.errors.filter((item: unknown) => typeof item === 'string')
        : [];
      const taskIssues = Array.isArray(error?.data?.taskValidation?.issues)
        ? error.data.taskValidation.issues.filter((item: unknown) => item && typeof item === 'object')
        : [];
      const validationDetails = Array.isArray(error?.data?.details)
        ? error.data.details.filter((item: unknown) => typeof item === 'string')
        : [];
      if (taskIssues.length > 0 || taskErrors.length > 0) {
        setSpecTaskFormatErrors(taskErrors as string[]);
        setSpecTaskValidationIssues(taskIssues as TasksMarkdownValidationIssue[]);
        setSpecTaskValidationDetails([]);
        setActiveSpecTaskIssueKey(null);
      } else if (validationDetails.length > 0) {
        setSpecTaskFormatErrors([]);
        setSpecTaskValidationIssues([]);
        setSpecTaskValidationDetails(validationDetails as string[]);
        setActiveSpecTaskIssueKey(null);
      }
      toast('error', error?.message || '保存 Spec 修订失败');
    } finally {
      setSavingSpecRevision(false);
    }
  }, [
    configFile,
    creationSessionSummary,
    editingConfig,
    specCodingDetails,
    specCodingSummary,
    specRevisionBaseArtifact,
    specRevisionDraft,
    specRevisionSummary,
    specRevisionTarget,
    toast,
    workflowConfig,
  ]);
  const refreshCreationSpecSnapshots = useCallback(async () => {
    if (!creationSessionSummary?.id) {
      setSpecArtifactSnapshots([]);
      return null;
    }
    try {
      const data = await specCodingApi.getCreationSession(creationSessionSummary.id);
      const session = data.session;
      const snapshots = normalizeSpecArtifactSnapshots(session?.artifactSnapshots);
      setSpecArtifactSnapshots(snapshots);
      setSpecRollbackTargetVersion((current) => {
        if (current && snapshots.some((snapshot: SpecArtifactSnapshot) => String(snapshot.version) === current)) return current;
        const previous = [...snapshots]
          .filter((snapshot) => snapshot.version !== specCodingSummary?.version)
          .sort((a, b) => b.version - a.version)[0];
        return previous ? String(previous.version) : '';
      });
      return session || null;
    } catch {
      setSpecArtifactSnapshots([]);
      return null;
    }
  }, [creationSessionSummary?.id, specCodingSummary?.version]);

  useEffect(() => {
    void refreshCreationSpecSnapshots();
  }, [refreshCreationSpecSnapshots]);

  const saveSpecArtifactsRevision = useCallback(async (input: {
    artifacts: SpecCodingArtifactDrafts;
    revisionSummary: string;
    focusArtifact?: SpecCodingArtifactKey;
  }) => {
    if (!creationSessionSummary?.id || !specCodingDetails || !specCodingSummary) {
      toast('error', '当前工作流没有可修订的创建期 Spec');
      return false;
    }

    const nextSpecCoding = {
      id: specCodingSummary.id,
      version: specCodingSummary.version,
      status: specCodingSummary.status,
      summary: specCodingSummary.summary || input.revisionSummary,
      workflowName: workflowConfig?.workflow?.name || creationSessionSummary.workflowName || configFile,
      phases: specCodingDetails.phases || [],
      assignments: specCodingDetails.assignments || [],
      checkpoints: specCodingDetails.checkpoints || [],
      tasks: specCodingDetails.tasks || [],
      progress: specCodingSummary.progress || {
        overallStatus: 'pending',
        completedPhaseIds: [],
        activePhaseId: specCodingDetails.phases?.[0]?.id,
      },
      revisions: specCodingDetails.revisions || [],
      artifacts: {
        ...(specCodingDetails.artifacts || {}),
        ...input.artifacts,
      },
      linkedConfigFilename: configFile,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      setSavingSpecRevision(true);
      setSpecTaskFormatErrors([]);
      const data = await specCodingApi.updateCreationSession(creationSessionSummary.id, {
        specCoding: nextSpecCoding,
        specCodingStatus: specCodingSummary.status,
        revisionSummary: input.revisionSummary,
        config: editingConfig || workflowConfig || undefined,
      });
      const session = data.session;
      if (!session?.specCoding) throw new Error('保存后没有返回 Spec 内容');
      const updatedSpec = session.specCoding;
      const snapshots = normalizeSpecArtifactSnapshots(session.artifactSnapshots);

      setSpecCodingSummary({
        id: updatedSpec.id,
        version: updatedSpec.version,
        status: updatedSpec.status,
        source: 'creation',
        summary: updatedSpec.summary,
        phaseCount: updatedSpec.phases?.length || 0,
        taskCount: updatedSpec.tasks?.length || 0,
        assignmentCount: updatedSpec.assignments?.length || 0,
        checkpointCount: updatedSpec.checkpoints?.length || 0,
        progress: updatedSpec.progress,
        latestRevision: updatedSpec.revisions?.at(-1) || null,
      });
      setSpecCodingDetails({
        phases: updatedSpec.phases || [],
        tasks: updatedSpec.tasks || [],
        assignments: updatedSpec.assignments || [],
        checkpoints: updatedSpec.checkpoints || [],
        revisions: updatedSpec.revisions || [],
        artifactSnapshots: snapshots,
        artifacts: updatedSpec.artifacts || {},
      });
      setSpecArtifactSnapshots(snapshots);
      setSpecRevisionCandidate(null);
      setSpecRevisionDraft('');
      setSpecRevisionSummary('');
      setSpecTaskFormatErrors([]);
      setSpecTaskValidationIssues([]);
      setSpecTaskValidationDetails([]);
      setActiveSpecTaskIssueKey(null);
      if (input.focusArtifact) {
        setSpecCodingArtifactTab(input.focusArtifact);
        setSpecRevisionTarget(input.focusArtifact);
      }
      setSpecCodingExplorerTab('revisions');

      const sourceConfig = editingConfig || workflowConfig;
      if (sourceConfig) {
        const compiled = compileStepTaskBindings(sourceConfig as any, updatedSpec as any);
        if (compiled.validation.errors.length > 0 || compiled.validation.warnings.length > 0) {
          setSpecBindingReview({ validation: compiled.validation, suggestedConfig: compiled.config });
        } else {
          setSpecBindingReview(null);
        }
      }
      return true;
    } catch (error: any) {
      const taskErrors = Array.isArray(error?.data?.taskValidation?.errors)
        ? error.data.taskValidation.errors.filter((item: unknown) => typeof item === 'string')
        : [];
      const taskIssues = Array.isArray(error?.data?.taskValidation?.issues)
        ? error.data.taskValidation.issues.filter((item: unknown) => item && typeof item === 'object')
        : [];
      const validationDetails = Array.isArray(error?.data?.details)
        ? error.data.details.filter((item: unknown) => typeof item === 'string')
        : [];
      if (taskIssues.length > 0 || taskErrors.length > 0) {
        setSpecTaskFormatErrors(taskErrors as string[]);
        setSpecTaskValidationIssues(taskIssues as TasksMarkdownValidationIssue[]);
        setSpecTaskValidationDetails([]);
        setActiveSpecTaskIssueKey(null);
      } else if (validationDetails.length > 0) {
        setSpecTaskFormatErrors([]);
        setSpecTaskValidationIssues([]);
        setSpecTaskValidationDetails(validationDetails as string[]);
        setActiveSpecTaskIssueKey(null);
      }
      toast('error', error?.message || '保存 Spec 修订失败');
      return false;
    } finally {
      setSavingSpecRevision(false);
    }
  }, [
    configFile,
    creationSessionSummary,
    editingConfig,
    specCodingDetails,
    specCodingSummary,
    toast,
    workflowConfig,
  ]);

  const buildSpecAiRevisionPrompt = useCallback((instruction: string) => {
    const workflowName = workflowConfig?.workflow?.name || creationSessionSummary?.workflowName || configFile;
    return [
      '请基于当前工作流 Spec 制品和用户修订要求，生成一版完整的 Spec 修订候选。',
      '生成内容保持候选状态；系统会先展示 diff，由用户确认后再应用。',
      '必须同时返回完整 requirements、design、tasks 三份制品，即使用户只要求修改其中一份，也要保持三份制品互相一致。',
      '保持原文主语言、术语、需求编号、任务编号和 workflow step 绑定关系一致；保留仍然有效的 spec-coding-task 注释。',
      '',
      `工作流：${workflowName}`,
      workflowConfig?.workflow?.description ? `工作流描述：${workflowConfig.workflow.description}` : '',
      requirements ? `原始需求：${requirements}` : '',
      '',
      '用户修订要求：',
      instruction,
      '',
      '当前 requirements.md：',
      '```markdown',
      currentSpecArtifacts.requirements.slice(0, 12000),
      '```',
      '',
      '当前 design.md：',
      '```markdown',
      currentSpecArtifacts.design.slice(0, 12000),
      '```',
      '',
      '当前 tasks.md：',
      '```markdown',
      currentSpecArtifacts.tasks.slice(0, 12000),
      '```',
      '',
      '输出要求：',
      '1. 可以先简短说明修订思路。',
      '2. 最终必须在 <result>...</result> 内输出一个 JSON 对象，直接输出原始 JSON。',
      '3. JSON 格式必须是 {"kind":"spec_artifact_revision","payload":{"summary":"一句话摘要","revisionPlan":[{"artifact":"requirements","op":"modify","targetId":"R1","reason":"为什么改"}],"artifacts":{"requirements":"# requirements.md\\n...","design":"# design.md\\n...","tasks":"# tasks.md\\n..."}}}。',
      '4. artifacts 的三个字段都必须是完整 markdown 字符串，不能只返回片段或 patch。',
      '5. revisionPlan 必须用 add / modify / remove / rename 描述具体 R/D/T 或章节的变化，并写清具体影响。',
      '6. requirements 必须保留 R 编号、用户故事和 WHEN/THEN；design 必须保留 D 编号、接口/数据/测试/风险；tasks 必须保留 T 编号、需求追踪、设计追踪、动作、交付和验证。',
      '7. 输出以 </result> 作为结束。',
    ].filter(Boolean).join('\n\n');
  }, [
    configFile,
    creationSessionSummary?.workflowName,
    currentSpecArtifacts.design,
    currentSpecArtifacts.requirements,
    currentSpecArtifacts.tasks,
    requirements,
    workflowConfig?.workflow?.description,
    workflowConfig?.workflow?.name,
  ]);

  const validateSpecRevisionArtifacts = useCallback(async (artifacts: SpecCodingArtifactDrafts): Promise<SpecArtifactQualityReport | null> => {
    const data = await specCodingApi.validateArtifactsQuality(artifacts);
    return data.qualityValidation || null;
  }, []);

  const applySpecTaskValidationDisplay = useCallback((qualityValidation: SpecArtifactQualityReport | null) => {
    const taskValidation = qualityValidation?.taskValidation;
    const taskErrors = Array.isArray(taskValidation?.errors)
      ? taskValidation.errors.filter((item: unknown) => typeof item === 'string')
      : [];
    const taskIssues = Array.isArray(taskValidation?.issues)
      ? taskValidation.issues.filter((item: unknown) => item && typeof item === 'object')
      : [];
    setSpecTaskFormatErrors(taskErrors as string[]);
    setSpecTaskValidationIssues(taskIssues as TasksMarkdownValidationIssue[]);
    setSpecTaskValidationDetails([]);
    setActiveSpecTaskIssueKey(null);
  }, []);

  const handleGenerateAiSpecRevision = useCallback(async () => {
    const instruction = specAiInstruction.trim();
    if (!instruction) {
      toast('warning', '请先写清楚要怎么修订 Spec');
      return;
    }
    if (!creationSessionSummary?.id || !specCodingSummary || !specCodingDetails) {
      toast('error', '当前工作流没有可修订的创建期 Spec');
      return;
    }
    const model = workflowDefaultModel || globalDefaultModel;
    const selectedEngine = engine || globalEngine;
    if (!model || !selectedEngine) {
      toast('error', '缺少可用的 AI engine/model 配置');
      return;
    }

    setSpecAiRevising(true);
    setSpecAiStream('');
    if (!specAiSessionId) {
      setSpecRevisionCandidate(null);
    }
    setSpecTaskFormatErrors([]);
    setSpecTaskValidationIssues([]);
    setSpecTaskValidationDetails([]);
    const now = new Date().toISOString();
    const userMessageId = `spec-revision-user-${Date.now()}`;
    const assistantMessageId = `spec-revision-assistant-${Date.now()}`;
    setSpecAiMessages((messages) => [
      ...messages,
      {
        id: userMessageId,
        role: 'user',
        content: instruction,
        createdAt: now,
        status: 'completed',
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: now,
        status: 'streaming',
      },
    ]);

    try {
      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          message: specAiSessionId ? instruction : buildSpecAiRevisionPrompt(instruction),
          displayMessage: `AI 优化 Spec：${instruction.slice(0, 80)}`,
          model,
          engine: selectedEngine,
          sessionId: specAiSessionId || undefined,
          frontendSessionId: `spec-revision-${creationSessionSummary.id}`,
          streamScope: 'workbench-spec-revision',
          mode: 'dashboard',
          workingDirectory: resolvedProjectRoot || projectRoot || undefined,
          skipUserMessage: true,
        }),
      });
      const startData = await startRes.json().catch(() => null);
      if (!startRes.ok || !startData?.chatId) {
        throw new Error(startData?.error || '启动 AI Spec 修订失败');
      }

      const finalContent = await new Promise<string>((resolve, reject) => {
        const es = createSafeEventSource(`/api/chat/stream?id=${encodeURIComponent(startData.chatId)}`);
        let accumulated = '';
        let thinkingAccumulated = '';
        let settled = false;
        let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;
        const updateAssistantMessage = (content: string, status: SpecRevisionMessage['status']) => {
          setSpecAiMessages((messages) => messages.map((message) => (
            message.id === assistantMessageId
              ? { ...message, content, status }
              : message
          )));
        };
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          es.close();
          updateAssistantMessage(accumulated || thinkingAccumulated || message, 'failed');
          reject(new Error(message));
        };
        es.addEventListener('delta', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          accumulated += String(data.content || '');
          const row = storeChatStreamSseEventAsAgentMessage('delta', data, {
            chatId: startData.chatId,
            runId: runId || selectedRun?.id || undefined,
            stepKey: 'workbench-spec-revision',
            provider: data.engine || selectedEngine,
            model: data.model || model,
            sessionId: data.sessionId || specAiSessionId || undefined,
            frontendSessionId: `spec-revision-${creationSessionSummary.id}`,
            streamScope: 'workbench-spec-revision',
          }, aiPrevious);
          aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          setSpecAiStream(accumulated);
          updateAssistantMessage(accumulated, 'streaming');
        });
        es.addEventListener('thinking', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          thinkingAccumulated += String(data.content || '');
          const row = storeChatStreamSseEventAsAgentMessage('thinking', data, {
            chatId: startData.chatId,
            runId: runId || selectedRun?.id || undefined,
            stepKey: 'workbench-spec-revision',
            provider: data.engine || selectedEngine,
            model: data.model || model,
            sessionId: data.sessionId || specAiSessionId || undefined,
            frontendSessionId: `spec-revision-${creationSessionSummary.id}`,
            streamScope: 'workbench-spec-revision',
          }, aiPrevious);
          aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          if (!accumulated) {
            setSpecAiStream(thinkingAccumulated);
            updateAssistantMessage(thinkingAccumulated, 'streaming');
          }
        });
        es.addEventListener('session', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          if (data.sessionId) {
            setSpecAiSessionId(String(data.sessionId));
          }
        });
        es.addEventListener('done', (event) => {
          if (settled) return;
          settled = true;
          const data = parseAceSseEventData((event as MessageEvent).data);
          es.close();
          if (data.sessionId) {
            setSpecAiSessionId(String(data.sessionId));
          }
          if (data.isError) {
            storeChatStreamSseEventAsAgentMessage('error', {
              ...data,
              content: data.error || data.result || accumulated || 'AI Spec 修订失败',
              isError: true,
            }, {
              chatId: startData.chatId,
              runId: runId || selectedRun?.id || undefined,
              stepKey: 'workbench-spec-revision',
              provider: data.engine || selectedEngine,
              model: data.model || model,
              sessionId: data.sessionId || specAiSessionId || undefined,
              frontendSessionId: `spec-revision-${creationSessionSummary.id}`,
              streamScope: 'workbench-spec-revision',
            }, aiPrevious);
            updateAssistantMessage(data.error || data.result || accumulated || 'AI Spec 修订失败', 'failed');
            reject(new Error(data.error || data.result || accumulated || 'AI Spec 修订失败'));
            return;
          }
          const finalText = String(data.result || accumulated || '');
          const row = storeChatStreamSseEventAsAgentMessage('done', {
            ...data,
            content: finalText,
          }, {
            chatId: startData.chatId,
            runId: runId || selectedRun?.id || undefined,
            stepKey: 'workbench-spec-revision',
            provider: data.engine || selectedEngine,
            model: data.model || model,
            sessionId: data.sessionId || specAiSessionId || undefined,
            frontendSessionId: `spec-revision-${creationSessionSummary.id}`,
            streamScope: 'workbench-spec-revision',
          }, aiPrevious);
          aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          updateAssistantMessage(finalText, 'completed');
          resolve(finalText);
        });
        es.addEventListener('engine_error', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          fail(data.message || 'AI Spec 修订失败');
        });
        es.addEventListener('failed', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          fail(data.message || 'AI Spec 修订失败');
        });
        es.onerror = () => fail('AI Spec 修订连接中断');
      });

      const parsed = extractSpecArtifactRevisionResult(finalContent, currentSpecArtifacts);
      if (!parsed) {
        throw new Error(diagnoseExtractionFailure(finalContent, 'spec_artifact_revision'));
      }
      const qualityValidation = await validateSpecRevisionArtifacts(parsed.artifacts);
      applySpecTaskValidationDisplay(qualityValidation);
      setSpecRevisionCandidate({
        source: 'ai',
        summary: parsed.summary,
        artifacts: parsed.artifacts,
        revisionPlan: parsed.revisionPlan,
        createdAt: new Date().toISOString(),
        rawOutput: finalContent,
        qualityValidation,
      });
      setSpecRevisionSummary(parsed.summary);
      setSpecRevisionTarget(specCodingArtifactTab);
      setSpecArtifactViewMode('diff');
      setSpecCodingExplorerTab('artifacts');
      if (qualityValidation?.ok === false) {
        toast('warning', 'AI 已生成优化建议，但校验未通过；请继续调整后再应用');
      } else {
        toast('success', specAiSessionId ? 'AI 已更新 Spec 优化建议，请检查差异后应用' : 'AI 已生成 Spec 优化建议，请检查差异后应用');
      }
    } catch (error: any) {
      setSpecAiMessages((messages) => messages.map((message) => (
        message.id === assistantMessageId && message.status === 'streaming'
          ? { ...message, content: message.content || error?.message || 'AI Spec 修订失败', status: 'failed' }
          : message
      )));
      toast('error', error?.message || 'AI Spec 修订失败');
    } finally {
      setSpecAiRevising(false);
    }
  }, [
    buildSpecAiRevisionPrompt,
    creationSessionSummary?.id,
    currentSpecArtifacts,
    engine,
    globalDefaultModel,
    globalEngine,
    applySpecTaskValidationDisplay,
    projectRoot,
    resolvedProjectRoot,
    specAiInstruction,
    specAiSessionId,
    specCodingArtifactTab,
    specCodingDetails,
    specCodingSummary,
    toast,
    validateSpecRevisionArtifacts,
    workflowDefaultModel,
  ]);

  const handleApplySpecRevisionCandidate = useCallback(async () => {
    if (!specRevisionCandidate) return;
    const qualityErrors = specRevisionCandidate.qualityValidation?.errors || [];
    if (qualityErrors.length > 0) {
      toast('error', 'Spec 候选仍有校验错误，请先让 AI 修正后再应用');
      return;
    }
    const ok = await saveSpecArtifactsRevision({
      artifacts: specRevisionCandidate.artifacts,
      revisionSummary: specRevisionSummary.trim() || specRevisionCandidate.summary,
      focusArtifact: specRevisionTarget,
    });
    if (ok) {
      toast('success', 'Spec 优化建议已应用');
    }
  }, [saveSpecArtifactsRevision, specRevisionCandidate, specRevisionSummary, specRevisionTarget, toast]);

  const handleCreateRollbackCandidate = useCallback(() => {
    const snapshot = sortedSpecArtifactSnapshots.find((item) => String(item.version) === specRollbackTargetVersion);
    if (!snapshot) {
      toast('warning', '请选择要回退的 Spec 版本');
      return;
    }
    setSpecRevisionCandidate({
      source: 'rollback',
      summary: `回退 Spec 到 v${snapshot.version}: ${snapshot.summary}`,
      artifacts: normalizeSpecArtifactDrafts(snapshot.artifacts),
      createdAt: new Date().toISOString(),
      targetVersion: snapshot.version,
    });
    setSpecRevisionSummary(`回退 Spec 到 v${snapshot.version}: ${snapshot.summary}`);
    setSpecArtifactViewMode('diff');
    setSpecCodingExplorerTab('artifacts');
    toast('success', `已载入 v${snapshot.version} 回退候选，请检查 diff 后应用`);
  }, [sortedSpecArtifactSnapshots, specRollbackTargetVersion, toast]);

  const handleDiscardSpecRevisionCandidate = useCallback(() => {
    setSpecRevisionCandidate(null);
    setSpecRevisionSummary('');
    setSpecTaskFormatErrors([]);
    setSpecTaskValidationIssues([]);
    setSpecTaskValidationDetails([]);
    setActiveSpecTaskIssueKey(null);
    if (specArtifactViewMode === 'diff' && !specRevisionDraft.trim()) {
      setSpecArtifactViewMode('preview');
    }
  }, [specArtifactViewMode, specRevisionDraft]);
  const buildDefaultDesignOptimizationInstruction = useCallback((target: DesignOptimizationTarget) => {
    const specContextHint = specDesignEnabled ? '、Spec 任务绑定' : '';
    if (target.scope === 'workflow') {
      return `请重新审视整个工作流编排，优化阶段/状态划分、Agent 分工、步骤任务说明${specContextHint}和审查策略。`;
    }
    if (target.scope === 'state') {
      return `请优化状态「${target.stateName}」，重点检查状态描述、内部步骤拆分、Agent 分工、转移规则${specContextHint}和人工审查策略。`;
    }
    return `请优化步骤「${target.stepName}」，重点检查 Agent 选择、task 提示词、constraints、skills${specDesignEnabled ? ' 和 specTaskBinding' : ''}。`;
  }, [specDesignEnabled]);
  const openDesignOptimizationDialog = useCallback((target: DesignOptimizationTarget, presetInstruction?: string) => {
    setDesignOptimizationTarget(target);
    setDesignOptimizationInstruction(presetInstruction || buildDefaultDesignOptimizationInstruction(target));
    setDesignOptimizationDialogOpen(true);
    setDesignOptimizationGenerating(false);
    setDesignOptimizationStream('');
    setDesignOptimizationCandidate(null);
    setDesignOptimizationMessages([]);
    setDesignOptimizationSessionId(null);
  }, [buildDefaultDesignOptimizationInstruction]);
  const handleOpenWorkflowOptimization = useCallback(() => {
    const sourceConfig = editingConfig || workflowConfig;
    if (!sourceConfig?.workflow) {
      toast('warning', '当前没有可优化的工作流草稿');
      return;
    }
    openDesignOptimizationDialog({
      scope: 'workflow',
      workflowMode: getWorkflowMode(sourceConfig),
      workflowName: sourceConfig.workflow.name || configFile,
    });
  }, [configFile, editingConfig, openDesignOptimizationDialog, toast, workflowConfig]);
  const handleOptimizeStateMachineState = useCallback((
    stateIndex: number,
    presetInstruction?: string,
    reviewPolicyOnly?: boolean,
    unlockForAi?: boolean,
  ) => {
    const sourceConfig = editingConfig || workflowConfig;
    const stateNode = sourceConfig?.workflow?.states?.[stateIndex];
    if (!stateNode) {
      toast('warning', '找不到要优化的状态');
      return;
    }
    openDesignOptimizationDialog({
      scope: 'state',
      workflowMode: 'state-machine',
      stateIndex,
      stateName: stateNode.name || `状态 ${stateIndex + 1}`,
      stateId: stateNode.id,
      reviewPolicyOnly,
      unlockForAi,
    }, presetInstruction);
  }, [editingConfig, openDesignOptimizationDialog, toast, workflowConfig]);
  const handleOptimizeStateMachineStep = useCallback((stateIndex: number, stepIndex: number) => {
    const sourceConfig = editingConfig || workflowConfig;
    const stateNode = sourceConfig?.workflow?.states?.[stateIndex];
    const step = stateNode?.steps?.[stepIndex];
    if (!stateNode || !step) {
      toast('warning', '找不到要优化的步骤');
      return;
    }
    openDesignOptimizationDialog({
      scope: 'step',
      workflowMode: 'state-machine',
      containerType: 'state',
      containerIndex: stateIndex,
      containerName: stateNode.name || `状态 ${stateIndex + 1}`,
      stepIndex,
      stepName: step.name || `步骤 ${stepIndex + 1}`,
    });
  }, [editingConfig, openDesignOptimizationDialog, toast, workflowConfig]);
  const handleGenerateDesignOptimization = useCallback(async () => {
    const instruction = designOptimizationInstruction.trim();
    const target = designOptimizationTarget;
    const sourceConfig = editingConfig || workflowConfig;
    if (!target) {
      toast('warning', '请先选择要优化的范围');
      return;
    }
    if (!instruction) {
      toast('warning', '请先写清楚要如何优化');
      return;
    }
    if (!sourceConfig?.workflow) {
      toast('error', '当前没有可优化的工作流草稿');
      return;
    }
    const model = workflowDefaultModel || globalDefaultModel;
    const selectedEngine = engine || globalEngine;
    if (!model || !selectedEngine) {
      toast('error', '缺少可用的 AI engine/model 配置');
      return;
    }

    const now = new Date().toISOString();
    const userMessageId = `design-opt-user-${Date.now()}`;
    const assistantMessageId = `design-opt-assistant-${Date.now()}`;
    setDesignOptimizationGenerating(true);
    setDesignOptimizationStream('');
    if (!designOptimizationSessionId) {
      setDesignOptimizationCandidate(null);
    }
    setDesignOptimizationMessages((messages) => [
      ...messages,
      {
        id: userMessageId,
        role: 'user',
        content: instruction,
        createdAt: now,
        status: 'completed',
      },
      {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        createdAt: now,
        status: 'streaming',
      },
    ]);

    try {
      const startRes = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          message: designOptimizationSessionId
            ? instruction
            : buildDesignOptimizationPrompt({
                target,
                workflowName: sourceConfig.workflow.name || creationSessionSummary?.workflowName || configFile,
                configFile,
                instruction,
                currentConfig: sourceConfig,
                currentSpecArtifacts,
                requirements,
                availableAgents: agentConfigs.map((agent: any) => ({
                  name: agent?.name,
                  team: agent?.team,
                  roleType: agent?.roleType,
                  description: agent?.description,
                  capabilities: Array.isArray(agent?.capabilities) ? agent.capabilities : [],
                })),
                availableSkills,
                specTasks: designOptimizationSpecTaskOptions,
              }),
          displayMessage: `${getDesignOptimizationDialogTitle(target)}：${instruction.slice(0, 80)}`,
          model,
          engine: selectedEngine,
          sessionId: designOptimizationSessionId || undefined,
          frontendSessionId: `design-opt-${configFile}-${target.scope}`,
          streamScope: 'workbench-design-optimization',
          mode: 'dashboard',
          workingDirectory: resolvedProjectRoot || projectRoot || undefined,
          skipUserMessage: true,
        }),
      });
      const startData = await startRes.json().catch(() => null);
      if (!startRes.ok || !startData?.chatId) {
        throw new Error(startData?.error || '启动 AI 工作流优化失败');
      }

      const finalContent = await new Promise<string>((resolve, reject) => {
        const es = createSafeEventSource(`/api/chat/stream?id=${encodeURIComponent(startData.chatId)}`);
        let accumulated = '';
        let thinkingAccumulated = '';
        let settled = false;
        let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined;
        let streamUpdateTimer: ReturnType<typeof setTimeout> | null = null;
        let lastStreamUpdateAt = 0;
        let pendingStreamContent = '';
        let pendingStreamStatus: DesignOptimizationMessage['status'] = 'streaming';
        const commitAssistantMessage = (content: string, status: DesignOptimizationMessage['status']) => {
          setDesignOptimizationMessages((messages) => messages.map((message) => (
            message.id === assistantMessageId
              ? { ...message, content, status }
              : message
          )));
        };
        const flushAssistantMessage = () => {
          if (streamUpdateTimer) {
            clearTimeout(streamUpdateTimer);
            streamUpdateTimer = null;
          }
          lastStreamUpdateAt = Date.now();
          commitAssistantMessage(pendingStreamContent, pendingStreamStatus);
        };
        const updateAssistantMessage = (content: string, status: DesignOptimizationMessage['status'], immediate = false) => {
          pendingStreamContent = content;
          pendingStreamStatus = status;
          if (immediate) {
            flushAssistantMessage();
            return;
          }
          const elapsed = Date.now() - lastStreamUpdateAt;
          if (elapsed >= DESIGN_OPTIMIZATION_STREAM_UPDATE_MS) {
            flushAssistantMessage();
            return;
          }
          if (!streamUpdateTimer) {
            streamUpdateTimer = setTimeout(flushAssistantMessage, DESIGN_OPTIMIZATION_STREAM_UPDATE_MS - elapsed);
          }
        };
        const fail = (message: string) => {
          if (settled) return;
          settled = true;
          es.close();
          updateAssistantMessage(accumulated || thinkingAccumulated || message, 'failed', true);
          reject(new Error(message));
        };
        es.addEventListener('delta', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          accumulated += String(data.content || '');
          updateAssistantMessage(accumulated, 'streaming');
        });
        es.addEventListener('thinking', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          thinkingAccumulated += String(data.content || '');
          if (!accumulated) {
            updateAssistantMessage(thinkingAccumulated, 'streaming');
          }
        });
        es.addEventListener('session', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          if (data.sessionId) {
            setDesignOptimizationSessionId(String(data.sessionId));
          }
        });
        es.addEventListener('done', (event) => {
          if (settled) return;
          settled = true;
          const data = parseAceSseEventData((event as MessageEvent).data);
          es.close();
          if (data.sessionId) {
            setDesignOptimizationSessionId(String(data.sessionId));
          }
          if (data.isError) {
            storeChatStreamSseEventAsAgentMessage('error', {
              ...data,
              content: data.error || data.result || accumulated || 'AI 工作流优化失败',
              isError: true,
            }, {
              chatId: startData.chatId,
              runId: runId || selectedRun?.id || undefined,
              stepKey: 'workbench-design-optimization',
              provider: data.engine || selectedEngine,
              model: data.model || model,
              sessionId: data.sessionId || designOptimizationSessionId || undefined,
              frontendSessionId: `design-opt-${configFile}-${target.scope}`,
              streamScope: 'workbench-design-optimization',
            }, aiPrevious);
            updateAssistantMessage(data.error || data.result || accumulated || 'AI 工作流优化失败', 'failed', true);
            reject(new Error(data.error || data.result || accumulated || 'AI 工作流优化失败'));
            return;
          }
          const finalText = String(data.result || accumulated || '');
          const row = storeChatStreamSseEventAsAgentMessage('done', {
            ...data,
            content: finalText,
          }, {
            chatId: startData.chatId,
            runId: runId || selectedRun?.id || undefined,
            stepKey: 'workbench-design-optimization',
            provider: data.engine || selectedEngine,
            model: data.model || model,
            sessionId: data.sessionId || designOptimizationSessionId || undefined,
            frontendSessionId: `design-opt-${configFile}-${target.scope}`,
            streamScope: 'workbench-design-optimization',
          }, aiPrevious);
          aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          updateAssistantMessage(finalText, 'completed', true);
          resolve(finalText);
        });
        es.addEventListener('engine_error', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          fail(data.message || 'AI 工作流优化失败');
        });
        es.addEventListener('failed', (event) => {
          const data = parseAceSseEventData((event as MessageEvent).data);
          fail(data.message || 'AI 工作流优化失败');
        });
        es.onerror = () => fail('AI 工作流优化连接中断');
      });

      const itemPreview = extractWorkflowPatchItemPayload(finalContent, configFile);
      if (itemPreview.parseError || !itemPreview.payload?.patch || !itemPreview.payload.scope || !itemPreview.payload.workflowMode) {
        throw new Error(itemPreview.parseError || diagnoseExtractionFailure(finalContent, 'workflow_patch_item'));
      }
      const payload: WorkflowPatchPayload = itemPreview.payload;
      if (!doesWorkflowPatchMatchTarget(payload, target, sourceConfig)) {
        throw new Error('AI 返回的 workflow_patch 作用域或工作流模式与当前目标不匹配');
      }
      const candidateConfig = applyDesignOptimizationPatch(sourceConfig, payload, target);
      if (!candidateConfig) {
        throw new Error('workflow_patch 无法应用到当前工作流草稿，请检查 patch 结构');
      }

      const validationRes = await configApi.validateConfig({ config: candidateConfig });
      const bindingResult = specDesignEnabled && specCodingDetails
        ? compileStepTaskBindings(candidateConfig as any, specCodingDetails as any, { requireFullCoverage: true })
        : null;
      const baseSnapshot = extractDesignOptimizationSnapshot(sourceConfig, target);
      const candidateSnapshot = extractDesignOptimizationSnapshot(candidateConfig, target);
      const patchValue = extractWorkflowPatchValue(payload, target);
      setDesignOptimizationCandidate({
        summary: payload.summary?.trim() || `${getDesignOptimizationTargetLabel(target)} ${designOptimizationSessionId ? '调整建议' : '优化建议'}`,
        createdAt: new Date().toISOString(),
        rawOutput: finalContent,
        filename: payload.filename,
        payload,
        target,
        candidateConfig,
        baseSnapshot: baseSnapshot ?? patchValue,
        candidateSnapshot: candidateSnapshot ?? patchValue,
        configValidation: validationRes?.validation
          ? {
              ok: !!validationRes.validation.ok,
              issues: Array.isArray(validationRes.validation.issues) ? validationRes.validation.issues : [],
            }
          : null,
        bindingValidation: bindingResult?.validation || null,
      });
      toast('success', designOptimizationSessionId ? 'AI 已更新优化建议，请检查差异后应用' : 'AI 已生成优化建议，请检查差异后应用');
    } catch (error: any) {
      setDesignOptimizationMessages((messages) => messages.map((message) => (
        message.id === assistantMessageId && message.status === 'streaming'
          ? { ...message, content: message.content || error?.message || 'AI 工作流优化失败', status: 'failed' }
          : message
      )));
      toast('error', error?.message || 'AI 工作流优化失败');
    } finally {
      setDesignOptimizationGenerating(false);
    }
  }, [
    agentConfigs,
    availableSkills,
    configFile,
    creationSessionSummary?.workflowName,
    currentSpecArtifacts,
    designOptimizationInstruction,
    designOptimizationSessionId,
    designOptimizationSpecTaskOptions,
    designOptimizationTarget,
    editingConfig,
    engine,
    globalDefaultModel,
    globalEngine,
    projectRoot,
    requirements,
    resolvedProjectRoot,
    specDesignEnabled,
    specCodingDetails,
    toast,
    workflowConfig,
    workflowDefaultModel,
  ]);
  const handleCloseDesignOptimizationDialog = useCallback(() => {
    setDesignOptimizationDialogOpen(false);
    setDesignOptimizationTarget(null);
    setDesignOptimizationGenerating(false);
    setDesignOptimizationCandidate(null);
    setDesignOptimizationStream('');
    setDesignOptimizationMessages([]);
    setDesignOptimizationSessionId(null);
  }, []);
  const handleApplyDesignOptimizationCandidate = useCallback(() => {
    if (!designOptimizationCandidate) return;
    const latestConfig = editingConfig || workflowConfig;
    if (!latestConfig) {
      toast('error', '当前工作流草稿已不可用，请重新生成优化建议');
      return;
    }
    const latestBaseSnapshot = extractDesignOptimizationSnapshot(latestConfig, designOptimizationCandidate.target);
    if (JSON.stringify(latestBaseSnapshot ?? null) !== JSON.stringify(designOptimizationCandidate.baseSnapshot ?? null)) {
      toast('warning', '目标内容在 AI 生成建议后已变化，请重新生成，避免覆盖较新的修改');
      return;
    }
    const candidateConfig = applyDesignOptimizationPatch(
      latestConfig,
      designOptimizationCandidate.payload,
      designOptimizationCandidate.target,
    );
    if (!candidateConfig) {
      toast('error', '优化建议已过期或无法安全应用，请重新生成');
      return;
    }
    latestEditingConfigRef.current = candidateConfig;
    dispatch({ type: 'SET_EDITING_CONFIG', payload: candidateConfig });
    handleCloseDesignOptimizationDialog();
    setDesignTab('orchestration');
    toast('success', 'AI 优化建议已应用到当前工作流草稿，请记得保存配置');
  }, [designOptimizationCandidate, dispatch, editingConfig, handleCloseDesignOptimizationDialog, toast, workflowConfig]);
  const handleDiscardDesignOptimizationCandidate = useCallback(() => {
    setDesignOptimizationCandidate(null);
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
    const names = resolveWorkflowPolicyAgentNames({
      workflow,
      agentConfigs,
      supervisorPosition: 'first',
    });
    const supervisorPolicyAgent = resolveWorkflowPolicySupervisorAgentName(workflow, agentConfigs);

    return names.map((name) => {
      const roleConfig = agentConfigs.find((role: any) => role.name === name);
      const selection = roleConfig
        ? resolveWorkflowAgentSelection(roleConfig, {
            engine: globalEngine,
            defaultModel: globalDefaultModel,
          }, {
            agentName: name,
            workflowContext: {
              engine,
              executionPolicy: currentWorkflowExecutionPolicy,
            },
          })
        : null;
      return {
        name,
        team: roleConfig?.team || (name === supervisorPolicyAgent ? 'black-gold' : 'blue'),
        engine: selection?.effectiveEngine || '',
        model: selection?.effectiveModel || '',
        status: 'waiting' as const,
        currentTask: null,
        completedTasks: 0,
        sessionId: null,
        tokenUsage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
      };
    });
  }, [agentConfigs, currentWorkflowExecutionPolicy, engine, globalDefaultModel, globalEngine, workflowConfig?.workflow]);

  const displayWorkflowAgents = useMemo(() => {
    const runtimeByName = new Map(agents.map((agent) => [agent.name, agent]));
    const configuredNames = new Set(configuredWorkflowAgents.map((agent) => agent.name));
    const configuredWithRuntime = configuredWorkflowAgents.map((agent) => {
      const runtimeAgent = runtimeByName.get(agent.name);
      if (!runtimeAgent) return agent;
      return {
        ...agent,
        ...runtimeAgent,
        engine: agent.engine || (runtimeAgent as any).engine || '',
        model: agent.model || (runtimeAgent as any).model || '',
      };
    });
    const runtimeRemainder = agents.filter((agent) => !configuredNames.has(agent.name));
    return [...configuredWithRuntime, ...runtimeRemainder];
  }, [agents, configuredWorkflowAgents]);

  const isRunning = workflowStatus === 'running' || workflowStatus === 'preparing';
  const canForceTransition = Boolean(runId || initialRunId || selectedRun?.id) && workflowConfig?.workflow?.mode === 'state-machine';
  const forceTransitionActionLabel = isRunning ? '强制跳转' : '强制恢复';
  const forceCompletableStep = workflowStatus === 'running'
    ? activeSteps.length > 1
      ? activeSteps.find((stepName) => workflowStepKeyMatchesName(stepName, selectedStep?.name)) || ''
      : (currentStep || activeSteps[0] || '')
    : '';
  const canForceCompleteStep = workflowStatus === 'running' && Boolean(forceCompletableStep);
  const detailRunId = runDetail ? String(runDetail.id || runDetail.runId || '') : '';
  const actionRunId = (runRecordDrilled || viewingHistoryRun)
    ? (selectedRun?.id || detailRunId || runId || initialRunId || '')
    : (runId || selectedRun?.id || detailRunId || initialRunId || '');
  const selectedRunStatus = normalizeWorkflowStatusCode(selectedRun?.status);
  const detailRunStatus = normalizeWorkflowStatusCode(runDetail?.status || runDetail?.workflowStatus);
  const runtimeWorkflowStatus = normalizeWorkflowStatusCode(workflowStatus);
  const runtimeStatusMatchesActionRun = !isWeakWorkflowStatus(runtimeWorkflowStatus)
    && (!actionRunId || String(runId || '') === actionRunId);
  const actionWorkflowStatus = runtimeStatusMatchesActionRun
    ? runtimeWorkflowStatus
    : (selectedRunStatus || detailRunStatus || runtimeWorkflowStatus);
  const actionIsRunning = actionWorkflowStatus === 'running' || actionWorkflowStatus === 'preparing' || (!actionWorkflowStatus && isRunning);
  const runtimeTaskInput = useMemo(() => {
    const fromStatus = normalizeWorkflowTaskInput((statusCompactQuery.data as any)?.taskInput);
    if (hasWorkflowTaskInput(fromStatus)) return fromStatus;
    const fromDetail = normalizeWorkflowTaskInput(runDetail?.taskInput);
    if (hasWorkflowTaskInput(fromDetail)) return fromDetail;
    return normalizeWorkflowTaskInput({
      title: selectedRun?.taskTitle,
      issueUrl: selectedRun?.taskIssueUrl,
    });
  }, [runDetail?.taskInput, selectedRun?.taskIssueUrl, selectedRun?.taskTitle, statusCompactQuery.data]);
  const runtimeTaskTitle = getWorkflowTaskInputTitle(runtimeTaskInput);
  const canStartWorkflow = isRunMode && Boolean(workflowConfig) && !starting && !startRequesting && !stopping && !isRunning;
  const canStopWorkflow = isRunMode && !stopping && actionIsRunning;
  const canResumeWorkflow = isRunMode
    && Boolean(actionRunId)
    && !actionIsRunning
    && historyRunAction?.action !== 'resume'
    && ['failed', 'stopped', 'pending', 'crashed'].includes(actionWorkflowStatus);
  const resumeWorkflowDisabledReason = actionIsRunning
    ? '当前工作流正在运行'
    : actionRunId
      ? '当前状态无需恢复'
      : '请选择一条运行记录';
  useEffect(() => {
    if (!isRunMode || !actionIsRunning) return;
    setRunClockNow(Date.now());
    const timer = window.setInterval(() => setRunClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [actionIsRunning, isRunMode]);

  const { startTime: runStartedAtForOverview, endTime: runEndedAtForOverview } = useMemo(() => (
    resolveWorkflowOverviewTiming({
      actionRunId,
      actionIsRunning,
      runtimeRunId: runId,
      runtimeStartTime: runStartTime,
      runtimeEndTime: runEndTime,
      status: statusCompactQuery.data as any,
      historyRuns,
      runDetail,
      selectedRun,
    })
  ), [
    actionIsRunning,
    actionRunId,
    historyRuns,
    runDetail,
    runEndTime,
    runId,
    runStartTime,
    selectedRun,
    statusCompactQuery.data,
  ]);
  const runTiming = useMemo(() => calculateWorkflowRunTiming({
    startTime: runStartedAtForOverview,
    endTime: runEndedAtForOverview,
    nowMs: runClockNow,
    accumulatedWaitMs: runAccumulatedWaitMs,
    waitStartedAt: runWaitStartedAt,
  }), [
    runAccumulatedWaitMs,
    runClockNow,
    runEndedAtForOverview,
    runStartedAtForOverview,
    runWaitStartedAt,
  ]);
  const runTransitionTimeline = useMemo(() => {
    const records = Array.isArray(smStateHistory) ? smStateHistory : [];
    return records.map((item: any, index: number) => {
      const previous = index > 0 ? records[index - 1] : null;
      const startedAt = previous?.timestamp || runStartedAtForOverview || item.startedAt || item.startTime || null;
      const endedAt = item.timestamp || item.endedAt || item.endTime || null;
      return {
        id: String(item.id || `${item.from || item.fromState || 'start'}-${item.to || item.toState || 'next'}-${index}`),
        from: formatWorkflowLocation(item.from || item.fromState || item.previousState, null, index === 0 ? '开始' : '上一状态'),
        to: formatWorkflowLocation(item.to || item.toState || item.nextState, null, '下一状态'),
        startedAt,
        endedAt,
        reason: String(item.reason || item.message || '').trim(),
      };
    });
  }, [formatWorkflowLocation, runStartedAtForOverview, smStateHistory]);
  const runStepTimeline = useMemo(() => {
    const workflow = workflowConfig?.workflow;
    const formationStates = (workflow?.states || []) as StateMachineState[];
    const resolveStepMeta = (stepName?: string | null) => {
      const rawName = String(stepName || '').trim();
      if (!rawName) return { stateName: '', stepName: '', agent: '' };
      for (const stateNode of formationStates) {
        for (const step of stateNode.steps || []) {
          const candidate = String(step?.name || '').trim();
          if (!candidate) continue;
          const stateName = String(stateNode.name || '').trim();
          const matches = rawName === candidate
            || rawName === `${stateName}-${candidate}`
            || rawName === `state:${stateName}#${candidate}`
            || workflowStepKeyMatchesName(rawName, candidate);
          if (matches) {
            return {
              stateName,
              stepName: candidate,
              agent: String(step?.agent || '').trim(),
            };
          }
        }
      }
      const normalized = rawName.replace(/-迭代\d+$/, '');
      return { stateName: '', stepName: normalized || rawName, agent: '' };
    };

    const items = (persistedStepLogs || []).map((log: any, index: number) => {
      const rawStepName = String(log?.stepName || log?.step || log?.name || '').trim();
      const meta = resolveStepMeta(rawStepName);
      const output = String(log?.output || log?.outputPreview || '').trim();
      const error = String(log?.error || log?.errorPreview || '').trim();
      const outputRef = String(log?.outputRef || '').trim();
      const outputBytes = typeof log?.outputBytes === 'number' && Number.isFinite(log.outputBytes) ? log.outputBytes : undefined;
      const status = String(log?.status || (error ? 'failed' : output ? 'completed' : 'unknown')).trim();
      const timestamp = log?.timestamp || log?.createdAt || log?.endTime || log?.startTime || null;
      const timestampMs = timestamp ? new Date(timestamp).getTime() : NaN;
      const tokenUsage = normalizeAggregatedTokenUsage(log?.tokenUsage);
      const agentName = String(log?.agent || meta.agent || '').trim();
      const runtimeAgent = agentName ? agents.find((agent) => agent.name === agentName) : null;
      const roleConfig = agentName ? agentConfigs.find((role: any) => role.name === agentName) : null;
      return {
        id: String(log?.id || `${rawStepName || 'step'}-${index}`),
        index,
        rawStepName,
        stepName: meta.stepName || rawStepName || `步骤 ${index + 1}`,
        stateName: meta.stateName,
        agent: agentName,
        status,
        timestamp,
        durationMs: status === 'running' && Number.isFinite(timestampMs)
          ? Math.max(0, runClockNow - timestampMs)
          : (typeof log?.durationMs === 'number' ? log.durationMs : undefined),
        tokenUsage,
        engineName: String(log?.engineName || '').trim(),
        modelName: String(log?.modelName || log?.model || log?.payload?.modelName || log?.payload?.model || (runtimeAgent as any)?.model || roleConfig?.model || '').trim(),
        sessionId: log?.sessionId || null,
        outputRef,
        outputBytes,
        output,
        error,
        payload: log,
      };
    });

    const runningStepKeys = new Set(items
      .filter((item) => item.status === 'running')
      .flatMap((item) => [item.rawStepName, item.stepName].filter(Boolean)));
    const activeKeys = Array.from(new Set([currentStep, ...activeSteps].map((value) => String(value || '').trim()).filter(Boolean)));
    activeKeys.forEach((activeKey) => {
      const meta = resolveStepMeta(activeKey);
      if (runningStepKeys.has(activeKey) || runningStepKeys.has(meta.stepName)) return;
      items.push({
        id: `active:${activeKey}`,
        index: items.length,
        rawStepName: activeKey,
        stepName: meta.stepName || activeKey,
        stateName: meta.stateName,
        agent: meta.agent,
        status: 'running',
        timestamp: null,
        durationMs: undefined,
        tokenUsage: emptyAggregatedTokenUsage(),
        engineName: '',
        modelName: '',
        sessionId: null,
        outputRef: '',
        outputBytes: undefined,
        output: '',
        error: '',
        payload: null,
      });
    });

    return items.sort((a, b) => {
      const aTime = a.timestamp ? new Date(a.timestamp).getTime() : NaN;
      const bTime = b.timestamp ? new Date(b.timestamp).getTime() : NaN;
      if (!Number.isNaN(aTime) && !Number.isNaN(bTime) && aTime !== bTime) return aTime - bTime;
      return a.index - b.index;
    });
  }, [activeSteps, agentConfigs, agents, currentStep, persistedStepLogs, runClockNow, workflowConfig?.workflow]);
  const openOverviewStepRecordFromLog = useCallback((log: any) => {
    const matched = runStepTimeline.find((item) => item.id === log?.id)
      || runStepTimeline.find((item) => item.rawStepName === log?.stepName && item.timestamp === log?.timestamp)
      || runStepTimeline.find((item) => item.rawStepName === log?.stepName);
    if (matched) {
      setOverviewStepRecord(matched);
      return;
    }
    setOverviewStepRecord({
      id: String(log?.id || log?.stepName || 'step'),
      rawStepName: String(log?.stepName || ''),
      stepName: String(log?.stepName || '步骤'),
      stateName: '',
      agent: String(log?.agent || ''),
      status: String(log?.status || 'unknown'),
      timestamp: log?.timestamp || null,
      durationMs: typeof log?.durationMs === 'number' ? log.durationMs : undefined,
      tokenUsage: normalizeAggregatedTokenUsage(log?.tokenUsage),
      engineName: String(log?.engineName || ''),
      modelName: String(log?.modelName || log?.model || ''),
      sessionId: log?.sessionId || null,
      outputRef: String(log?.outputRef || ''),
      outputBytes: typeof log?.outputBytes === 'number' ? log.outputBytes : undefined,
      output: String(log?.output || ''),
      error: String(log?.error || ''),
      payload: log,
    });
  }, [runStepTimeline]);
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
  const selectedAgentRoleConfig = selectedAgent
    ? agentConfigs.find((role: any) => role.name === selectedAgent.name)
    : null;
  const selectedRoleSelection = useMemo(() => {
    if (!selectedRoleConfig) return null;
    return resolveWorkflowAgentSelection(
      selectedRoleConfig,
      { engine: globalEngine, defaultModel: globalDefaultModel },
      {
        agentName: selectedRoleConfig.name,
        workflowContext: {
          engine,
          executionPolicy: currentWorkflowExecutionPolicy,
        },
      },
    );
  }, [selectedRoleConfig, globalEngine, globalDefaultModel, engine, currentWorkflowExecutionPolicy]);
  const overviewStepTokenUsage = normalizeAggregatedTokenUsage(overviewStepRecord?.tokenUsage);
  const overviewStepCacheHitTokens = overviewStepTokenUsage.cacheReadInputTokens;
  const overviewStepCacheHitRatio = formatTokenPercent(
    overviewStepCacheHitTokens,
    overviewStepTokenUsage.inputTokens + overviewStepCacheHitTokens,
  );
  const overviewStepOutput = String(overviewStepExternalOutput || '');
  const pendingHumanQuestionKindLabel = useMemo(() => {
    if (!pendingHumanQuestion) return null;
    if (pendingHumanQuestion.source?.type === 'human-help') return '人工客服';
    if (pendingHumanQuestion.source?.type === 'parallel-manual-join') return '并发人工确认';
    return '人工审查';
  }, [pendingHumanQuestion]);
  const pendingHumanAttentionTitle = isTerminalWorkflowStatus(normalizeWorkflowStatusCode(workflowStatus))
    ? null
    : pendingHumanQuestionKindLabel
      ? `待${pendingHumanQuestionKindLabel} · ${workflowBaseTitle}`
      : humanApprovalData
        ? `待人工审查 · ${workflowBaseTitle}`
        : null;
  const workflowTitle = useMemo(() => {
    if (pendingHumanAttentionTitle) return pendingHumanAttentionTitle;
    if (viewingHistoryRun) return `查看运行 · ${workflowBaseTitle}`;
    if (rehearsalInfo?.enabled) return `演练模式 · ${workflowBaseTitle}`;
    if (workflowStatus === 'running') return `运行中 · ${workflowBaseTitle}`;
    if (workflowStatus === 'preparing') return `准备中 · ${workflowBaseTitle}`;
    if (workflowStatus === 'completed') return `已完成 · ${workflowBaseTitle}`;
    if (workflowStatus === 'failed' || workflowStatus === 'crashed') return `运行失败 · ${workflowBaseTitle}`;
    if (workflowStatus === 'stopped') return `已停止 · ${workflowBaseTitle}`;
    return `${workflowBaseTitle} · Workflow`;
  }, [pendingHumanAttentionTitle, viewingHistoryRun, rehearsalInfo?.enabled, workflowStatus, workflowBaseTitle]);
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
  const runtimeSupervisorAgent = useMemo(() => {
    return finalReview?.supervisorAgent
      || workflowConfig?.workflow?.supervisor?.agent
      || agentConfigs.find((agent: any) => agent?.roleType === 'supervisor')?.name
      || 'default-supervisor';
  }, [agentConfigs, finalReview?.supervisorAgent, workflowConfig?.workflow?.supervisor?.agent]);
  const runtimeSupervisorSessionId = useMemo(() => {
    return displayWorkflowAgents.find((agent) => agent.name === runtimeSupervisorAgent)?.sessionId || null;
  }, [displayWorkflowAgents, runtimeSupervisorAgent]);
  const normalizeFinalReviewScore = useCallback((score: number) => {
    if (!Number.isFinite(score)) return 0;
    return score > 10 ? score / 10 : score;
  }, []);
  const formatFinalReviewScore = useCallback((score: number) => {
    const normalized = Math.max(0, Math.min(10, normalizeFinalReviewScore(score)));
    return normalized % 1 === 0 ? String(normalized) : normalized.toFixed(1);
  }, [normalizeFinalReviewScore]);
  const renderFinalReviewCard = useCallback(() => {
    if (!finalReview) return null;
    return (
      <div className="rounded-2xl border border-border/60 bg-background/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-medium">战后结算</div>
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
                    <Badge variant="secondary" className="text-[10px]">{formatFinalReviewScore(card.score)}/10</Badge>
                  </div>
                  <Progress value={Math.max(0, Math.min(10, normalizeFinalReviewScore(card.score))) * 10} className="h-1.5" />
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
    );
  }, [finalReview, formatFinalReviewScore, normalizeFinalReviewScore]);
  const orderedWorkflowAgents = useMemo(() => {
    const agentMap = new Map(displayWorkflowAgents.map((agent) => [agent.name, agent]));
    const ordered = workflowDirectory
      .map((entry) => agentMap.get(entry.label))
      .filter((agent): agent is (typeof displayWorkflowAgents)[number] => Boolean(agent));
    const remainder = displayWorkflowAgents.filter((agent) => !workflowDirectory.some((entry) => entry.label === agent.name));
    return [...ordered, ...remainder];
  }, [displayWorkflowAgents, workflowDirectory]);
  const supervisorFormationAgents = useMemo(() => {
    const names = new Set<string>();
    const result: Array<{
      name: string;
      team?: any;
      roleType?: any;
      avatar?: any;
      engine?: string;
      model?: string;
    }> = [];

    const pushAgent = (name?: string | null, fallback?: { team?: any; roleType?: any }) => {
      const trimmed = name?.trim();
      if (!trimmed || names.has(trimmed)) return;
      names.add(trimmed);
      const roleConfig = agentConfigs.find((role: any) => role.name === trimmed);
      const runtimeAgent = orderedWorkflowAgents.find((agent) => agent.name === trimmed);
      result.push({
        name: trimmed,
        team: roleConfig?.team || runtimeAgent?.team || fallback?.team || 'blue',
        roleType: roleConfig?.roleType || fallback?.roleType || 'normal',
        avatar: roleConfig?.avatar,
        engine: String((runtimeAgent as any)?.engine || '').trim(),
        model: String((runtimeAgent as any)?.model || '').trim(),
      });
    };

    pushAgent(runtimeSupervisorAgent, { team: 'black-gold', roleType: 'supervisor' });
    orderedWorkflowAgents.forEach((agent) => {
      if (agent.name !== runtimeSupervisorAgent) {
        pushAgent(agent.name);
      }
    });
    const workflow = workflowConfig?.workflow;
    for (const stateNode of workflow?.states || []) {
      for (const step of stateNode.steps || []) {
        if (step?.type !== 'subworkflow') pushAgent(step?.agent);
      }
    }
    return result;
  }, [agentConfigs, orderedWorkflowAgents, runtimeSupervisorAgent, workflowConfig?.workflow]);
  const workflowAgoraSessionId = useMemo(() => {
    const candidates = [
      (statusCompactQuery.data as any)?.workflowFrontendSessionId,
      runDetail?.workflowFrontendSessionId,
      selectedRun?.workflowFrontendSessionId,
    ];
    for (const candidate of candidates) {
      const sessionId = String(candidate || '').trim();
      if (sessionId) return sessionId;
    }
    return null;
  }, [runDetail?.workflowFrontendSessionId, selectedRun?.workflowFrontendSessionId, statusCompactQuery.data]);
  const workflowAgoraInitialGuests = useMemo(() => (
    supervisorFormationAgents.map((agent) => ({
      name: agent.name,
      sourceAgent: agent.name,
      runtimeAgentName: agent.name,
      engine: agent.engine || '',
      model: agent.model || '',
    }))
  ), [supervisorFormationAgents]);
  const workflowAgoraAgentSessionIds = useMemo(() => {
    const result: Record<string, string> = {};
    const appendSessionMap = (value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      for (const [agentName, sessionId] of Object.entries(value as Record<string, unknown>)) {
        const normalizedAgentName = String(agentName || '').trim();
        const normalizedSessionId = String(sessionId || '').trim();
        if (normalizedAgentName && normalizedSessionId) result[normalizedAgentName] = normalizedSessionId;
      }
    };
    appendSessionMap(selectedRun?.attachedAgentSessions);
    appendSessionMap(runDetail?.attachedAgentSessions);
    appendSessionMap((statusCompactQuery.data as any)?.attachedAgentSessions);
    displayWorkflowAgents.forEach((agent) => {
      const sessionId = String(agent.sessionId || '').trim();
      if (agent.name && sessionId) result[agent.name] = sessionId;
    });
    if (runtimeSupervisorAgent && runtimeSupervisorSessionId) {
      result[runtimeSupervisorAgent] = runtimeSupervisorSessionId;
    }
    return result;
  }, [displayWorkflowAgents, runDetail?.attachedAgentSessions, runtimeSupervisorAgent, runtimeSupervisorSessionId, selectedRun?.attachedAgentSessions, statusCompactQuery.data]);
  const workflowAgoraWorkingDirectory = useMemo(() => String(
    (statusCompactQuery.data as any)?.workingDirectory
    || runDetail?.workingDirectory
    || selectedRun?.workingDirectory
    || currentRunWorkspacePath
    || resolvedProjectRoot
    || ''
  ).trim(), [currentRunWorkspacePath, resolvedProjectRoot, runDetail?.workingDirectory, selectedRun?.workingDirectory, statusCompactQuery.data]);
  const workflowFormationStates = useMemo(() => {
    const workflow = workflowConfig?.workflow;
    return (workflow?.states || []) as StateMachineState[];
  }, [workflowConfig?.workflow]);
  const activeFormationAgentNames = useMemo(() => {
    const activeKeys = new Set([currentStep, ...activeSteps].map((value) => String(value || '').trim()).filter(Boolean));
    if (activeKeys.size === 0) return [] as string[];
    const result = new Set<string>();
    for (const stateNode of workflowFormationStates) {
      for (const step of stateNode.steps || []) {
        const stateName = String(stateNode.name || '').trim();
        const stepName = String(step?.name || '').trim();
        const matches = activeKeys.has(stepName)
          || activeKeys.has(`${stateName}-${stepName}`)
          || activeKeys.has(`state:${stateName}#${stepName}`)
          || Array.from(activeKeys).some((key) => workflowStepKeyMatchesName(key, stepName));
        if (matches && step?.agent) result.add(step.agent);
      }
    }
    return Array.from(result);
  }, [activeSteps, currentStep, workflowFormationStates]);
  const workflowTokenAnalytics = useMemo(() => {
    const stepNameToPhase = new Map<string, string>();
    for (const stateNode of workflowConfig?.workflow?.states || []) {
      for (const step of stateNode.steps || []) {
        if (step?.name) stepNameToPhase.set(step.name, stateNode.name);
      }
    }

    const byAgentMap = new Map<string, AggregatedTokenUsage>();
    const byPhaseMap = new Map<string, AggregatedTokenUsage>();
    const loggedByAgentMap = new Map<string, AggregatedTokenUsage>();
    const totalFromAgents = emptyAggregatedTokenUsage();

    for (const agent of orderedWorkflowAgents) {
      const usage = normalizeAggregatedTokenUsage(agent.tokenUsage as Partial<AggregatedTokenUsage> | undefined);
      byAgentMap.set(agent.name, usage);
      addAggregatedTokenUsage(totalFromAgents, usage);
    }

    for (const log of persistedStepLogs) {
      const usage = normalizeAggregatedTokenUsage(log.tokenUsage);
      if (usage.totalTokens <= 0) continue;

      const agentUsage = loggedByAgentMap.get(log.agent) || emptyAggregatedTokenUsage();
      addAggregatedTokenUsage(agentUsage, usage);
      loggedByAgentMap.set(log.agent, agentUsage);

      const rawStepName = log.stepName?.replace(/-迭代\d+$/, '') || '';
      const phaseName = stepNameToPhase.get(rawStepName) || currentPhase || '未归档';
      const phaseUsage = byPhaseMap.get(phaseName) || emptyAggregatedTokenUsage();
      addAggregatedTokenUsage(phaseUsage, usage);
      byPhaseMap.set(phaseName, phaseUsage);
    }

    for (const agent of orderedWorkflowAgents) {
      const totalUsage = normalizeAggregatedTokenUsage(agent.tokenUsage as Partial<AggregatedTokenUsage> | undefined);
      const loggedUsage = loggedByAgentMap.get(agent.name) || emptyAggregatedTokenUsage();
      const remainder = normalizeAggregatedTokenUsage({
        inputTokens: totalUsage.inputTokens - loggedUsage.inputTokens,
        outputTokens: totalUsage.outputTokens - loggedUsage.outputTokens,
        cacheCreationInputTokens: totalUsage.cacheCreationInputTokens - loggedUsage.cacheCreationInputTokens,
        cacheReadInputTokens: totalUsage.cacheReadInputTokens - loggedUsage.cacheReadInputTokens,
      });
      if (remainder.totalTokens > 0) {
        const unassigned = byPhaseMap.get('进行中 / 未归档') || emptyAggregatedTokenUsage();
        addAggregatedTokenUsage(unassigned, remainder);
        byPhaseMap.set('进行中 / 未归档', unassigned);
      }
    }

    const total = totalFromAgents.totalTokens > 0
      ? totalFromAgents
      : Array.from(byPhaseMap.values()).reduce((acc, usage) => {
          addAggregatedTokenUsage(acc, usage);
          return acc;
        }, emptyAggregatedTokenUsage());

    return {
      total,
      byAgent: Array.from(byAgentMap.entries())
        .map(([name, usage]) => ({ name, ...usage }))
        .filter((item) => item.totalTokens > 0)
        .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name)),
      byPhase: Array.from(byPhaseMap.entries())
        .map(([name, usage]) => ({ name, ...usage }))
        .filter((item) => item.totalTokens > 0)
        .sort((a, b) => b.totalTokens - a.totalTokens || a.name.localeCompare(b.name)),
      hasData: total.totalTokens > 0,
    };
  }, [currentPhase, orderedWorkflowAgents, persistedStepLogs, workflowConfig]);

  useEffect(() => {
    if (orderedWorkflowAgents.length === 0) return;
    if (selectedAgent) {
      const refreshedAgent = orderedWorkflowAgents.find((agent) => agent.name === selectedAgent.name);
      if (refreshedAgent) {
        if (refreshedAgent !== selectedAgent) {
          dispatch({ type: 'SET_SELECTED_AGENT', payload: refreshedAgent });
          if (selectedStep) {
            dispatch({ type: 'SET_SELECTED_STEP', payload: selectedStep });
          }
        }
        return;
      }
    }
    dispatch({ type: 'SET_SELECTED_AGENT', payload: orderedWorkflowAgents[0] });
  }, [orderedWorkflowAgents, selectedAgent, selectedStep, dispatch]);

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
    const tasks = flattenRuntimeSpecTasksWithDepth(effectiveSpecCodingTasks);
    if (tasks.length <= 8) return tasks;
    const firstActiveIndex = tasks.findIndex((task) => task.status !== 'completed');
    if (firstActiveIndex === -1) {
      return tasks.slice(Math.max(0, tasks.length - 8));
    }
    const startIndex = Math.max(0, firstActiveIndex - 2);
    return tasks.slice(startIndex, startIndex + 8);
  }, [effectiveSpecCodingTasks]);
  const focusTaskOnDiagram = useCallback((task: { phaseId?: string }) => {
    const phaseTitle = getSpecCodingTaskPhaseTitle(task);
    if (!phaseTitle) return;
    setFocusedState(phaseTitle);
    setRuntimeStateViewMode('diagram');
    setExecutionViewTabOverride('diagram');
  }, [getSpecCodingTaskPhaseTitle]);
  const openAgentFromTask = useCallback((agentName: string) => {
    const matchedAgent = orderedWorkflowAgents.find((agent) => agent.name === agentName)
      || agents.find((agent) => agent.name === agentName);
    if (!matchedAgent) return;
    dispatch({ type: 'SET_SELECTED_AGENT', payload: matchedAgent as any });
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' });
    setRunInspectorPanelOpen(true);
  }, [agents, dispatch, orderedWorkflowAgents]);
  const attentionSignal = useAttentionSignal({
    active: Boolean(pendingHumanAttentionTitle),
    title: pendingHumanAttentionTitle || `待人工审查 · ${workflowBaseTitle}`,
    notificationTitle: `ACEHarness - ${pendingHumanQuestionKindLabel ? `待${pendingHumanQuestionKindLabel}` : '待人工审查'}`,
    notificationBody: `${workflowBaseTitle} ${pendingHumanQuestionKindLabel ? `等待${pendingHumanQuestionKindLabel}` : '进入人工审查点'}，请及时处理。`,
    toast,
    toastMessage: `${workflowBaseTitle} ${pendingHumanQuestionKindLabel ? `等待${pendingHumanQuestionKindLabel}` : '已进入人工审查点'}`,
  });

  useDocumentTitle(embeddedInDashboard ? null : attentionSignal.active ? attentionSignal.title || null : workflowTitle);

  const totalSteps = workflowConfig?.workflow?.states?.reduce(
    (sum: number, state: any) => sum + (state.steps?.length ?? 0), 0
  ) ?? 0;
  const editingPreflightSummary = useMemo(() => {
    const workflow = editingConfig?.workflow;
    if (!workflow) {
      return { configuredSteps: 0, totalCommands: 0 };
    }
    const steps = (workflow.states || []).flatMap((state: any) => state?.steps || []);
    return steps.reduce((summary: { configuredSteps: number; totalCommands: number }, step: any) => {
      const commandCount = Array.isArray(step?.preCommands) ? step.preCommands.filter((item: any) => typeof item === 'string' && item.trim()).length : 0;
      if (commandCount > 0) {
        summary.configuredSteps += 1;
        summary.totalCommands += commandCount;
      }
      return summary;
    }, { configuredSteps: 0, totalCommands: 0 });
  }, [editingConfig?.workflow]);

  const resolveRuntimeRunId = useCallback((payload?: any, fallbackRunId?: string) => {
    const rawRunId = payload?.runId
      || payload?.data?.runId
      || payload?.statusSnapshot?.runId
      || payload?.data?.statusSnapshot?.runId
      || fallbackRunId
      || runId
      || selectedRun?.id
      || initialRunId
      || '';
    return String(rawRunId || '').trim();
  }, [initialRunId, runId, selectedRun?.id]);

  const syncRuntimePayloadToDb = useCallback((payload?: any, fallbackRunId?: string) => {
    if (!payload) return;
    const resolvedRunId = resolveRuntimeRunId(payload, fallbackRunId);
    if (!resolvedRunId) return;

    const statusSnapshot = payload.statusSnapshot || payload.data?.statusSnapshot;
    const eventGroups = [
      payload.events,
      payload.eventLog,
      payload.workflowEvents,
      statusSnapshot?.events,
      statusSnapshot?.eventLog,
      statusSnapshot?.workflowEvents,
    ].filter(Array.isArray) as Array<Array<Record<string, unknown>>>;
    eventGroups.forEach((events) => syncWorkflowEventsToDb(resolvedRunId, events));

    if (payload.type && payload.data) {
      runtimeEventSeqRef.current += 1;
      syncWorkflowEventsToDb(resolvedRunId, [{
        seq: Number(payload.seq ?? payload.data.seq ?? runtimeEventSeqRef.current),
        type: String(payload.type),
        timestamp: String(payload.timestamp || payload.data.timestamp || new Date().toISOString()),
        message: typeof payload.data.message === 'string' ? payload.data.message : undefined,
        payload: payload.data,
      }]);
    }

    const stateHistoryGroups = [
      payload.stateHistory,
      statusSnapshot?.stateHistory,
    ].filter(Array.isArray) as Array<Array<Record<string, unknown>>>;
    stateHistoryGroups.forEach((items) => syncWorkflowStateHistoryToDb(resolvedRunId, items, 0));

    const stepLogGroups = [
      payload.stepLogs,
      statusSnapshot?.stepLogs,
    ].filter(Array.isArray) as Array<Array<Record<string, unknown>>>;
    stepLogGroups.forEach((logs) => syncWorkflowStepLogsToDb(resolvedRunId, logs, 0));

    const documentGroups = [
      payload.documents,
      payload.files,
      statusSnapshot?.documents,
      statusSnapshot?.files,
    ].filter(Array.isArray) as Array<Array<Record<string, unknown>>>;
    documentGroups.forEach((files) => syncDocumentsMetadataToDb(resolvedRunId, files));

    const humanQuestions = [
      payload.pendingHumanQuestion,
      payload.humanQuestion,
      payload.question,
      payload.data?.pendingHumanQuestion,
      payload.data?.humanQuestion,
      payload.data?.question,
      statusSnapshot?.pendingHumanQuestion,
      ...(Array.isArray(payload.humanQuestions) ? payload.humanQuestions : []),
      ...(Array.isArray(statusSnapshot?.humanQuestions) ? statusSnapshot.humanQuestions : []),
    ].filter(Boolean).map((question: any) => ({
      ...question,
      runId: question.runId || resolvedRunId,
      configFile: question.configFile || configFile,
    })) as Array<HumanQuestion>;
    if (humanQuestions.length > 0) {
      syncWorkflowHumanQuestionsToDb(humanQuestions);
    }
  }, [configFile, resolveRuntimeRunId]);

  const cacheWorkflowStatusPayload = useCallback((status: any, requestedRunId?: string) => {
    if (!status) return;
    const resolvedRunId = resolveRuntimeRunId(status, requestedRunId) || requestedRunId;
    const mergeStatusPayload = (current: any) => ({
      ...(current && typeof current === 'object' ? current : {}),
      ...status,
    });
    queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, requestedRunId), mergeStatusPayload);
    if (resolvedRunId && resolvedRunId !== requestedRunId) {
      queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, resolvedRunId), mergeStatusPayload);
    }
    const parentRunId = String(resolvedRunId || requestedRunId || status.runId || '').trim();
    if (parentRunId && Array.isArray(status.subworkflowRuns)) {
      const cacheChildStatus = (child: any) => {
        const childRunId = String(child?.runId || '').trim();
        const childConfigFile = String(child?.configFile || '').trim();
        if (!childRunId || !childConfigFile) return;
        const childStatus = child?.status && typeof child.status === 'object'
          ? { ...child.status, runId: child.status.runId || childRunId }
          : { ...child, runId: childRunId };
        queryClient.setQueryData(
          queryKeys.workflowChildStatusCompact(configFile, parentRunId, childConfigFile, childRunId),
          childStatus,
        );
        queryClient.setQueryData(queryKeys.workflowStatusCompact(childConfigFile, childRunId), childStatus);
        if (Array.isArray(childStatus.subworkflowRuns)) {
          childStatus.subworkflowRuns.forEach(cacheChildStatus);
        }
      };
      status.subworkflowRuns.forEach(cacheChildStatus);
    }
    syncRuntimePayloadToDb(status, requestedRunId);
  }, [configFile, queryClient, resolveRuntimeRunId, syncRuntimePayloadToDb]);

  const applyWorkflowEventLogRecord = useCallback((event: any) => {
    if (!event?.type) return;
    const payload = event.payload || event.data || {};
    if (!shouldApplyRuntimePayload(payload)) return;
    syncRuntimePayloadToDb({
      type: event.type,
      seq: event.seq,
      timestamp: event.timestamp,
      data: payload,
    }, event.runId);

    if (event.type === 'workflow.log') {
      const message = String(payload.message || payload.error || '').trim();
      if (message) {
        const level = payload.level === 'error' || payload.level === 'warning' || payload.level === 'success'
          ? payload.level
          : 'info';
        addLog(String(payload.agent || 'system'), level, message);
        if (level === 'error') {
          setRunStatusReason(String(payload.error || message));
        }
      }
    }

    if (event.type === 'run.state.saved') {
      const status = String(payload.status || '');
      const statusIsTerminal = isTerminalWorkflowStatus(status);
      if (status) {
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: status });
      }
      if (event.runId || payload.runId) {
        dispatch({ type: 'SET_RUN_ID', payload: String(event.runId || payload.runId) });
      }
      if (typeof payload.currentPhase === 'string' || typeof payload.currentState === 'string') {
        dispatch({ type: 'SET_CURRENT_PHASE', payload: payload.currentPhase || payload.currentState || '' });
      }
      if (statusIsTerminal) {
        dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      } else if (typeof payload.currentStep === 'string') {
        dispatch({ type: 'SET_CURRENT_STEP', payload: payload.currentStep });
      }
      if (Array.isArray(payload.completedSteps)) {
        dispatch({ type: 'SET_COMPLETED_STEPS', payload: payload.completedSteps });
      }
      if (Array.isArray(payload.failedSteps)) {
        dispatch({ type: 'SET_FAILED_STEPS', payload: payload.failedSteps });
      }
      setActiveSteps(normalizeActiveWorkflowSteps({
        activeSteps: payload.activeSteps,
        currentStep: payload.currentStep,
        currentPhase: payload.currentPhase,
        currentState: payload.currentState,
        completedSteps: payload.completedSteps,
        failedSteps: payload.failedSteps,
        terminal: statusIsTerminal,
      }));
      setActiveConcurrencyGroups(statusIsTerminal ? [] : (Array.isArray(payload.activeConcurrencyGroups) ? payload.activeConcurrencyGroups : []));
      if (Array.isArray(payload.stateHistory)) {
        setSmStateHistory(payload.stateHistory);
      }
      if (typeof payload.transitionCount === 'number') {
        setSmTransitionCount(payload.transitionCount);
      }
    }

    if (event.type === 'workflow.step-start') {
      const step = String(payload.step || '').trim();
      if (step) {
        dispatch({ type: 'SET_CURRENT_STEP', payload: step });
        setActiveSteps((current) => Array.from(new Set([step, ...current].filter(Boolean))));
      }
    }

    if (event.type === 'workflow.step-complete') {
      const step = String(payload.step || '').trim();
      if (step) {
        dispatch({ type: 'ADD_COMPLETED_STEP', payload: step });
        setActiveSteps((current) => current.filter((item) => item !== step));
      }
    }

    if (event.type === 'workflow.transition') {
      const from = String(payload.from || '').trim();
      const to = String(payload.to || payload.targetState || '').trim();
      if (to) {
        dispatch({ type: 'SET_CURRENT_PHASE', payload: to });
        setSmStateHistory((prev) => {
          if (prev.some((item) => item.from === from && item.to === to && item.timestamp === payload.timestamp)) return prev;
          return [...prev, {
            from,
            to,
            reason: payload.reason || '',
            issues: Array.isArray(payload.issues) ? payload.issues : [],
            timestamp: payload.timestamp || event.timestamp || new Date().toISOString(),
          }];
        });
      }
    }
  }, [addLog, dispatch, shouldApplyRuntimePayload, syncRuntimePayloadToDb]);

  const syncWorkflowEventLogUntil = useCallback((runIdValue?: string | null, targetSeq?: number | null) => {
    const resolvedRunId = String(runIdValue || '').trim();
    if (!resolvedRunId) return;
    const currentSeq = workflowEventSeqByRunIdRef.current.get(resolvedRunId) || 0;
    const normalizedTargetSeq = typeof targetSeq === 'number' && Number.isFinite(targetSeq) ? Math.floor(targetSeq) : 0;
    if (normalizedTargetSeq > 0 && currentSeq >= normalizedTargetSeq) return;
    if (workflowEventSyncInflightRef.current.has(resolvedRunId)) return;

    const promise = workflowApi.getEventLog(resolvedRunId, { afterSeq: currentSeq, limit: 500 })
      .then(async (result) => {
        let lastSeq = currentSeq;
        for (const event of result.events || []) {
          const seq = Number(event.seq || 0);
          if (seq > lastSeq + 1) {
            const status = await workflowApi.getStatus(configFile, resolvedRunId, { compact: true });
            cacheWorkflowStatusPayload(status, resolvedRunId);
            lastSeq = seq - 1;
          }
          applyWorkflowEventLogRecord(event);
          lastSeq = Math.max(lastSeq, seq);
        }
        if (typeof result.nextSeq === 'number') {
          lastSeq = Math.max(lastSeq, result.nextSeq);
        }
        workflowEventSeqByRunIdRef.current.set(resolvedRunId, lastSeq);
        if (normalizedTargetSeq > 0 && lastSeq < normalizedTargetSeq) {
          const status = await workflowApi.getStatus(configFile, resolvedRunId, { compact: true });
          cacheWorkflowStatusPayload(status, resolvedRunId);
        }
      })
      .catch(() => {})
      .finally(() => {
        workflowEventSyncInflightRef.current.delete(resolvedRunId);
      });
    workflowEventSyncInflightRef.current.set(resolvedRunId, promise);
  }, [applyWorkflowEventLogRecord, cacheWorkflowStatusPayload, configFile]);

  const mergeLiveRunStatus = useCallback((status: any, requestedRunId?: string) => {
    if (!status) return;
    const resolvedRunId = resolveRuntimeRunId(status, requestedRunId) || requestedRunId;
    if (!resolvedRunId) return;
    const taskInput = normalizeWorkflowTaskInput(status.taskInput);
    const incomingStatusReason = typeof status.statusReason === 'string' ? status.statusReason.trim() : '';
    const compactStatusReason = formatWorkflowFailureReason(incomingStatusReason, 1800) || null;
    const shouldPreserveDetailedReason = (previous: any): boolean => {
      const previousReason = typeof previous?.statusReason === 'string' ? previous.statusReason.trim() : '';
      if (!previousReason || isLiveTextTruncated(previousReason) || !compactStatusReason) return false;
      return previousReason.length > compactStatusReason.length * 2
        && (previousReason.length > 1800 || /<!--\s*(?:timestamp|chunk-boundary)/i.test(previousReason));
    };
    const patch = {
      id: resolvedRunId,
      runId: resolvedRunId,
      configFile,
      status: status.status,
      workflowStatus: status.status,
      statusReason: compactStatusReason,
      currentPhase: status.currentPhase || status.currentState || null,
      currentState: status.currentState || status.currentPhase || null,
      currentStep: status.currentStep || null,
      startTime: status.startTime,
      endTime: status.endTime || null,
      updatedAt: new Date().toISOString(),
      activeSteps: Array.isArray(status.activeSteps) ? status.activeSteps : undefined,
      activeConcurrencyGroups: Array.isArray(status.activeConcurrencyGroups) ? status.activeConcurrencyGroups : undefined,
      completedSteps: Array.isArray(status.completedSteps) ? status.completedSteps.length : undefined,
      transitionCount: typeof status.transitionCount === 'number' ? status.transitionCount : undefined,
      taskInput: hasWorkflowTaskInput(taskInput) ? taskInput : undefined,
      taskTitle: getWorkflowTaskInputTitle(taskInput) || undefined,
      taskIssueUrl: taskInput.issueUrl,
    };
    setHistoryRuns((prev) => prev.map((item) => item.id === resolvedRunId
      ? { ...item, ...patch, statusReason: shouldPreserveDetailedReason(item) ? item.statusReason : patch.statusReason }
      : item));
    setSelectedRun((prev: any) => prev?.id === resolvedRunId
      ? { ...prev, ...patch, statusReason: shouldPreserveDetailedReason(prev) ? prev.statusReason : patch.statusReason }
      : prev);
    setRunDetail((prev: any) => {
      const prevRunId = String(prev?.id || prev?.runId || '');
      return prevRunId === resolvedRunId
        ? { ...prev, ...patch, statusReason: shouldPreserveDetailedReason(prev) ? prev.statusReason : patch.statusReason }
        : prev;
    });
  }, [configFile, resolveRuntimeRunId]);

  const applyWorkflowStatusPayload = (status: any, requestedRunId?: string) => {
    if (!status?.status) return;
    if (!shouldApplyRuntimePayload(status)) return;
    syncRuntimePayloadToDb(status, requestedRunId);
    const statusRunId = resolveRuntimeRunId(status, requestedRunId);
    const statusEventSeq = Number((status as any).eventSeq || 0);
    if (statusRunId && statusEventSeq > 0) {
      syncWorkflowEventLogUntil(statusRunId, statusEventSeq);
    }
    mergeLiveRunStatus(status, requestedRunId);
      const smStatus = status as typeof status & {
        mode?: 'state-machine';
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
      const statusReason = formatWorkflowFailureReason(status.statusReason);
      setRunStatusReason(statusReason || null);
      const statusIsActive = isRuntimeWorkflowStatusActive(status.status);
      const statusIsTerminal = isTerminalWorkflowStatus(status.status);
      const normalizedStatus = normalizeWorkflowStatusCode(status.status);
      const statusReasonLogKey = `${status.runId || requestedRunId || ''}:${normalizedStatus}:${statusReason}`;
      if ((normalizedStatus === 'failed' || normalizedStatus === 'crashed') && statusReason && runStatusReasonLogRef.current !== statusReasonLogKey) {
        runStatusReasonLogRef.current = statusReasonLogKey;
        addLog('system', 'error', `工作流失败: ${statusReason}`);
      } else if (!statusReason || (normalizedStatus !== 'failed' && normalizedStatus !== 'crashed')) {
        runStatusReasonLogRef.current = null;
      }
      if (status.runId) dispatch({ type: 'SET_RUN_ID', payload: status.runId });
      if (typeof (status as any).currentState === 'string') dispatch({ type: 'SET_CURRENT_PHASE', payload: (status as any).currentState });
      else if (typeof status.currentPhase === 'string') dispatch({ type: 'SET_CURRENT_PHASE', payload: status.currentPhase });
      else if (!statusIsActive) dispatch({ type: 'SET_CURRENT_PHASE', payload: '' });
      if (statusIsTerminal) dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      else if (typeof status.currentStep === 'string') dispatch({ type: 'SET_CURRENT_STEP', payload: status.currentStep });
      else if (!statusIsActive) dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      if (status.agents?.length) dispatch({ type: 'SET_AGENTS', payload: status.agents });
      const nextCompletedSteps = Array.isArray(status.completedSteps) ? status.completedSteps : [];
      const nextFailedSteps = Array.isArray(status.failedSteps) ? status.failedSteps : [];
      if (status.completedSteps) dispatch({ type: 'SET_COMPLETED_STEPS', payload: nextCompletedSteps });
      dispatch({ type: 'SET_FAILED_STEPS', payload: nextFailedSteps });
      setActiveSteps(normalizeActiveWorkflowSteps({
        activeSteps: (status as any).activeSteps,
        currentStep: status.currentStep,
        currentPhase: status.currentPhase,
        currentState: smStatus.currentState,
        completedSteps: nextCompletedSteps,
        failedSteps: nextFailedSteps,
        terminal: statusIsTerminal,
      }));
      setActiveConcurrencyGroups(statusIsTerminal ? [] : (Array.isArray((status as any).activeConcurrencyGroups) ? (status as any).activeConcurrencyGroups : []));
      const pendingLiveFeedback = Array.isArray((status as any).pendingLiveFeedback)
        ? (status as any).pendingLiveFeedback
        : [];
      const restoredLiveFeedback: InlineFeedback[] = pendingLiveFeedback
        .map((item: any, index: number) => {
          const message = String(item?.message || '').trim();
          if (!message) return null;
          const statusValue = item?.status === 'interrupting' ? 'interrupting' : 'queued';
          return {
            id: String(item?.id || `restored-feedback-${index}`),
            message,
            timestamp: String(item?.timestamp || new Date().toISOString()),
            streamIndex: liveStream.length + index,
            mode: item?.interrupt || statusValue === 'interrupting' ? 'interrupt' : 'feedback',
            status: statusValue as LiveFeedbackStatus,
            automatic: Boolean(item?.automatic),
          };
        })
        .filter(Boolean) as InlineFeedback[];
      pendingLiveFeedbackRef.current = restoredLiveFeedback;
      for (const feedback of restoredLiveFeedback) {
        upsertInlineFeedback(feedback);
      }

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
      if ((status as any).workspaceGit) {
        const nextEnabled = (status as any).workspaceGit.enabled !== false;
        setRuntimeGitBaselineEnabled((current) => current === nextEnabled ? current : nextEnabled);
      } else {
        const nextEnabled = workflowConfig?.context?.gitBaselineEnabled !== false;
        setRuntimeGitBaselineEnabled((current) => current === nextEnabled ? current : nextEnabled);
      }
      if ((status as any).agentFlow) {
        setAgentFlow((status as any).agentFlow);
      }
      const payloadSpecCodingDisabled = specCodingDisabled || (status as any).specCodingDisabled === true;
      setSpecRevisionVote(payloadSpecCodingDisabled ? null : ((status as any).specRevisionVote || null));
      setSpecRevisionVoteHistory(payloadSpecCodingDisabled ? [] : (Array.isArray((status as any).specRevisionVoteHistory) ? (status as any).specRevisionVoteHistory : []));
      setCreationSessionSummary(payloadSpecCodingDisabled ? null : ((status as any).creationSession || null));
      const preferRunSpec = state.viewMode === 'run';
      const nextSpecCodingSummary = preferRunSpec
        ? ((status as any).runSpecCodingSummary || (status as any).specCodingSummary || (status as any).creationSpecCodingSummary || null)
        : ((status as any).creationSpecCodingSummary || ((status as any).specCodingSummary?.source === 'creation' ? (status as any).specCodingSummary : null));
      const nextSpecCodingDetails = preferRunSpec
        ? ((status as any).runSpecCodingDetails || (status as any).specCodingDetails || (status as any).creationSpecCodingDetails || null)
        : ((status as any).creationSpecCodingDetails || ((status as any).specCodingSummary?.source === 'creation' ? (status as any).specCodingDetails : null));
      setSpecCodingSummary(payloadSpecCodingDisabled ? null : nextSpecCodingSummary);
      setSpecCodingDetails(payloadSpecCodingDisabled ? null : nextSpecCodingDetails);
      setSpecCodingSourceOfTruth(payloadSpecCodingDisabled ? null : ((status as any).sourceOfTruth || null));
      if (payloadSpecCodingDisabled) setSpecBindingReview(null);
      setPersistMode(status.persistMode);
      setDeltaSpecMerged(Boolean(status.deltaSpecMerged));
      setDeltaMergeState(status.deltaMergeState);
      setMasterSpecPath(status.masterSpecPath);
      setFinalReview((status as any).finalReview || null);
      setQualityChecks((status as any).qualityChecks || []);
      const statusCurrentState = String((status as any).currentState || '');
      const statusPendingHumanQuestion = (status as any).pendingHumanQuestion || null;
      const statusHasActiveHumanApproval = statusCurrentState === '__human_approval__' || Boolean((status as any).pendingCheckpoint);
      const nextPendingHumanQuestion = statusPendingHumanQuestion
        || (statusHasActiveHumanApproval ? ((status as any).pendingHumanQuestion || null) : null);
      const shouldRestorePendingHumanQuestion = nextPendingHumanQuestion
        && nextPendingHumanQuestion.status === 'unanswered';
      if (shouldRestorePendingHumanQuestion) {
        setPendingHumanQuestionIfChanged(nextPendingHumanQuestion);
      } else {
        clearPendingHumanQuestion();
      }

      {
        if (Array.isArray(status.stepLogs)) {
          if (status.runId) syncWorkflowStepLogsToDb(String(status.runId), status.stepLogs as any[], 0);
          restoreStepLogs(status.stepLogs as any[], 'merge');
        }
      }
      if (status.iterationStates) {
        Object.entries(status.iterationStates).forEach(([phase, iterState]) => {
          dispatch({ type: 'SET_ITERATION_STATE', payload: { phase, state: iterState as any } });
        });
      }

      // Restore state machine specific data
      if (status.stateHistory) {
        if (status.runId && Array.isArray(status.stateHistory)) {
          syncWorkflowStateHistoryToDb(String(status.runId), status.stateHistory as any[], 0);
        }
        setSmStateHistory(status.stateHistory);
      } else if (status.runId) {
        void loadRunSplitRuntimeData(String(status.runId), 'merge');
      }
      if (status.issueTracker) {
        setSmIssueTracker(status.issueTracker);
      }
      if (status.transitionCount !== undefined) {
        setSmTransitionCount(status.transitionCount);
      }
      setSubworkflowRuns(Array.isArray((status as any).subworkflowRuns) ? (status as any).subworkflowRuns : []);
      setSubworkflowSummary((status as any).subworkflowSummary || null);
      setActiveSubworkflowRunId((status as any).activeSubworkflowRunId || null);
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
      setRunAccumulatedWaitMs(typeof status.accumulatedWaitMs === 'number' ? status.accumulatedWaitMs : 0);
      setRunWaitStartedAt(status.waitStartedAt ?? null);
  };

  useEffect(() => {
    const status = statusCompactQuery.data;
    if (!status) return;
    const signature = JSON.stringify({
      queryRunId: statusQueryRunId || null,
      runId: (status as any).runId || null,
      status: (status as any).status || null,
      currentPhase: (status as any).currentPhase || null,
      currentState: (status as any).currentState || null,
      currentStep: (status as any).currentStep || null,
      transitionCount: (status as any).transitionCount ?? null,
      stepLogs: Array.isArray((status as any).stepLogs)
        ? (status as any).stepLogs.slice(-8).map((log: any) => ({
            id: log?.id || null,
            status: log?.status || null,
            outputRef: log?.outputRef || null,
            outputBytes: log?.outputBytes ?? null,
            outputLength: typeof log?.output === 'string' ? log.output.length : null,
            errorLength: typeof log?.error === 'string' ? log.error.length : null,
            timestamp: log?.timestamp || null,
          }))
        : null,
      stateHistory: Array.isArray((status as any).stateHistory) ? (status as any).stateHistory.length : null,
      humanQuestions: Array.isArray((status as any).humanQuestions) ? (status as any).humanQuestions.length : null,
      pendingHumanQuestionId: (status as any).pendingHumanQuestion?.id || null,
      accumulatedWaitMs: (status as any).accumulatedWaitMs ?? null,
      waitStartedAt: (status as any).waitStartedAt || null,
      eventSeq: (status as any).eventSeq ?? null,
    });
    if (appliedStatusCacheSignatureRef.current === signature) return;
    appliedStatusCacheSignatureRef.current = signature;
    applyWorkflowStatusPayload(status, statusQueryRunId);
  }, [statusCompactQuery.data, statusQueryRunId]);

  const fetchCurrentStatus = async () => {
    try {
      const requestedRunId = statusQueryRunId;
      const status = await queryClient.fetchQuery({
        queryKey: queryKeys.workflowStatusCompact(configFile, requestedRunId),
        queryFn: () => fetchWorkflowStatusCompact(configFile, requestedRunId),
        staleTime: 1_000,
      });
      cacheWorkflowStatusPayload(status, requestedRunId);
    } catch { /* server might not be ready */ }
  };

  useEffect(() => {
    if (!shouldConnectWorkbenchRunStatusStream({
      viewMode,
      isHistoryRunView,
      configFile,
      runId: statusQueryRunId,
    })) return;
    const activeRunId = statusQueryRunId;
    if (!activeRunId && !isRuntimeWorkflowStatusActive(workflowStatus)) return;
    void fetchCurrentStatus();
    const timer = window.setInterval(() => {
      void fetchCurrentStatus();
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [configFile, isHistoryRunView, statusQueryRunId, viewMode, workflowStatus]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryLoaded(false);
    try {
      const { runs } = await runsApi.listByConfig(configFile);
      const locallyStartedRunId = latestRunIdRef.current;
      setHistoryRuns((current) => {
        const locallyStartedRun = locallyStartedRunId
          ? current.find((run: any) => run.id === locallyStartedRunId)
          : null;
        return locallyStartedRun && !runs.some((run: any) => run.id === locallyStartedRunId)
          ? upsertStartedRunInHistory(runs, locallyStartedRun)
          : runs;
      });
      setSelectedRun((current: any) => {
        if (!current?.id) return current;
        const latest = runs.find((item: any) => item.id === current.id);
        if (!latest) return current.id === runId || current.id === locallyStartedRunId ? current : null;
        return { ...current, ...latest };
      });
      if (
        selectedRun?.id
        && selectedRun.id !== locallyStartedRunId
        && !runs.some((item: any) => item.id === selectedRun.id)
      ) {
        setRunRecordDrilled(false);
        setRunDetailSection('overview');
        setRunWorkbenchTab('overview');
        setViewingHistoryRun(false);
        setRunDetail(null);
      }
    } catch {
      setHistoryRuns([]);
    } finally {
      setHistoryLoaded(true);
      setHistoryLoading(false);
    }
  }, [configFile, runId, selectedRun?.id]);

  const entryRefreshKeyRef = useRef('');
  useEffect(() => {
    if (viewMode !== 'run' || isHistoryRunView) return;
    const key = `${configFile}:${runId || initialRunId || 'latest'}`;
    if (entryRefreshKeyRef.current === key) return;
    entryRefreshKeyRef.current = key;
    void loadHistory();
    void fetchCurrentStatus();
  }, [configFile, initialRunId, isHistoryRunView, loadHistory, runId, viewMode]);

  useEffect(() => {
    if (viewMode !== 'run') return;
    const routeSection = effectiveSearchParams.get('section') || '';
    const requestedRunId = effectiveSearchParams.get('runId') || effectiveSearchParams.get('run') || '';
    const hasHistoryRun = effectiveSearchParams.get('history') === '1' || Boolean(requestedRunId);
    const requestedTab = getRunWorkbenchTabFromSearchParams(effectiveSearchParams);
    const requestedDocumentSource = getDocumentSourceFilterFromSearchParams(effectiveSearchParams);

    if (isRuntimeLightweightWorkflow) {
      const redirect = resolveLightweightWorkbenchRunTabRedirect({ requestedTab, requestedDocumentSource });
      if (redirect) {
        setWorkbenchNavSection('runs');
        setRunRecordDrilled(true);
        setRunDetailSection(redirect.section);
        setRunWorkbenchTab(redirect.tab);
        setDocumentSourceFilter(redirect.documentSource);
        updateUrl({
          tab: redirect.tab,
          documentSource: redirect.documentSource === 'all' ? null : redirect.documentSource,
        });
        return;
      }
    }

    if (routeSection.startsWith('preview') && !hasHistoryRun) {
      setWorkbenchNavSection((current) => current === 'preview' ? current : 'preview');
      setRunRecordDrilled((current) => current ? false : current);
      const nextPreviewSection = resolveWorkbenchPreviewRouteSection(routeSection);
      setRunDetailSection((current) => current === nextPreviewSection ? current : nextPreviewSection);
      return;
    }
    if (!hasHistoryRun) return;

    if (requestedRunId && returnedRunIdRef.current === requestedRunId) {
      setRunRecordDrilled(false);
      setRunDetailSection('overview');
      setRunWorkbenchTab('overview');
      setViewingHistoryRun(false);
      updateUrl({
        run: null,
        runId: null,
        history: null,
        section: null,
        tab: null,
        workspace: null,
        workspaceRoot: null,
        changes: null,
        workspaceFile: null,
        workspaceLine: null,
        workspaceColumn: null,
      });
      return;
    }

    if (requestedRunId && historyLoaded && !historyLoading && !historyRuns.some((item: any) => item.id === requestedRunId)) {
      setSelectedRun((current: any) => current?.id === requestedRunId ? null : current);
      setRunRecordDrilled(false);
      setRunDetailSection('overview');
      setRunWorkbenchTab('overview');
      setViewingHistoryRun(false);
      setRunDetail(null);
      if (runId === requestedRunId) {
        dispatch({ type: 'SET_RUN_ID', payload: '' });
      }
      updateUrl({
        run: null,
        runId: null,
        history: null,
        tab: null,
        workspace: null,
        workspaceRoot: null,
        changes: null,
        workspaceFile: null,
        workspaceLine: null,
        workspaceColumn: null,
      });
      return;
    }

    setWorkbenchNavSection((current) => current === 'runs' ? current : 'runs');
    setRunRecordDrilled((current) => current ? current : true);
    const runWorkbenchTab = getRunWorkbenchTabFromSearchParams(effectiveSearchParams);
    const nextRunDetailSection = runWorkbenchTabToDetailSection(runWorkbenchTab, runtimeSpecAvailable);
    setRunDetailSection((current) => current === nextRunDetailSection ? current : nextRunDetailSection);

    if (!requestedRunId) return;
    setSelectedRun((current: any) => {
      const fromHistory = historyRuns.find((item: any) => item.id === requestedRunId);
      if (current?.id === requestedRunId) {
        if (fromHistory && (isWeakWorkflowStatus(current.status) || current.status !== fromHistory.status)) {
          const next = { ...current, ...fromHistory };
          return JSON.stringify(next) === JSON.stringify(current) ? current : next;
        }
        return current;
      }
      return fromHistory || current || { id: requestedRunId, status: workflowStatus || 'unknown', configFile };
    });
  }, [configFile, dispatch, historyLoaded, historyLoading, historyRuns, isRuntimeLightweightWorkflow, runId, runtimeSpecAvailable, searchParamsString, updateUrl, viewMode, workflowStatus]);

  useEffect(() => {
    const next = getDocumentSourceFilterFromSearchParams(effectiveSearchParams);
    setDocumentSourceFilter((current) => current === next ? current : next);
  }, [searchParamsString]);

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

  const restoreStepLogs = useCallback((logs: any[] = [], mode: 'merge' | 'set' = 'merge') => {
    const safeLogs = Array.isArray(logs) ? logs : [];
    if (mode === 'set') {
      setPersistedStepLogs(safeLogs);
    } else if (safeLogs.length > 0) {
      setPersistedStepLogs((prev) => {
        const byKey = new Map<string, any>();
        for (const log of prev || []) byKey.set(String(log?.id || log?.stepName || byKey.size), log);
        for (const log of safeLogs) byKey.set(String(log?.id || log?.stepName || byKey.size), log);
        return Array.from(byKey.values());
      });
    }
    const activeLogs = selectCurrentStepAttemptLogs(safeLogs);
    const restoredResults: Record<string, { output: string; error?: string; costUsd?: number; durationMs?: number }> = {};
    const restoredIdMap: Record<string, string> = {};
    for (const log of activeLogs) {
      const key = log.id || log.stepName;
      if (!key) continue;
      restoredResults[key] = {
        output: log.output || '',
        error: log.error || undefined,
        costUsd: log.costUsd || undefined,
        durationMs: log.durationMs || undefined,
      };
      if (log.id && log.stepName) {
        restoredIdMap[log.stepName] = log.id;
      }
    }
    if (mode === 'set') {
      dispatch({ type: 'SET_STEP_RESULTS', payload: restoredResults });
      dispatch({ type: 'SET_STEP_ID_MAP', payload: restoredIdMap });
    } else {
      if (Object.keys(restoredResults).length > 0) {
        dispatch({ type: 'MERGE_STEP_RESULTS', payload: restoredResults });
      }
      if (Object.keys(restoredIdMap).length > 0) {
        dispatch({ type: 'MERGE_STEP_ID_MAP', payload: restoredIdMap });
      }
    }
  }, [dispatch]);

  const dbStateHistoryItems = useMemo(() => {
    return dbStateHistoryRows.map((row) => ({
      ...(row.payload || {}),
      id: (row.payload as any)?.id || row.id,
      timestamp: (row.payload as any)?.timestamp || row.timestamp,
      from: (row.payload as any)?.from || row.fromState,
      to: (row.payload as any)?.to || row.toState,
      state: (row.payload as any)?.state || row.state,
      step: (row.payload as any)?.step || row.step,
      status: (row.payload as any)?.status || row.status,
      reason: (row.payload as any)?.reason || row.reason,
      summary: (row.payload as any)?.summary || row.summary,
    }));
  }, [dbStateHistoryRows]);

  const dbStepLogItems = useMemo(() => {
    return dbStepLogRows.map((row) => ({
      ...(row.payload || {}),
      id: (row.payload as any)?.id || row.id,
      stepName: (row.payload as any)?.stepName || row.stepName,
      agent: (row.payload as any)?.agent || row.agent,
      status: (row.payload as any)?.status || row.status,
      timestamp: (row.payload as any)?.timestamp || row.timestamp,
      durationMs: (row.payload as any)?.durationMs || row.durationMs,
      costUsd: (row.payload as any)?.costUsd || row.costUsd,
      tokenUsage: (row.payload as any)?.tokenUsage,
      engineName: (row.payload as any)?.engineName || row.engineName,
      modelName: (row.payload as any)?.modelName || (row.payload as any)?.model,
      sessionId: (row.payload as any)?.sessionId || row.sessionId,
      childRunId: (row.payload as any)?.childRunId || row.childRunId,
      childStatus: (row.payload as any)?.childStatus || row.childStatus,
      outputRef: (row.payload as any)?.outputRef || row.outputRef,
      outputBytes: (row.payload as any)?.outputBytes || row.outputBytes,
      output: (row.payload as any)?.output || row.outputPreview || '',
      error: (row.payload as any)?.error || row.errorPreview || '',
    }));
  }, [dbStepLogRows]);

  const dbRuntimeEvents = useMemo(() => {
    return dbWorkflowEventRows.map((row) => ({
      id: row.id,
      seq: row.seq,
      type: row.type,
      timestamp: row.timestamp || new Date().toISOString(),
      state: row.state,
      step: row.step,
      agent: row.agent,
      message: row.message,
      payload: row.payload,
    }));
  }, [dbWorkflowEventRows]);

  const dbStateHistorySignature = useMemo(() => {
    if (!activeRuntimeRunId || dbStateHistoryItems.length === 0) return '';
    const last = dbStateHistoryItems[dbStateHistoryItems.length - 1] || {};
    return [
      activeRuntimeRunId,
      dbStateHistoryItems.length,
      last.id || '',
      last.timestamp || '',
      last.from || '',
      last.to || '',
      last.state || '',
      last.step || '',
      last.status || '',
    ].join('|');
  }, [activeRuntimeRunId, dbStateHistoryItems]);

  const dbStepLogSignature = useMemo(() => {
    if (!activeRuntimeRunId || dbStepLogItems.length === 0) return '';
    const last = dbStepLogItems[dbStepLogItems.length - 1] || {};
    return [
      activeRuntimeRunId,
      dbStepLogItems.length,
      last.id || '',
      last.stepName || '',
      last.status || '',
      last.timestamp || '',
      last.durationMs || '',
      last.childRunId || '',
      last.childStatus || '',
      String(last.output || '').length,
      String(last.error || '').length,
    ].join('|');
  }, [activeRuntimeRunId, dbStepLogItems]);

  useEffect(() => {
    if (!activeRuntimeRunId || dbStateHistoryItems.length === 0) return;
    if (appliedDbStateHistorySignatureRef.current === dbStateHistorySignature) return;
    appliedDbStateHistorySignatureRef.current = dbStateHistorySignature;
    setSmStateHistory(dbStateHistoryItems);
    setSmTransitionCount((prev) => Math.max(prev, dbStateHistoryItems.length));
  }, [activeRuntimeRunId, dbStateHistoryItems, dbStateHistorySignature]);

  useEffect(() => {
    if (!activeRuntimeRunId || dbStepLogItems.length === 0) return;
    if (appliedDbStepLogSignatureRef.current === dbStepLogSignature) return;
    appliedDbStepLogSignatureRef.current = dbStepLogSignature;
    restoreStepLogs(dbStepLogItems, 'set');
  }, [activeRuntimeRunId, dbStepLogItems, dbStepLogSignature, restoreStepLogs]);

  const loadRunSplitRuntimeData = useCallback(async (targetRunId: string, mode: 'merge' | 'set' = 'merge') => {
    if (!targetRunId) return;
    const eventQueryKey = queryKeys.workflowEvents(configFile, targetRunId, { afterSeq: 0, limit: 200 });
    if (!queryClient.getQueryData(eventQueryKey) && dbRuntimeEvents.length > 0) {
      queryClient.setQueryData(eventQueryKey, {
        runId: targetRunId,
        events: dbRuntimeEvents,
        nextSeq: Math.max(0, ...dbRuntimeEvents.map((event) => Number(event.seq || 0))) + 1,
      });
    }
    const [eventsResult, stateHistoryResult, stepLogsResult] = await Promise.allSettled([
      queryClient.fetchQuery({
        queryKey: eventQueryKey,
        queryFn: () => fetchWorkflowEvents({ configFile, runId: targetRunId, afterSeq: 0, limit: 200 }),
        staleTime: 5_000,
      }),
      queryClient.fetchQuery({
        queryKey: queryKeys.workflowStateHistory(configFile, targetRunId, { offset: 0, limit: 200 }),
        queryFn: () => fetchWorkflowStateHistory({ configFile, runId: targetRunId, offset: 0, limit: 200 }),
        staleTime: 5_000,
      }),
      queryClient.fetchQuery({
        queryKey: queryKeys.workflowStepLogs(configFile, targetRunId, { offset: 0, limit: 200 }),
        queryFn: () => fetchWorkflowStepLogs({ configFile, runId: targetRunId, offset: 0, limit: 200 }),
        staleTime: 5_000,
      }),
    ]);
    if (eventsResult.status === 'fulfilled') {
      const events = eventsResult.value.events || [];
      syncWorkflowEventsToDb(targetRunId, events);
    }
    if (stateHistoryResult.status === 'fulfilled') {
      const items = stateHistoryResult.value.items || [];
      syncWorkflowStateHistoryToDb(targetRunId, items, 0);
      setSmStateHistory(items);
      const total = stateHistoryResult.value.pagination?.total;
      if (typeof total === 'number') setSmTransitionCount(total);
    }
    if (stepLogsResult.status === 'fulfilled') {
      const items = stepLogsResult.value.items || [];
      syncWorkflowStepLogsToDb(targetRunId, items, 0);
      restoreStepLogs(items, mode);
    }
  }, [configFile, dbRuntimeEvents, queryClient, restoreStepLogs]);

  const loadRunDetail = useCallback(async (runId: string) => {
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.runDetail(runId),
        queryFn: () => runsApi.getRunDetail(runId),
        staleTime: 30_000,
      });
      setRunDetail(detail);
      if (detail) {
        queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, runId), detail);
        syncRuntimePayloadToDb(detail, runId);
      }
      void loadRunSplitRuntimeData(runId, 'merge');
    } catch {
      setRunDetail(null);
    }
  }, [configFile, loadRunSplitRuntimeData, queryClient, syncRuntimePayloadToDb]);

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
  }, [clearPendingHumanQuestion]);

  useEffect(() => {
    if (!activeRuntimeRunId || dbUnansweredHumanQuestionRows.length === 0) return;
    const [latestQuestion] = dbUnansweredHumanQuestionRows;
    if (!latestQuestion) return;
    setPendingHumanQuestionIfChanged({
      ...latestQuestion,
      answerSchema: latestQuestion.answerSchema as any,
      answer: latestQuestion.answer as any,
      source: latestQuestion.source as any,
    } as HumanQuestion);
  }, [activeRuntimeRunId, dbUnansweredHumanQuestionRows, setPendingHumanQuestionIfChanged]);

  const applyWorkflowStatusSnapshot = useCallback((snapshot: any) => {
    if (!snapshot) return;
    syncRuntimePayloadToDb(snapshot);
    const snapshotRunId = resolveRuntimeRunId(snapshot);
    const snapshotEventSeq = Number(snapshot.eventSeq || 0);
    if (snapshotRunId && snapshotEventSeq > 0) {
      syncWorkflowEventLogUntil(snapshotRunId, snapshotEventSeq);
    }
    if (typeof snapshot.status === 'string' && snapshot.status) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: snapshot.status });
      setRunStatusReason(formatWorkflowFailureReason(snapshot.statusReason) || null);
    }
    if (snapshot.runId) {
      dispatch({ type: 'SET_RUN_ID', payload: snapshot.runId });
    }
    const statusIsActive = isRuntimeWorkflowStatusActive(snapshot.status);
    const statusIsTerminal = isTerminalWorkflowStatus(snapshot.status);
    const nextPhase = typeof snapshot.currentPhase === 'string'
      ? snapshot.currentPhase
      : typeof snapshot.currentState === 'string'
        ? snapshot.currentState
        : undefined;
    if (nextPhase !== undefined) {
      dispatch({ type: 'SET_CURRENT_PHASE', payload: nextPhase });
    } else if (snapshot.status && !statusIsActive) {
      dispatch({ type: 'SET_CURRENT_PHASE', payload: '' });
    }
    if (statusIsTerminal) {
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
    } else if (typeof snapshot.currentStep === 'string') {
      dispatch({ type: 'SET_CURRENT_STEP', payload: snapshot.currentStep });
    } else if (snapshot.status && !statusIsActive) {
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
    }
    setActiveSteps(normalizeActiveWorkflowSteps({
      activeSteps: snapshot.activeSteps,
      currentStep: snapshot.currentStep,
      currentPhase: snapshot.currentPhase,
      currentState: snapshot.currentState,
      completedSteps: snapshot.completedSteps,
      failedSteps: snapshot.failedSteps,
      terminal: statusIsTerminal,
    }));
    if (statusIsTerminal) {
      setActiveConcurrencyGroups([]);
    } else if (Array.isArray(snapshot.activeConcurrencyGroups)) {
      setActiveConcurrencyGroups(snapshot.activeConcurrencyGroups);
    }
    if (Array.isArray(snapshot.completedSteps)) {
      dispatch({ type: 'SET_COMPLETED_STEPS', payload: snapshot.completedSteps });
    }
    if (Array.isArray(snapshot.failedSteps)) {
      dispatch({ type: 'SET_FAILED_STEPS', payload: snapshot.failedSteps });
    }
    if (Array.isArray(snapshot.agents) && snapshot.agents.length > 0) {
      dispatch({ type: 'SET_AGENTS', payload: snapshot.agents });
    }
    if (snapshot.workingDirectory) {
      dispatch({ type: 'SET_WORKING_DIRECTORY', payload: snapshot.workingDirectory });
    }
    if (snapshot.workspaceGit) {
      const nextEnabled = snapshot.workspaceGit.enabled !== false;
      setRuntimeGitBaselineEnabled((current) => current === nextEnabled ? current : nextEnabled);
    }
    if (snapshot.globalContext !== undefined) {
      dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: snapshot.globalContext });
    }
    if (snapshot.phaseContexts) {
      dispatch({ type: 'SET_PHASE_CONTEXTS', payload: snapshot.phaseContexts });
    }
    if (Array.isArray(snapshot.stateHistory)) {
      setSmStateHistory(snapshot.stateHistory);
    }
    if (Array.isArray(snapshot.issueTracker)) {
      setSmIssueTracker(snapshot.issueTracker);
    }
    if (snapshot.transitionCount !== undefined) {
      setSmTransitionCount(snapshot.transitionCount || 0);
    }
    if (Array.isArray(snapshot.supervisorFlow)) {
      setSupervisorFlow(snapshot.supervisorFlow);
    }
    if (Array.isArray(snapshot.agentFlow)) {
      setAgentFlow(snapshot.agentFlow);
    }
    if (snapshot.startTime) {
      setRunStartTime(snapshot.startTime);
    }
    if (snapshot.endTime) {
      setRunEndTime(snapshot.endTime);
    }
    if (typeof snapshot.accumulatedWaitMs === 'number') {
      setRunAccumulatedWaitMs(snapshot.accumulatedWaitMs);
    }
    if (snapshot.waitStartedAt !== undefined) {
      setRunWaitStartedAt(snapshot.waitStartedAt ?? null);
    }
    if (Array.isArray(snapshot.qualityChecks)) {
      setQualityChecks(snapshot.qualityChecks);
    }
    if (!specCodingDisabled && snapshot.runSpecCoding) {
      const runSpecCodingPayload = buildSpecCodingRuntimePayload(snapshot.runSpecCoding, 'run');
      setSpecCodingSummary(runSpecCodingPayload.specCodingSummary);
      setSpecCodingDetails(runSpecCodingPayload.specCodingDetails);
    }
    if (snapshot.persistMode !== undefined) {
      setPersistMode(snapshot.persistMode || undefined);
    }
    if (snapshot.deltaSpecMerged !== undefined) {
      setDeltaSpecMerged(Boolean(snapshot.deltaSpecMerged));
    }
    if (snapshot.deltaMergeState !== undefined) {
      setDeltaMergeState(snapshot.deltaMergeState || undefined);
    }
    if (specCodingDisabled) {
      setSpecRevisionVote(null);
      setSpecRevisionVoteHistory([]);
    } else if (Object.prototype.hasOwnProperty.call(snapshot, 'specRevisionVote')) {
      setSpecRevisionVote(snapshot.specRevisionVote || null);
    }
    if (!specCodingDisabled && Array.isArray(snapshot.specRevisionVoteHistory)) {
      setSpecRevisionVoteHistory(snapshot.specRevisionVoteHistory);
    }
    if (snapshot.latestSupervisorReview) {
      setLatestSupervisorReview(snapshot.latestSupervisorReview);
    }
    if (snapshot.pendingHumanQuestion !== undefined) {
      setPendingHumanQuestionIfChanged(snapshot.pendingHumanQuestion || null);
    }
  }, [dispatch, resolveRuntimeRunId, setPendingHumanQuestionIfChanged, specCodingDisabled, syncRuntimePayloadToDb, syncWorkflowEventLogUntil]);

  const clearHumanApprovalData = useCallback(() => {
    humanApprovalSignatureRef.current = null;
    setHumanApprovalData(null);
  }, []);

  const clearTransientRunUiState = useCallback(() => {
    setSelectedRun(null);
    setRunDetail(null);
    setViewingHistoryRun(false);
    setActiveSteps([]);
    setActiveConcurrencyGroups([]);
    setPersistedStepLogs([]);
    setRunStatusReason(null);
    setSmStateHistory([]);
    setSmIssueTracker([]);
    setSmTransitionCount(0);
    setSupervisorFlow([]);
    setAgentFlow([]);
    setRunStartTime(null);
    setRunEndTime(null);
    setRunAccumulatedWaitMs(0);
    setRunWaitStartedAt(null);
    setFinalReview(null);
    setQualityChecks([]);
    setLatestSupervisorReview(null);
    setSpecRevisionVote(null);
    setSpecRevisionVoteHistory([]);
    setRehearsalInfo(null);
    {
      const nextEnabled = workflowConfig?.context?.gitBaselineEnabled !== false;
      setRuntimeGitBaselineEnabled((current) => current === nextEnabled ? current : nextEnabled);
    }
    dispatch({ type: 'SET_SELECTED_STEP', payload: null });
    dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
    dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: '' });
    dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: false });
    clearPendingHumanQuestion();
    clearHumanApprovalData();
  }, [clearHumanApprovalData, clearPendingHumanQuestion, dispatch, workflowConfig?.context?.gitBaselineEnabled]);

  useEffect(() => {
    const pendingRunId = pendingHumanQuestion?.runId || null;
    if (!pendingRunId || !historyLoaded || historyLoading) return;
    if (historyRuns.some((item: any) => item.id === pendingRunId)) return;
    clearPendingHumanQuestion();
    clearHumanApprovalData();
  }, [
    clearHumanApprovalData,
    clearPendingHumanQuestion,
    historyLoaded,
    historyLoading,
    historyRuns,
    pendingHumanQuestion?.runId,
  ]);

  const clearDeletedRunFromWorkbench = useCallback((deletedRunId: string) => {
    setHistoryRuns((prev) => prev.filter((item: any) => item.id !== deletedRunId));
    setSelectedRun((current: any) => current?.id === deletedRunId ? null : current);
    setSelectedRunIds((prev) => prev.filter((id) => id !== deletedRunId));

    const currentUrlRunId = effectiveSearchParams.get('runId') || effectiveSearchParams.get('run');
    const deletedActiveRun = [
      currentUrlRunId,
      runId,
      selectedRun?.id,
      runDetail?.id,
      pendingHumanQuestion?.runId,
    ].filter(Boolean).includes(deletedRunId);

    if (deletedActiveRun) {
      setRunRecordDrilled(false);
      setRunDetailSection('overview');
      setRunWorkbenchTab('overview');
      setViewingHistoryRun(false);
      setRunDetail(null);
      setActiveSteps([]);
      setActiveConcurrencyGroups([]);
      setPersistedStepLogs([]);
      setSmStateHistory([]);
      setSmIssueTracker([]);
      setSmTransitionCount(0);
      setSupervisorFlow([]);
      setAgentFlow([]);
      clearPendingHumanQuestion();
      clearHumanApprovalData();
      dispatch({ type: 'SET_RUN_ID', payload: '' });
      updateUrl({
        run: null,
        runId: null,
        history: null,
        tab: null,
        workspace: null,
        workspaceRoot: null,
        changes: null,
        workspaceFile: null,
        workspaceLine: null,
        workspaceColumn: null,
      });
      return;
    }

    if (pendingHumanQuestion?.runId === deletedRunId) {
      clearPendingHumanQuestion();
      clearHumanApprovalData();
    }
  }, [
    clearHumanApprovalData,
    clearPendingHumanQuestion,
    dispatch,
    effectiveSearchParams,
    pendingHumanQuestion?.runId,
    runDetail?.id,
    runId,
    selectedRun?.id,
    updateUrl,
  ]);

  useEffect(() => {
    const handleDeletedRun = (event: Event) => {
      const detail = (event as CustomEvent<{ runId?: string; configFile?: string }>).detail;
      const deletedRunId = detail?.runId;
      if (!deletedRunId) return;
      if (detail?.configFile && detail.configFile !== configFile) return;
      clearDeletedRunFromWorkbench(deletedRunId);
      void loadHistory();
    };
    window.addEventListener(WORKFLOW_RUN_DELETED_EVENT, handleDeletedRun);
    return () => window.removeEventListener(WORKFLOW_RUN_DELETED_EVENT, handleDeletedRun);
  }, [clearDeletedRunFromWorkbench, configFile, loadHistory]);

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
  }, [clearHumanApprovalData]);

  useEffect(() => {
    if (focusTarget !== 'human-question') return;
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'workflow' });
    setExecutionViewTabOverride('supervisor');
  }, [dispatch, focusTarget, focusQuestionId]);

  useEffect(() => {
    if (!pendingHumanQuestion) return;
    // 已停止/已结束的工作流不再跳转人工审查
    if (workflowStatus === 'stopped' || workflowStatus === 'completed' || workflowStatus === 'failed' || workflowStatus === 'crashed') return;
    // 跳转到 workbench supervisor tab
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'workflow' });
    setExecutionViewTabOverride('supervisor');
  }, [dispatch, pendingHumanQuestion, workflowStatus]);

  const restoreHumanApprovalFromDetail = useCallback((detail: any) => {
    if (detail?.mode !== 'state-machine' || detail?.currentState !== '__human_approval__') {
      return false;
    }
    // 已停止的工作流不恢复人工审查弹框
    const detailStatus = detail?.status || detail?.workflowStatus;
    if (detailStatus && detailStatus !== 'running' && detailStatus !== 'paused') {
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
    if (isDesignMode) {
      loadWorkflowConfig();
      loadContexts(); // Design mode needs editable contexts immediately
      fetchCurrentStatus();
    } else {
      void loadWorkflowConfig({ background: true });
    }

    if (isRunMode) {
      void loadHistory();
      // History links use the scoped status stream below. Do not let the global stream
      // switch the page away from the explicitly selected run.
      if (isHistoryRunView) {
        return;
      }
      fetchCurrentStatus();
      const eventSource = workflowApi.connectEventStream((event: any) => {
        setViewingHistoryRun(false);
        handleEventRef.current(event);
      });
      return () => eventSource?.close();
    }
  }, [viewMode, isHistoryRunView, initialRunId, runId]);

  useEffect(() => {
    const modeFromUrl = normalizeViewMode(effectiveSearchParams.get('mode'));
    const isViewingHistoricalRunDetail = viewingHistoryRun && state.viewMode === 'run';
    if (!isViewingHistoricalRunDetail && modeFromUrl !== state.viewMode) {
      dispatch({ type: 'SET_VIEW_MODE', payload: modeFromUrl });
    }
  }, [dispatch, searchParamsString, state.viewMode, viewingHistoryRun]);

  useEffect(() => {
    if (!hasRunWorkbenchTabSearchParam(effectiveSearchParams)) return;
    const nextTab = getRunWorkbenchTabFromSearchParams(effectiveSearchParams);
    setRunWorkbenchTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [searchParamsString]);

  // Auto-load run from URL ?run=xxx on mount
  useEffect(() => {
    if (initialRunId && returnedRunIdRef.current === initialRunId) {
      return;
    }
    if (!initialRunId || initialRunId === runId) {
      return;
    }

    const modeFromUrl = normalizeViewMode(effectiveSearchParams.get('mode'));
    if (initialHistoryRun) {
      void viewHistoryRun(initialRunId);
      return;
    }

    dispatch({ type: 'SET_RUN_ID', payload: initialRunId });
    dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
    setViewingHistoryRun(false);
    setSelectedRun(null);
    void fetchCurrentStatus();
  }, [dispatch, fetchCurrentStatus, initialHistoryRun, initialRunId, runId, searchParamsString]);

  useEffect(() => {
    const activeRunId = runId || initialRunId;
    if (viewMode !== 'run' || !activeRunId) {
      return;
    }
    const loadKey = `${configFile}:${activeRunId}`;
    if (autoLoadedRunDetailKeyRef.current === loadKey) {
      return;
    }
    autoLoadedRunDetailKeyRef.current = loadKey;
    void loadRunDetail(activeRunId);
  }, [configFile, initialRunId, loadRunDetail, runId, viewMode]);

  useEffect(() => {
    if (viewMode !== 'run' || viewingHistoryRun || !runDetail) {
      return;
    }
    restoreHumanApprovalFromDetail(runDetail);
  }, [restoreHumanApprovalFromDetail, runDetail, viewingHistoryRun, viewMode]);

  // Sync runId to URL
  useEffect(() => {
    if (viewMode !== 'run') {
      return;
    }
    if (effectiveSearchParams.get('section')?.startsWith('preview')) {
      return;
    }
    const returnedRunId = returnedRunIdRef.current;
    if (returnedRunId && (runId === returnedRunId || initialRunId === returnedRunId)) {
      return;
    }
    if (initialHistoryRun || viewingHistoryRun) {
      const currentUrlRunId = effectiveSearchParams.get('runId');
      if (runId && runId !== currentUrlRunId) {
        updateUrl({ run: null, runId: runId, mode: 'run', history: '1' });
      }
      return;
    }
    const currentUrlRun = effectiveSearchParams.get('run');
    if (initialRunId && runId && initialRunId !== runId && currentUrlRun === initialRunId) {
      return;
    }
    if (runId && runId !== currentUrlRun) {
      updateUrl({ run: runId, runId: null });
    }
  }, [initialHistoryRun, runId, searchParamsString, updateUrl, viewingHistoryRun, viewMode]);

  // Live status stream replaces periodic /api/workflow/status polling.
  useEffect(() => {
    const requestedRunId = statusQueryRunId;
    if (!shouldConnectWorkbenchRunStatusStream({
      viewMode,
      isHistoryRunView,
      configFile,
      runId: requestedRunId,
    })) return;
    const eventSource = workflowApi.connectStatusStream(
      { configFile, runId: requestedRunId },
      (status, event) => {
        if (event) {
          syncRuntimePayloadToDb(event, requestedRunId);
        }
        cacheWorkflowStatusPayload(status, requestedRunId);
        applyWorkflowStatusSnapshot(status);
      },
    );
    return () => eventSource.close();
  }, [viewMode, isHistoryRunView, configFile, statusQueryRunId, applyWorkflowStatusSnapshot, cacheWorkflowStatusPayload, syncRuntimePayloadToDb]);

  useEffect(() => {
    if (isDesignMode && workflowConfig && !hasUnsavedDesignConfigChangesRef.current) {
      dispatch({ type: 'SET_EDITING_CONFIG', payload: JSON.parse(JSON.stringify(workflowConfig)) });
    }
  }, [viewMode, workflowConfig]);

  const viewHistoryRun = async (runId: string) => {
    setHistoryRunAction({ runId, action: 'view' });
    returnedRunIdRef.current = null;
    try {
      const detail = await queryClient.fetchQuery({
        queryKey: queryKeys.runDetail(runId),
        queryFn: () => runsApi.getRunDetail(runId),
        staleTime: 30_000,
      });
      if (!detail) return;
      setRunDetail(detail);
      queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, runId), detail);
      syncRuntimePayloadToDb(detail, runId);

      const detailAttachedAgentSessions = detail.attachedAgentSessions && typeof detail.attachedAgentSessions === 'object' && !Array.isArray(detail.attachedAgentSessions)
        ? Object.fromEntries(
            Object.entries(detail.attachedAgentSessions)
              .map(([agentName, sessionId]) => [String(agentName).trim(), typeof sessionId === 'string' ? sessionId.trim() : ''])
              .filter(([agentName, sessionId]) => agentName && sessionId)
          ) as Record<string, string>
        : {};
      const detailSupervisorAgent = String(
        detail.supervisorAgent
        || workflowConfig?.workflow?.supervisor?.agent
        || agentConfigs.find((agent: any) => agent?.roleType === 'supervisor')?.name
        || 'default-supervisor'
      ).trim();
      const detailSupervisorSessionId = String(
        detail.supervisorSessionId
        || detailAttachedAgentSessions[detailSupervisorAgent]
        || ''
      ).trim();
      if (detailSupervisorAgent && detailSupervisorSessionId) {
        detailAttachedAgentSessions[detailSupervisorAgent] = detailSupervisorSessionId;
      }
      const persistedAgents = Array.isArray(detail.agents) ? detail.agents : [];
      const persistedAgentNames = new Set(
        persistedAgents.map((agent: any) => String(agent?.name || '').trim()).filter(Boolean)
      );
      const sessionOnlyAgents = Object.entries(detailAttachedAgentSessions)
        .filter(([agentName]) => !persistedAgentNames.has(agentName))
        .map(([agentName, sessionId]) => ({
          name: agentName,
          sessionId,
        }));

      // Map persisted agents to the Agent shape the run view expects
      const agents = [...persistedAgents, ...sessionOnlyAgents].map((a: any) => {
        // Resolve model from current agent config (engineModels) if available
        const roleConfig = agentConfigs.find((r: any) => r.name === a.name);
        let model = a.model;
        if (roleConfig?.engineModels) {
          model = resolveWorkflowAgentSelection(
            roleConfig,
            { engine: globalEngine, defaultModel: globalDefaultModel },
            {
              agentName: a.name,
              workflowContext: workflowConfig?.context,
            },
          ).effectiveModel || model;
        }
        const agentName = String(a.name || '').trim();
        return {
          name: agentName,
          team: a.team || roleConfig?.team || (agentName === detailSupervisorAgent ? 'black-gold' : 'blue'),
          model,
          status: a.status || 'waiting',
          currentTask: null,
          completedTasks: a.completedTasks || 0,
          tokenUsage: a.tokenUsage || { inputTokens: 0, outputTokens: 0 },
          sessionId: String(
            a.sessionId
            || detailAttachedAgentSessions[agentName]
            || (agentName === detailSupervisorAgent ? detailSupervisorSessionId : '')
            || ''
          ).trim() || null,
          iterationCount: a.iterationCount || 0,
          summary: a.summary || '',
          changes: [],
        };
      });

      // Restore all state into the run view
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: detail.status === 'crashed' ? 'failed' : detail.status });
      setRunStatusReason(formatWorkflowFailureReason(detail.statusReason) || null);
      dispatch({ type: 'SET_RUN_ID', payload: runId });
      dispatch({ type: 'SET_AGENTS', payload: agents });
      dispatch({ type: 'SET_COMPLETED_STEPS', payload: detail.completedSteps || [] });
      setActiveSteps(Array.isArray(detail.activeSteps) ? detail.activeSteps : []);
      setActiveConcurrencyGroups(Array.isArray(detail.activeConcurrencyGroups) ? detail.activeConcurrencyGroups : []);
      // Ensure the interrupted step is marked as failed for crashed runs
      const failed = [...(detail.failedSteps || [])];
      if ((detail.status === 'crashed' || detail.status === 'failed' || detail.status === 'stopped') && detail.currentStep
        && !detail.completedSteps?.includes(detail.currentStep) && !failed.includes(detail.currentStep)) {
        failed.push(detail.currentStep);
      }
      dispatch({ type: 'SET_FAILED_STEPS', payload: failed });
      if (detail.currentPhase) dispatch({ type: 'SET_CURRENT_PHASE', payload: detail.currentPhase });
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });

      restoreStepLogs(Array.isArray(detail.stepLogs) ? detail.stepLogs : [], 'set');
      void loadRunSplitRuntimeData(runId, 'set');

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

      // Restore state machine data. The compact detail can contain a short tail;
      // the split endpoint above replaces it with the paged lightweight list.
      if (detail.stateHistory) {
        setSmStateHistory(detail.stateHistory);
      }
      setFinalReview(detail.finalReview || null);
      setQualityChecks((detail as any).qualityChecks || []);
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
      setWorkbenchNavSection('runs');
      setRunRecordDrilled(true);
      setRunDetailSection('overview');
      setRunWorkbenchTab('overview');
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      updateUrl({
        run: null,
        runId,
        mode: 'run',
        history: '1',
        section: null,
        tab: 'overview',
        workspace: null,
        workspaceRoot: null,
        changes: null,
        workspaceFile: null,
        workspaceLine: null,
        workspaceColumn: null,
      });
      if (agents.length > 0) {
        dispatch({ type: 'SET_SELECTED_AGENT', payload: agents[0] });
      }
      // Restore state-machine human approval dialog when viewing a historical run
      if (!restoreHumanApprovalFromDetail(detail)) {
        clearHumanApprovalData();
      }
      addLog('system', 'info', `查看历史运行: ${runId}`);
    } catch (error: any) {
      addLog('system', 'error', `加载历史运行失败: ${error.message}`);
    } finally {
      setHistoryRunAction((current) => current?.runId === runId && current.action === 'view' ? null : current);
    }
  };

  const loadWorkflowConfig = async (options?: { background?: boolean }) => {
    const background = options?.background === true;
    if (!background) {
      setPageLoading(true);
      setLoadError(null);
    }
    try {
      const { config, agents: loadedAgents } = await configApi.getConfig(configFile);
      const shouldHydrateDraft = !background || !isDesignMode || !hasUnsavedDesignConfigChangesRef.current;
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      if (shouldHydrateDraft) {
        dispatch({ type: 'SET_EDITING_CONFIG', payload: config });
      }
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: loadedAgents || [] });
      if (shouldHydrateDraft) {
        dispatch({ type: 'SET_PROJECT_ROOT', payload: config.context?.projectRoot || '' });
        dispatch({ type: 'SET_WORKSPACE_MODE', payload: config.context?.workspaceMode || 'isolated-copy' });
        dispatch({ type: 'SET_REQUIREMENTS', payload: config.context?.requirements || '' });
        dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: config.context?.timeoutMinutes || 30 });
        const loadedExecutionPolicy = resolveWorkflowExecutionPolicy(config.context);
        dispatch({ type: 'SET_ENGINE', payload: loadedExecutionPolicy.defaultEngine || '' });
        setWorkflowDefaultModel(loadedExecutionPolicy.defaultModel || '');
        setWorkflowAutoCompactOnStepChange(loadedExecutionPolicy.autoCompactOnStepChange === true);
        setWorkflowSupervisorEnabled((config as any)?.workflow?.supervisor?.enabled === true);
        setWorkflowAgentOverrides(loadedExecutionPolicy.agentOverrides || {});
        dispatch({ type: 'SET_SKILLS', payload: config.context?.skills || [] });
        dispatch({ type: 'SET_MCP_SERVERS', payload: config.context?.mcpServers || [] });
        dispatch({ type: 'SET_RAG_KNOWLEDGE_BASES', payload: Array.isArray(config.context?.capabilitySkills?.rag?.knowledgeBases) ? config.context.capabilitySkills.rag.knowledgeBases : [] });
      }
      if (config.context?.specCodingEnabled === false || config.context?.skipSpecCoding === true) {
        setCreationSessionSummary(null);
        setSpecCodingSummary(null);
        setSpecCodingDetails(null);
        setSpecCodingSourceOfTruth(null);
        setSpecBindingReview(null);
      }

      // Load available skills
      try {
        const skillsRes = await fetch('/api/skills');
        const skillsData = await skillsRes.json();
        setAvailableSkills(skillsData.skills?.map((s: any) => ({ name: s.name, description: s.description })) || []);
      } catch { /* ignore */ }
      try {
        const mcpRes = await fetch('/api/mcp');
        const mcpData = await mcpRes.json();
        setAvailableMcpServers(Array.isArray(mcpData.servers) ? mcpData.servers : []);
      } catch { /* ignore */ }
      try {
        const ragRes = await fetch('/api/rag/knowledge-bases', { headers: getAuthHeaders() });
        const ragData = await ragRes.json();
        setAvailableKnowledgeBases(Array.isArray(ragData.knowledgeBases)
          ? ragData.knowledgeBases.map((kb: any) => ({ id: kb.id, name: kb.name || kb.id, description: kb.description || '', chunkCount: kb.chunkCount || 0 }))
          : []);
      } catch { /* ignore */ }
    } catch (error: any) {
      const message = error?.message || '加载失败';
      if (!background) {
        setLoadError(message);
      }
    } finally {
      if (!background) {
        setPageLoading(false);
      }
    }
  };

  const handleEvent = useCallback((event: any) => {
    if (!shouldApplyRuntimePayload(event?.data)) return;
    syncRuntimePayloadToDb(event);
    if (event?.data?.statusSnapshot?.status) {
      cacheWorkflowStatusPayload(event.data.statusSnapshot, resolveRuntimeRunId(event));
    } else if (['state', 'state-change', 'step', 'result', 'sm-transition', 'agents', 'state-executing', 'agent-flow'].includes(String(event?.type || ''))) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowStatusCompact(configFile, statusQueryRunId) });
    }

    switch (event.type) {
      case 'snapshot': {
        const statuses = event.data?.workflowStatuses || {};
        const status = statuses[configFile]
          || Object.values(statuses).find((item: any) =>
            item?.currentConfigFile === configFile
            || item?.configFile === configFile
            || item?.runId === (runId || selectedRun?.id || initialRunId)
          );
        if (status) {
          cacheWorkflowStatusPayload(status, (status as any).runId || statusQueryRunId);
          applyWorkflowStatusPayload(status, (status as any).runId || statusQueryRunId);
        }
        break;
      }
      case 'status': {
        cacheWorkflowStatusPayload(event.data, event.data?.runId || statusQueryRunId);
        applyWorkflowStatusPayload(event.data, event.data?.runId || statusQueryRunId);
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        if (event.data.workingDirectory) dispatch({ type: 'SET_WORKING_DIRECTORY', payload: event.data.workingDirectory });
        addLog('system', 'info', event.data.message);
        break;
      }
      case 'state': {
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        const stateName = String(event.data.state || event.data.currentState || event.data.statusSnapshot?.currentState || '').trim();
        if (stateName) dispatch({ type: 'SET_CURRENT_PHASE', payload: stateName });
        addLog('system', 'info', `📍 ${event.data.message}`);
        break;
      }
      case 'state-change': {
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        const from = String(event.data.from || event.data.previousState || '').trim();
        const to = String(event.data.to || event.data.targetState || event.data.state || event.data.currentState || event.data.statusSnapshot?.currentState || '').trim();
        if (to) {
          dispatch({ type: 'SET_CURRENT_PHASE', payload: to });
          setSmStateHistory((previous) => {
            const timestamp = event.data.timestamp || new Date().toISOString();
            if (previous.some((item) => item.from === from && item.to === to && item.timestamp === timestamp)) return previous;
            return [...previous, {
              from,
              to,
              reason: event.data.reason || event.data.message || '',
              issues: Array.isArray(event.data.issues) ? event.data.issues : [],
              timestamp,
            }];
          });
        }
        if (typeof event.data.transitionCount === 'number') setSmTransitionCount(event.data.transitionCount);
        addLog('system', 'info', `状态切换: ${from || '-'} -> ${to || '-'}`);
        break;
      }
      case 'step':
      case 'step-start':
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        if (event.data.step) dispatch({ type: 'SET_CURRENT_STEP', payload: event.data.step });
        if (event.data.id) {
          dispatch({ type: 'MAP_STEP_ID', payload: { stepName: event.data.step, stepId: event.data.id } });
        }
        if (event.data.step) setActiveSteps((current) => Array.from(new Set([event.data.step, ...current].filter(Boolean))));
        addLog(event.data.agent || 'system', 'info', `开始执行: ${event.data.step || ''}`);
        break;
      case 'result':
      case 'step-complete': {
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        const resultKey = event.data.id || event.data.step;
        if (event.data.error) {
          addLog(event.data.agent || 'system', 'error', event.data.output || event.data.errorDetail || '步骤执行失败');
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
          setRunStatusReason(event.data.errorDetail || event.data.output || '步骤执行失败');
          setActiveSteps((current) => current.filter((step) => step !== event.data.step));
          if (event.data.step) dispatch({ type: 'ADD_FAILED_STEP', payload: event.data.step });
          dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
          if (resultKey) {
            dispatch({ type: 'SET_STEP_RESULT', payload: {
              step: resultKey,
              result: { output: '', error: event.data.errorDetail || event.data.output },
            }});
          }
        } else {
          addLog(event.data.agent || 'system', 'success', `完成: ${event.data.step || ''}`);
          if (event.data.step) {
            dispatch({ type: 'ADD_COMPLETED_STEP', payload: event.data.step });
            setActiveSteps((current) => current.filter((step) => step !== event.data.step));
          }
          if (resultKey) {
            dispatch({ type: 'SET_STEP_RESULT', payload: {
              step: resultKey,
              result: {
                output: event.data.fullOutput || event.data.output,
                costUsd: event.data.costUsd,
                durationMs: event.data.durationMs,
              },
            }});
          }
        }
        break;
      }
      case 'agents':
        dispatch({ type: 'SET_AGENTS', payload: event.data.agents });
        if (!selectedAgent && event.data.agents.length > 0) {
          dispatch({ type: 'SET_SELECTED_AGENT', payload: event.data.agents[0] });
        }
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
        addLog('system', 'info', `👤 ${event.data.humanQuestion?.source?.type === 'parallel-manual-join' ? '等待并发人工确认' : '等待人工审查'}: ${event.data.currentState} → ${event.data.nextState || event.data.suggestedNextState || ''}`);
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
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
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
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        addLog('system', 'success', 'Supervisor 消息已回复');
        if (!event.data.question || event.data.question.id === pendingHumanQuestion?.id) {
          clearPendingHumanQuestion();
          clearHumanApprovalData();
        }
        break;
      case 'force-transition':
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        addLog('system', 'warning', `⚡ 强制跳转请求: ${event.data.from} → ${event.data.targetState}`);
        break;
      case 'transition-forced':
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        addLog('system', 'info', `⚡ 已强制跳转: ${event.data.from} → ${event.data.to}`);
        dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.to });
        break;
      case 'sm-transition':
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
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
        if (event.data.status === 'delivered') {
          markInlineFeedbacksDelivered(event.data);
        } else {
          upsertInlineFeedback({
            id: event.data.id || (Array.isArray(event.data.ids) ? event.data.ids[0] : '') || `server-feedback-${event.data.timestamp || Date.now()}`,
            message: event.data.message,
            timestamp: event.data.timestamp || new Date().toISOString(),
            streamIndex: liveStream.length,
            mode: event.data.interrupt ? 'interrupt' : 'feedback',
            status: event.data.status === 'interrupting' ? 'interrupting' : 'queued',
            automatic: event.data.automatic,
          });
        }
        break;
      case 'feedback-recalled':
        addLog('system', 'info', `反馈已撤回: ${event.data.message.substring(0, 50)}${event.data.message.length > 50 ? '...' : ''}`);
        setInlineFeedbacks(prev => {
          const idx = prev.findIndex(f => f.id === event.data.id || f.message === event.data.message);
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
      case 'supervisor-review':
        setLatestSupervisorReview(event.data);
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        break;
      default:
        applyWorkflowStatusSnapshot(event.data?.statusSnapshot);
        break;
    }
  }, [selectedAgent, addLog, currentPhase, pendingHumanQuestion?.id, setPendingHumanQuestionIfChanged, setHumanApprovalDataIfChanged, clearPendingHumanQuestion, clearHumanApprovalData, shouldApplyRuntimePayload, applyWorkflowStatusSnapshot, syncRuntimePayloadToDb, cacheWorkflowStatusPayload, resolveRuntimeRunId, queryClient, configFile, statusQueryRunId, liveStream.length, markInlineFeedbacksDelivered, upsertInlineFeedback]);

  // Keep a ref to the latest handleEvent so SSE callback never goes stale
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const syncSavedWorkflowConfig = useCallback((config: any) => {
    latestEditingConfigRef.current = config;
    hasUnsavedDesignConfigChangesRef.current = false;
    dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
    dispatch({ type: 'SET_EDITING_CONFIG', payload: config });
    queryClient.setQueryData(queryKeys.config(configFile), (previous: any) => ({
      ...(previous && typeof previous === 'object' ? previous : {}),
      config,
    }));
    void queryClient.invalidateQueries({ queryKey: ['configs'] });
    setSavedWorkflowRevision((revision) => revision + 1);
  }, [configFile, dispatch, queryClient]);

  const saveConfig = async () => {
    const draftConfig = latestEditingConfigRef.current || editingConfig;
    if (!workflowConfig || !draftConfig) return;
    setSaving(true);
    try {
      const configBase = {
        ...workflowConfig,
        workflow: draftConfig?.workflow || workflowConfig.workflow,
        context: {
          ...(workflowConfig.context || {}),
          ...(draftConfig?.context || {}),
        },
      };
      const config = buildWorkflowDesignConfigForSave(configBase, currentWorkflowDesignDraftState);
      await configApi.saveConfig(configFile, config);
      syncSavedWorkflowConfig(config);
      toast('success', '配置已保存');
    } catch (error: any) {
      toast('error', '保存失败: ' + error.message);
    } finally {
      setSaving(false);
    }
  };

  const hasContextEditableRun = Boolean(runId || initialRunId || selectedRun?.id);

  const requestStartWorkflow = useCallback(async (
    mode: 'rehearsal' | 'real' = (rehearsalMode ? 'rehearsal' : 'real'),
    options?: {
      skipPreflight?: boolean;
      preflightChecks?: QualityCheckRecord[];
    },
  ) => {
    if (startRequesting || starting) return;
    setStartRequesting(true);
    const nextPhaseDrafts = Object.fromEntries(
      startContextTargets.map((name: string) => [name, phaseContexts[name] || ''])
    ) as Record<string, string>;
    const fallbackWorkingDirectory = state.workingDirectory || '';
    setPendingStartRequest({
      mode,
      skipPreflight: options?.skipPreflight,
      preflightChecks: options?.preflightChecks,
      preflightPreview: null,
    });
    setStartGlobalContextDraft(globalContext || '');
    setStartPhaseContextDrafts(nextPhaseDrafts);
    setStartTaskInputDraft({});
    setStartWorkingDirectoryDraft(fallbackWorkingDirectory);
    setShowStartWorkflowDialog(true);
    try {
      const savedDefaults = await workflowApi.getStartContextDefaults(configFile).catch(() => null);
      if (savedDefaults) {
        const savedPhaseDrafts = Object.fromEntries(
          startContextTargets.map((name: string) => [name, savedDefaults.phaseContexts?.[name] || ''])
        ) as Record<string, string>;
        setStartGlobalContextDraft(savedDefaults.globalContext || '');
        setStartPhaseContextDrafts(savedPhaseDrafts);
        setStartWorkingDirectoryDraft(savedDefaults.workingDirectory || fallbackWorkingDirectory);
      }
      let preflightPreview: Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null = null;
      if (!options?.skipPreflight) {
        preflightPreview = await workflowApi.preflightPreview(configFile);
      }
      setPendingStartRequest((current) => current && current.mode === mode ? {
        mode,
        skipPreflight: options?.skipPreflight,
        preflightChecks: options?.preflightChecks,
        preflightPreview,
      } : current);
    } catch (error: any) {
      toast('warning', error?.message || '启动前检查预览暂不可用，可继续设置上下文后启动');
    } finally {
      setStartRequesting(false);
    }
  }, [configFile, globalContext, phaseContexts, rehearsalMode, startContextTargets, startRequesting, starting, state.workingDirectory, toast]);

  useEffect(() => {
    if (autoStartHandledRef.current) return;
    if (effectiveSearchParams.get('autoStart') !== '1') return;
    if (pageLoading || !workflowConfig) return;

    autoStartHandledRef.current = true;
    if (!canStartWorkflow) {
      if (isRunning) {
        toast('warning', '该工作流当前正在运行，无法重复启动');
      }
      updateUrl({ autoStart: null, mode: 'run' });
      return;
    }

    void requestStartWorkflow('real');
    updateUrl({ autoStart: null, mode: 'run' });
  }, [canStartWorkflow, isRunning, pageLoading, requestStartWorkflow, searchParamsString, toast, updateUrl, workflowConfig]);

  const requestCancelStartup = useCallback(async () => {
    if (startupCancelRequestedRef.current) return;
    startupCancelRequestedRef.current = true;
    setStartupCancelRequested(true);
    setRehearsalProgressSteps((prev) => [...prev, '已请求取消启动，正在等待当前步骤结束']);
    const createdRunId = startupCreatedRunIdRef.current;
    if (createdRunId) {
      try {
        await workflowApi.stop(configFile);
        setRehearsalProgressSteps((prev) => [...prev, '已停止已创建的运行']);
      } catch (error: any) {
        setRehearsalProgressSteps((prev) => [...prev, `取消停止请求失败：${error?.message || '未知错误'}`]);
      }
    }
  }, [configFile]);

  const startWorkflow = async (
    mode: 'rehearsal' | 'real' = (rehearsalMode ? 'rehearsal' : 'real'),
    options?: {
      skipPreflight?: boolean;
      preflightChecks?: QualityCheckRecord[];
      initialContexts?: WorkflowStartContexts;
      reviewSelection?: WorkflowStartReviewSelection;
    },
  ) => {
    const isRehearsalStart = mode === 'rehearsal';
    const skipPreflight = !!options?.skipPreflight;
    const plannedStart = Boolean(options?.reviewSelection);
    const preflightStrategy = resolveStartPreflightStrategy({
      plannedStart,
      skipRequested: skipPreflight,
    });
    const initialContexts = options?.initialContexts;
    const normalizedWorkingDirectory = (initialContexts?.workingDirectory || '').trim();
    const normalizedProjectRoot = normalizedWorkingDirectory || (projectRoot || '').trim();
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

    startupCancelRequestedRef.current = false;
    startupInProgressRef.current = true;
    startupExpectedRunIdRef.current = null;
    setStartupCancelRequested(false);
    startupCreatedRunIdRef.current = null;
    setStarting(true);
    try {
      const normalizedPhaseContexts = Object.fromEntries(
        Object.entries(initialContexts?.phaseContexts || {})
          .map(([name, value]) => [name, value || ''])
          .filter(([, value]) => value.trim().length > 0)
      );
      const normalizedGlobalContext = initialContexts?.globalContext || '';
      const normalizedTaskInput = normalizeWorkflowTaskInput(initialContexts?.taskInput);
      dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: normalizedGlobalContext });
      dispatch({ type: 'SET_PHASE_CONTEXTS', payload: normalizedPhaseContexts });
      if (normalizedWorkingDirectory) {
        dispatch({ type: 'SET_WORKING_DIRECTORY', payload: normalizedWorkingDirectory });
      }
      workflowApi.setStartContextDefaults(configFile, {
        globalContext: normalizedGlobalContext,
        phaseContexts: normalizedPhaseContexts,
        workingDirectory: normalizedWorkingDirectory || undefined,
      }).catch((error: any) => {
        addLog('system', 'warning', `保存下次启动上下文默认值失败: ${error?.message || '未知错误'}`);
      });
      setStartupProgressMode(mode);
      setRehearsalProgressSteps([
        isRehearsalStart
          ? (skipPreflight
            ? '已进入演练模式，跳过项目检查，正在执行必要启动校验'
            : '已进入演练模式，正在执行启动前检查')
          : (skipPreflight
            ? '正在正式启动，已跳过项目检查，正在执行必要启动校验'
            : '正在正式启动，正在执行启动前检查'),
      ]);
      setRehearsalProgressDialogOpen(true);
      if (!isRehearsalStart) {
        setRehearsalResultDialogOpen(false);
      }
      let preflight = {
        ok: true,
        failedCount: 0,
        warningCount: 0,
        checks: options?.preflightChecks || [],
      };
      const clientExecutedPreflight = preflightStrategy.runInClient;
      if (clientExecutedPreflight) {
        preflight = await workflowApi.preflight(configFile, normalizedProjectRoot);
      }
      if (startupCancelRequestedRef.current) {
        setRehearsalProgressSteps((prev) => [...prev, '启动已取消']);
        return;
      }
      setPreflightChecks(preflight.checks || []);
      if (clientExecutedPreflight) {
        setRehearsalProgressSteps((prev) => [...prev, `启动前检查完成：${preflight.failedCount > 0 ? `${preflight.failedCount} 项失败` : preflight.warningCount > 0 ? `${preflight.warningCount} 项警告` : '全部通过'}`]);
      } else if (plannedStart && !skipPreflight) {
        setRehearsalProgressSteps((prev) => [...prev, '已确认检查计划，正在执行服务端启动前检查']);
      } else {
        setRehearsalProgressSteps((prev) => [...prev, '已跳过 lint、build、test 等项目检查；运行方案与工作流结构仍会校验']);
      }
      if (!preflight.ok) {
        const failedDetails = (preflight.checks || [])
          .filter((check) => check.status === 'failed')
          .slice(0, 5)
          .map((check) => {
            const commandResult = formatQualityCheckCommandResults(check);
            return `${check.summary || describeQualityCheck(check)}${commandResult ? `\n${commandResult}` : ''}`;
          })
          .join('\n\n');
        setRehearsalProgressSteps((prev) => [...prev, isRehearsalStart ? '演练已停止，请先处理启动前检查失败项' : '正式启动已停止，请先处理启动前检查失败项']);
        dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
        addLog('system', 'error', `启动前检查未通过: ${preflight.failedCount} 项失败${failedDetails ? `\n\n${failedDetails}` : ''}`);
        await confirm({
          title: '启动前检查未通过',
          description: failedDetails || `启动前检查未通过：${preflight.failedCount} 项失败。`,
          confirmLabel: '知道了',
          cancelLabel: '关闭',
          variant: 'destructive',
        });
        return;
      }
      if (preflight.warningCount > 0) {
        const warningDescription = (preflight.checks || [])
          .filter((check) => check.status === 'warning')
          .slice(0, 3)
          .map((check) => {
            const commandResult = formatQualityCheckCommandResults(check);
            return `${check.summary || describeQualityCheck(check)}${commandResult ? `\n${commandResult}` : ''}`;
          })
          .join('\n\n');
        const confirmed = await confirm({
          title: '启动前检查存在警告',
          description: warningDescription || '启动前检查存在警告，确认后将继续启动。',
          confirmLabel: '继续启动',
          cancelLabel: '取消',
          variant: 'default',
        });
        if (!confirmed) {
          setRehearsalProgressSteps((prev) => [...prev, isRehearsalStart ? '已取消演练，等待处理 preflight 警告' : '已取消正式启动，等待处理 preflight 警告']);
          addLog('system', 'warning', '已取消启动，等待处理 preflight 警告');
          toast('warning', '已取消启动，可先处理 preflight 警告');
          return;
        }
        addLog('system', 'warning', `启动前检查存在 ${preflight.warningCount} 项警告，已人工确认后继续执行`);
      }
      if (startupCancelRequestedRef.current) {
        setRehearsalProgressSteps((prev) => [...prev, '启动已取消']);
        return;
      }
      clearTransientRunUiState();
      dispatch({ type: 'RESET_RUN' });
      latestRunIdRef.current = null;
      startupExpectedRunIdRef.current = null;
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'preparing' });
      addLog('system', 'info', isRehearsalStart ? '正在启动演练模式...' : '正在启动工作流...');
      setRehearsalProgressSteps((prev) => [...prev,
        plannedStart && !skipPreflight
          ? (isRehearsalStart ? '正在执行启动前检查并创建演练运行' : '正在执行启动前检查并创建正式运行')
          : skipPreflight
            ? (isRehearsalStart ? '正在完成必要校验并创建演练运行' : '正在完成必要校验并创建正式运行')
            : (isRehearsalStart ? '已通过检查，正在创建演练运行并等待结果' : '已通过检查，正在创建正式运行'),
      ]);
      const startResult = await workflowApi.start(configFile, undefined, {
        // Legacy starts already ran their project checks in this client. A
        // planned start delegates the single authoritative execution to the
        // server unless the user explicitly skips project checks.
        skipPreflight: preflightStrategy.skipOnServer,
        rehearsal: isRehearsalStart,
        preflightChecks: preflight.checks || [],
        startPlanId: options?.reviewSelection?.planId,
        adversarialIntent: options?.reviewSelection?.intent,
        reviewOverrides: options?.reviewSelection?.overrides,
        initialContexts: {
          globalContext: normalizedGlobalContext,
          phaseContexts: normalizedPhaseContexts,
          taskInput: normalizedTaskInput,
          workingDirectory: normalizedWorkingDirectory || undefined,
        },
      });
      if (plannedStart && !skipPreflight) {
        setRehearsalProgressSteps((prev) => [...prev, '启动前检查完成：全部通过']);
      }
      startupCreatedRunIdRef.current = startResult.runId || null;
      startupExpectedRunIdRef.current = startResult.runId || null;
      if (startupCancelRequestedRef.current) {
        if (startResult.runId) {
          try {
            await workflowApi.stop(configFile);
            setRehearsalProgressSteps((prev) => [...prev, '启动已取消，已停止刚创建的运行']);
          } catch (error: any) {
            setRehearsalProgressSteps((prev) => [...prev, `启动已取消，但停止运行失败：${error?.message || '未知错误'}`]);
          }
        } else {
          setRehearsalProgressSteps((prev) => [...prev, '启动已取消']);
        }
        return;
      }
      if (!isRehearsalStart && startResult.runId) {
        const newRunId = String(startResult.runId);
        const startedRun = {
          id: newRunId,
          runId: newRunId,
          configFile,
          status: 'preparing',
          startTime: new Date().toISOString(),
        };
        latestRunIdRef.current = startResult.runId;
        setHistoryRuns((current) => upsertStartedRunInHistory(current, startedRun));
        setSelectedRun(startedRun);
        setViewingHistoryRun(false);
        dispatch({ type: 'SET_RUN_ID', payload: startResult.runId });
        dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
        setWorkbenchNavSection('runs');
        setRunRecordDrilled(true);
        setRunDetailSection('overview');
        setRunWorkbenchTab('overview');
        await updateUrl({
          mode: 'run',
          run: startResult.runId,
          history: null,
          section: null,
          tab: 'overview',
          workspace: null,
          workspaceRoot: null,
          changes: null,
          workspaceFile: null,
          workspaceLine: null,
          workspaceColumn: null,
        });
      }
      if (isRehearsalStart && (startResult as any).rehearsal) {
        setRehearsalProgressSteps((prev) => [...prev, '演练执行完成，正在整理结果']);
        setRehearsalProgressDialogOpen(false);
        setRehearsalInfo((startResult as any).rehearsal);
        setRehearsalResultDialogOpen(true);
    } else {
      setRehearsalProgressSteps((prev) => [...prev, '正式运行已创建，正在进入执行界面']);
      setRehearsalProgressDialogOpen(false);
    }
      addLog('system', 'success', isRehearsalStart ? '演练模式执行完成' : '工作流启动成功，等待执行...');
      // Fetch status shortly after start to catch initial state
      setTimeout(fetchCurrentStatus, 500);
    } catch (error: any) {
      const failedChecks = Array.isArray(error?.checks)
        ? (error.checks as QualityCheckRecord[]).filter((check) => check?.status === 'failed')
        : [];
      if (Array.isArray(error?.checks)) {
        setPreflightChecks(error.checks as QualityCheckRecord[]);
      }
      const failedDetails = failedChecks.slice(0, 5).map((check) => {
        const commandResult = formatQualityCheckCommandResults(check);
        return `${check.summary || describeQualityCheck(check)}${commandResult ? `\n${commandResult}` : ''}`;
      });
      setRehearsalProgressSteps((prev) => [
        ...prev,
        isRehearsalStart ? `演练启动失败：${error.message}` : `正式启动失败：${error.message}`,
        ...failedDetails.map((detail) => `失败详情：\n${detail}`),
      ]);
      setRehearsalProgressDialogOpen(true);
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `启动失败: ${error.message}${failedDetails.length ? `\n\n${failedDetails.join('\n\n')}` : ''}`);
    } finally {
      startupCancelRequestedRef.current = false;
      startupInProgressRef.current = false;
      setStartupCancelRequested(false);
      startupCreatedRunIdRef.current = null;
      setStarting(false);
    }
  };

  const confirmStartWorkflow = useCallback((
    contexts: WorkflowStartContexts,
    reviewSelection?: WorkflowStartReviewSelection,
    preflightMode: 'run' | 'skip' = 'run',
  ) => {
    if (!pendingStartRequest) return;
    const request = pendingStartRequest;
    setPendingStartReviewPlanId(null);
    setShowStartWorkflowDialog(false);
    setPendingStartRequest(null);
    setStartGlobalContextDraft(contexts.globalContext);
    setStartPhaseContextDrafts(contexts.phaseContexts);
    setStartTaskInputDraft(normalizeWorkflowTaskInput(contexts.taskInput));
    setStartWorkingDirectoryDraft(contexts.workingDirectory || '');
    void startWorkflow(request.mode, {
      // Skipping applies only to project quality commands. Planned-run hashes,
      // effective config validation, agent bindings and snapshots remain
      // mandatory on the server.
      skipPreflight: request.skipPreflight || preflightMode === 'skip',
      preflightChecks: request.preflightChecks,
      initialContexts: contexts,
      reviewSelection,
    });
  }, [pendingStartRequest, startWorkflow]);

  const stopWorkflow = useCallback(async () => {
    setStopping(true);
    setStopProgressDialogOpen(true);
    setStopProgressSummary('停止请求已发送，正在停止运行实例。');
    setStopProgressSteps(createStopProgressSteps());
    let statusPollTimer: number | undefined;
    let statusPollInFlight = false;
    try {
      const targetRunId = actionRunId || runId || selectedRun?.id || initialRunId || undefined;
      const pollStoppedState = async () => {
        if (statusPollInFlight) return;
        statusPollInFlight = true;
        try {
          const status = await workflowApi.getStatus(configFile, targetRunId, { compact: true });
          if (normalizeWorkflowStatusCode(status?.status) !== 'stopped') return;
          setStopProgressSteps((prev) => markStopProgressStatePersisted(prev));
          setStopProgressSummary('运行实例已停止，正在后台清理运行资源。');
        } catch {
          // The stop request remains authoritative; polling only improves visible progress.
        } finally {
          statusPollInFlight = false;
        }
      };
      statusPollTimer = window.setInterval(() => { void pollStoppedState(); }, 500);
      void pollStoppedState();
      const stopResult = await workflowApi.stop(configFile, targetRunId) as {
        success?: boolean;
        runIds?: string[];
        steps?: unknown;
      };
      setStopProgressSteps((prev) => {
        const merged = mergeUserVisibleStopProgressSteps(prev, stopResult.steps);
        const requested = merged.map((step) => (
          step.id === 'request' ? { ...step, status: 'success' as const } : step
        ));
        return stopResult.success === false ? requested : completeStopProgressSteps(requested);
      });
      setStopProgressSummary(stopResult.success === false ? '停止工作流失败。' : '停止请求已完成。');
      if (stopResult.success === false) {
        throw new Error('停止工作流失败。');
      }
      const stoppedAt = new Date().toISOString();
      const stoppedRunIds = new Set(
        (Array.isArray(stopResult.runIds) ? stopResult.runIds : [])
          .concat(targetRunId || [])
          .filter(Boolean) as string[]
      );
      // Directly update local state — don't rely solely on SSE
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'stopped' });
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      setRunStatusReason('用户手动停止');
      setActiveSteps([]);
      setActiveConcurrencyGroups([]);
      clearHumanApprovalData();
      clearPendingHumanQuestion();
      for (const stoppedRunId of stoppedRunIds) {
        queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, stoppedRunId), (current: any) => ({
          ...(current || {}),
          runId: stoppedRunId,
          status: 'stopped',
          statusReason: '用户手动停止',
          currentStep: '',
          activeSteps: [],
          activeConcurrencyGroups: [],
        }));
      }
      queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, undefined), (current: any) => ({
        ...(current || {}),
        runId: runId || selectedRun?.id || initialRunId || current?.runId,
        status: 'stopped',
        statusReason: '用户手动停止',
        currentStep: '',
        activeSteps: [],
        activeConcurrencyGroups: [],
      }));
      setHistoryRuns((prev) => prev.map((item) => (
        stoppedRunIds.has(item.id)
          ? { ...item, status: 'stopped', endTime: item.endTime || stoppedAt }
          : item
      )));
      setSelectedRun((prev: any) => (
        prev && stoppedRunIds.has(prev.id)
          ? { ...prev, status: 'stopped', endTime: prev.endTime || stoppedAt }
          : prev
      ));
      setRunDetail((prev: any) => (
        prev && stoppedRunIds.has(prev.id || prev.runId)
          ? { ...prev, status: 'stopped', endTime: prev.endTime || stoppedAt, activeSteps: [], activeConcurrencyGroups: [] }
          : prev
      ));
      addLog('system', 'warning', '工作流已停止');
      await Promise.all([loadHistory(), fetchCurrentStatus()]);
      setStopProgressSteps((prev) => prev.map((step) => (
        step.id === 'refresh' ? { ...step, status: 'success', detail: '运行状态已刷新。' } : step
      )));
      setStopProgressSummary('工作流已停止。');
    } catch (error: any) {
      setStopProgressSteps((prev) => prev.map((step) => (
        step.status === 'running' ? { ...step, status: 'failed', detail: '停止请求未完成。' } : step
      )));
      setStopProgressSummary('停止工作流失败。');
      addLog('system', 'error', '停止工作流失败。');
    } finally {
      if (statusPollTimer !== undefined) window.clearInterval(statusPollTimer);
      setStopping(false);
    }
  }, [actionRunId, addLog, clearHumanApprovalData, clearPendingHumanQuestion, configFile, dispatch, fetchCurrentStatus, initialRunId, loadHistory, queryClient, runId, selectedRun?.id]);

  const requestStopWorkflow = useCallback(async () => {
    const ok = await confirm({
      title: '确认停止工作流',
      description: '停止后当前运行将中断。是否继续？',
      confirmLabel: '确认停止',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    await stopWorkflow();
  }, [confirm, stopWorkflow]);

  const handleForceTransition = (targetState: string) => {
    setForceTransitionModal({ targetState, instruction: '' });
  };

  const patchRunStatusLocally = useCallback((targetRunId: string, status: string, statusReason: string | null = null) => {
    if (!targetRunId) return;
    const patch = {
      id: targetRunId,
      runId: targetRunId,
      status,
      workflowStatus: status,
      statusReason,
      endTime: status === 'running' || status === 'preparing' ? null : undefined,
      updatedAt: new Date().toISOString(),
    };
    setHistoryRuns((previous) => previous.map((item) => item.id === targetRunId ? { ...item, ...patch } : item));
    setSelectedRun((previous: any) => previous?.id === targetRunId ? { ...previous, ...patch } : previous);
    setRunDetail((previous: any) => {
      const previousRunId = String(previous?.id || previous?.runId || '');
      return previousRunId === targetRunId ? { ...previous, ...patch } : previous;
    });
    queryClient.setQueryData(queryKeys.workflowStatusCompact(configFile, targetRunId), (previous: any) => ({
      ...(previous || {}),
      ...patch,
    }));
  }, [configFile, queryClient]);

  const executeForceTransition = async () => {
    if (!forceTransitionModal) return;
    setForceTransitioning(true);
    try {
      const rid = runId || selectedRun?.id;
      if (rid) {
        // 对人工审查跳转统一走专用 runId 驱动接口，避免服务热重载后丢失内存 manager。
        await applyAcceptedWorkbenchRecovery(
          () => workflowApi.forceTransition(
            forceTransitionModal.targetState,
            forceTransitionModal.instruction || undefined,
            configFile,
            rid,
          ),
          () => {
            setViewingHistoryRun(false);
            dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
            patchRunStatusLocally(rid, 'running');
          },
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
    } catch (e: any) {
      addLog('system', 'error', `强制恢复失败: ${e.message || '未知错误'}`);
      toast('error', e.message);
    } finally {
      setForceTransitioning(false);
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
      fetchCurrentStatus();
    } catch (error: any) {
      toast('error', error.message || '提交回复失败');
    } finally {
      setSubmittingHumanQuestion(false);
    }
  };

  const forceCompleteStep = async () => {
    const stepName = forceCompletableStep;
    if (!stepName) {
      toast('warning', '当前没有正在运行的步骤，无法强制放行');
      return;
    }

    const ok = await confirm({
      title: '确认强制放行当前步骤',
      description: `这会中断当前步骤「${stepName}」，并把已产生的实时输出作为该步骤结果继续推进工作流。只有在你确认当前输出已经足够时才使用。`,
      confirmLabel: '确认强制放行',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;

    setForceCompleting(true);
    try {
      const result = await workflowApi.forceCompleteStep(configFile);
      addLog('system', 'info', `步骤 "${result.step}" 已强制放行 (${result.outputLength} 字符)`);
      fetchCurrentStatus();
    } catch (error: any) {
      addLog('system', 'error', `强制放行失败: ${error.message}`);
      toast('error', error.message);
    } finally {
      setForceCompleting(false);
    }
  };

  const resolveHumanApprovalPassTarget = () => {
    const question = pendingHumanQuestion;
    const sourceState = String(
      question?.previousState
      || (question?.source as any)?.fromState
      || question?.workflowPath?.at(-1)?.stateName
      || ''
    ).trim();
    const workflowStates = Array.isArray(workflowConfig?.workflow?.states) ? workflowConfig.workflow.states : [];
    const sourceStateConfig = workflowStates.find((stateNode: any) => String(stateNode?.name || '') === sourceState);
    const passTransition = Array.isArray((sourceStateConfig as any)?.transitions)
      ? (sourceStateConfig as any).transitions.find((transition: any) => transition?.condition?.verdict === 'pass')
      : null;
    const passTarget = String(passTransition?.to || '').trim();
    if (passTarget) return passTarget;
    return String(question?.suggestedNextState || question?.availableStates?.[0] || '').trim();
  };

  const submitHumanApprovalFromBanner = async () => {
    if (!pendingHumanQuestion) {
      toast('warning', '当前没有待处理的人工问题');
      return;
    }
    const selectedState = resolveHumanApprovalPassTarget();
    if (pendingHumanQuestion.answerSchema?.type === 'approval-transition' && !selectedState) {
      toast('warning', '请选择审查通过后的目标状态');
      openRunDetailSection('live');
      return;
    }
    await handleSubmitHumanQuestion({
      selectedState,
      instruction: `通过人工审查，按 pass 路径进入「${selectedState}」。`,
    });
  };

  const rejectHumanApprovalFromBanner = async () => {
    if (!pendingHumanQuestion) {
      toast('warning', '当前没有待处理的人工问题');
      return;
    }
    const ok = await confirm({
      title: '确认拒绝并停止',
      description: '拒绝后将停止当前工作流运行。是否继续？',
      confirmLabel: '拒绝并停止',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!ok) return;
    setSubmittingHumanQuestion(true);
    try {
      setViewingHistoryRun(false);
      await stopWorkflow();
      clearPendingHumanQuestion();
      clearHumanApprovalData();
      toast('success', '已停止当前工作流');
      fetchCurrentStatus();
    } catch (error: any) {
      toast('error', error.message || '停止工作流失败');
    } finally {
      setSubmittingHumanQuestion(false);
    }
  };

  const resumeWorkflow = async (resumeRunId?: string) => {
    const rid = resumeRunId || actionRunId || runId || selectedRun?.id;
    if (!rid) return;
    if (resumeRunId) setHistoryRunAction({ runId: rid, action: 'resume' });
    try {
      setViewingHistoryRun(false);
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
      dispatch({ type: 'SET_RUN_ID', payload: rid });
      patchRunStatusLocally(rid, 'running');
      addLog('system', 'info', `正在恢复运行: ${rid}...`);
      await workflowApi.resume(rid);
      addLog('system', 'success', '工作流恢复成功，继续执行...');
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      // Fetch immediately, then polling effect takes over (every 3s)
      fetchCurrentStatus();
    } catch (error: any) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      setRunStatusReason(error.message || '恢复失败');
      patchRunStatusLocally(rid, 'failed', error.message || '恢复失败');
      addLog('system', 'error', `恢复失败: ${error.message}`);
    } finally {
      if (resumeRunId) setHistoryRunAction((current) => current && current.runId === rid && current.action === 'resume' ? null : current);
    }
  };

  const requestResumeWorkflow = useCallback(() => {
    if (!canResumeWorkflow) {
      toast('warning', resumeWorkflowDisabledReason);
      return;
    }
    void resumeWorkflow(actionRunId);
  }, [actionRunId, canResumeWorkflow, resumeWorkflowDisabledReason, resumeWorkflow, toast]);

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = { idle: '空闲', preparing: '准备中', running: '运行中', completed: '已完成', failed: '失败', stopped: '已停止', crashed: '崩溃' };
    return texts[status] || status;
  };

  const handleDeleteRun = async (deleteRunId: string) => {
    const confirmed = await confirm({
      title: '删除运行记录',
      description: '确定要删除这个运行记录吗？此操作不可撤销。',
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (!confirmed) return;

    setHistoryRunAction({ runId: deleteRunId, action: 'delete' });
    try {
      await runsApi.deleteRun(deleteRunId);
      clearDeletedRunFromWorkbench(deleteRunId);
      toast('success', '运行记录已删除');
      // Reload history
      await loadHistory();
    } catch (error: any) {
      toast('error', `删除失败: ${error.message}`);
    } finally {
      setHistoryRunAction((current) => current?.runId === deleteRunId && current.action === 'delete' ? null : current);
    }
  };

  const handleAnalyzeRunPrompts = async (runId: string) => {
    setHistoryRunAction({ runId, action: 'analyze' });
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
      setHistoryRunAction((current) => current?.runId === runId && current.action === 'analyze' ? null : current);
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

  const toggleOptimizationSelection = useCallback((index: number, checked: boolean | 'indeterminate') => {
    setSelectedOptimizations((prev) => {
      const next = new Set(prev);
      if (checked === true) next.add(index);
      else next.delete(index);
      return next;
    });
  }, []);

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
    setRightPanelTab('detail');
    setRunInspectorPanelOpen(true);
    setShowSystemPrompt(false);
    const agent = agents.find((a) => a.name === step.agent);
    if (agent) {
      dispatch({ type: 'SET_SELECTED_AGENT', payload: agent });
      dispatch({ type: 'SET_SELECTED_STEP', payload: step });
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' });
    }
  };

  const findSubworkflowRunForStep = useCallback((step: any, candidates: any[] = subworkflowRuns) => {
    if (!step || step.type !== 'subworkflow') return null;
    const stepName = String(step.name || '').trim();
    const configFile = getSubworkflowConfigFileFromStep(step);
    const normalizedConfigFile = configFile.toLowerCase();
    const items = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
    const byStep = [...items].reverse().find((child) =>
      stepName
      && String(child?.parentStepName || '').trim() === stepName
      && (!configFile || String(child?.configFile || '').trim().toLowerCase() === normalizedConfigFile)
    );
    if (byStep) return byStep;
    const byConfig = [...items].reverse().find((child) =>
      configFile
      && String(child?.configFile || '').trim().toLowerCase() === normalizedConfigFile
    );
    if (byConfig) return byConfig;
    const fallbackRunId = Array.isArray((workflowStatus as any)?.childRunIds)
      ? (workflowStatus as any).childRunIds.at(-1)
      : null;
    if (configFile && typeof fallbackRunId === 'string' && fallbackRunId.trim()) {
      return {
        runId: fallbackRunId.trim(),
        configFile,
        parentStepName: stepName,
        status: 'unknown',
      };
    }
    return null;
  }, [getSubworkflowConfigFileFromStep, subworkflowRuns]);

  const handleRunDiagramStepClick = useCallback((step: any) => {
    if (step?.type === 'subworkflow') {
      const childRun = findSubworkflowRunForStep(step);
      if (childRun?.configFile && childRun?.runId) {
        void openSubworkflowRun(childRun);
        return;
      }
      void openSubworkflowConfigPreview(step);
      return;
    }
    selectStep(step);
  }, [findSubworkflowRunForStep, openSubworkflowConfigPreview, openSubworkflowRun]);

  const renderSubworkflowDrilldown = useCallback(() => {
    const active = subworkflowDrilldownStack[subworkflowDrilldownStack.length - 1];
    if (!active) return null;
    const childConfig = active.config;
    const childWorkflow = childConfig?.workflow;
    const childStatus = active.status || {};
    const childTabKey = getSubworkflowCacheKey(active.configFile, active.runId || '');
    const childSubworkflowRuns = Array.isArray(childStatus.subworkflowRuns) ? childStatus.subworkflowRuns : [];
    const handleChildStepClick = (step: any) => {
      if (step?.type === 'subworkflow') {
        const childRun = findSubworkflowRunForStep(step, childSubworkflowRuns);
        if (childRun?.configFile && childRun?.runId) {
          void openSubworkflowRun(childRun);
          return;
        }
        void openSubworkflowConfigPreview(step);
        return;
      }
      selectStep(step);
    };

    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-sm">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-muted/20 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 gap-1.5"
              onClick={() => setSubworkflowDrilldownStack((prev) => prev.slice(0, -1))}
            >
              <span className="material-symbols-outlined text-base">arrow_back</span>
              返回父工作流
            </Button>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">
                {childWorkflow?.name || active.child?.parentStepName || active.configFile}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {active.previewOnly ? `${active.configFile} · 未绑定运行记录` : `${active.configFile} · ${active.runId}`}
              </div>
            </div>
          </div>
          <Badge variant={active.previewOnly ? 'outline' : childStatus.status === 'failed' || childStatus.status === 'crashed' ? 'destructive' : childStatus.status === 'completed' ? 'default' : 'secondary'}>
            {active.previewOnly ? '预览' : (childStatus.status || active.child?.status || 'unknown')}
          </Badge>
        </div>
        <div className="min-h-0 flex-1 p-4">
          {isLightweightWorkflowConfig(childConfig) ? (
            <LightweightWorkflowExecutionView
              workflow={childWorkflow}
              runId={active.runId || null}
              status={childStatus.status || active.child?.status || 'idle'}
              currentState={childStatus.currentState || childStatus.currentPhase || null}
              currentStep={childStatus.currentStep || null}
              activeSteps={Array.isArray(childStatus.activeSteps) ? childStatus.activeSteps : []}
              completedSteps={Array.isArray(childStatus.completedSteps) ? childStatus.completedSteps : []}
              failedSteps={Array.isArray(childStatus.failedSteps) ? childStatus.failedSteps : []}
              workspaceAvailable={false}
            />
          ) : (
            <StateMachineExecutionView
              states={childWorkflow.states || []}
              agents={active.agents || []}
              currentState={childStatus.currentPhase || null}
              currentStep={childStatus.currentStep || null}
              activeSteps={Array.isArray(childStatus.activeSteps) ? childStatus.activeSteps : []}
              activeConcurrencyGroups={Array.isArray(childStatus.activeConcurrencyGroups) ? childStatus.activeConcurrencyGroups : []}
              completedSteps={Array.isArray(childStatus.completedSteps) ? childStatus.completedSteps : []}
              stateHistory={Array.isArray(childStatus.stateHistory) ? childStatus.stateHistory : []}
              issueTracker={Array.isArray(childStatus.issueTracker) ? childStatus.issueTracker : []}
              transitionCount={typeof childStatus.transitionCount === 'number' ? childStatus.transitionCount : 0}
              maxTransitions={childWorkflow.maxTransitions || 50}
              status={(childStatus.status || active.child?.status || 'idle') as any}
              isRunning={childStatus.status === 'running' || childStatus.status === 'preparing'}
              allowForceTransition={false}
              focusedState={childStatus.currentPhase || null}
              startTime={childStatus.startTime || active.child?.startedAt || null}
              endTime={childStatus.endTime || active.child?.endedAt || null}
              accumulatedWaitMs={typeof childStatus.accumulatedWaitMs === 'number' ? childStatus.accumulatedWaitMs : 0}
              waitStartedAt={childStatus.waitStartedAt || null}
              supervisorFlow={Array.isArray(childStatus.supervisorFlow) ? childStatus.supervisorFlow : []}
              agentFlow={Array.isArray(childStatus.agentFlow) ? childStatus.agentFlow : []}
              tokenAnalytics={childStatus.tokenAnalytics}
              executionTrace={childStatus.executionTrace || null}
              subworkflowRuns={childSubworkflowRuns}
              subworkflowSummary={childStatus.subworkflowSummary || null}
              activeSubworkflowRunId={childStatus.activeSubworkflowRunId || null}
              onOpenSubworkflowRun={openSubworkflowRun}
              defaultActiveTab={subworkflowExecutionTabs[childTabKey] || 'trace'}
              onActiveTabChange={(tab) => setSubworkflowExecutionTabs((prev) => ({ ...prev, [childTabKey]: tab }))}
              onStateClick={setFocusedState}
              onStepClick={handleChildStepClick}
            />
          )}
        </div>
      </div>
    );
  }, [findSubworkflowRunForStep, getSubworkflowCacheKey, openSubworkflowConfigPreview, openSubworkflowRun, selectStep, subworkflowDrilldownStack, subworkflowExecutionTabs]);

  const selectStateDetails = (stateName: string) => {
    setFocusedState(stateName);
    setRightPanelTab('detail');
    const states = workflowConfig?.workflow?.states || [];
    const state = states.find((item: any) => item.name === stateName);
    const steps = state?.steps || [];
    if (!steps.length) return;

    const runningStep = steps.find((step: any) => {
      const candidates = [step.name, `${stateName}-${step.name}`];
      return [currentStep, ...activeSteps].filter(Boolean).some((active) =>
        candidates.some((candidate) =>
          active === candidate
          || active?.startsWith(`${candidate}-迭代`)
          || active?.endsWith(`-${candidate}`)
        )
      );
    });
    selectStep(runningStep || steps[0]);
  };

  const selectStepByLogName = (logStepName: string) => {
    const allSteps = (runtimeWorkflowConfig?.workflow?.states || []).flatMap((state: any) =>
      (state.steps || []).map((step: any) => ({ ...step, __stateName: state.name }))
    );

    const matchedStep = allSteps.find((step: any) =>
      step.name === logStepName ||
      logStepName.endsWith(`-${step.name}`) ||
      (step.__stateName && logStepName === `${step.__stateName}-${step.name}`)
    );

    if (matchedStep) {
      selectStep(matchedStep);
    }
  };

  const openStepRecordInStateDiagram = (record: any) => {
    const stepName = String(record?.rawStepName || record?.stepName || '').trim();
    if (!stepName) return;
    if (isRuntimeLightweightWorkflow) {
      setOverviewStepRecord(null);
      openRunDetailSection('overview');
      return;
    }
    if (record?.stateName) {
      setFocusedState(record.stateName);
    }
    selectStepByLogName(stepName);
    setWorkbenchNavSection('runs');
    setRunRecordDrilled(true);
    setRunDetailSection('state');
    handleRunWorkbenchTabChange('state');
    setOverviewStepRecord(null);
  };

  const openRunRecordDocument = (input: { stepName: string; filename?: string }) => {
    const documentSource = isRuntimeLightweightWorkflow ? 'tasklist' : 'runtime-output';
    setDocumentFocusRequest(documentSource === 'tasklist' ? null : {
      requestId: Date.now(),
      stepName: input.stepName,
      filename: input.filename,
    });
    setWorkbenchNavSection('runs');
    setRunRecordDrilled(true);
    setRunDetailSection('documents');
    handleRunWorkbenchTabChange('documents', { documentSource });
  };

  const openPersistedStepRecord = (log: {
    id: string;
    stepName: string;
    rawStepName?: string;
    status: 'running' | 'completed' | 'failed';
    output?: string;
    error?: string;
  }) => {
    const resultKey = log.id || log.rawStepName || log.stepName;
    const fileName = Object.entries(stepIdMap).find(([, id]) => id === resultKey)?.[0];
    openRunRecordDocument({ stepName: log.rawStepName || log.stepName, filename: fileName });
    setOverviewStepRecord(null);
  };

  // Chunk separator used in persisted stream files
  const CHUNK_SEP = WORKBENCH_STREAM_CHUNK_SEPARATOR;
  const CHUNK_BOUNDARY_REGEX = WORKBENCH_STREAM_CHUNK_BOUNDARY_REGEX;
  const CHUNK_BOUNDARY_SEARCH_REGEX = /\r?\n*\s*<!--\s*chunk-boundary\s*-->\s*\r?\n*/i;
  const CHUNK_WITH_TIME_REGEX = /^<!-- timestamp: (.+?) -->\n/;
  const splitStreamChunks = splitWorkbenchLiveStreamContent;
  const isLifecycleStatusChunk = useCallback((chunk: string): boolean => {
    const normalized = String(chunk || '').replace(/<!--.*?-->/gs, '').trim().toLowerCase();
    return normalized === 'running'
      || normalized === 'preparing'
      || normalized === 'pending'
      || normalized === 'waiting'
      || /^准备中[:：]/.test(normalized)
      || /^启动中[:：]/.test(normalized)
      || /^加载\s*agent\s*配置/.test(normalized);
  }, []);
  const normalizeLiveStreamChunks = useCallback((chunks: string[]): string[] =>
    chunks.filter((chunk) => String(chunk || '').trim().length > 0 && !isLifecycleStatusChunk(chunk)), [isLifecycleStatusChunk]);

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
    const withoutCompleteHumanHelp = text.replace(/<human-help>\s*[\s\S]*?\s*<\/human-help>/gi, '');
    const openHumanHelpIndex = withoutCompleteHumanHelp.toLowerCase().lastIndexOf('<human-help>');
    const visibleText = openHumanHelpIndex >= 0
      ? withoutCompleteHumanHelp.slice(0, openHumanHelpIndex)
      : withoutCompleteHumanHelp;
    return visibleText
      .replace(/<step-conclusion>\s*([\s\S]*?)\s*<\/step-conclusion>/gi, '$1')
      .replace(/<\/?step-conclusion\s*>?/gi, '')
      .trim();
  };

  const stripLegacyRuntimeToolStatusText = (text: string): string => {
    if (!text) return text;
    return text
      .split(/\r?\n/)
      .filter((line) => {
        const trimmed = line.trim();
        if (!trimmed) return true;
        if (trimmed.includes('<ace-process>') || trimmed.includes('</ace-process>')) return true;
        return !/^[^<\r\n]{1,12000}\s+\((?:pending|queued|running|in_progress|completed)\)(?::\s*[^<\r\n]{0,12000})?$/i.test(trimmed);
      })
      .join('\n');
  };

  const prepareChunkForDisplay = (text: string): string => {
    return sanitizeProtocolBlocksForDisplay(stripLegacyRuntimeToolStatusText(mergeSubtaskDetails(text)));
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
      const rawContent = chunk.substring(fbMatch[0].length);
      const closeIndex = rawContent.search(/\n?<!--\s*\/human-feedback\s*-->\s*/i);
      const boundaryIndex = rawContent.search(CHUNK_BOUNDARY_SEARCH_REGEX);
      const contentEnd = [closeIndex, boundaryIndex]
        .filter((index) => index >= 0)
        .sort((a, b) => a - b)[0];
      return {
        timestamp: fbMatch[1],
        content: contentEnd >= 0 ? rawContent.slice(0, contentEnd) : rawContent,
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

  const resolveLiveStreamSource = useCallback((rawStepName?: string | null) => {
    const fallbackStateName = (selectedStep as any)?.__stateName || currentPhase || null;
    const fallbackStepName = selectedStep?.name || null;
    const trimmed = String(rawStepName || '').trim();
    if (!trimmed) {
      return {
        stateName: fallbackStateName,
        stepName: fallbackStepName,
      };
    }

    const rawBase = trimmed.replace(/-迭代\d+$/, '');

    const preferredStates = new Set<string>();
    if ((selectedStep as any)?.__stateName) preferredStates.add((selectedStep as any).__stateName);
    if (currentPhase) preferredStates.add(currentPhase);
    const states = workflowConfig?.workflow?.states || [];
    const sortedStates = [
      ...states.filter((state: any) => preferredStates.has(state.name)),
      ...states.filter((state: any) => !preferredStates.has(state.name)),
    ];

    for (const state of sortedStates) {
      for (const step of state.steps || []) {
        const stepName = String(step?.name || '').trim();
        if (!stepName) continue;
        const stepBase = stepName.replace(/-迭代\d+$/, '');
        const fullName = `${state.name}-${stepName}`;
        const fullBaseName = `${state.name}-${stepBase}`;
        if (
          rawBase === stepName
          || rawBase === stepBase
          || rawBase === fullName
          || rawBase === fullBaseName
          || rawBase.endsWith(`-${stepName}`)
          || rawBase.endsWith(`-${stepBase}`)
        ) {
          return {
            stateName: state.name,
            stepName,
          };
        }
      }
    }

    return {
      stateName: fallbackStateName,
      stepName: fallbackStepName || rawBase || trimmed,
    };
  }, [currentPhase, selectedStep, workflowConfig]);

  const liveStreamTarget = useMemo(() => {
    const targetRunId = runId || selectedRun?.id || '';
    const parallelActiveSteps = Array.from(new Set(activeSteps.filter(Boolean)));
    const selectedParallelStep = parallelActiveSteps.length > 1
      ? parallelActiveSteps.find((stepName) => stepName === liveStreamStepSelection)
        || parallelActiveSteps.find((stepName) => workflowStepKeyMatchesName(stepName, selectedStep?.name))
        || parallelActiveSteps[0]
        || ''
      : '';
    const runtimeStep = selectedParallelStep || currentStep || (parallelActiveSteps.length === 1 ? parallelActiveSteps[0] : '');
    const manualStep = isRunning ? '' : (selectedStep?.name || '');
    const activeStep = runtimeStep || manualStep;

    return {
      runId: targetRunId,
      activeStep,
      parallelActiveSteps,
      stepKey: activeStep,
    };
  }, [activeSteps, currentStep, isRunning, liveStreamStepSelection, runId, selectedRun?.id, selectedStep?.name]);

  const liveStreamSources = useMemo(() => {
    type Source = {
      key: string;
      runId: string;
      stepKey: string;
      label: string;
      scope: string;
      stateName: string | null;
      stepName: string | null;
      status?: string;
    };
    const sources: Source[] = [];
    const seen = new Set<string>();
    const pushSource = (input: {
      runId?: string | null;
      stepKey?: string | null;
      scope: string;
      stateName?: string | null;
      stepName?: string | null;
      status?: string;
    }) => {
      const sourceRunId = String(input.runId || '').trim();
      const stepKey = String(input.stepKey || input.stepName || '').trim();
      if (!sourceRunId || !stepKey) return;
      const source = resolveLiveStreamSource(stepKey);
      const stateName = input.stateName ?? source.stateName ?? null;
      const stepName = input.stepName ?? source.stepName ?? stepKey;
      const key = `${sourceRunId}::${stepKey}`;
      if (seen.has(key)) return;
      seen.add(key);
      sources.push({
        key,
        runId: sourceRunId,
        stepKey,
        label: [input.scope, stateName ? formatStateName(stateName) : '', stepName].filter(Boolean).join(' / '),
        scope: input.scope,
        stateName,
        stepName,
        status: input.status,
      });
    };

    const parentRunId = runId || selectedRun?.id || '';
    const rootLiveStreamSteps = resolveWorkbenchLiveStreamStepKeys({
      activeSteps: liveStreamTarget.parallelActiveSteps.length ? liveStreamTarget.parallelActiveSteps : [liveStreamTarget.activeStep],
      currentStep,
      currentPhase,
      completedSteps,
      failedSteps,
      terminal: isTerminalWorkflowStatus(workflowStatus),
      fallbackStepName: isRuntimeLightweightWorkflow ? resolveSoleConfiguredWorkflowStepName(runtimeWorkflowConfig?.workflow) : '',
    });
    for (const stepKey of rootLiveStreamSteps) {
      pushSource({
        runId: parentRunId,
        stepKey,
        scope: '当前工作流',
        status: workflowStatus,
      });
    }

    const appendChildStatus = (child: any, status: any, depth: number) => {
      const childRunId = child?.runId || status?.runId;
      const scope = `${'子'.repeat(Math.max(1, depth))}工作流${child?.parentStepName ? ` · ${child.parentStepName}` : ''}`;
      const childLiveStreamSteps = resolveWorkbenchLiveStreamStepKeys({
        activeSteps: status?.activeSteps,
        currentStep: status?.currentStep,
        currentPhase: status?.currentPhase,
        currentState: status?.currentState,
        completedSteps: status?.completedSteps,
        failedSteps: status?.failedSteps,
        terminal: isTerminalWorkflowStatus(status?.status),
      });
      for (const stepKey of childLiveStreamSteps) {
        pushSource({
          runId: childRunId,
          stepKey: String(stepKey),
          scope,
          stateName: status?.currentPhase || status?.currentState || null,
          status: status?.status || child?.status,
        });
      }
      const nestedRuns = Array.isArray(status?.subworkflowRuns) ? status.subworkflowRuns : [];
      for (const nested of nestedRuns) {
        const nestedEntry = nested?.runId
          ? subworkflowDrilldownCacheRef.current.get(getSubworkflowCacheKey(nested.configFile, nested.runId))
          : null;
        appendChildStatus(nested, nestedEntry?.status || {}, depth + 1);
      }
    };

    for (const child of subworkflowRuns || []) {
      const cached = child?.runId
        ? subworkflowDrilldownCacheRef.current.get(getSubworkflowCacheKey(child.configFile, child.runId))
        : null;
      appendChildStatus(child, cached?.status || child, 1);
    }
    for (const entry of subworkflowDrilldownStack) {
      appendChildStatus(entry.child, entry.status || {}, 1);
    }

    return sources;
  }, [
    activeSteps,
    completedSteps,
    currentPhase,
    currentStep,
    failedSteps,
    getSubworkflowCacheKey,
    isRuntimeLightweightWorkflow,
    liveStreamTarget.activeStep,
    liveStreamTarget.parallelActiveSteps,
    resolveLiveStreamSource,
    runId,
    selectedRun?.id,
    subworkflowDrilldownStack,
    subworkflowRuns,
    runtimeWorkflowConfig?.workflow,
    workflowStatus,
  ]);

  const selectedLiveStreamSource = useMemo(() => {
    if (liveStreamSourceSelection) {
      const selected = liveStreamSources.find((source) => source.key === liveStreamSourceSelection);
      if (selected) return selected;
    }
    return liveStreamSources[0] || {
      key: liveStreamTarget.runId && liveStreamTarget.stepKey ? `${liveStreamTarget.runId}::${liveStreamTarget.stepKey}` : '',
      runId: liveStreamTarget.runId,
      stepKey: liveStreamTarget.stepKey,
      label: liveStreamTarget.stepKey || '实时输出',
      scope: '当前工作流',
      stateName: null,
      stepName: liveStreamTarget.stepKey || null,
    };
  }, [liveStreamSourceSelection, liveStreamSources, liveStreamTarget.runId, liveStreamTarget.stepKey]);
  const dbAgentMessageRows = useAgentMessageRows();
  const getCachedLiveStreamContent = useCallback((sourceRunId?: string | null, stepKey?: string | null) => {
    const normalizedRunId = String(sourceRunId || '').trim();
    const normalizedStepKey = String(stepKey || '').trim();
    if (!normalizedRunId || !normalizedStepKey) return '';
    const rows = dbAgentMessageRows
      .filter((row) => row.runId === normalizedRunId && row.stepKey === normalizedStepKey)
      .map((row) => ({ id: row.id, content: row.content, chunks: row.chunks }));
    return reconstructWorkbenchCachedLiveStreamContent(rows, normalizedRunId, normalizedStepKey);
  }, [dbAgentMessageRows]);
  const getCachedLiveStreamChunks = useCallback((sourceRunId?: string | null, stepKey?: string | null) =>
    normalizeLiveStreamChunks(splitStreamChunks(getCachedLiveStreamContent(sourceRunId, stepKey))), [
      getCachedLiveStreamContent,
      normalizeLiveStreamChunks,
    ]);

  const refreshLiveStreamContent = useCallback(async () => {
    const rid = selectedLiveStreamSource.runId || runId || selectedRun?.id || '';
    const activeStep = selectedLiveStreamSource.stepKey || liveStreamTarget.stepKey || '';
    if (!rid || !activeStep) {
      setLiveStream(getCachedLiveStreamChunks(rid, activeStep));
      setLiveToolEvents([]);
      return;
    }

    setLiveStreamSource({
      stateName: selectedLiveStreamSource.stateName,
      stepName: selectedLiveStreamSource.stepName || activeStep,
    });
    liveStreamRunRef.current = rid;
    liveStreamStepRef.current = activeStep;

    const cachedContent = getCachedLiveStreamContent(rid, activeStep);
    const cachedChunks = getCachedLiveStreamChunks(rid, activeStep);
    let content = '';
    let toolEvents: RuntimeToolEvent[] = [];
    try {
      const stream = await streamApi.getStream(rid, activeStep);
      content = stream.content;
      toolEvents = stream.toolEvents;
    } catch {
      content = '';
    }
    if (!content) {
      try {
        const { processes } = await processApi.list();
        const workflowProcesses = processes.filter((p: any) => !(p.agent === 'chat' && p.step === 'chat'));
        const matched = workflowProcesses.find((p: any) => p.runId === rid && p.step === activeStep)
          || workflowProcesses.find((p: any) => p.runId === rid);
        content = matched?.streamContent || '';
        toolEvents = Array.isArray(matched?.toolEvents) ? matched.toolEvents : toolEvents;
      } catch {
        content = '';
      }
    }

    const chunks = normalizeLiveStreamChunks(content
      ? (() => {
          const parts = content.split(CHUNK_BOUNDARY_REGEX);
          const trailing = parts.pop() || '';
          return [...parts.filter(Boolean), ...(trailing ? [trailing] : [])];
        })()
      : cachedChunks);
    liveStreamRawRef.current = content || cachedContent;
    liveStreamLenRef.current = liveStreamRawRef.current.length;
    setLiveStream(chunks);
    setLiveToolEvents(toolEvents);
    setLiveStreamVisibleCount(LIVE_STREAM_PAGE_SIZE);
  }, [
    getCachedLiveStreamChunks,
    getCachedLiveStreamContent,
    liveStreamTarget.stepKey,
    normalizeLiveStreamChunks,
    runId,
    selectedLiveStreamSource.runId,
    selectedLiveStreamSource.stateName,
    selectedLiveStreamSource.stepKey,
    selectedLiveStreamSource.stepName,
    selectedRun?.id,
  ]);

  useEffect(() => {
    let cancelled = false;
    const record = overviewStepRecord;
    const rid = runId || selectedRun?.id || '';
    const stepName = String(record?.rawStepName || record?.stepName || '').trim();
    setOverviewStepExternalOutput('');
    if (!record || !rid || !stepName) {
      setOverviewStepExternalOutputLoading(false);
      return;
    }
    setOverviewStepExternalOutputLoading(true);
    void streamApi.getStreamContent(rid, stepName)
      .then((content) => {
        if (cancelled) return;
        const chunks = normalizeLiveStreamChunks(content
          ? (() => {
              const parts = content.split(CHUNK_BOUNDARY_REGEX);
              const trailing = parts.pop() || '';
              return [...parts.filter(Boolean), ...(trailing ? [trailing] : [])];
            })()
          : []);
        setOverviewStepExternalOutput(chunks.join('\n\n'));
      })
      .catch(() => {
        if (!cancelled) setOverviewStepExternalOutput('');
      })
      .finally(() => {
        if (!cancelled) setOverviewStepExternalOutputLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [normalizeLiveStreamChunks, overviewStepRecord, runId, selectedRun?.id]);

  useEffect(() => {
    const parallelActiveSteps = normalizeActiveWorkflowSteps({
      activeSteps,
      currentStep,
      currentPhase,
      completedSteps,
      failedSteps,
      terminal: isTerminalWorkflowStatus(workflowStatus),
    });
    const selectedStepName = selectedStep?.name || '';
    const selectedStepChanged = lastLiveStreamSelectedStepNameRef.current !== selectedStepName;
    lastLiveStreamSelectedStepNameRef.current = selectedStepName;
    if (parallelActiveSteps.length <= 1) {
      if (liveStreamStepSelection) setLiveStreamStepSelection('');
      return;
    }
    const selectedMatch = parallelActiveSteps.find((stepName) => workflowStepKeyMatchesName(stepName, selectedStep?.name));
    if (selectedStepChanged && selectedMatch && selectedMatch !== liveStreamStepSelection) {
      setLiveStreamStepSelection(selectedMatch);
      return;
    }
    if (!parallelActiveSteps.includes(liveStreamStepSelection)) {
      setLiveStreamStepSelection(parallelActiveSteps[0] || '');
    }
  }, [activeSteps, completedSteps, currentPhase, currentStep, failedSteps, liveStreamStepSelection, selectedStep?.name, workflowStatus]);

  useEffect(() => {
    if (!liveStreamSources.length) {
      if (liveStreamSourceSelection) setLiveStreamSourceSelection('');
      return;
    }
    if (!liveStreamSources.some((source) => source.key === liveStreamSourceSelection)) {
      setLiveStreamSourceSelection(liveStreamSources[0].key);
    }
  }, [liveStreamSourceSelection, liveStreamSources]);

  const liveSectionRefreshKey = runDetailSection === 'live'
    ? `${selectedLiveStreamSource.runId || ''}::${selectedLiveStreamSource.stepKey || ''}`
    : '';
  const lastLiveSectionRefreshKeyRef = useRef('');
  useEffect(() => {
    if (runDetailSection !== 'live') return;
    if (!liveSectionRefreshKey) return;
    setShowLiveStream(true);
    if (lastLiveSectionRefreshKeyRef.current === liveSectionRefreshKey) return;
    lastLiveSectionRefreshKeyRef.current = liveSectionRefreshKey;
    void refreshLiveStreamContent();
  }, [liveSectionRefreshKey, refreshLiveStreamContent, runDetailSection]);

  useEffect(() => {
    const runningChildren = (subworkflowRuns || []).filter((child: any) =>
      child?.runId
      && child?.configFile
      && ['pending', 'starting', 'running', 'waiting-human', 'unknown'].includes(String(child.status || 'unknown'))
    );
    if (!runningChildren.length) return;
    let cancelled = false;
    const refresh = async () => {
      for (const child of runningChildren) {
        if (cancelled) return;
        try {
          const key = getSubworkflowCacheKey(child.configFile, child.runId);
          const existing = subworkflowDrilldownCacheRef.current.get(key);
          const parentRunId = String(child.parentRunId || activeRuntimeRunId || '').trim();
          const statusQuery = () => queryClient.fetchQuery({
            queryKey: queryKeys.workflowChildStatusCompact(configFile, parentRunId, child.configFile, child.runId),
            queryFn: () => fetchWorkflowStatusCompact(child.configFile, child.runId),
            staleTime: 1_000,
          });
          const [configResponse, status] = existing?.config
            ? [{ config: existing.config, agents: existing.agents || [] }, await statusQuery()]
            : await Promise.all([
                configApi.getConfig(child.configFile),
                statusQuery(),
              ]);
          if (cancelled) return;
          queryClient.setQueryData(queryKeys.workflowStatusCompact(child.configFile, child.runId), status);
          subworkflowDrilldownCacheRef.current.set(key, {
            child,
            configFile: child.configFile,
            runId: child.runId,
            config: configResponse.config,
            agents: configResponse.agents || [],
            status,
          });
        } catch {}
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeRuntimeRunId, configFile, getSubworkflowCacheKey, queryClient, subworkflowRuns]);

  // --- Live stream via SSE (opencode) or polling fallback (claude-code) ---
  const startLiveStream = () => {
    setShowLiveStream(true);
    if (liveStreamFeedbackRef.current) liveStreamFeedbackRef.current.value = '';
    setLiveFeedbackDraft('');
    liveFeedbackEditorRef.current?.clear();
    setLiveStreamVisibleCount(LIVE_STREAM_PAGE_SIZE);
    liveStreamUserScrolledUp.current = false;
    setLiveStreamScrollLocked(false);
    setInlineFeedbacks(pendingLiveFeedbackRef.current);

    // Close previous connection
    if (liveStreamRef.current) {
      if (liveStreamRef.current instanceof EventSource) liveStreamRef.current.close();
      else clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }

    const rid = selectedLiveStreamSource.runId;
    const activeStep = selectedLiveStreamSource.stepKey;
    const cachedChunks = getCachedLiveStreamChunks(rid, activeStep);
    // `chunks` are presentation segments. Keep the persisted transcript as
    // raw text so a cache restore cannot manufacture Markdown paragraphs.
    const cachedRaw = getCachedLiveStreamContent(rid, activeStep);
    liveStreamLenRef.current = cachedRaw.length;
    liveStreamRawRef.current = cachedRaw;
    setLiveStream(normalizeLiveStreamChunks(cachedChunks));
    setLiveToolEvents([]);
    liveStreamRunRef.current = rid;
    liveStreamStepRef.current = activeStep;
    setLiveStreamSource({
      stateName: selectedLiveStreamSource.stateName,
      stepName: selectedLiveStreamSource.stepName || activeStep,
    });

    // Try SSE live stream if we have runId + step
    if (rid && activeStep) {
      void streamApi.getStream(rid, activeStep)
        .then((stream) => setLiveToolEvents(stream.toolEvents))
        .catch(() => {});
      let sseBuffer = '';
      let sseRaw = cachedRaw;
      const liveMessageId = `workflow:${rid}:${activeStep}:live`;
      let aiPrevious: Pick<AceStreamChunk, 'id' | 'content' | 'toolCalls'> | undefined = cachedRaw
        ? { id: liveMessageId, content: cachedRaw, toolCalls: [] }
        : undefined;
      const applyRawStream = (nextRaw: string) => {
        sseRaw = nextRaw;
        liveStreamRawRef.current = sseRaw;
        liveStreamLenRef.current = sseRaw.length;

        const parts = sseRaw.split(CHUNK_BOUNDARY_REGEX);
        sseBuffer = parts.pop() || '';
        const rebuilt = normalizeLiveStreamChunks([...parts.filter(Boolean), ...(sseBuffer ? [sseBuffer] : [])]);
        setLiveStream(rebuilt);
      };
      const es = streamApi.connectLiveStream(
        rid,
        activeStep,
        (content) => {
          const nextRaw = applyWorkbenchLiveStreamTransportFrame(sseRaw, { kind: 'delta', content });

          if (nextRaw === sseRaw) return;

          if (content) {
            const row = storeWorkflowSseEventAsAgentMessage({
              type: 'workflow-step-delta',
              data: {
                messageId: liveMessageId,
                runId: rid,
                stepKey: activeStep,
                content,
                timestamp: new Date().toISOString(),
              },
            }, aiPrevious);
            aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          }

          applyRawStream(nextRaw);
        },
        (_status) => {
          if (aiPrevious) {
            const now = new Date().toISOString();
            storeAceAgentMessage({
              id: liveMessageId,
              runId: rid,
              stepKey: activeStep,
              role: 'assistant',
              status: 'done',
              content: aiPrevious.content,
              chunks: [],
              toolCalls: aiPrevious.toolCalls,
              createdAt: now,
              updatedAt: now,
            });
          }
          // Stream done — don't auto-close panel, user may still be reading
        },
        (tool) => {
          setLiveToolEvents((current) => mergeRuntimeToolEvents(current, tool));
        },
        (content) => {
          const snapshot = applyWorkbenchLiveStreamTransportFrame(sseRaw, { kind: 'snapshot', content });
          const now = new Date().toISOString();
          const row = storeAceAgentMessage({
            id: liveMessageId,
            runId: rid,
            stepKey: activeStep,
            role: 'assistant',
            status: 'streaming',
            content: snapshot,
            chunks: snapshot ? [snapshot] : [],
            toolCalls: aiPrevious?.toolCalls || [],
            toolEvents: [],
            createdAt: now,
            updatedAt: now,
          });
          aiPrevious = { id: row.id, content: row.content, toolCalls: row.toolCalls };
          applyRawStream(snapshot);
        },
      );
      liveStreamRef.current = es;
      return;
    }

    // Fallback: polling for claude-code or when runId/step not yet available
    liveStreamRef.current = setInterval(async () => {
      try {
        const { processes } = await processApi.list();
        const curRid = selectedLiveStreamSource.runId || runId || selectedRun?.id;

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
        const curStep = selectedLiveStreamSource.stepKey || runningProc?.step || (!isRunning ? selectedStep?.name : '');

        if (curStep !== liveStreamStepRef.current) {
          liveStreamRunRef.current = curRid || '';
          liveStreamStepRef.current = curStep;
          setLiveStreamSource({
            stateName: selectedLiveStreamSource.stateName,
            stepName: selectedLiveStreamSource.stepName || curStep,
          });
          const nextCachedChunks = getCachedLiveStreamChunks(curRid, curStep);
          const nextCachedRaw = getCachedLiveStreamContent(curRid, curStep);
          liveStreamLenRef.current = nextCachedRaw.length;
          liveStreamRawRef.current = nextCachedRaw;
          setLiveStream(normalizeLiveStreamChunks(nextCachedChunks));
          setLiveToolEvents([]);
          setInlineFeedbacks(pendingLiveFeedbackRef.current);
        }

        let content: string | null = null;
        if (curRid && curStep) {
          const stream = await streamApi.getStream(curRid, curStep);
          content = stream.content;
          setLiveToolEvents(stream.toolEvents);
        }
        if (!content) {
          const running = workflowProcesses.find((p: any) => p.status === 'running' && p.runId === curRid && (!curStep || p.step === curStep))
            || workflowProcesses.find((p: any) => p.status === 'running' && p.runId === curRid);
          if (Array.isArray(running?.toolEvents)) setLiveToolEvents(running.toolEvents);
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
            const parts = content.split(CHUNK_BOUNDARY_REGEX);
            const trailing = parts.pop() || '';
            const rebuilt = normalizeLiveStreamChunks([...parts.filter(Boolean), ...(trailing ? [trailing] : [])]);
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
              const segs = merged.split(CHUNK_BOUNDARY_REGEX);
              const newTail = segs.pop() || '';
              const completed = segs.filter(Boolean);
              next.push(...completed);
              if (newTail) next.push(newTail);
              return normalizeLiveStreamChunks(next);
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
    liveStreamRunRef.current = '';
    liveStreamStepRef.current = '';
    liveStreamRawRef.current = '';
    setShowLiveStream(false);
    setLiveStreamFullscreen(false);
    setLiveStreamScrollLocked(false);
  };

  useEffect(() => {
    if (runDetailSection === 'live') return;
    if (!showLiveStream && !liveStreamRef.current) return;
    stopLiveStream();
  }, [runDetailSection, showLiveStream]);

  // Auto-reconnect live stream when the active run or step changes while the panel is open.
  useEffect(() => {
    if (!showLiveStream) return;
    if (!selectedLiveStreamSource.runId && !selectedLiveStreamSource.stepKey) return;
    if (
      liveStreamRef.current
      && liveStreamRunRef.current === selectedLiveStreamSource.runId
      && liveStreamStepRef.current === selectedLiveStreamSource.stepKey
    ) {
      return;
    }
    startLiveStream();
  }, [showLiveStream, selectedLiveStreamSource.runId, selectedLiveStreamSource.stepKey]);

  const sendLiveFeedback = async (interrupt?: boolean, existingFeedback?: InlineFeedback) => {
    const feedback = existingFeedback?.message || liveFeedbackEditorRef.current?.getMarkdown() || liveFeedbackDraft || liveStreamFeedbackRef.current?.value || '';
    if (!feedback.trim() || sendingFeedback) return;
    setSendingFeedback(true);
    const feedbackId = existingFeedback?.id || `live-feedback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const timestamp = existingFeedback?.timestamp || new Date().toISOString();
    try {
      upsertInlineFeedback({
        id: feedbackId,
        message: feedback.trim(),
        timestamp,
        streamIndex: existingFeedback?.streamIndex ?? liveStream.length,
        mode: interrupt ? 'interrupt' : 'feedback',
        status: interrupt ? 'interrupting' : 'sending',
      });
      
      const res = await workflowApi.injectFeedback(
        feedback.trim(),
        interrupt,
        configFile,
        feedbackId,
        selectedLiveStreamSource.runId || undefined,
      );
      upsertInlineFeedback({
        id: feedbackId,
        message: feedback.trim(),
        timestamp,
        streamIndex: existingFeedback?.streamIndex ?? liveStream.length,
        mode: interrupt ? 'interrupt' : 'feedback',
        status: res.interrupted ? 'interrupting' : 'queued',
      });
      if (!existingFeedback) {
        if (liveStreamFeedbackRef.current) liveStreamFeedbackRef.current.value = '';
        setLiveFeedbackDraft('');
        liveFeedbackEditorRef.current?.clear();
      }
      if (interrupt) {
        if (res.interrupted) {
          toast('success', '已打断当前执行，反馈将立即处理');
        } else {
          toast('warning', '打断信号已发送，反馈已排队等待处理');
        }
      }
    } catch (error: any) {
      toast('error', `发送反馈失败: ${error.message}`);
      upsertInlineFeedback({
        id: feedbackId,
        message: feedback.trim(),
        timestamp,
        streamIndex: existingFeedback?.streamIndex ?? liveStream.length,
        mode: interrupt ? 'interrupt' : 'feedback',
        status: 'failed',
        error: error.message,
      });
    }
    setSendingFeedback(false);
  };

  const recallFeedback = async (message: string) => {
    try {
      await workflowApi.recallFeedback(message, configFile, selectedLiveStreamSource.runId || undefined);
    } catch (error: any) {
      toast('error', `撤回失败: ${error.message}`);
    }
  };

  const renderLiveStreamItems = () => {
    const renderLiveThinkingIndicator = () => {
      const lastChunk = liveStream[liveStream.length - 1] || '';
      const isExecuting = liveToolEvents.some((tool) => tool.status === 'running')
        || (/\*\*🔧 .+?\*\*[^]*$/.test(lastChunk) && !/<\/details>\s*$/.test(lastChunk.trim()));
      const statusText = isExecuting ? '执行中' : '思考中';
      return (
        <div className={cn(styles.thinkingBot, 'mx-4 mb-3 mt-1')} aria-live="polite">
          <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
          <Shimmer as="span" className={styles.thinkingText}>{statusText}</Shimmer>
          <span className={styles.thinkingDots}><span>.</span><span>.</span><span>.</span></span>
        </div>
      );
    };

    if (liveStream.length === 0 && inlineFeedbacks.length === 0 && liveToolEvents.length === 0) {
      if (isRunning) return <div className="py-3">{renderLiveThinkingIndicator()}</div>;
      return <div className="py-8 text-center text-sm text-muted-foreground">(等待输出...)</div>;
    }

    type ChunkItem = { type: 'chunk'; content: string; index: number | string; page?: number; pageCount?: number };
    type ToolItem = { type: 'tool'; tool: RuntimeToolEvent; index: string };
    type ToolGroupItem = { type: 'tool-group'; tools: RuntimeToolEvent[]; index: string };
    type LoadMoreItem = { type: 'load-more'; remaining: number };
    type Item = ChunkItem | ToolItem | ToolGroupItem | ({ type: 'feedback' } & InlineFeedback) | { type: 'thinking' } | LoadMoreItem;
    const items: Item[] = [];
    let fbIdx = 0;
    for (let i = 0; i < liveStream.length; i++) {
      while (fbIdx < inlineFeedbacks.length && inlineFeedbacks[fbIdx].streamIndex <= i) {
        items.push({ type: 'feedback', ...inlineFeedbacks[fbIdx] });
        fbIdx++;
      }
      items.push({ type: 'chunk', content: liveStream[i], index: i });
    }
    while (fbIdx < inlineFeedbacks.length) {
      items.push({ type: 'feedback', ...inlineFeedbacks[fbIdx] });
      fbIdx++;
    }

    const TODO_MARKER = '<!-- todo-list-marker -->';
    let lastTodoIdx = -1;
    for (let j = items.length - 1; j >= 0; j--) {
      if (items[j].type === 'chunk' && (items[j] as any).content.includes(TODO_MARKER)) {
        if (lastTodoIdx === -1) lastTodoIdx = j;
        else (items[j] as any).content = '';
      }
    }

    const rawFilteredItems = items.filter((it) => {
      if (it.type === 'feedback') return true;
      const c = (it as any).content as string;
      if (!c) return false;
      const parsedIt = parseChunk(c);
      if (parsedIt.isHumanFeedback) {
        const embeddedContent = parsedIt.content.trim();
        const embeddedMessages = [
          embeddedContent,
          ...embeddedContent.split('\n\n').map(f => f.trim()),
        ].filter(Boolean);
        return !embeddedMessages.some((message) =>
          inlineFeedbacks.some((feedback) => feedback.message.trim() === message)
        );
      }
      const stripped = c.replace(/\*\*🔧 .+?\*\*/g, '').replace(/<!--.*?-->/gs, '').trim();
      return stripped.length > 1;
    });

    const mergedItems: Item[] = [];
    let pendingChunkItems: ChunkItem[] = [];
    const flushPendingChunkItems = () => {
      if (!pendingChunkItems.length) return;
      mergedItems.push(
        ...mergeAceSubtaskChunkItems(
          mergeAceProcessChunkItems(
            pendingChunkItems.map((item) => ({ ...item, index: Number(item.index) })),
            CHUNK_SEP
          ),
          CHUNK_SEP
        )
      );
      pendingChunkItems = [];
    };
    for (const rawItem of rawFilteredItems) {
      if (rawItem.type === 'chunk') pendingChunkItems.push(rawItem);
      else {
        flushPendingChunkItems();
        mergedItems.push(rawItem);
      }
    }
    flushPendingChunkItems();

    const filteredItems: Item[] = [];
    for (const item of mergedItems) {
      if (item.type !== 'chunk') {
        filteredItems.push(item);
        continue;
      }
      const pages = splitMarkdownIntoVirtualPages(item.content);
      if (pages.length <= 1) {
        filteredItems.push(item);
        continue;
      }
      pages.forEach((page, pageIndex) => {
        filteredItems.push({
          type: 'chunk',
          content: page,
          index: `${item.index}:page:${pageIndex}`,
          page: pageIndex + 1,
          pageCount: pages.length,
        });
      });
    }
    let mergedTools: RuntimeToolEvent[] = [];
    for (const tool of liveToolEvents) mergedTools = mergeRuntimeToolEvents(mergedTools, tool);

    const getTimelineTimestamp = (item: Item): number | null => {
      const rawTimestamp = item.type === 'tool'
        ? item.tool.createdAt || item.tool.updatedAt
        : item.type === 'feedback'
          ? item.timestamp
          : item.type === 'chunk'
            ? parseChunk(item.content).timestamp
            : null;
      const timestamp = Date.parse(String(rawTimestamp || ''));
      return Number.isNaN(timestamp) ? null : timestamp;
    };

    // Tool payloads are structured, but they remain ordinary chronological
    // entries in the live transcript. The final lifecycle update only changes
    // the card state; createdAt keeps the card at the original call position.
    const timelineItems: Item[] = [...filteredItems];
    for (const [toolIndex, tool] of mergedTools.entries()) {
      const toolItem: ToolItem = { type: 'tool', tool, index: `${tool.id}:${toolIndex}` };
      const toolTimestamp = getTimelineTimestamp(toolItem);
      const insertionIndex = toolTimestamp === null
        ? -1
        : timelineItems.findIndex((item) => {
            const itemTimestamp = getTimelineTimestamp(item);
            if (itemTimestamp === null) return false;
            // Preserve call order for tools emitted in the same millisecond,
            // while putting each tool before the next text or feedback event.
            return item.type === 'tool'
              ? itemTimestamp > toolTimestamp
              : itemTimestamp >= toolTimestamp;
          });
      timelineItems.splice(insertionIndex < 0 ? timelineItems.length : insertionIndex, 0, toolItem);
    }

    const groupedTimelineItems: Item[] = [];
    for (let index = 0; index < timelineItems.length; index += 1) {
      const item = timelineItems[index];
      if (item.type !== 'tool') {
        groupedTimelineItems.push(item);
        continue;
      }

      const tools = [item.tool];
      let cursor = index + 1;
      while (cursor < timelineItems.length && timelineItems[cursor].type === 'tool') {
        tools.push((timelineItems[cursor] as ToolItem).tool);
        cursor += 1;
      }
      if (tools.length > 1) {
        groupedTimelineItems.push({
          type: 'tool-group',
          tools,
          index: getStableLiveToolGroupIdentity(item.index),
        });
      } else {
        groupedTimelineItems.push(item);
      }
      index = cursor - 1;
    }

    timelineItems.splice(0, timelineItems.length, ...groupedTimelineItems);
    if (isRunning) timelineItems.push({ type: 'thinking' });

    const hasMore = timelineItems.length > liveStreamVisibleCount;
    const visibleItems = hasMore ? timelineItems.slice(timelineItems.length - liveStreamVisibleCount) : timelineItems;
    const displayItems: Item[] = hasMore
      ? [{ type: 'load-more', remaining: timelineItems.length - liveStreamVisibleCount }, ...visibleItems]
      : visibleItems;

    const renderLiveStreamItem = (item: Item, i: number) => {
      if (item.type === 'load-more') {
        return (
          <div className="flex justify-center px-4 pb-3 pt-2">
            <button
              className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
              onClick={() => setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE)}
            >
              加载更早的 {item.remaining} 条内容
            </button>
          </div>
        );
      }
      if (item.type === 'thinking') return renderLiveThinkingIndicator();
      if (item.type === 'tool') {
        const timestamp = formatLiveOutputTimestamp(item.tool.createdAt || item.tool.updatedAt);
        return (
          <div className="border-b border-border/50 px-4 pb-3 last:border-0">
            {timestamp ? (
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-muted-foreground" aria-label="工具调用时间">
                <span className="h-px min-w-4 flex-1 bg-border/70" />
                <span className="shrink-0">{timestamp}</span>
                <span className="h-px min-w-4 flex-1 bg-border/70" />
              </div>
            ) : null}
            <RuntimeToolEventCard tool={item.tool} isStreaming={isRunning} />
          </div>
        );
      }
      if (item.type === 'tool-group') {
        const timestamp = formatLiveOutputTimestamp(item.tools[0]?.createdAt || item.tools[0]?.updatedAt);
        return (
          <div className="border-b border-border/50 px-4 pb-3 last:border-0">
            {timestamp ? (
              <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-muted-foreground" aria-label="工具调用时间">
                <span className="h-px min-w-4 flex-1 bg-border/70" />
                <span className="shrink-0">{timestamp}</span>
                <span className="h-px min-w-4 flex-1 bg-border/70" />
              </div>
            ) : null}
            <RuntimeToolEventGroup events={item.tools} isStreaming={isRunning} />
          </div>
        );
      }
      if (item.type === 'feedback') {
        const statusMeta: Record<LiveFeedbackStatus, { label: string; className: string }> = {
          sending: { label: '发送中', className: 'bg-muted text-muted-foreground' },
          queued: { label: '已排队', className: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200' },
          interrupting: { label: item.mode === 'interrupt' ? '打断处理中' : '正在接入', className: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200' },
          delivered: { label: 'AI 已接入', className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' },
          failed: { label: '发送失败', className: 'bg-destructive/10 text-destructive' },
        };
        const meta = statusMeta[item.status] || statusMeta.queued;
        return (
          <div className="group flex justify-end px-4 pb-3">
            <div className={cn(
              'relative max-w-[86%] rounded-2xl border px-3 py-2 shadow-sm',
              item.mode === 'interrupt'
                ? 'border-destructive/30 bg-destructive/10'
                : 'border-primary/30 bg-primary/15'
            )}>
              <div className="mb-1 flex flex-wrap items-center justify-end gap-1.5 text-right text-[10px] text-muted-foreground">
                <span className={cn('rounded-full px-2 py-0.5 font-medium', meta.className)}>{meta.label}</span>
                <span className="font-mono">{new Date(item.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                {isRunning && item.status === 'queued' && item.mode !== 'interrupt' && (
                  <button
                    onClick={() => sendLiveFeedback(true, item)}
                    className="rounded-full px-1.5 py-0.5 text-primary opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                    title="转为打断并立即处理"
                  >
                    转打断
                  </button>
                )}
                {isRunning && (
                  <button
                    onClick={() => recallFeedback(item.id || item.message)}
                    className="rounded text-destructive opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    title="撤回"
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: '12px' }}>undo</span>
                  </button>
                )}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{item.message}</div>
              {item.error && <div className="mt-1 text-xs text-destructive">{item.error}</div>}
            </div>
          </div>
        );
      }
      const parsed = parseChunk(item.content);
      const liveOutputTimestamp = formatLiveOutputTimestamp(parsed.timestamp);
      if (parsed.isHumanFeedback) {
        return (
          <div className="flex justify-end px-4 pb-3">
            <div className="max-w-[86%] rounded-2xl border border-primary/30 bg-primary/15 px-3 py-2 shadow-sm">
              <div className="mb-1 flex flex-wrap items-center justify-end gap-1.5 text-right text-[10px] text-muted-foreground">
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">AI 已接入</span>
                {parsed.timestamp && (
                  <span className="font-mono">
                    {new Date(parsed.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>
              <div className="text-sm">
                <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} />
              </div>
            </div>
          </div>
        );
      }
      return (
        <div className="border-b border-border/50 px-4 pb-3 last:border-0">
          {(parsed.timestamp || item.pageCount) ? (
            <div className="mb-2 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
              {liveOutputTimestamp ? (
                <div className="flex min-w-0 flex-1 items-center gap-2" aria-label="新发言时间">
                  <span className="h-px min-w-4 flex-1 bg-border/70" />
                  <span className="shrink-0">
                    {liveOutputTimestamp}
                  </span>
                  <span className="h-px min-w-4 flex-1 bg-border/70" />
                </div>
              ) : null}
              {item.pageCount ? (
                <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 font-sans">
                  分页 {item.page}/{item.pageCount}
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="text-sm">
            <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} />
          </div>
        </div>
      );
    };

    return (
      <div className="flex h-full min-h-0 flex-col">
        <VirtualList
          items={displayItems}
          estimateSize={180}
          height="100%"
          className="min-h-0 flex-1"
          testId="workbench-live-stream-virtual-list"
          maxRenderedItems={40}
          scrollRef={liveStreamScrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
            liveStreamUserScrolledUp.current = !atBottom;
            setLiveStreamScrollLocked(!atBottom);
            if (el.scrollTop === 0 && timelineItems.length > liveStreamVisibleCount) {
              setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE);
            }
          }}
          getKey={(item, index) => item.type === 'feedback'
            ? `feedback:${item.id || item.timestamp}:${item.streamIndex}:${index}`
            : item.type === 'load-more'
              ? `load-more:${item.remaining}`
                : item.type === 'thinking'
                  ? `thinking:${index}`
                  : item.type === 'tool-group'
                    ? item.index
                  : item.type === 'tool'
                    ? `tool:${item.tool.id}:${item.tool.status}`
                    : `chunk:${item.index}`}
          renderItem={renderLiveStreamItem}
        />
      </div>
    );
  };

  const renderLiveStreamPanel = () => (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-start justify-between gap-3 px-3 pb-2 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="max-w-full text-[10px] font-normal">
              <span className="mr-1 text-muted-foreground">状态</span>
              <span className="truncate">{liveStreamSource.stateName ? formatStateName(liveStreamSource.stateName) : '未定位'}</span>
            </Badge>
            <Badge variant="outline" className="max-w-full text-[10px] font-normal">
              <span className="mr-1 text-muted-foreground">步骤</span>
              <span className="truncate">{liveStreamSource.stepName || '未定位'}</span>
            </Badge>
          </div>
          {liveStreamSources.length > 0 ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-[11px] text-muted-foreground">实时源</span>
              <Select
                value={selectedLiveStreamSource?.key || liveStreamSourceSelection || liveStreamSources[0]?.key || ''}
                onValueChange={(value) => {
                  setLiveStreamSourceSelection(value);
                  const source = liveStreamSources.find((item) => item.key === value);
                  if (!source) return;
                  if (source.runId === (runId || selectedRun?.id || '')) {
                    setLiveStreamStepSelection(source.stepKey);
                  }
                }}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                  <SelectValue placeholder="选择实时输出源" />
                </SelectTrigger>
                <SelectContent>
                  {liveStreamSources.map((source) => (
                    <SelectItem key={source.key} value={source.key} className="text-xs">
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 px-0"
          onClick={() => void refreshLiveStreamContent()}
          title="刷新实时输出"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
        </Button>
        <Button
          variant={liveStreamScrollLocked ? 'secondary' : 'ghost'}
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs"
          onClick={() => {
            if (liveStreamScrollLocked) unlockLiveStreamScroll();
            else {
              liveStreamUserScrolledUp.current = true;
              setLiveStreamScrollLocked(true);
            }
          }}
          title={liveStreamScrollLocked ? '解除滚动锁并跳到底部' : '锁定当前滚动位置'}
        >
          <span className="material-symbols-outlined text-base">{liveStreamScrollLocked ? 'lock' : 'lock_open'}</span>
          <span>{liveStreamScrollLocked ? '已锁定' : '跟随'}</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 pb-4">
        {renderLiveStreamItems()}
      </div>
      <div className="p-3 pt-0">
        <div className="home-chat-composer relative overflow-hidden rounded-[24px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
          <RichTextEditor
            ref={liveFeedbackEditorRef}
            content={liveFeedbackDraft}
            onChange={(markdown: string) => setLiveFeedbackDraft(markdown)}
            onEnter={() => { void sendLiveFeedback(); }}
            placeholder="输入实时反馈"
            minHeight={96}
            maxHeight={180}
            disabled={sendingFeedback || !isRunning}
            autoFocus={false}
            showFullscreenToggle={false}
            showToolbar={false}
            trimPastedTrailingNewlines
            footerInside
            surfaceClassName="rounded-[24px] border-0 bg-transparent shadow-none"
            contentAreaClassName="min-h-[58px] items-start px-4 pb-2 pt-3"
            footerClassName="gap-3 border-border/60 px-4 pb-3 pt-2"
            footerContent={<span className="text-[10px] text-muted-foreground">实时反馈</span>}
            footerAfterCountContent={(
              <div className="ml-2 flex items-center gap-2">
                <Button
                  className="h-9 w-9 rounded-2xl px-0"
                  size="sm"
                  onClick={() => sendLiveFeedback()}
                  disabled={sendingFeedback || !liveFeedbackDraft.trim() || !isRunning}
                  title="发送反馈"
                >
                  <span className="material-symbols-outlined text-sm">send</span>
                </Button>
                <Button
                  className="h-9 w-9 rounded-2xl px-0"
                  size="sm"
                  variant="destructive"
                  onClick={() => sendLiveFeedback(true)}
                  disabled={sendingFeedback || !liveFeedbackDraft.trim() || !isRunning}
                  title="打断当前执行，立即处理反馈"
                >
                  <span className="material-symbols-outlined text-sm">bolt</span>
                </Button>
              </div>
            )}
          />
        </div>
      </div>
    </div>
  );

  const renderContextInspectorPanel = () => (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">运行上下文</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            当前 run 的全局上下文和阶段上下文，编辑仍使用原上下文工作台。
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-xs"
          onClick={() => openContextEditor('global')}
          disabled={!hasContextEditableRun}
        >
          <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>edit_note</span>
          编辑
        </Button>
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="text-xs font-medium text-muted-foreground">全局上下文</div>
          <div className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap break-words text-sm leading-6">
            {globalContext?.trim() || <span className="text-muted-foreground">暂无全局上下文。</span>}
          </div>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-xs font-medium text-muted-foreground">阶段上下文</div>
            <Badge variant="outline" className="text-[10px]">{Object.values(phaseContexts).filter(Boolean).length}</Badge>
          </div>
          <div className="space-y-2">
            {startContextTargets.length > 0 ? startContextTargets.map((name: string) => (
              <button
                key={name}
                type="button"
                className="w-full rounded-lg border bg-background px-3 py-2 text-left transition-colors hover:bg-muted/30"
                onClick={() => openContextEditor('phase', name)}
                disabled={!hasContextEditableRun}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs font-medium">{name}</span>
                  {phaseContexts[name] ? <StatusPill tone="accent" className="py-0.5 text-[10px]">已配置</StatusPill> : null}
                </div>
                <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                  {phaseContexts[name] || '暂无阶段上下文。'}
                </div>
              </button>
            )) : (
              <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">当前工作流没有可展示的阶段上下文。</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const renderHumanQuestionsInspectorPanel = () => {
    const questionRows = dbUnansweredHumanQuestionRows as any[];
    const visibleQuestions = pendingHumanQuestion ? [pendingHumanQuestion, ...questionRows.filter((row) => row.id !== pendingHumanQuestion.id)] : questionRows;
    return (
      <div className="flex h-full min-h-0 flex-col overflow-auto bg-background p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold">人工问题</div>
            <div className="mt-1 text-xs leading-5 text-muted-foreground">
              待回答问题保留在执行视图和 Supervisor 协作面板中处理。
            </div>
          </div>
          {pendingHumanQuestion ? <StatusPill tone="warning">待回答</StatusPill> : <StatusPill tone="neutral">无待办</StatusPill>}
        </div>
        {visibleQuestions.length > 0 ? (
          <div className="space-y-3">
            {visibleQuestions.map((question: any, index) => (
              <div key={question.id || `${question.question || question.prompt}-${index}`} className="rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate text-xs font-medium text-muted-foreground">
                    {question.source?.type || question.currentState || question.stateName || '人工确认'}
                  </div>
                  <Badge variant="outline" className="text-[10px]">{question.status || 'unanswered'}</Badge>
                </div>
                <div className="mt-2 text-sm leading-6">
                  {question.question || question.prompt || question.message || '等待人工输入。'}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 h-8 text-xs"
                  onClick={() => {
                    setMainExecutionActiveTab('supervisor');
                    setExecutionViewTabOverride('supervisor');
                    openRunDetailSection('overview');
                  }}
                >
                  <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>forum</span>
                  到 Agent 对话处理
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-[220px] items-center justify-center rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            当前没有待回答问题。
          </div>
        )}
      </div>
    );
  };

  const renderDiffInspectorPanel = () => (
    <div className="flex h-full min-h-0 flex-col overflow-auto bg-background p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">Git 变更</div>
          <div className="mt-1 text-xs leading-5 text-muted-foreground">
            摘要放在 inspector，完整 diff 保留在中央“变更”工作区。
          </div>
        </div>
        <StatusPill tone={workspaceChangeCount > 0 ? 'warning' : 'neutral'}>
          {workspaceChangeCount} 文件
        </StatusPill>
      </div>
      <div className="space-y-3">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="text-xs text-muted-foreground">工作区</div>
          <div className="mt-1 break-all text-sm leading-6">{currentRunWorkspacePath || projectRoot || '暂无运行工作区。'}</div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 justify-start text-xs"
          onClick={() => handleRunWorkbenchTabChange('changes')}
          disabled={!currentRunWorkspacePath}
        >
          <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>difference</span>
          打开中央变更工作区
        </Button>
        {!effectiveGitBaselineEnabled ? (
          <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
            当前工作流已关闭 Git 基线与变更追踪。
          </div>
        ) : null}
      </div>
    </div>
  );

  const openContextEditor = useCallback((_scope: 'global' | 'phase' = 'global', _phase?: string) => {
    const rid = runId || initialRunId || selectedRun?.id;
    if (!rid) {
      toast('warning', '当前没有可编辑上下文的运行记录');
      return;
    }
    const nextPhaseDrafts = Object.fromEntries(
      startContextTargets.map((name: string) => [name, phaseContexts[name] || ''])
    ) as Record<string, string>;
    setContextEditorGlobalDraft(globalContext || '');
    setContextEditorPhaseDrafts(nextPhaseDrafts);
    setShowContextEditor(true);
  }, [globalContext, initialRunId, phaseContexts, runId, selectedRun?.id, startContextTargets, toast]);

  const saveContext = async (contexts: WorkflowStartContexts) => {
    try {
      setSavingContextEditor(true);
      const rid = runId || initialRunId || selectedRun?.id;

      setContextEditorGlobalDraft(contexts.globalContext);
      setContextEditorPhaseDrafts(contexts.phaseContexts);
      if (contexts.workingDirectory?.trim()) {
        dispatch({ type: 'SET_WORKING_DIRECTORY', payload: contexts.workingDirectory.trim() });
      }

      await workflowApi.setContext('global', contexts.globalContext, undefined, rid || undefined, configFile);
      dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: contexts.globalContext });

      for (const name of startContextTargets) {
        const nextValue = contexts.phaseContexts[name] || '';
        await workflowApi.setContext('phase', nextValue, name, rid || undefined, configFile);
        dispatch({ type: 'SET_PHASE_CONTEXT', payload: { phase: name, context: nextValue } });
      }

      setShowContextEditor(false);
      toast('success', '上下文已保存');
    } catch (error: any) {
      toast('error', `保存失败: ${error.message}`);
    } finally {
      setSavingContextEditor(false);
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
      await applyAcceptedWorkbenchRecovery(
        () => workflowApi.rerunFromStep(rid, stepName),
        () => {
          setViewingHistoryRun(false);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'running' });
          dispatch({ type: 'SET_STEP_RESULTS', payload: {} });
          dispatch({ type: 'SET_STEP_ID_MAP', payload: {} });
          dispatch({ type: 'SET_RUN_ID', payload: rid });
          addLog('system', 'info', `正在从步骤 "${stepName}" 重新运行...`);
        },
      );
      dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
      fetchCurrentStatus();
    } catch (error: any) {
      addLog('system', 'error', `重新运行失败: ${error.message}`);
    }
  };

  const handlePreviewSpecMerge = useCallback(async (force = false) => {
    const rid = runId || initialRunId || selectedRun?.id;
    if (!rid) {
      toast('error', '缺少 runId，无法生成 Spec 合入预览');
      return;
    }
    if (!force && specMergePreview && deltaMergeState?.status === 'awaiting-confirmation') {
      setSpecMergeDialogOpen(true);
      return;
    }

    setSpecMergeDialogOpen(true);
    setSpecMergeLoading(true);
    setSpecMergeError(null);
    try {
      const preview = await workflowApi.previewSpecMerge({ runId: rid, configFile });
      setSpecMergePreview(preview);
      setDeltaMergeState(preview.mergeState);
      setDeltaSpecMerged(false);
    } catch (error: any) {
      const message = error?.message || '生成 Spec 合入预览失败';
      setSpecMergeError(message);
      toast('error', message);
      await fetchCurrentStatus();
    } finally {
      setSpecMergeLoading(false);
    }
  }, [configFile, deltaMergeState?.status, initialRunId, runId, selectedRun?.id, specMergePreview, toast]);

  const handleOpenSpecMergeDialog = useCallback(() => {
    setSpecMergeError(null);
    if (deltaMergeState?.status === 'awaiting-confirmation') {
      setSpecMergeDialogOpen(true);
      if (!specMergePreview) void handlePreviewSpecMerge(false);
      return;
    }
    void handlePreviewSpecMerge(true);
  }, [deltaMergeState?.status, handlePreviewSpecMerge, specMergePreview]);

  const handleApplySpecMerge = useCallback(async () => {
    const rid = runId || initialRunId || selectedRun?.id;
    const mergedHash = specMergePreview?.mergeState?.mergedHash || deltaMergeState?.mergedHash;
    if (!rid || !mergedHash) {
      setSpecMergeError('缺少合并候选校验信息，请重新生成预览');
      return;
    }

    setSpecMergeApplying(true);
    setSpecMergeError(null);
    try {
      const result = await workflowApi.applySpecMerge({ runId: rid, configFile, mergedHash });
      setDeltaMergeState(result.mergeState);
      setDeltaSpecMerged(true);
      setSpecMergePreview((prev) => prev ? { ...prev, mergeState: result.mergeState } : prev);
      toast('success', '已合入 Master Spec');
      await fetchCurrentStatus();
      setSpecMergeDialogOpen(false);
    } catch (error: any) {
      const message = error?.message || '确认合入 Spec 失败';
      setSpecMergeError(message);
      toast('error', message);
      await fetchCurrentStatus();
    } finally {
      setSpecMergeApplying(false);
    }
  }, [configFile, deltaMergeState?.mergedHash, initialRunId, runId, selectedRun?.id, specMergePreview?.mergeState?.mergedHash, toast]);

  const handleImportWorkspaceDeltaSpec = useCallback(async () => {
    const rid = runId || initialRunId || selectedRun?.id;
    if (!rid) {
      toast('error', '缺少 runId，无法导入 workspace delta spec');
      return;
    }

    setSpecImporting(true);
    try {
      const result = await workflowApi.importWorkspaceDeltaSpec({
        runId: rid,
        configFile,
        summary: '用户从 workspace delta spec 导入修订',
      });
      if (result.specCodingSummary) setSpecCodingSummary(result.specCodingSummary);
      if (result.specCodingDetails) setSpecCodingDetails(result.specCodingDetails);
      setDeltaMergeState(result.deltaMergeState);
      setDeltaSpecMerged(Boolean(result.deltaSpecMerged));
      setSpecMergePreview(null);
      toast('success', '已导入 workspace delta spec');
      await fetchCurrentStatus();
    } catch (error: any) {
      const message = error?.message || '导入 workspace delta spec 失败';
      toast('error', message);
      await fetchCurrentStatus();
    } finally {
      setSpecImporting(false);
    }
  }, [configFile, fetchCurrentStatus, initialRunId, runId, selectedRun?.id, toast]);

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
    if (liveStreamScrollLocked) return;
    const scrollToBottom = () => {
      const el = liveStreamScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    scrollToBottom();
    const firstFrame = window.requestAnimationFrame(() => {
      scrollToBottom();
      window.requestAnimationFrame(scrollToBottom);
    });
    return () => window.cancelAnimationFrame(firstFrame);
  }, [liveStream, liveStreamScrollLocked]);

  const unlockLiveStreamScroll = useCallback(() => {
    liveStreamUserScrolledUp.current = false;
    setLiveStreamScrollLocked(false);
    const scrollToBottom = () => {
      const el = liveStreamScrollRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    };
    scrollToBottom();
    window.requestAnimationFrame(() => window.requestAnimationFrame(scrollToBottom));
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

    // 4. Fallback: direct key match in stepResults (preRuntime, no UUID)
    if (stepResults[baseName]) return baseName;

    // 5. If currently running this step, return baseName for stream display
    if (currentStep && (currentStep === baseName || currentStep.endsWith('-' + baseName))) {
      return currentStep;
    }

    return baseName;
  };

  const stripSpecBindingsFromWorkflowConfig = useCallback((config: any) => {
    const next = JSON.parse(JSON.stringify(config));
    const nodes = Array.isArray(next?.workflow?.states) ? next.workflow.states : [];
    for (const node of nodes) {
      for (const step of Array.isArray(node?.steps) ? node.steps : []) {
        if (step && typeof step === 'object') {
          delete step.specTaskBinding;
        }
      }
    }
    next.context = {
      ...(next.context || {}),
      specCodingEnabled: false,
      skipSpecCoding: true,
    };
    return next;
  }, []);

  const handleSaveConfig = useCallback(async (): Promise<boolean> => {
    const draftConfig = latestEditingConfigRef.current || editingConfig;
    if (!draftConfig) return false;
    setSaving(true);
    try {
      const rawConfig = buildWorkflowDesignConfigForSave(draftConfig, currentWorkflowDesignDraftState);
      const config = specCodingDisabled ? stripSpecBindingsFromWorkflowConfig(rawConfig) : rawConfig;
      const specCodingDocument = !specCodingDisabled && specCodingSummary && specCodingDetails ? {
        id: specCodingSummary.id,
        version: specCodingSummary.version,
        status: specCodingSummary.status,
        summary: specCodingSummary.summary,
        workflowName: workflowConfig?.workflow?.name || configFile,
        phases: specCodingDetails.phases || [],
        assignments: specCodingDetails.assignments || [],
        checkpoints: specCodingDetails.checkpoints || [],
        tasks: specCodingDetails.tasks || [],
        progress: specCodingSummary.progress,
        revisions: specCodingDetails.revisions || [],
        artifacts: specCodingDetails.artifacts || {},
        linkedConfigFilename: configFile,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } : undefined;
      await configApi.saveConfig(configFile, config, {
        creationSessionId: creationSessionSummary?.id,
        specCoding: specCodingDocument,
      });
      toast('success', '配置已保存，后续运行将使用新策略');
      syncSavedWorkflowConfig(config);
      return true;
    } catch (error: any) {
      toast('error', '保存失败: ' + error.message);
      return false;
    } finally {
      setSaving(false);
    }
  }, [
    configFile,
    creationSessionSummary?.id,
    currentWorkflowDesignDraftState,
    dispatch,
    editingConfig,
    specCodingDisabled,
    specCodingDetails,
    specCodingSummary,
    stripSpecBindingsFromWorkflowConfig,
    syncSavedWorkflowConfig,
    toast,
    workflowConfig?.workflow?.name,
  ]);

  const saveWorkflowName = useCallback(async (newName: string) => {
    const draftConfig = latestEditingConfigRef.current || editingConfig || workflowConfig;
    const nextConfig = buildWorkflowConfigWithName(draftConfig, newName);
    if (!nextConfig) {
      setNameValue(draftConfig?.workflow?.name || workflowConfig?.workflow?.name || '');
      setEditingName(false);
      return;
    }
    if (nextConfig.workflow.name === draftConfig?.workflow?.name) {
      setEditingName(false);
      return;
    }
    if (nameSaveInFlightRef.current) return;

    nameSaveInFlightRef.current = true;
    try {
      latestEditingConfigRef.current = nextConfig;
      dispatch({ type: 'SET_EDITING_CONFIG', payload: nextConfig });

      if (await handleSaveConfig()) {
        setEditingName(false);
      }
    } finally {
      nameSaveInFlightRef.current = false;
    }
  }, [dispatch, editingConfig, handleSaveConfig, workflowConfig]);

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

  const renderRunStructuredTaskListPanel = () => {
    const tasks = flattenRuntimeSpecTasksWithDepth(effectiveSpecCodingTasks);
    return (
      <div className="h-full min-h-0 overflow-auto bg-muted/20 p-4" data-testid="runtime-structured-tasklist">
        <div className="mx-auto max-w-6xl space-y-4">
          <div className="rounded-2xl border bg-background p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary" style={{ fontSize: 19 }}>checklist</span>
                  <h2 className="text-xl font-semibold">任务清单</h2>
                </div>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">来自本次运行快照的结构化任务及 Agent 回写状态。</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{specCodingTaskProgress.completed}/{specCodingTaskProgress.total}</Badge>
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => {
                  setSpecCodingArtifactTab('tasks');
                  setSpecCodingModalOpen(true);
                }}>
                  查看 tasks.md
                </Button>
              </div>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              {[
                { label: '已完成', value: specCodingTaskProgress.completed, tone: 'text-emerald-600' },
                { label: '进行中', value: specCodingTaskProgress.inProgress, tone: 'text-primary' },
                { label: '阻塞', value: specCodingTaskProgress.blocked, tone: 'text-red-600' },
                { label: '未开始', value: specCodingTaskProgress.pending, tone: 'text-muted-foreground' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">{item.label}</div>
                  <div className={cn('mt-1 text-lg font-semibold', item.tone)}>{item.value}</div>
                </div>
              ))}
            </div>
            <Progress value={specCodingTaskProgress.percentage} className="mt-4 h-2" />
          </div>

          {tasks.length ? (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div key={task.id} className={cn(
                  'rounded-xl border bg-background p-4',
                  task.status === 'completed' ? 'border-emerald-500/30' : task.status === 'in-progress' ? 'border-primary/35' : task.status === 'blocked' ? 'border-red-500/35' : '',
                )}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0" style={{ marginLeft: `${Math.min((task.depth || 0) * 20, 80)}px` }}>
                      <div className="flex flex-wrap items-center gap-2">
                        {task.depth ? <span className="material-symbols-outlined text-sm text-muted-foreground">subdirectory_arrow_right</span> : null}
                        <span className="text-xs font-mono text-muted-foreground">{task.id}</span>
                        <span className="text-sm font-semibold">{task.title}</span>
                      </div>
                      {task.detail ? <div className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{task.detail}</div> : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                        {(task.ownerAgents || []).length ? <span>Agent：{(task.ownerAgents || []).join('、')}</span> : null}
                        {task.validation ? <span>验证：{task.validation}</span> : null}
                        {task.updatedAt ? <span>更新：{new Date(task.updatedAt).toLocaleString()}</span> : null}
                      </div>
                    </div>
                    <Badge variant={task.status === 'blocked' ? 'destructive' : task.status === 'completed' ? 'secondary' : 'outline'} className="shrink-0">
                      {formatSpecCodingTaskStatus(task.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed bg-background p-8 text-center">
              <div className="text-sm font-medium">暂无结构化任务</div>
              <div className="mt-1 text-xs text-muted-foreground">本次运行尚未生成 tasks.md 或任务状态投影。</div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderRuntimeInsightPanels = () => {
    const hasSpecCodingTasks = !specCodingDisabled && Boolean(specCodingSummary && specCodingDetails?.tasks?.length);
    const hasQualityChecks = displayQualityChecks.length > 0;
    if (!hasSpecCodingTasks && !hasQualityChecks) return null;

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
                  {specCodingTaskProgress.completed}/{specCodingTaskProgress.total}
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

            <div className="grid gap-2 sm:grid-cols-4">
              {[
                { label: '已完成', value: specCodingTaskProgress.completed, tone: 'text-emerald-600' },
                { label: '进行中', value: specCodingTaskProgress.inProgress, tone: 'text-primary' },
                { label: '阻塞', value: specCodingTaskProgress.blocked, tone: 'text-red-600' },
                { label: '未开始', value: specCodingTaskProgress.pending, tone: 'text-muted-foreground' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border bg-muted/20 p-3">
                  <div className="text-[10px] text-muted-foreground">{item.label}</div>
                  <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
                </div>
              ))}
            </div>

            <div className="space-y-2">
              {overviewTasks.map((task) => (
                <div
                  key={task.id}
                  className={`rounded-xl border p-3 transition-colors ${
                    task.status === 'completed'
                      ? 'border-emerald-500/30 bg-emerald-500/8'
                      : task.status === 'in-progress'
                        ? 'border-primary/30 bg-accent shadow-none'
                        : task.status === 'blocked'
                          ? 'border-red-500/30 bg-red-500/8'
                          : 'bg-muted/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0" style={{ marginLeft: `${Math.min((task.depth || 0) * 18, 72)}px` }}>
                      <div className="flex items-center gap-2">
                        {task.depth ? (
                          <span className="material-symbols-outlined text-sm text-muted-foreground">subdirectory_arrow_right</span>
                        ) : null}
                        {task.status === 'in-progress' ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-accent px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse"></span>
                            进行中
                          </span>
                        ) : null}
                        {task.depth ? (
                          <span className="rounded-full border px-1.5 py-0.5 text-[10px] text-muted-foreground">子任务</span>
                        ) : null}
                        <div className={`text-sm font-medium leading-6 ${
                          task.status === 'completed'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : task.status === 'in-progress'
                              ? 'text-primary'
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
                            ? 'border border-primary/25 bg-accent text-primary'
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

        <div className="grid gap-3">
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

        </div>
      </div>
    );
  };

  const renderCreationDraftInboxCard = () => {
    return (
      <div className="rounded-2xl border bg-background/75 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>inventory_2</span>
              <h3 className="text-base font-semibold">创建草稿箱</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              保存补充问答、Spec 规划和 workflow 草案的中间状态，可从这里继续恢复。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => void loadCreationDrafts()}>
              刷新
            </Button>
          </div>
        </div>
        {creationDraftsLoading ? (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            正在读取创建草稿...
          </div>
        ) : workbenchCreationDrafts.length ? (
          <div className="space-y-2">
            {workbenchCreationDrafts.map((session) => (
              <div key={session.id} className="rounded-xl border bg-muted/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="truncate text-sm font-medium text-foreground">{session.workflowName || '未命名工作流'}</div>
                      {session.isRelated ? <Badge variant="secondary" className="text-[10px]">当前工作区</Badge> : null}
                      <Badge variant="outline" className="text-[10px]">{session.status}</Badge>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">{session.filename || '未命名配置'}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      {session.planningEngine ? <span>引擎: {getEngineMeta(session.planningEngine)?.name || session.planningEngine}</span> : null}
                      {session.planningModel ? <span>模型: {session.planningModel}</span> : null}
                      {session.updatedAt ? <span>{new Date(session.updatedAt).toLocaleString()}</span> : null}
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => {
                      setResumeCreationDraftId(session.id);
                      setCreationDraftModalOpen(true);
                    }}
                  >
                    继续创建
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            暂无可恢复的创建草稿。
          </div>
        )}
      </div>
    );
  };

  const renderPersistedSpecCard = () => {
    if (persistMode !== 'repository') {
      return null;
    }

    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-foreground">
              <span>持久化 Spec</span>
              <Badge variant="outline" className="text-[10px]">
                {getSpecMergeStatusLabel(deltaMergeState?.status)}
              </Badge>
              {deltaSpecMerged ? <Badge variant="secondary" className="text-[10px]">已合入</Badge> : null}
            </div>
            {masterSpecPath ? (
              <div className="truncate font-mono text-[11px] text-muted-foreground" title={masterSpecPath}>
                Master: {masterSpecPath}
              </div>
            ) : null}
            {deltaMergeState?.error ? (
              <div className="text-[11px] leading-5 text-destructive">{deltaMergeState.error}</div>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => void handleImportWorkspaceDeltaSpec()}
              disabled={specImporting}
            >
              {specImporting ? <ClipLoader color="currentColor" size={12} className="mr-2" /> : null}
              导入 Delta 修改
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-8 text-xs"
              onClick={handleOpenSpecMergeDialog}
              disabled={!canMergeSpec || specMergeLoading || specMergeApplying}
            >
              {specMergeLoading ? <ClipLoader color="currentColor" size={12} className="mr-2" /> : null}
              合入 Master Spec
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const renderSpecCodingPanel = (options?: { className?: string; summaryOnly?: boolean }) => {
    if (!specDesignEnabled) return null;

    return (
      <div className={options?.className || 'space-y-4'}>
        <div className="rounded-2xl border bg-background/75 p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
                <h3 className="text-base font-semibold">spec 规格</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                查看创建期确认的 requirements、design、tasks；运行后这里会展示当前 run 的快照与进度投影。
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
                onClick={() => {
                  setSpecArtifactViewMode('preview');
                  setSpecCodingModalOpen(true);
                }}
                title="弹出 spec 规格文件管理器"
              >
                <span className="material-symbols-outlined text-sm">open_in_new</span>
              </Button>
            </div>
          </div>

          {specCodingSummary ? (
            <div className="space-y-3">
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-4">
                  {[
                    { label: '已完成', value: specCodingTaskProgress.completed, tone: 'text-emerald-600' },
                    { label: '进行中', value: specCodingTaskProgress.inProgress, tone: 'text-primary' },
                    { label: '阻塞', value: specCodingTaskProgress.blocked, tone: 'text-red-600' },
                    { label: '未开始', value: specCodingTaskProgress.pending, tone: 'text-muted-foreground' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border bg-muted/20 p-3">
                      <div className="text-[10px] text-muted-foreground">{item.label}</div>
                      <div className={`mt-1 text-lg font-semibold ${item.tone}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="rounded-xl border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                    <span>Spec Task 状态跟踪</span>
                    <span>{specCodingTaskProgress.completed}/{specCodingTaskProgress.total || specCodingSummary.taskCount || 0}</span>
                  </div>
                  <Progress value={specCodingTaskProgress.percentage} className="mt-2 h-2" />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
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
              </div>
              {specCodingSummary.summary ? (
                <div className="rounded-xl border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
                  {specCodingSummary.summary}
                </div>
              ) : null}
              {specCodingTaskProgress.blocked > 0 ? (
                <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-3 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-red-600">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>block</span>
                    {specCodingTaskProgress.blocked} 个 tasks.md 任务阻塞
                  </div>
                  <div className="space-y-1.5">
                    {specCodingTaskProgress.blockedTasks.slice(0, 3).map((task) => (
                      <div key={`blocked-${task.id}`} className="text-[11px] leading-5 text-muted-foreground">
                        <span className="font-medium text-foreground">{task.title}</span>
                        {task.validation ? <span> · {task.validation}</span> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {specCodingSummary?.progress?.summary ? (
                <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
                  当前进度：{specCodingSummary.progress.summary}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              当前工作流没有绑定创建期 spec 规格制品。通过首页 AI 创建工作流并确认 spec 规格后，这里会显示完整内容。
            </div>
          )}
        </div>

        {!options?.summaryOnly && specCodingSummary && (
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

        {!options?.summaryOnly && specCodingTaskProgress.recentlyUpdatedTasks.length ? (
          <div className="rounded-2xl border bg-background/75 p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Spec Task 状态事件</div>
                <div className="text-xs text-muted-foreground">最近由 Agent 或系统回写的任务状态、验证信息和更新时间。</div>
              </div>
              <Badge variant="outline" className="text-[10px]">{specCodingTaskProgress.recentlyUpdatedTasks.length} 条</Badge>
            </div>
            <div className="space-y-2">
              {specCodingTaskProgress.recentlyUpdatedTasks.map((task) => (
                <div key={`task-event-${task.id}`} className="rounded-xl border bg-muted/10 p-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 font-medium text-foreground">{task.title}</div>
                    <Badge variant="outline" className="shrink-0 text-[10px]">{formatSpecCodingTaskStatus(task.status)}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                    {task.updatedBy ? <span>来源：{task.updatedBy}</span> : null}
                    {task.updatedAt ? <span>{new Date(task.updatedAt).toLocaleString()}</span> : null}
                    {task.phaseId ? <span>phase：{task.phaseId}</span> : null}
                  </div>
                  {task.validation ? <div className="mt-1 leading-5">验证：{task.validation}</div> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {!options?.summaryOnly && specCodingDetails?.revisions?.length ? (
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

  const renderSpecCodingExplorer = () => {
    if (!specDesignEnabled || !activeSpecCodingArtifact) {
      return (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Spec 模式将在当前运行提供 Spec 数据后开放。
        </div>
      );
    }

    return (
    <>
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
              <div className="truncate text-sm font-semibold">spec 规格文件管理器</div>
              {specRevisionCandidate ? (
                <Badge variant="secondary" className="shrink-0 text-[10px]">
                  {specRevisionCandidate.source === 'rollback' ? '回退候选' : 'AI 候选'}
                </Badge>
              ) : null}
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
              onClick={() => openSpecArtifactEditor(activeSpecCodingArtifact.key)}
              disabled={!creationSessionSummary?.id}
              title="修订当前 spec 规格"
            >
              <span className="material-symbols-outlined text-sm">edit_note</span>
            </Button>
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
          <div className="grid grid-cols-2 gap-1 border-b border-border p-2">
            <Button
              variant={specCodingExplorerTab === 'artifacts' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSpecCodingExplorerTab('artifacts')}
            >
              制品
            </Button>
            <Button
              variant={specCodingExplorerTab === 'revisions' ? 'secondary' : 'ghost'}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSpecCodingExplorerTab('revisions')}
            >
              修订
            </Button>
          </div>
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
                  onClick={() => {
                      setSpecCodingArtifactTab(entry.key);
                      setSpecTaskFormatErrors([]);
                      if (specArtifactViewMode !== 'preview') {
                        setSpecRevisionTarget(entry.key);
                        if (!specRevisionCandidate) {
                          setSpecRevisionDraft(entry.content || '');
                        }
                      }
                    }}
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
          {specCodingExplorerTab === 'artifacts' ? (
          <>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{activeSpecCodingArtifact.title}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{activeSpecCodingArtifact.label}</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <ButtonGroup>
                {([
                  { value: 'preview', label: '预览', disabled: false },
                  { value: 'edit', label: '编辑', disabled: !creationSessionSummary?.id },
                  { value: 'diff', label: '差异', disabled: false },
                ] as const).map((mode) => (
                  <Button
                    key={mode.value}
                    type="button"
                    size="sm"
                    variant={specArtifactViewMode === mode.value ? 'secondary' : 'outline'}
                    className="h-8 text-xs"
                    disabled={mode.disabled}
                    onClick={() => {
                      setSpecTaskFormatErrors([]);
                      if (mode.value !== 'preview' && specRevisionTarget !== activeSpecCodingArtifact.key) {
                        setSpecRevisionTarget(activeSpecCodingArtifact.key);
                        if (!specRevisionCandidate) {
                          setSpecRevisionDraft(activeSpecCodingArtifact.content || '');
                        }
                      }
                      setSpecArtifactViewMode(mode.value);
                    }}
                  >
                    {mode.label}
                  </Button>
                ))}
              </ButtonGroup>
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
            <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
              <div className="flex min-h-[360px] min-w-0 flex-col rounded-xl border bg-muted/10">
                <div className="shrink-0 border-b px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: 16 }}>auto_fix_high</span>
                        对话修订候选
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        首轮生成完整 requirements/design/tasks；后续可继续要求 AI 调整当前候选。
                      </div>
                    </div>
                    {specAiRevising ? (
                      <Badge variant="secondary" className="text-[10px]">生成中</Badge>
                    ) : specAiSessionId ? (
                      <Badge variant="outline" className="text-[10px]">多轮</Badge>
                    ) : null}
                  </div>
                </div>

                <div className="home-chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  <div className="space-y-4">
                    {specAiMessages.length ? (
                      specAiMessages.map((message) => (
                        <div
                          key={message.id}
                          className={cn('group flex min-w-0', message.role === 'user' ? 'justify-end' : 'items-start gap-2')}
                        >
                          {message.role === 'assistant' ? <RobotLogo size={28} className="mt-1 shrink-0" /> : null}
                          <div className={cn('min-w-0 space-y-1', message.role === 'user' ? 'max-w-[86%]' : 'max-w-[92%]')}>
                            <div
                              className={cn(
                                'min-w-0 rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                                message.role === 'user'
                                  ? 'home-chat-bubble home-chat-bubble-user rounded-tr-sm text-primary-foreground'
                                  : 'home-chat-bubble home-chat-bubble-assistant rounded-tl-sm',
                                message.status === 'failed' ? 'border border-red-500/30 bg-red-500/8 text-red-700 dark:text-red-300' : ''
                              )}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] opacity-70">
                                <span>{message.role === 'user' ? '你' : 'AI'}</span>
                                {message.status === 'streaming' ? <span>生成中</span> : null}
                                {message.status === 'failed' ? <span>失败</span> : null}
                              </div>
                              {message.content.trim() ? (
                                <div className={`${styles.markdownContent} min-w-0 break-words text-sm [overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap`}>
                                  <AceAwareMarkdown content={message.content} isStreaming={message.status === 'streaming'} />
                                </div>
                              ) : (
                                <div className="text-xs text-muted-foreground">等待 AI 输出...</div>
                              )}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="flex h-full min-h-[190px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                        <RobotLogo size={48} className="mb-3" />
                        <div className="font-medium text-foreground">描述你想怎么修订 Spec</div>
                        <div className="mt-1 max-w-sm text-xs leading-5">
                          AI 会生成完整三份制品候选；右侧会立刻展示 diff 和质量校验结果。
                        </div>
                      </div>
                    )}
                    {specAiRevising ? (
                      <div className={styles.thinkingBot} aria-live="polite">
                        <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
                        <Shimmer as="span" className={styles.thinkingText}>AI 正在修订 Spec</Shimmer>
                        <span className={styles.thinkingDots}><span>.</span><span>.</span><span>.</span></span>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0 border-t bg-background px-4 py-3">
                  <div className="home-chat-composer relative overflow-hidden rounded-[22px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                    <Textarea
                      value={specAiInstruction}
                      onChange={(event) => setSpecAiInstruction(event.target.value)}
                      placeholder={specAiSessionId ? '继续说明要怎么调整当前 Spec 候选...' : '例如：把验收标准补充到 tasks.md，并同步调整 design.md 中的状态说明'}
                      rows={3}
                      className="min-h-[92px] resize-none border-0 bg-transparent px-4 py-3 text-sm leading-6 shadow-none focus-visible:ring-0"
                      disabled={specAiRevising || savingSpecRevision || !creationSessionSummary?.id}
                    />
                    <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 text-xs"
                        onClick={() => {
                          setSpecAiInstruction('');
                          setSpecAiStream('');
                          setSpecAiMessages([]);
                          setSpecAiSessionId(null);
                          setSpecRevisionCandidate(null);
                          setSpecTaskFormatErrors([]);
                          setSpecTaskValidationIssues([]);
                          setSpecTaskValidationDetails([]);
                          setActiveSpecTaskIssueKey(null);
                        }}
                        disabled={specAiRevising}
                      >
                        重置
                      </Button>
                      <Button
                        type="button"
                        className="h-8 text-xs"
                        onClick={() => void handleGenerateAiSpecRevision()}
                        disabled={specAiRevising || savingSpecRevision || !creationSessionSummary?.id || !specAiInstruction.trim()}
                      >
                        {specAiRevising ? <ClipLoader color="currentColor" size={12} className="mr-2" /> : null}
                        {specAiSessionId ? '发送调整' : '生成优化建议'}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="min-w-0 rounded-xl border bg-background">
                <div className="border-b px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium">基线 / 当前候选</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {specRevisionCandidate
                          ? `${new Date(specRevisionCandidate.createdAt).toLocaleString()} · 先看差异和校验，再应用`
                          : '等待 AI 生成 Spec 候选版本'}
                      </div>
                    </div>
                    {specRevisionCandidate ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={handleDiscardSpecRevisionCandidate}
                          disabled={savingSpecRevision}
                        >
                          放弃候选
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => void handleApplySpecRevisionCandidate()}
                          disabled={savingSpecRevision || specRevisionQualityErrors.length > 0}
                        >
                          {savingSpecRevision ? '应用中...' : '应用候选'}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-3 p-4">
                  {specRevisionCandidate ? (
                    <>
                      <div className="rounded-lg border border-primary/25 bg-primary/5 p-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          <Badge variant="secondary" className="text-[10px]">
                            {specRevisionCandidate.source === 'rollback' ? `回退到 v${specRevisionCandidate.targetVersion}` : 'AI 候选'}
                          </Badge>
                          <span className="min-w-0 break-words [overflow-wrap:anywhere]">{specRevisionCandidate.summary}</span>
                        </div>
                      </div>

                      <div className="grid min-w-0 grid-cols-3 gap-2">
                        <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">质量错误</div>
                          <div className="mt-1 text-lg font-semibold text-red-600">{specRevisionQualityErrors.length}</div>
                        </div>
                        <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">质量警告</div>
                          <div className="mt-1 text-lg font-semibold text-amber-600">{specRevisionQualityWarnings.length}</div>
                        </div>
                        <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">tasks 格式</div>
                          <div className={cn('mt-1 text-lg font-semibold', specRevisionTaskValidation?.ok === false ? 'text-red-600' : 'text-emerald-600')}>
                            {specRevisionTaskValidation?.ok === false ? '失败' : '通过'}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-3">
                        {specCodingArtifactEntries.map((entry) => (
                          <button
                            key={`candidate-tab-${entry.key}`}
                            type="button"
                            className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                              specRevisionTarget === entry.key
                                ? 'border-primary bg-background text-foreground'
                                : 'border-border/60 bg-background/50 text-muted-foreground hover:bg-background'
                            }`}
                            onClick={() => {
                              setSpecCodingArtifactTab(entry.key);
                              setSpecRevisionTarget(entry.key);
                              setSpecArtifactViewMode('diff');
                            }}
                          >
                            <div className="font-medium">{entry.label}</div>
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              {specRevisionCandidate.artifacts[entry.key] === entry.content ? '无变化' : '有变化'}
                            </div>
                          </button>
                        ))}
                      </div>

                      {specRevisionQualityErrors.length > 0 ? (
                        <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3">
                          <div className="text-sm font-medium text-red-600">Spec 校验错误</div>
                          <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                            {specRevisionQualityErrors.map((issue, index) => (
                              <div key={`spec-quality-error-${index}`}>
                                {issue.artifact ? `${issue.artifact}：` : ''}{issue.message || '未知错误'}
                                {issue.suggestion ? ` 建议：${issue.suggestion}` : ''}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {specRevisionQualityWarnings.length > 0 ? (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
                          <div className="text-sm font-medium text-amber-700 dark:text-amber-300">Spec 校验警告</div>
                          <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                            {specRevisionQualityWarnings.map((issue, index) => (
                              <div key={`spec-quality-warning-${index}`}>
                                {issue.artifact ? `${issue.artifact}：` : ''}{issue.message || '未知提示'}
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="flex min-h-[260px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                      <span className="material-symbols-outlined mb-2 text-primary" style={{ fontSize: 32 }}>difference</span>
                      <div className="font-medium text-foreground">暂无候选</div>
                      <div className="mt-1 max-w-sm text-xs leading-5">左侧生成后，这里会显示候选摘要、校验结果和三份制品切换。</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            {specArtifactViewMode === 'preview' ? (
              activeSpecCodingArtifact.content.trim() ? (
              <div className={`${styles.markdownContent} max-w-none`}>
                <Markdown>{activeSpecCodingArtifact.content}</Markdown>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
                这份 spec 规格制品还没有内容。
              </div>
              )
            ) : specArtifactViewMode === 'edit' ? (
              <div className="flex h-full min-h-0 flex-col gap-3">
                {specRevisionCandidate ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-3 text-xs leading-5 text-muted-foreground">
                    当前有未应用的 {specRevisionCandidate.source === 'rollback' ? '回退' : 'AI'} 候选；编辑器仍显示手动草稿，候选内容请在“差异”里查看并应用。
                  </div>
                ) : null}
                {specRevisionTarget === 'tasks' && (specTaskFormatErrors.length > 0 || specTaskValidationIssues.length > 0 || specTaskValidationDetails.length > 0) ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-3">
                    <div className="flex items-center gap-2 text-xs font-medium text-red-600">
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>
                      {specTaskValidationIssues.length > 0 || specTaskFormatErrors.length > 0 ? 'tasks.md 格式校验未通过' : '保存失败，请检查任务文档结构'}
                    </div>
                    {specTaskValidationIssues.length > 0 ? (
                      <div className="mt-2 space-y-2">
                        {specTaskValidationIssues.map((issue, index) => (
                          <button
                            key={`spec-task-issue-${index}`}
                            type="button"
                            className={`block w-full rounded-lg border bg-background/60 p-2.5 text-left transition-colors hover:bg-background ${
                              activeSpecTaskIssueKey === `${issue.code}:${issue.lineNumber ?? 'global'}:${index}`
                                ? 'border-red-500/50 ring-1 ring-red-500/30'
                                : 'border-red-500/20'
                            }`}
                            onClick={() => focusSpecTaskIssue(issue, index)}
                          >
                            <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-foreground">
                              <span className="rounded bg-red-500/12 px-1.5 py-0.5 text-[10px] text-red-600">
                                {issue.lineNumber ? `第 ${issue.lineNumber} 行` : '全局'}
                              </span>
                              {issue.taskId ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {issue.taskId}
                                </span>
                              ) : null}
                              <span>{issue.message}</span>
                            </div>
                            {issue.lineContent ? (
                              <pre className="mt-2 overflow-x-auto rounded bg-muted/70 px-2 py-1.5 font-mono text-[10px] text-muted-foreground whitespace-pre-wrap break-all">
                                {issue.lineContent}
                              </pre>
                            ) : null}
                            {issue.suggestion ? (
                              <div className="mt-2 text-[11px] leading-5 text-muted-foreground">
                                建议修改：{issue.suggestion}
                              </div>
                            ) : null}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-2 space-y-1 text-[11px] leading-5 text-muted-foreground">
                        {(specTaskFormatErrors.length > 0 ? specTaskFormatErrors : specTaskValidationDetails).map((message, index) => (
                          <div key={`spec-task-format-${index}`}>{message}</div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-[1fr_minmax(0,2fr)]">
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">修订摘要</Label>
                    <Input
                      value={specRevisionSummary}
                      onChange={(event) => setSpecRevisionSummary(event.target.value)}
                      placeholder={`例如：调整 ${activeSpecCodingArtifact.label} 的结构与验收标准`}
                      disabled={savingSpecRevision}
                    />
                  </div>
                  <div className="flex items-end justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSpecRevisionDraft(specRevisionBaseArtifact?.content || '')}
                      disabled={savingSpecRevision}
                    >
                      恢复当前内容
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleSaveSpecRevision()}
                      disabled={savingSpecRevision || !creationSessionSummary?.id || !specRevisionDraft.trim()}
                    >
                      {savingSpecRevision ? '保存中...' : '保存修订'}
                    </Button>
                  </div>
                </div>
                <div className="min-h-[480px] flex-1 overflow-hidden rounded-xl border">
                  <MonacoEditor
                    height="100%"
                    defaultLanguage="markdown"
                    language="markdown"
                    value={specRevisionDraft}
                    onChange={(value: string | undefined) => setSpecRevisionDraft(value || '')}
                    onMount={(editor: unknown, monaco: unknown) => {
                      specTaskEditorRef.current = editor as MonacoEditorInstance;
                      specTaskMonacoRef.current = monaco as MonacoNamespace;
                    }}
                    theme={resolvedTheme === 'dark' ? 'vs-dark' : 'vs-light'}
                    options={{
                      glyphMargin: true,
                      minimap: { enabled: false },
                      wordWrap: 'on',
                      fontSize: 13,
                      readOnly: savingSpecRevision || !creationSessionSummary?.id,
                      scrollBeyondLastLine: false,
                    }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl border bg-muted/10">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                  <div className="text-xs text-muted-foreground">
                    {specRevisionCandidate
                      ? `${specRevisionCandidate.source === 'rollback' ? '回退候选' : 'AI 候选'} 与当前 ${specRevisionBaseArtifact?.label || activeSpecCodingArtifact.label} 的逐行差异`
                      : `当前稿与基线 ${specRevisionBaseArtifact?.label || activeSpecCodingArtifact.label} 的逐行差异`}
                  </div>
                  {specRevisionCandidate ? (
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={handleDiscardSpecRevisionCandidate}
                        disabled={savingSpecRevision}
                      >
                        放弃
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => void handleApplySpecRevisionCandidate()}
                        disabled={savingSpecRevision}
                      >
                        {savingSpecRevision ? '应用中...' : '应用'}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <div className="max-h-[70vh] overflow-auto p-4 font-mono text-xs leading-6">
                  {specArtifactDiffRows.length ? (
                    specArtifactDiffRows.map((row, index) => (
                      <div
                        key={`${row.type}-${index}`}
                        className={
                          row.type === 'add'
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : row.type === 'remove'
                              ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                              : 'text-muted-foreground'
                        }
                      >
                        <span className="mr-2 inline-block w-4 text-center">
                          {row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '}
                        </span>
                        <span className="whitespace-pre-wrap break-words">{row.text || ' '}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-muted-foreground">没有差异。</div>
                  )}
                </div>
              </div>
            )}
          </div>
          </>
          ) : (
            <div className="flex-1 overflow-auto p-5">
              <div className="mb-4 space-y-3 rounded-xl border bg-background/75 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>restore</span>
                      回退到历史 Spec
                    </div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">
                      从历史快照生成回退候选，不会直接覆盖当前版本；应用前可查看三份制品 diff。
                    </div>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => void refreshCreationSpecSnapshots()}
                    disabled={!creationSessionSummary?.id}
                  >
                    刷新快照
                  </Button>
                </div>
                {rollbackSpecArtifactSnapshots.length ? (
                  <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                    <Select
                      value={specRollbackTargetVersion}
                      onValueChange={setSpecRollbackTargetVersion}
                    >
                      <SelectTrigger className="h-9 text-xs">
                        <SelectValue placeholder="选择要回退到的版本" />
                      </SelectTrigger>
                      <SelectContent>
                        {rollbackSpecArtifactSnapshots.map((snapshot) => (
                          <SelectItem key={`rollback-${snapshot.version}`} value={String(snapshot.version)}>
                            v{snapshot.version} · {snapshot.summary || '无摘要'}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      className="h-9 text-xs"
                      onClick={handleCreateRollbackCandidate}
                      disabled={!specRollbackTargetVersion || savingSpecRevision}
                    >
                      生成回退候选
                    </Button>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                    暂无可回退的历史快照。
                  </div>
                )}
              </div>
              {sortedSpecArtifactSnapshots.length ? (
                <div className="mb-4 space-y-2 rounded-xl border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">历史快照</div>
                    <Badge variant="outline" className="text-[10px]">{sortedSpecArtifactSnapshots.length} 个版本</Badge>
                  </div>
                  <div className="space-y-2">
                    {sortedSpecArtifactSnapshots.map((snapshot) => (
                      <button
                        key={`snapshot-${snapshot.version}`}
                        type="button"
                        className={`w-full rounded-lg border p-3 text-left text-xs transition-colors ${
                          String(snapshot.version) === specRollbackTargetVersion
                            ? 'border-primary bg-primary/10'
                            : 'bg-muted/10 hover:bg-muted/30'
                        }`}
                        onClick={() => setSpecRollbackTargetVersion(String(snapshot.version))}
                        disabled={snapshot.version === specCodingSummary?.version}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="font-medium text-foreground">
                            v{snapshot.version}
                            {snapshot.version === specCodingSummary?.version ? ' · 当前版本' : ''}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            {snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleString() : ''}
                          </div>
                        </div>
                        <div className="mt-1 line-clamp-2 text-muted-foreground">{snapshot.summary || '无摘要'}</div>
                        {snapshot.createdBy ? (
                          <div className="mt-1 text-[10px] text-muted-foreground">修订者：{snapshot.createdBy}</div>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="space-y-3 rounded-xl border p-4">
                <div className="text-sm font-semibold">修订记录</div>
                <div className="space-y-2">
                  {specCodingDetails?.revisions?.length ? (
                    [...specCodingDetails.revisions].reverse().map((revision) => (
                      <div key={revision.id} className="rounded-lg border bg-muted/20 p-3 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground">v{revision.version}</span>
                          <span>{new Date(revision.createdAt).toLocaleString()}</span>
                        </div>
                        <div className="mt-1 leading-5">{revision.summary}</div>
                        {revision.createdBy ? (
                          <div className="mt-1 text-[10px]">修订者：{revision.createdBy}</div>
                        ) : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">当前还没有修订记录。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </>
    );
  };

  const showWorkbenchPreview = workbenchNavSection === 'preview';
  const workbenchModeSubtitle = showWorkbenchPreview ? '预览' : isRunMode ? '运行' : '设计';
  const workbenchShellTitle = showWorkbenchPreview
    ? `预览 · ${workflowBaseTitle}`
    : workflowTitle;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleVisibility = (event: Event) => {
      const detail = (event as CustomEvent<Partial<Record<WorkflowRunWindowId, boolean>>>).detail;
      if (!detail) return;
      setWorkflowRunWindowVisibility((prev) => ({ ...prev, ...detail }));
    };
    window.addEventListener(WORKFLOW_RUN_VISIBILITY_EVENT, handleVisibility);
    return () => window.removeEventListener(WORKFLOW_RUN_VISIBILITY_EVENT, handleVisibility);
  }, []);

  const handleWorkflowRunWindowSelect = useCallback((windowId: 'directory' | 'center', visible: boolean) => {
    if (windowId === 'center') {
      dispatchWorkflowRunRestore('center');
      return;
    }
    if (visible) {
      dispatchWorkflowRunHide(windowId === 'directory' ? 'left' : windowId);
      return;
    }
    if (windowId === 'directory') {
      setLeftRunPanelTab('directory');
      dispatchWorkflowRunRestore('left');
      return;
    }
  }, []);

  const restoreWorkflowRunDefaultLayout = useCallback(() => {
    setLeftRunPanelTab('directory');
    setRightPanelTab('detail');
    dispatchWorkflowRunResetLayout();
  }, []);

  const renderWorkflowRunWindowMenu = useCallback(() => {
    if (!isRunMode) return null;
    const leftVisible = workflowRunWindowVisibility.left !== false;
    const items: Array<{ id: 'directory' | 'center'; label: string; visible: boolean; locked?: boolean }> = [
      { id: 'directory', label: '运行信息', visible: leftVisible },
      { id: 'center', label: '运行工作区', visible: true, locked: true },
    ];
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 px-2.5 text-xs">
            <span className="material-symbols-outlined shrink-0" style={{ fontSize: 14 }}>splitscreen</span>
            <span className="inline shrink-0">窗口</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          {items.map((item) => (
            <DropdownMenuItem
              key={item.id}
              onSelect={() => handleWorkflowRunWindowSelect(item.id, item.visible)}
              className="gap-2"
            >
              <span className="flex-1">{item.label}</span>
              {item.locked ? (
                <span className="text-[10px] text-muted-foreground">固定</span>
              ) : null}
              {item.visible ? (
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 15 }}>check</span>
              ) : null}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={restoreWorkflowRunDefaultLayout} className="gap-2">
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>restart_alt</span>
            还原默认布局
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }, [
    handleWorkflowRunWindowSelect,
    isRunMode,
    restoreWorkflowRunDefaultLayout,
    workflowRunWindowVisibility.center,
    workflowRunWindowVisibility.left,
  ]);

  const workflowStatusPill = useMemo(() => (
    <StatusPill tone={getWorkflowStatusTone(workflowStatus)}>
      {getStatusText(workflowStatus)}
    </StatusPill>
  ), [workflowStatus]);

  const workbenchObjectName = isDesignMode && editingName ? (
    <Input
      value={nameValue}
      onChange={(e) => setNameValue(e.target.value)}
      onBlur={() => void saveWorkflowName(nameValue)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          void saveWorkflowName(nameValue);
        }
        if (e.key === 'Escape') setEditingName(false);
      }}
      className="h-8 w-[220px] text-sm font-semibold"
      aria-label="工作流名称"
      autoFocus
    />
  ) : workflowConfig?.workflow?.name || configFile;

  const workbenchPrimaryAction = useMemo<WorkbenchAction | undefined>(() => {
    if (isRunMode) {
      return {
        id: 'start-workflow',
        label: startRequesting ? '准备中...' : starting ? '启动中...' : rehearsalMode ? '开始演练' : '启动工作流',
        icon: starting || startRequesting
          ? <ClipLoader color="currentColor" size={14} />
          : <span className="material-symbols-outlined" style={{ fontSize: 14 }}>play_arrow</span>,
        group: 'run',
        disabled: showWorkbenchPreview ? (!workflowConfig || starting || startRequesting) : !canStartWorkflow,
        disabledReason: !workflowConfig
          ? '工作流配置加载中'
          : !showWorkbenchPreview && isRunning
          ? '当前工作流正在运行'
          : undefined,
        onSelect: () => requestStartWorkflow(),
      };
    }
    if (isDesignMode) {
      return {
        id: 'save-config',
        label: saving ? '保存中...' : '保存配置',
        icon: saving
          ? <ClipLoader color="currentColor" size={14} />
          : <span className="material-symbols-outlined" style={{ fontSize: 14 }}>save</span>,
        group: 'edit',
        disabled: saving,
        onSelect: handleSaveConfig,
      };
    }
    return undefined;
  }, [canStartWorkflow, handleSaveConfig, isDesignMode, isRunMode, rehearsalMode, requestStartWorkflow, saving, showWorkbenchPreview, startRequesting, starting]);

  const workbenchSecondaryActions = useMemo<WorkbenchAction[]>(() => {
    if (!isRunMode) {
      if (!isDesignMode || editingName) return [];
      return [{
        id: 'edit-name',
        label: '修改名称',
        icon: <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit</span>,
        group: 'edit',
        onSelect: () => {
          setEditingName(true);
          setNameValue(workflowConfig?.workflow?.name || '');
        },
      }];
    }
    if (showWorkbenchPreview) {
      return [
        {
          id: 'context-workbench',
          label: '上下文工作台',
          icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit_note</span>,
          group: 'edit',
          disabled: !hasContextEditableRun,
          onSelect: () => openContextEditor('global'),
        },
        {
          id: 'toggle-process-panel',
          label: showProcessPanel ? '隐藏进程' : '进程',
          icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>settings</span>,
          group: 'view',
          onSelect: () => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel }),
        },
      ];
    }
    return [
      {
        id: 'stop-workflow',
        label: stopping ? '停止中...' : '停止',
        icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>stop</span>,
        group: 'run',
        variant: 'destructive',
        disabled: !canStopWorkflow,
        disabledReason: actionIsRunning ? undefined : '当前没有运行中的工作流',
        onSelect: requestStopWorkflow,
      },
      {
        id: 'resume-workflow',
        label: historyRunAction?.action === 'resume' ? '恢复中...' : '恢复',
        icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>restart_alt</span>,
        group: 'run',
        className: 'border-emerald-500/35 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/15 disabled:border-border disabled:bg-muted disabled:text-muted-foreground',
        disabled: !canResumeWorkflow,
        disabledReason: resumeWorkflowDisabledReason,
        onSelect: requestResumeWorkflow,
      },
      {
        id: 'context-workbench',
        label: '上下文工作台',
        icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit_note</span>,
        group: 'edit',
        disabled: !hasContextEditableRun,
        onSelect: () => openContextEditor('global'),
      },
      {
        id: 'toggle-process-panel',
        label: showProcessPanel ? '隐藏进程' : '进程',
        icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>settings</span>,
        group: 'view',
        onSelect: () => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel }),
      },
    ];
  }, [
    canStartWorkflow,
    canResumeWorkflow,
    canStopWorkflow,
    dispatch,
    editingName,
    hasContextEditableRun,
    historyRunAction?.action,
    isDesignMode,
    isRunMode,
    isRunning,
    openContextEditor,
    requestStopWorkflow,
    requestResumeWorkflow,
    actionRunId,
    actionIsRunning,
    isRunning,
    resumeWorkflowDisabledReason,
    requestStartWorkflow,
    showWorkbenchPreview,
    workflowConfig,
    showProcessPanel,
    workflowConfig?.workflow?.name,
  ]);

  const workbenchOverflowActions = useMemo<WorkbenchAction[]>(() => {
    if (!isRunMode) return [];
    if (showWorkbenchPreview) return [];
    const hasForceCompletableStep = [currentStep, ...activeSteps].filter(Boolean).length > 0;
    return [
      {
        id: 'toggle-rehearsal',
        label: rehearsalMode ? '关闭演练模式' : '开启演练模式',
        icon: <span className="material-symbols-outlined" style={{ fontSize: 15 }}>theater_comedy</span>,
        group: 'run',
        onSelect: () => setRehearsalMode(!rehearsalMode),
      },
      {
        id: 'force-complete-step',
        label: forceCompleting ? '放行中...' : '强制放行当前步骤',
        icon: forceCompleting
          ? <ClipLoader color="currentColor" size={14} />
          : <span className="material-symbols-outlined" style={{ fontSize: 15 }}>warning</span>,
        group: 'danger',
        variant: 'destructive',
        disabled: forceCompleting || !hasForceCompletableStep,
        disabledReason: !hasForceCompletableStep ? '当前没有正在运行的步骤' : undefined,
        onSelect: forceCompleteStep,
      },
    ];
  }, [
    activeSteps,
    currentStep,
    forceCompleting,
    forceCompleteStep,
    isRunMode,
    rehearsalMode,
    showWorkbenchPreview,
    workflowStatus,
  ]);

  const visibleWorkbenchSecondaryActions = useMemo(
    () => showWorkbenchPreview
      ? workbenchSecondaryActions.filter((action) => action.id === 'context-workbench' || action.id === 'toggle-process-panel')
      : workbenchSecondaryActions,
    [showWorkbenchPreview, workbenchSecondaryActions],
  );
  const visibleWorkbenchOverflowActions = useMemo(
    () => showWorkbenchPreview ? [] : workbenchOverflowActions,
    [showWorkbenchPreview, workbenchOverflowActions],
  );

  const renderWorkbenchHeader = useCallback((variant: 'shell' | 'inline') => (
    <WorkbenchHeader
      objectName={workbenchObjectName}
      status={showWorkbenchPreview ? undefined : workflowStatusPill}
      primaryAction={workbenchPrimaryAction}
      secondaryActions={visibleWorkbenchSecondaryActions}
      overflowActions={visibleWorkbenchOverflowActions}
      leading={<RobotLogo size={22} />}
      className={variant === 'shell' ? 'border-0 bg-transparent' : 'shrink-0'}
      data-testid={`workbench-header-${variant}`}
    />
  ), [
    workbenchModeSubtitle,
    workbenchObjectName,
    workbenchPrimaryAction,
    showWorkbenchPreview,
    visibleWorkbenchOverflowActions,
    visibleWorkbenchSecondaryActions,
    workflowStatus,
    workflowStatusPill,
  ]);

  const workbenchHeaderActions = useMemo(() => renderWorkbenchHeader('shell'), [renderWorkbenchHeader]);
  const dashboardShellActions = useMemo(() => (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {visibleWorkbenchSecondaryActions.map((action) => (
        <WorkbenchActionButton key={action.id} action={action} />
      ))}
      <WorkbenchOverflowMenu actions={visibleWorkbenchOverflowActions} />
      {workbenchPrimaryAction ? <WorkbenchActionButton action={workbenchPrimaryAction} primary /> : null}
    </div>
  ), [visibleWorkbenchOverflowActions, workbenchPrimaryAction, visibleWorkbenchSecondaryActions]);
  const dashboardShellActionSignature = useMemo(() => {
    const summarizeAction = (action?: WorkbenchAction) => action ? [
      action.id,
      action.label,
      action.disabled ? 'disabled' : 'enabled',
      action.disabledReason || '',
      action.variant || '',
      action.className || '',
    ].join(':') : 'none';
    return [
      summarizeAction(workbenchPrimaryAction),
      visibleWorkbenchSecondaryActions.map(summarizeAction).join('|'),
      visibleWorkbenchOverflowActions.map(summarizeAction).join('|'),
    ].join('||');
  }, [visibleWorkbenchOverflowActions, visibleWorkbenchSecondaryActions, workbenchPrimaryAction]);

  const { isDashboardShell } = useDashboardShellHeader({
    title: workbenchShellTitle,
    subtitle: `${workbenchModeSubtitle} · ${configFile}`,
    leadingActions: editingName ? workbenchObjectName : undefined,
    actions: dashboardShellActions,
  }, [workbenchShellTitle, workbenchModeSubtitle, configFile, dashboardShellActionSignature, editingName, nameValue]);

  const selectedRunId = runId || selectedRun?.id || null;
  const runRecordItems = [
    ...(selectedRun ? [selectedRun] : []),
    ...historyRuns.filter((item: any) => item.id !== selectedRun?.id),
  ].slice(0, 12);
  const previewDetailNavItems = buildWorkbenchPreviewDetailNavItems({
    isLightweightWorkflow,
    runtimeSpecAvailable,
  });
  const runDetailNavItems = buildWorkbenchRunDetailNavItems({
    isLightweightWorkflow: isRuntimeLightweightWorkflow,
    runtimeSpecAvailable,
    includeStructuredTasklist: isPromotedLightweightRun && runtimeSpecAvailable,
  });

  const openPreviewSection = () => {
    setWorkbenchNavSection('preview');
    setRunRecordDrilled(false);
    setRunDetailSection('overview');
    dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
    updateUrl({
      mode: 'run',
      designTab: null,
      section: 'preview-overview',
      run: null,
      runId: null,
      history: null,
      tab: null,
      workspace: null,
      workspaceRoot: null,
      changes: null,
      documentSource: null,
      workspaceFile: null,
      workspaceLine: null,
      workspaceColumn: null,
    });
  };

  const openPreviewDetailSection = (section: RunDetailSection) => {
    const nextSection = section;
    setWorkbenchNavSection('preview');
    setRunRecordDrilled(false);
    setRunDetailSection(nextSection);
    dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
    const previewSection = nextSection === 'state'
      ? 'preview-state'
      : nextSection === 'agents'
        ? 'preview-agents'
      : nextSection === 'workspace'
        ? 'preview-workspace'
        : nextSection === 'spec'
          ? 'preview-spec'
          : 'preview-overview';
    updateUrl({
      mode: 'run',
      designTab: null,
      section: previewSection,
      run: null,
      runId: null,
      history: null,
      tab: null,
      documentSource: null,
      workspace: null,
      workspaceRoot: null,
      changes: null,
      workspaceFile: null,
      workspaceLine: null,
      workspaceColumn: null,
    });
  };

  const openRunDetailSection = (
    section: RunDetailSection,
    options: { documentSource?: DocumentSourceFilter } = {},
  ) => {
    const nextSection = section;
    const nextDocumentSource = nextSection === 'documents'
      ? (options.documentSource || documentSourceFilter)
      : 'all';
    const changesDocumentSource = nextSection === 'documents' && nextDocumentSource !== documentSourceFilter;
    if ((nextSection === runDetailSection && !changesDocumentSource) || runDetailNavigationPendingRef.current) return;
    const navigationToken = runDetailNavigationTokenRef.current + 1;
    runDetailNavigationTokenRef.current = navigationToken;
    runDetailNavigationPendingRef.current = nextSection;
    setRunDetailNavigationPending(nextSection);

    const tab = runDetailSectionToWorkbenchTab(nextSection);
    returnedRunIdRef.current = null;
    setWorkbenchNavSection('runs');
    setRunRecordDrilled(true);
    setRunDetailSection(nextSection);
    setRunWorkbenchTab(tab);
    if (nextSection === 'documents') setDocumentSourceFilter(nextDocumentSource);
    if (nextSection === 'workspace') {
      setWorkspaceEditorPath(currentRunWorkspacePath);
      setWorkspaceEditorTitle('工作区');
      setWorkspaceEditorFilePath(null);
      setWorkspaceEditorLineNumber(null);
      setWorkspaceEditorColumn(null);
    }
    void updateUrl({
      mode: 'run',
      section: null,
      tab,
      documentSource: nextSection === 'documents' && nextDocumentSource !== 'all' ? nextDocumentSource : null,
      workspace: nextSection === 'workspace' ? '1' : null,
      workspaceRoot: nextSection === 'workspace' ? currentRunWorkspacePath : null,
      changes: nextSection === 'changes' ? '1' : null,
      workspaceFile: null,
      workspaceLine: null,
      workspaceColumn: null,
    }).finally(() => {
      if (runDetailNavigationTokenRef.current !== navigationToken) return;
      runDetailNavigationPendingRef.current = null;
      setRunDetailNavigationPending(null);
    });
  };

  const humanAttentionActive = shouldShowWorkbenchHumanAttention({
    workflowStatus,
    hasPendingQuestion: Boolean(pendingHumanQuestion),
    hasApproval: Boolean(humanApprovalData),
    isHumanReviewLocation: currentPhase === '__human_approval__'
      || currentStep === '__human_approval__'
      || formatWorkflowLocation(currentPhase, currentStep, '').includes('人工审查'),
  });

  const renderHumanAttentionBanner = () => {
    if (!humanAttentionActive || showWorkbenchPreview) return null;
    const label = pendingHumanQuestionKindLabel || '人工审查';
    const pendingQuestionText = pendingHumanQuestion
      ? String((pendingHumanQuestion as any).question || pendingHumanQuestion.message || '').trim()
      : '';
    const title = pendingHumanQuestion
      ? (pendingHumanQuestion.title || '等待人工输入')
      : '确认工作流下一步';
    const summary = pendingHumanQuestion
      ? (pendingQuestionText || pendingHumanQuestion.supervisorAdvice || '请查看审批选项并给出决定。')
      : humanApprovalData?.result?.summary || humanApprovalData?.supervisorAdvice || '当前工作流等待人工确认后继续推进。';
    const route = humanApprovalData
      ? `${formatStateName(humanApprovalData.currentState)} -> ${formatStateName(humanApprovalData.nextState)}`
      : formatWorkflowLocation(currentPhase, currentStep, '等待处理');
    const suggestedAction = pendingHumanQuestion?.suggestedNextState
      || humanApprovalData?.nextState
      || null;
    const answerOptions = pendingHumanQuestion
      ? (pendingHumanQuestion.answerSchema.options?.map((option) => option.label)
        || pendingHumanQuestion.availableStates
        || [])
      : humanApprovalData?.availableStates || [];
    return (
      <div className="shrink-0 border-b border-orange-300 bg-orange-50 px-5 py-4 text-orange-950 shadow-[inset_4px_0_0_#f97316] dark:border-orange-400/25 dark:bg-orange-500/10 dark:text-orange-50">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="material-symbols-outlined mt-0.5 rounded-full bg-orange-600 p-1 text-white" style={{ fontSize: 19 }}>approval</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-extrabold">工作流已暂停，等待{label}</span>
                <StatusPill tone="warning" className="py-0.5 text-[10px]">{route}</StatusPill>
                <span className="text-[11px] font-semibold text-orange-700 dark:text-orange-200">
                  累计等待 {formatRunDuration(runTiming.waitMs)}
                </span>
              </div>
              <div className="mt-2 grid gap-x-5 gap-y-2 text-xs leading-5 md:grid-cols-[minmax(0,1.6fr)_minmax(180px,0.8fr)]">
                <div className="min-w-0">
                  <div className="font-bold text-orange-950 dark:text-orange-50">审批事项：{title}</div>
                  <div
                    className="mt-0.5 max-h-48 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words pr-2 text-orange-800 dark:text-orange-100/85"
                    aria-label="审批说明"
                    tabIndex={0}
                  >
                    {summary}
                  </div>
                </div>
                <div className="min-w-0 border-orange-200 md:border-l md:pl-5 dark:border-orange-400/20">
                  <div className="font-bold text-orange-950 dark:text-orange-50">需要决定</div>
                  <div className="mt-0.5 text-orange-800 dark:text-orange-100/85">
                    {answerOptions.length > 0 ? answerOptions.slice(0, 4).join(' / ') : '确认是否继续执行'}
                  </div>
                  {suggestedAction ? (
                    <div className="mt-1 font-semibold text-emerald-700 dark:text-emerald-300">Supervisor 推荐：{suggestedAction}</div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {pendingHumanQuestion ? (
              <Button type="button" size="sm" className="h-9 bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700" onClick={() => openRunDetailSection('live')}>
                <span className="material-symbols-outlined mr-1 text-sm">fact_check</span>
                查看并审批
              </Button>
            ) : null}
            <Button type="button" size="sm" variant="outline" className="h-9 border-orange-400/60 bg-background/90 text-xs" onClick={() => openRunDetailSection('state')}>
              <span className="material-symbols-outlined mr-1 text-sm">hub</span>
              查看状态图
            </Button>
            {humanApprovalData ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  className="h-8 bg-emerald-600 px-3 text-xs text-white hover:bg-emerald-700"
                  onClick={submitHumanApprovalFromBanner}
                  disabled={submittingHumanQuestion}
                >
                  <span className="material-symbols-outlined mr-1 text-sm">check</span>
                  {submittingHumanQuestion ? '提交中...' : '通过'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-8 px-3 text-xs"
                  onClick={rejectHumanApprovalFromBanner}
                  disabled={submittingHumanQuestion}
                >
                  <span className="material-symbols-outlined mr-1 text-sm">close</span>
                  拒绝并停止
                </Button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const renderRunStateMapPanel = () => (
    <div className="h-full min-h-0 overflow-hidden bg-background">
      {runtimeWorkflowConfig ? (
        <div className="relative h-full p-4">
            {subworkflowDrilldownLoading ? (
              <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-background/60 backdrop-blur-[1px]">
                <div className="flex items-center gap-2 rounded-full border bg-background px-4 py-2 text-sm text-muted-foreground shadow-sm">
                  <ClipLoader size={14} />
                  正在打开子工作流
                </div>
              </div>
            ) : null}
            {subworkflowDrilldownStack.length > 0 ? (
              renderSubworkflowDrilldown()
            ) : isRuntimeLightweightWorkflow ? (
              <LightweightTaskExecutionGraph
                {...lightweightTaskBoardInput}
                className="h-full"
              />
            ) : (
              <div className="flex h-full min-h-0 flex-col gap-3">
                <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">本次运行状态</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">按运行快照展示实际状态、步骤和转移，不修改原工作流。</div>
                  </div>
                  <div className="inline-flex rounded-lg border bg-muted/20 p-1">
                    <Button type="button" size="sm" variant={runtimeStateViewMode === 'structure' ? 'secondary' : 'ghost'} className="h-7 px-3 text-xs" onClick={() => setRuntimeStateViewMode('structure')}>
                      状态结构
                    </Button>
                    <Button type="button" size="sm" variant={runtimeStateViewMode === 'diagram' ? 'secondary' : 'ghost'} className="h-7 px-3 text-xs" onClick={() => setRuntimeStateViewMode('diagram')}>
                      拓扑图
                    </Button>
                  </div>
                </div>
                <div className="min-h-0 flex-1">
                  {runtimeStateViewMode === 'structure' ? (
                    <RuntimeStateStructurePanel
                      states={runtimeWorkflowConfig.workflow.states || []}
                      currentState={currentPhase}
                      currentStep={currentStep}
                      activeSteps={activeSteps}
                      completedSteps={completedSteps}
                      failedSteps={failedSteps}
                      stateHistory={smStateHistory}
                      workflowStatus={workflowStatus}
                    />
                  ) : (
                    <StateMachineExecutionView
                      states={runtimeWorkflowConfig.workflow.states || []}
                      agents={agentConfigs}
                      currentState={currentPhase}
                      currentStep={currentStep}
                      activeSteps={activeSteps}
                      activeConcurrencyGroups={activeConcurrencyGroups}
                      completedSteps={completedSteps}
                      failedSteps={failedSteps}
                      stateHistory={smStateHistory}
                      issueTracker={smIssueTracker}
                      transitionCount={smTransitionCount}
                      maxTransitions={runtimeWorkflowConfig.workflow.maxTransitions || 50}
                      status={workflowStatus as any}
                      isRunning={isRunning}
                      allowForceTransition={canForceTransition}
                      focusedState={focusedState}
                      startTime={runStartTime}
                      endTime={runEndTime}
                      accumulatedWaitMs={runAccumulatedWaitMs}
                      waitStartedAt={runWaitStartedAt}
                      supervisorFlow={supervisorFlow}
                      agentFlow={agentFlow}
                      tokenAnalytics={workflowTokenAnalytics}
                      executionTrace={executionTrace}
                      runtimeEvents={dbRuntimeEvents}
                      subworkflowRuns={subworkflowRuns}
                      subworkflowSummary={subworkflowSummary}
                      activeSubworkflowRunId={activeSubworkflowRunId}
                      onOpenSubworkflowRun={openSubworkflowRun}
                      overviewFooter={null}
                      activeTabOverride="trace"
                      defaultActiveTab="trace"
                      onActiveTabChange={setMainExecutionActiveTab}
                      hasPendingHumanQuestion={!!pendingHumanQuestion}
                      pendingHumanQuestion={pendingHumanQuestion as any}
                      formationAgents={supervisorFormationAgents}
                      supervisorAgent={runtimeSupervisorAgent}
                      onStateClick={selectStateDetails}
                      onStepClick={handleRunDiagramStepClick}
                      onRerunFromStep={handleRerunFromStep}
                      onForceTransition={handleForceTransition}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
      ) : (<WorkbenchExecutionLoadingSkeleton />)}
    </div>
  );

  const renderAgentFormationPanel = (mode: 'preview' | 'run') => {
    const isPreview = mode === 'preview';
    const lightweightMode = isPreview ? isLightweightWorkflow : isRuntimeLightweightWorkflow;
    if (lightweightMode) {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 p-4">
          <div className="mb-3 shrink-0">
            <div className={styles.workbenchPreviewKicker}>{isPreview ? '运行预览' : '运行 Agent'}</div>
            <h2 className="mt-2 text-xl font-semibold tracking-tight">任务与 Agent</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">显示本次运行已产生的主 Agent、子 Agent 活动和任务清单证据。</p>
          </div>
          <LightweightTaskBoard
            {...lightweightTaskBoardInput}
            className="min-h-0 flex-1 rounded-xl"
          />
        </div>
      );
    }
    const activeCount = isPreview ? 0 : activeFormationAgentNames.length;
    const statusLabel = isPreview
      ? '待运行'
      : formatWorkflowStatusLabel(actionWorkflowStatus || workflowStatus);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
        <div className="shrink-0 border-b bg-background px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className={styles.workbenchPreviewKicker}>{isPreview ? '编队预览' : '活跃编队'}</div>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">Agents</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                {isPreview
                  ? '展示当前工作流会用到的 Agent 编队、主管节点和执行关系。'
                  : '展示当前运行中参与调度的 Agent，活跃节点会随当前步骤和并发步骤高亮。'}
              </p>
            </div>
            <div className="grid min-w-[280px] grid-cols-3 gap-2">
              <div className={styles.workbenchMetric}><span>状态</span><strong>{statusLabel}</strong></div>
              <div className={styles.workbenchMetric}><span>Agent</span><strong>{supervisorFormationAgents.length}</strong></div>
              <div className={styles.workbenchMetric}><span>活跃</span><strong>{activeCount}</strong></div>
            </div>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
          <AgentFormationDiagram
            states={workflowFormationStates}
            agents={supervisorFormationAgents}
            supervisorAgent={runtimeSupervisorAgent}
            currentStep={isPreview ? null : currentStep}
            activeSteps={isPreview ? [] : activeSteps}
            status={isPreview ? 'idle' : workflowStatus as any}
            className="min-h-0 rounded-xl"
          />
        </div>
      </div>
    );
  };

  const renderRunAgoraPanel = () => (
    <div className="h-full min-h-0 overflow-hidden bg-background">
      <WorkflowSupervisorAgoraPanel
        sessionId={workflowAgoraSessionId}
        title={`Supervisor 协作 · ${workflowBaseTitle}`}
        configFile={configFile}
        runId={selectedRunId}
        supervisorAgent={runtimeSupervisorAgent}
        supervisorSessionId={runtimeSupervisorSessionId}
        workingDirectory={workflowAgoraWorkingDirectory}
        workflowStatus={workflowStatus}
        initialGuests={workflowAgoraInitialGuests}
        agentSessionIds={workflowAgoraAgentSessionIds}
        pendingHumanQuestion={pendingHumanQuestion}
        submittingHumanQuestion={submittingHumanQuestion}
        onSubmitHumanQuestion={handleSubmitHumanQuestion}
        specRevisionVote={specRevisionVote}
        specRevisionVoteHistory={specRevisionVoteHistory}
        formationPanel={(
          <div className="h-full min-h-0 bg-muted/20 p-4">
            <div className="h-full min-h-[420px] overflow-hidden rounded-2xl border bg-background">
              <AgentFormationDiagram
                states={workflowFormationStates}
                agents={supervisorFormationAgents}
                supervisorAgent={runtimeSupervisorAgent}
                currentStep={currentStep}
                activeSteps={activeSteps}
                status={workflowStatus as any}
                className="h-full"
              />
            </div>
          </div>
        )}
        summaryPanel={workflowStatus === 'completed' && finalReview ? (
          <div className="h-full overflow-y-auto bg-muted/20 p-4">
            {renderFinalReviewCard()}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            工作流完成后会在这里展示战后总结。
          </div>
        )}
      />
    </div>
  );

  const renderRunLiveOutputPanel = () => (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/10">
      {pendingHumanQuestion?.status === 'unanswered' ? (
        <div className="shrink-0 border-b bg-background/95 p-4 shadow-sm">
          <HumanQuestionCard
            question={pendingHumanQuestion}
            submitting={submittingHumanQuestion}
            collapsible={false}
            autoFocus
            onSubmit={handleSubmitHumanQuestion}
          />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        {renderLiveStreamPanel()}
      </div>
    </div>
  );

  const renderWorkbenchNavigation = () => (
    <div className={styles.workbenchNav}>
      <div className={styles.workbenchNavHeader}>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>account_tree</span>
          工作流工作台
        </div>
        <div className="mt-1 text-xs leading-5 text-muted-foreground">设计和运行记录按任务层级展开。</div>
      </div>

      <div className={styles.workbenchNavBody}>
        <div className={styles.workbenchNavSection}>
          <button
            type="button"
            className={cn(styles.workbenchNavItem, workbenchNavSection === 'design' && styles.workbenchNavItemActive)}
            onClick={() => {
              setWorkbenchNavSection('design');
              setRunRecordDrilled(false);
              switchViewMode('design' as ViewMode);
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>account_tree</span>
            <span className="min-w-0 flex-1 truncate">设计</span>
            <span className={styles.workbenchNavHint}>编排</span>
          </button>
          {workbenchNavSection === 'design' ? (
            <div className={styles.workbenchSubList}>
              {[
                { key: 'orchestration' as const, label: '编排', icon: 'account_tree' },
                { key: 'config' as const, label: '执行配置', icon: 'tune' },
                ...(specDesignEnabled ? [{ key: 'spec' as const, label: 'Spec', icon: 'fact_check' }] : []),
              ].map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(styles.workbenchSubItem, workbenchNavSection === 'design' && designTab === item.key && styles.workbenchSubItemActive)}
                  onClick={() => {
                    setWorkbenchNavSection('design');
                    switchViewMode('design' as ViewMode);
                    handleDesignTabChange(item.key);
                  }}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}

        </div>

        <div className={styles.workbenchNavSection}>
          <button
            type="button"
            className={cn(styles.workbenchNavItem, workbenchNavSection === 'preview' && styles.workbenchNavItemActive)}
            onClick={openPreviewSection}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 17 }}>visibility</span>
            <span className="min-w-0 flex-1 truncate">预览</span>
            <span className={styles.workbenchNavHint}>预览</span>
          </button>
          {workbenchNavSection === 'preview' ? (
            <div className={styles.workbenchSubList}>
              {previewDetailNavItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={cn(styles.workbenchSubItem, runDetailSection === item.key && styles.workbenchSubItemActive)}
                  onClick={() => openPreviewDetailSection(item.key)}
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.workbenchNavSection}>
          <div className={styles.workbenchRunEntry}>
            <button
              type="button"
              className={cn(styles.workbenchNavItem, styles.workbenchRunMain, workbenchNavSection === 'runs' && styles.workbenchNavItemActive)}
              onClick={() => {
                setWorkbenchNavSection('runs');
                setRunRecordDrilled(false);
                switchViewMode('run' as ViewMode);
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 17 }}>history</span>
              <span className="min-w-0 flex-1 truncate">运行记录</span>
            </button>
            <button
              type="button"
              className={styles.workbenchHistoryPageButton}
              onClick={openRunHistoryPage}
            >
              全部记录
            </button>
          </div>

          {workbenchNavSection === 'runs' && !runRecordDrilled ? (
            <div className={styles.workbenchRunList}>
              {historyLoading ? (
                <WorkbenchRunListLoadingSkeleton />
              ) : runRecordItems.length === 0 ? (
                <div className={styles.workbenchEmptyHint}>当前工作流的运行记录会显示在这里。</div>
              ) : (
                runRecordItems.map((item: any) => {
                  const active = selectedRunId === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        returnedRunIdRef.current = null;
                        setSelectedRun(item);
                        setRunRecordDrilled(true);
                        setRunDetailSection('overview');
                        void viewHistoryRun(item.id);
                      }}
                      className={cn(styles.workbenchRunCard, active && styles.workbenchRunCardActive)}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-xs font-semibold text-primary">{item.id}</span>
                        <StatusPill tone={getWorkflowStatusTone(item.status)}>{formatWorkflowStatusLabel(item.status)}</StatusPill>
                      </div>
                      <div className="mt-2 truncate text-sm font-semibold text-foreground">{workflowConfig?.workflow?.name || configFile}</div>
                      {item.taskTitle ? (
                        <div className="mt-1 line-clamp-2 text-xs leading-5 text-foreground">{item.taskTitle}</div>
                      ) : null}
                      <div className="mt-1 truncate text-xs text-muted-foreground">
                        {item.currentPhase || item.currentState || '运行摘要'} · {item.startTime ? new Date(item.startTime).toLocaleString('zh-CN') : '当前会话'}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          ) : null}

          {workbenchNavSection === 'runs' && runRecordDrilled ? (
            <div className={styles.workbenchRunDetailNav} aria-busy={runDetailNavigationPending ? 'true' : undefined}>
              <button
                type="button"
                className={styles.workbenchBackButton}
                onClick={() => {
                  returnedRunIdRef.current = selectedRunId || null;
                  setRunRecordDrilled(false);
                  updateUrl({
                    run: null,
                    runId: null,
                    history: null,
                    section: null,
                    tab: null,
                    workspace: null,
                    workspaceRoot: null,
                    changes: null,
                    workspaceFile: null,
                    workspaceLine: null,
                    workspaceColumn: null,
                  });
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 15 }}>arrow_back</span>
                返回历史列表
              </button>
              <div className={styles.workbenchSelectedRunCard}>
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold text-primary">{selectedRunId || '当前运行'}</span>
                  <StatusPill tone={getWorkflowStatusTone(actionWorkflowStatus || workflowStatus || selectedRun?.status)}>{formatWorkflowStatusLabel(actionWorkflowStatus || workflowStatus || selectedRun?.status)}</StatusPill>
                </div>
                <div className="mt-2 truncate text-sm font-semibold text-foreground">{workflowConfig?.workflow?.name || configFile}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{formatWorkflowLocation(currentPhase, currentStep, '运行摘要')}</div>
              </div>
              <div className={styles.workbenchSubList}>
                {runDetailNavItems.map((item) => {
                  const unavailable = (item.key === 'workspace' && !currentRunWorkspacePath)
                    || (item.key === 'changes' && !currentRunWorkspacePath);
                  const navigationBlocked = Boolean(runDetailNavigationPending && runDetailNavigationPending !== item.key);
                  const isNavigatingToItem = runDetailNavigationPending === item.key && item.key !== 'documents';
                  const isActive = runDetailSection === item.key && (
                    item.key !== 'documents'
                    || item.documentSource === documentSourceFilter
                    || (item.id === 'documents' && documentSourceFilter === 'all')
                  );
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={unavailable || navigationBlocked}
                      aria-busy={isNavigatingToItem ? 'true' : undefined}
                      className={cn(styles.workbenchSubItem, isActive && styles.workbenchSubItemActive)}
                      onClick={() => openRunDetailSection(item.key, { documentSource: item.documentSource })}
                    >
                      {isNavigatingToItem ? (
                        <ClipLoader size={13} color="currentColor" />
                      ) : (
                        <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{item.icon}</span>
                      )}
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );

  const renderWorkbenchPreview = () => {
    if (runDetailSection === 'state') {
      const stateMapConfig = stateMapUsesRuntimeSnapshot ? runtimeWorkflowConfig : workflowConfig;
      return (
        <div className={styles.workbenchPreviewFullPanel}>
          <div className={styles.workbenchPreviewFullHeader}>
            <div className={styles.workbenchPreviewKicker}>{stateMapUsesRuntimeSnapshot ? '本次运行快照' : '结构预览'}</div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">状态图</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {stateMapUsesRuntimeSnapshot
                ? '这里按本次 run 快照展示实际状态、步骤角色和流转历史；不会修改原工作流。'
                : '这里展示原始工作流配置。启动运行后，将自动切换为本次 run 的真实状态图。'}
            </p>
          </div>
          <div className={styles.workbenchPreviewCanvas}>
            {stateMapConfig && isLightweightWorkflowConfig(stateMapConfig) ? (
              <LightweightTaskExecutionGraph
                {...lightweightTaskBoardInput}
                className="h-full"
              />
            ) : stateMapConfig?.workflow?.mode === 'state-machine' ? (
              <StateMachineExecutionView
                key={`${stateMapUsesRuntimeSnapshot ? `run-${activeRuntimeRunId || 'current'}` : `preview-${configFile}-${savedWorkflowRevision}`}`}
                states={stateMapConfig.workflow.states || []}
                agents={agentConfigs}
                currentState={stateMapUsesRuntimeSnapshot ? currentPhase : null}
                currentStep={stateMapUsesRuntimeSnapshot ? currentStep : null}
                activeSteps={stateMapUsesRuntimeSnapshot ? activeSteps : []}
                activeConcurrencyGroups={stateMapUsesRuntimeSnapshot ? activeConcurrencyGroups : []}
                completedSteps={stateMapUsesRuntimeSnapshot ? completedSteps : []}
                failedSteps={stateMapUsesRuntimeSnapshot ? failedSteps : []}
                stateHistory={stateMapUsesRuntimeSnapshot ? smStateHistory : []}
                issueTracker={stateMapUsesRuntimeSnapshot ? smIssueTracker : []}
                transitionCount={stateMapUsesRuntimeSnapshot ? smTransitionCount : 0}
                maxTransitions={stateMapConfig.workflow.maxTransitions || 50}
                status={(stateMapUsesRuntimeSnapshot ? workflowStatus : 'idle') as any}
                isRunning={stateMapUsesRuntimeSnapshot ? isRunning : false}
                allowForceTransition={false}
                focusedState={stateMapUsesRuntimeSnapshot ? focusedState : null}
                startTime={stateMapUsesRuntimeSnapshot ? runStartTime : null}
                endTime={stateMapUsesRuntimeSnapshot ? runEndTime : null}
                accumulatedWaitMs={stateMapUsesRuntimeSnapshot ? runAccumulatedWaitMs : 0}
                waitStartedAt={stateMapUsesRuntimeSnapshot ? runWaitStartedAt : null}
                supervisorFlow={stateMapUsesRuntimeSnapshot ? supervisorFlow : []}
                agentFlow={stateMapUsesRuntimeSnapshot ? agentFlow : []}
                tokenAnalytics={stateMapUsesRuntimeSnapshot ? workflowTokenAnalytics : undefined}
                executionTrace={stateMapUsesRuntimeSnapshot ? executionTrace : null}
                runtimeEvents={stateMapUsesRuntimeSnapshot ? dbRuntimeEvents : []}
                subworkflowRuns={stateMapUsesRuntimeSnapshot ? subworkflowRuns : []}
                subworkflowSummary={stateMapUsesRuntimeSnapshot ? subworkflowSummary : null}
                activeSubworkflowRunId={stateMapUsesRuntimeSnapshot ? activeSubworkflowRunId : null}
                onOpenSubworkflowRun={() => {}}
                overviewFooter={null}
                activeTabOverride="trace"
                defaultActiveTab="trace"
                onActiveTabChange={() => {}}
                hasPendingHumanQuestion={stateMapUsesRuntimeSnapshot && !!pendingHumanQuestion}
                pendingHumanQuestion={stateMapUsesRuntimeSnapshot ? pendingHumanQuestion as any : null as any}
                formationAgents={supervisorFormationAgents}
                supervisorAgent={runtimeSupervisorAgent}
                diagramSemanticsScope={stateMapUsesRuntimeSnapshot ? 'run' : 'configuration'}
                onStateClick={() => {}}
                onStepClick={() => {}}
                onForceTransition={() => {}}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                此工作台仅支持状态机工作流预览。
              </div>
            )}
          </div>
        </div>
      );
    }
    if (runDetailSection === 'workspace') {
      return (
        <div className={styles.workbenchPreviewFullPanel}>
          <div className={styles.workbenchPreviewFullHeader}>
            <div className={styles.workbenchPreviewKicker}>工作区预览</div>
            <h2 className="mt-3 text-xl font-semibold tracking-tight">工作区</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              这里使用工作流配置里的工作区，和运行记录工作区保持同一套文件浏览与预览组件。
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden bg-background">
            {previewWorkspacePath ? (
              <WorkspaceEditor
                open
                onOpenChange={() => {}}
                workspacePath={previewWorkspacePath}
                title="工作区预览"
                presentation="page"
                searchParamsSnapshot={searchParamsString}
                onFileLocationChange={handlePreviewWorkspaceEditorFileLocationChange}
              />
            ) : (
              <div className="flex h-full items-center justify-center p-6">
                <div className="rounded-xl border border-dashed border-border bg-background px-6 py-5 text-center text-sm text-muted-foreground">
                  当前工作流还没有配置工作区路径。
                </div>
              </div>
            )}
          </div>
        </div>
      );
    }
    if (runDetailSection === 'agents') {
      return renderAgentFormationPanel('preview');
    }
    if (runDetailSection === 'spec') {
      return (
        <div className={styles.workbenchPreviewPanel}>
          <div className={styles.workbenchPreviewCard}>
            <div className={styles.workbenchPreviewKicker}>Spec 预览</div>
            <h2 className="mt-4 text-xl font-semibold tracking-tight">Spec</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              这里展示运行记录进入后的 Spec 查看位置。预览模式只展示入口和区域关系。
            </p>
            <div className="mt-6 rounded-xl border border-border bg-background p-5">
              <Skeleton className="mb-4 h-5 w-36" />
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-10/12" />
                <Skeleton className="h-4 w-8/12" />
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className={styles.workbenchPreviewPanel}>
        <div className={styles.workbenchPreviewCard}>
          <div className={styles.workbenchPreviewKicker}>运行预览</div>
          <h2 className="mt-4 text-xl font-semibold tracking-tight">总览</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            预览使用和运行记录一致的页面结构，用于确认入口位置、区域关系和操作路径。
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <div className={styles.workbenchMetric}><span>工作流</span><strong>{workflowBaseTitle}</strong></div>
            <div className={styles.workbenchMetric}><span>当前步骤</span><strong>待运行</strong></div>
            <div className={styles.workbenchMetric}><span>Agent</span><strong>{workflowAgentNames.length}</strong></div>
            <div className={styles.workbenchMetric}><span>转移次数</span><strong>0</strong></div>
          </div>
        </div>
      </div>
    );
  };

  const renderRunOverviewPanel = () => {
    const runFailureStepKeys = Array.from(new Set([
      ...(Array.isArray(runDetail?.failedSteps) ? runDetail.failedSteps : []),
      ...(Array.isArray((statusCompactQuery.data as any)?.failedSteps) ? (statusCompactQuery.data as any).failedSteps : []),
      ...(Array.isArray(failedSteps) ? failedSteps : []),
    ].map((stepKey) => String(stepKey || '').trim()).filter(Boolean)));
    const runFailureStepLogs = [
      ...(Array.isArray(runDetail?.stepLogs) ? runDetail.stepLogs : []),
      ...(Array.isArray((statusCompactQuery.data as any)?.stepLogs) ? (statusCompactQuery.data as any).stepLogs : []),
      ...persistedStepLogs,
    ];
    if (isRuntimeLightweightWorkflow) {
      const lightweightTokenMetric = buildLightweightTokenConsumptionMetric(workflowTokenAnalytics);
      const visibleStatusReason = formatWorkflowFailureReasonWithStepLogs(
        runDetail?.statusReason
        || runStatusReason
        || selectedRun?.statusReason
        || '',
        runFailureStepKeys,
        runFailureStepLogs,
      );
      const showStatusReason = Boolean(visibleStatusReason)
        && ['failed', 'crashed'].includes(normalizeWorkflowStatusCode(actionWorkflowStatus || workflowStatus));
      return (
        <div className="h-full min-h-0 overflow-auto bg-muted/20 p-4">
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            <div className="rounded-xl border bg-background p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className={styles.workbenchPreviewKicker}>轻量运行总览</div>
                  <h2 className="mt-2 truncate text-xl font-semibold tracking-tight">{selectedRunId || '当前运行'} · {workflowBaseTitle}</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">任务清单、Agent 活动和运行状态会随本次运行实时更新。</p>
                </div>
                <StatusPill tone={getWorkflowStatusTone(actionWorkflowStatus || workflowStatus)}>
                  {formatWorkflowStatusLabel(actionWorkflowStatus || workflowStatus)}
                </StatusPill>
              </div>
              {showStatusReason ? (
                <div role="alert" className="mt-4 border-l-2 border-destructive pl-3 text-sm leading-6 text-destructive">
                  <div className="font-semibold">运行失败原因</div>
                  <div className="whitespace-pre-wrap break-words">{visibleStatusReason}</div>
                </div>
              ) : null}
              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className={styles.workbenchMetric}><span>当前位置</span><strong>{formatWorkflowLocation(currentPhase, currentStep)}</strong></div>
                <div className={styles.workbenchMetric}><span>总历时</span><strong>{formatRunDuration(runTiming.totalMs)}</strong></div>
                <div className={styles.workbenchMetric}><span>工作区变更</span><strong>{workspaceChangeCount}</strong></div>
                <div className={styles.workbenchMetric}>
                  <span>Token 消耗</span>
                  <strong>{lightweightTokenMetric.value}</strong>
                  <small className="mt-1 block text-xs font-normal leading-5 text-muted-foreground">
                    {lightweightTokenMetric.details[0] || lightweightTokenMetric.status}
                  </small>
                </div>
              </div>
            </div>
            <LightweightTaskBoard {...lightweightTaskBoardInput} />
          </div>
        </div>
      );
    }
    const totalTokenUsage = workflowTokenAnalytics.total;
    const cacheHitTokens = totalTokenUsage.cacheReadInputTokens;
    const cacheHitRatio = formatTokenPercent(cacheHitTokens, totalTokenUsage.inputTokens + cacheHitTokens);
    const visibleStatusReason = formatWorkflowFailureReasonWithStepLogs(
      runDetail?.statusReason
      || runStatusReason
      || selectedRun?.statusReason
      || '',
      runFailureStepKeys,
      runFailureStepLogs,
    );
    const showStatusReason = Boolean(visibleStatusReason)
      && ['failed', 'crashed'].includes(normalizeWorkflowStatusCode(actionWorkflowStatus || workflowStatus));
    return (
    <div className={styles.workbenchPreviewPanel}>
      <div className={styles.workbenchPreviewCard}>
        <div className={styles.workbenchPreviewKicker}>运行总览</div>
        <h2 className="mt-4 text-xl font-semibold tracking-tight">
          {selectedRunId || '当前运行'} · {workflowBaseTitle}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {isRuntimeLightweightWorkflow
            ? '汇总当前运行状态、当前位置和关键执行数据。任务清单、实时输出和工作区通过左侧运行记录子菜单进入。'
            : '汇总当前运行状态、当前位置和关键执行数据。状态图和工作区通过左侧运行记录子菜单进入。'}
        </p>
        {showStatusReason ? (
          <div role="alert" className="mt-4 border-l-2 border-destructive pl-3 text-sm leading-6 text-destructive">
            <div className="flex items-start gap-2">
              <span className="material-symbols-outlined mt-0.5 shrink-0" style={{ fontSize: 18 }}>error</span>
              <div className="min-w-0 break-words">
                <div className="font-semibold">运行失败原因</div>
                <div className="whitespace-pre-wrap break-words">{visibleStatusReason}</div>
              </div>
            </div>
          </div>
        ) : null}
        {hasWorkflowTaskInput(runtimeTaskInput) ? (
          <div className="mt-5 space-y-3 rounded-md border border-border bg-muted/20 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-muted-foreground">本次任务</div>
                <div className="mt-1 break-words text-sm font-semibold text-foreground">
                  {runtimeTaskTitle || '未命名任务'}
                </div>
              </div>
              {runtimeTaskInput.issueUrl ? (
                <a
                  href={runtimeTaskInput.issueUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 text-xs font-medium text-primary hover:underline"
                >
                  打开链接
                </a>
              ) : null}
            </div>
            {runtimeTaskInput.description ? (
              <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                {runtimeTaskInput.description}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {runtimeTaskInput.targetBranch ? <Badge variant="outline">目标分支：{runtimeTaskInput.targetBranch}</Badge> : null}
              {runtimeTaskInput.acceptanceCriteria ? <Badge variant="outline">已填写验收标准</Badge> : null}
            </div>
          </div>
        ) : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
          <div className={`${styles.workbenchMetric} lg:col-span-3`}><span>状态</span><strong>{formatWorkflowStatusLabel(actionWorkflowStatus || workflowStatus)}</strong></div>
          <div className={`${styles.workbenchMetric} lg:col-span-3`}><span>当前位置</span><strong>{formatWorkflowLocation(currentPhase, currentStep)}</strong></div>
          <div className={`${styles.workbenchMetric} lg:col-span-3`}><span>已完成</span><strong>{completedSteps.length}</strong></div>
          <div className={`${styles.workbenchMetric} lg:col-span-3`}><span>转移次数</span><strong>{smTransitionCount}</strong></div>
          <div className={`${styles.workbenchTimingLedger} lg:col-span-12`}>
            <div className={styles.workbenchTimingHeader}>
              <div>
                <span className={styles.workbenchTimingEyebrow}>时间账本</span>
                <strong>总历时 {formatRunDuration(runTiming.totalMs)}</strong>
              </div>
              {runTiming.isWaiting ? <StatusPill tone="warning">当前正在等待</StatusPill> : null}
            </div>
            <div className={styles.workbenchTimingValues}>
              <div>
                <span><i className={styles.workbenchTimingRunDot} />实际运行</span>
                <strong>{formatRunDuration(runTiming.executionMs)}</strong>
                <small>{Math.round(runTiming.executionRatio * 100)}%</small>
              </div>
              <div>
                <span><i className={styles.workbenchTimingWaitDot} />等待耗时</span>
                <strong>{formatRunDuration(runTiming.waitMs)}</strong>
                <small>{Math.round(runTiming.waitRatio * 100)}%</small>
              </div>
            </div>
            <div className={styles.workbenchTimingTrack} aria-label={`实际运行 ${Math.round(runTiming.executionRatio * 100)}%，等待 ${Math.round(runTiming.waitRatio * 100)}%`}>
              <span className={styles.workbenchTimingRunBar} style={{ width: `${runTiming.executionRatio * 100}%` }} />
              <span className={styles.workbenchTimingWaitBar} style={{ width: `${runTiming.waitRatio * 100}%` }} />
            </div>
            <div className={styles.workbenchTimingHint}>实际运行 = 总历时 − 人工审查、暂停及恢复前等待</div>
          </div>
          <div className={`${styles.workbenchMetric} lg:col-span-4`}><span>变更</span><strong>{workspaceChangeCount}</strong></div>
          <div className={`${styles.workbenchTokenMetric} ${styles.workbenchTokenMetricGridItem} lg:col-span-8`}>
            <div className={styles.workbenchTokenMetricHeader}>
              <span>Token 消耗</span>
              <strong>{formatTokenCount(totalTokenUsage.totalTokens)}</strong>
            </div>
            <div className={styles.workbenchTokenMetricRows}>
              <div>输入 {formatTokenCount(totalTokenUsage.inputTokens)} · 输出 {formatTokenCount(totalTokenUsage.outputTokens)}</div>
              <div>缓存命中 {formatTokenCount(cacheHitTokens)} / {cacheHitRatio}</div>
            </div>
          </div>
        </div>
        <div className={styles.workbenchTransitionSection}>
          <div className={styles.workbenchTransitionHeader}>
            <div>
              <div className={styles.workbenchTransitionTitle}>流转记录</div>
              <div className={styles.workbenchTransitionSubtitle}>
                {runTimelineMode === 'steps' ? '按步骤展示执行顺序，点击步骤名查看 AI 输出' : '记录每个状态的开始时间和转移时间'}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border bg-background p-0.5">
                <Button
                  type="button"
                  variant={runTimelineMode === 'steps' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-xs"
                  onClick={() => setRunTimelineMode('steps')}
                >
                  步骤流转
                </Button>
                <Button
                  type="button"
                  variant={runTimelineMode === 'states' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-xs"
                  onClick={() => setRunTimelineMode('states')}
                >
                  状态转移
                </Button>
              </div>
              <StatusPill tone={(runTimelineMode === 'steps' ? runStepTimeline.length : runTransitionTimeline.length) > 0 ? 'info' : 'neutral'}>
                {runTimelineMode === 'steps' ? runStepTimeline.length : runTransitionTimeline.length} 条
              </StatusPill>
            </div>
          </div>
          <div className={styles.workbenchTransitionList}>
            {runTimelineMode === 'steps' ? (
              runStepTimeline.length > 0 ? (
                runStepTimeline.map((item) => {
                  const hasDetails = Boolean(item.output || item.outputRef || item.outputBytes || item.error || item.payload);
                  const statusLabel = item.status === 'completed'
                    ? '完成'
                    : item.status === 'failed'
                      ? '失败'
                      : item.status === 'running'
                        ? '运行中'
                        : item.status || '未知';
                  const statusTone = item.status === 'completed'
                    ? 'success'
                    : item.status === 'failed'
                      ? 'danger'
                      : item.status === 'running'
                        ? 'info'
                        : 'neutral';
                  const itemTokenUsage = normalizeAggregatedTokenUsage(item.tokenUsage);
                  const itemCacheHitTokens = itemTokenUsage.cacheReadInputTokens;
                  const itemCacheHitRatio = formatTokenPercent(itemCacheHitTokens, itemTokenUsage.inputTokens + itemCacheHitTokens);
                  return (
                    <div key={item.id} className={styles.workbenchTransitionItem}>
                      <div className={styles.workbenchTransitionTime}>
                        <span>{formatRunClockTime(item.timestamp)}</span>
                        {item.durationMs ? <span>{formatRunDuration(item.durationMs)}</span> : null}
                      </div>
                      <div className={styles.workbenchTransitionBody}>
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="min-w-0 truncate text-left text-sm font-semibold text-foreground underline-offset-4 hover:text-primary hover:underline disabled:pointer-events-none disabled:no-underline"
                            disabled={!hasDetails}
                            onClick={() => setOverviewStepRecord(item)}
                          >
                            {item.stepName}
                          </button>
                          <StatusPill tone={statusTone as any} className="py-0.5 text-[10px]">{statusLabel}</StatusPill>
                          {item.agent ? (
                            <button
                              type="button"
                              className="inline-flex h-5 max-w-full items-center rounded-full border px-2 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-primary"
                              title={`查看 ${item.agent} 的 Agent Intel`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openAgentFromTask(item.agent);
                              }}
                            >
                              <span className="truncate">{item.agent}</span>
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          {item.stateName ? <span className="truncate">状态：{formatStateName(item.stateName)}</span> : null}
                          {item.engineName ? <span className="truncate">引擎：{item.engineName}</span> : null}
                          {item.modelName ? <span className="truncate">模型：{item.modelName}</span> : null}
                        </div>
                        {itemTokenUsage.totalTokens > 0 ? (
                          <div className="mt-2 grid gap-1 rounded-md border bg-background/70 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground sm:grid-cols-3">
                            <div>
                              <span className="text-muted-foreground">Token 消耗</span>
                              <span className="ml-1 font-semibold text-foreground">{formatTokenCount(itemTokenUsage.totalTokens)}</span>
                            </div>
                            <div>
                              输入 {formatTokenCount(itemTokenUsage.inputTokens)} · 输出 {formatTokenCount(itemTokenUsage.outputTokens)}
                            </div>
                            <div>
                              缓存命中 {formatTokenCount(itemCacheHitTokens)} / {itemCacheHitRatio}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className={styles.workbenchEmptyHint}>
                  当前运行还没有步骤执行记录。
                </div>
              )
            ) : runTransitionTimeline.length > 0 ? (
              runTransitionTimeline.map((item) => (
                <div key={item.id} className={styles.workbenchTransitionItem}>
                  <div className={styles.workbenchTransitionTime}>
                    <span>{formatRunClockTime(item.startedAt)}</span>
                    <span>{formatRunClockTime(item.endedAt)}</span>
                  </div>
                  <div className={styles.workbenchTransitionBody}>
                    <div className={styles.workbenchTransitionRoute}>
                      <span>{item.from}</span>
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>arrow_forward</span>
                      <span>{item.to}</span>
                    </div>
                    {item.reason ? (
                      <div className={styles.workbenchTransitionReason}>{item.reason}</div>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className={styles.workbenchEmptyHint}>
                当前运行还没有流转记录。
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    );
  };

  if (pageLoading && isDesignMode) {
    return <BrandLoadingScreen message="加载工作流配置..." />;
  }

  if (loadError && isDesignMode) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <span className="material-symbols-outlined text-4xl text-destructive">error</span>
        <p className="text-sm text-destructive">{loadError}</p>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/dashboard">返回仪表盘</Link></Button>
          <Button onClick={() => void loadWorkflowConfig()}>重试</Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn(
      'flex flex-col bg-background/80 text-foreground',
      embeddedInDashboard ? 'h-full min-h-0 overflow-hidden' : 'h-screen'
    )}>
      {!isDashboardShell ? renderWorkbenchHeader('inline') : null}

      <div className="flex-1 flex overflow-hidden">
        {isRunMode && (
          <div className={cn(styles.runWorkbenchLayout, styles.runDocumentsLayout)}>
            <aside className={styles.runListRail}>
              {renderWorkbenchNavigation()}
            </aside>
            <section className={styles.runMainWorkspace}>
              {showWorkbenchPreview ? renderWorkbenchPreview() : null}
              <div className={cn("flex h-full flex-col overflow-hidden", showWorkbenchPreview && "hidden")}>
                <div className="shrink-0 border-b bg-background px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: 19 }}>account_tree</span>
                        <h2 className="truncate text-base font-semibold">{workflowBaseTitle}</h2>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn(
                            'h-2 w-2 rounded-full',
                            getWorkflowStatusDotClass(workflowStatus, isRunning),
                          )} />
                          {workflowStatus || '准备中'}
                        </span>
                        <span>{formatWorkflowLocation(currentPhase, currentStep, '等待运行事件')}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {runDetailSection !== 'documents' ? (
                        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setRunInspectorPanelOpen(true)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>psychology</span>
                          Agent Intel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
                {renderHumanAttentionBanner()}
                <div className="flex-1 min-h-0 overflow-hidden">
                  {runDetailSection === 'overview' ? (
                    renderRunOverviewPanel()
                  ) : runDetailSection === 'state' ? (
                    renderRunStateMapPanel()
                  ) : runDetailSection === 'agents' ? (
                    renderAgentFormationPanel('run')
                  ) : runDetailSection === 'agora' ? (
                    renderRunAgoraPanel()
                  ) : runDetailSection === 'live' ? (
                    renderRunLiveOutputPanel()
                  ) : runDetailSection === 'documents' && isPromotedLightweightRun && documentSourceFilter === 'tasklist' ? (
                    renderRunStructuredTaskListPanel()
                  ) : runDetailSection === 'documents' ? (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
                      <DocumentsPanel
                        runId={runId || selectedRun?.id || null}
                        focusRequest={documentFocusRequest}
                        documentSource={isRuntimeLightweightWorkflow ? 'tasklist' : documentSourceFilter}
                        lockedDocumentSource={isRuntimeLightweightWorkflow ? 'tasklist' : undefined}
                        onDocumentSourceChange={(source: DocumentSourceFilter) => {
                          if (isRuntimeLightweightWorkflow && source !== 'tasklist') return;
                          setDocumentSourceFilter(source);
                          void updateUrl({ documentSource: source === 'all' ? null : source });
                        }}
                        phaseDefinitions={(runtimeWorkflowConfig?.workflow?.states || []).map((state: any, order: number) => ({
                          name: String(state?.name || ''),
                          label: String(state?.label || state?.title || state?.displayName || ''),
                          order,
                        }))}
                        onOpenWorkspaceDirectory={(path: string) => openWorkspaceEditorAtPath(path, '文档目录')}
                        previewPresentation={isRuntimeLightweightWorkflow ? 'inline' : 'drawer'}
                        lightweightTasklistLayout={isRuntimeLightweightWorkflow}
                      />
                    </div>
                  ) : runDetailSection === 'spec' && runtimeSpecAvailable ? (
                    <div className="h-full min-h-0 overflow-y-auto bg-muted/20 p-4">
                      <div className="mx-auto max-w-5xl space-y-3">
                        {renderPersistedSpecCard()}
                        {renderSpecCodingPanel()}
                      </div>
                    </div>
                  ) : runDetailSection === 'workspace' ? (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 p-4">
                      {currentRunWorkspacePath ? (
                        <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
                          <WorkspaceEditor
                            open
                            onOpenChange={() => {}}
                            workspacePath={workspaceEditorPath || currentRunWorkspacePath}
                            initialFilePath={workspaceEditorFilePath}
                            initialLineNumber={workspaceEditorLineNumber}
                            initialColumn={workspaceEditorColumn}
                            title={workspaceEditorTitle}
                            presentation="page"
                            searchParamsSnapshot={searchParamsString}
                            onFileLocationChange={handleWorkspaceEditorFileLocationChange}
                          />
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/70 p-6 text-center text-sm text-muted-foreground">
                          当前运行还没有可用的工作区目录。
                        </div>
                      )}
                    </div>
                  ) : runDetailSection === 'changes' ? (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 p-4">
                      {currentRunWorkspacePath ? (
                        <GitWorkspaceDiffPanel
                          workspacePath={currentRunWorkspacePath}
                          runId={effectiveGitBaselineEnabled ? (runId || selectedRun?.id || null) : null}
                          isRunning={isRunning}
                          presentation="embedded"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/70 p-6 text-center text-sm text-muted-foreground">
                          {currentRunWorkspacePath ? '当前工作流已关闭 Git 基线与变更追踪。' : '当前运行还没有可用的 Git 工作区。'}
                        </div>
                      )}
                    </div>
                  ) : (
                    renderRunOverviewPanel()
                  )}
                </div>
              </div>
            </section>
            {showWorkbenchPreview && runDetailSection !== 'documents' && !runInspectorPanelOpen ? (
              <Button type="button" variant="outline" size="sm" className="absolute right-4 top-4 z-20 h-8 gap-1.5 bg-background text-xs" onClick={() => setRunInspectorPanelOpen(true)}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>psychology</span>
                Agent Intel
              </Button>
            ) : null}
            <DetailDrawer open={Boolean(overviewStepRecord)} onOpenChange={(open) => {
              if (!open) setOverviewStepRecord(null);
            }}>
              <DetailDrawerContent widthClassName="w-[min(760px,calc(100vw-1rem))]" className={cn(styles.workbenchInspectorDrawer, 'p-0')}>
                <DetailDrawerHeader>
                  <DetailDrawerTitle>{overviewStepRecord?.stepName || '步骤输出'}</DetailDrawerTitle>
                  <DetailDrawerDescription>
                    {[overviewStepRecord?.stateName ? `状态：${formatStateName(overviewStepRecord.stateName)}` : null, overviewStepRecord?.agent ? `Agent：${overviewStepRecord.agent}` : null, overviewStepRecord?.timestamp ? formatRunClockTime(overviewStepRecord.timestamp) : null].filter(Boolean).join(' · ') || '查看该步骤记录的完整输出'}
                  </DetailDrawerDescription>
                </DetailDrawerHeader>
                <DetailDrawerBody className="space-y-4">
                  {overviewStepRecord ? (
                    <>
                      {!isRuntimeLightweightWorkflow ? (
                        <div className="flex justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-xs"
                            onClick={() => openStepRecordInStateDiagram(overviewStepRecord)}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: 16 }}>hub</span>
                            在状态图查看
                          </Button>
                        </div>
                      ) : null}
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">状态</div>
                          <div className="mt-1 text-sm font-semibold">
                            {overviewStepRecord.status === 'completed' ? '完成' : overviewStepRecord.status === 'failed' ? '失败' : overviewStepRecord.status === 'running' ? '运行中' : overviewStepRecord.status || '未知'}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">Agent</div>
                          <div className="mt-1 truncate text-sm font-semibold">{overviewStepRecord.agent || '-'}</div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">耗时</div>
                          <div className="mt-1 text-sm font-semibold">{overviewStepRecord.durationMs ? formatRunDuration(overviewStepRecord.durationMs) : '-'}</div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">Token 消耗</div>
                          <div className="mt-1 text-sm font-semibold">{formatTokenCount(overviewStepTokenUsage.totalTokens)}</div>
                          <div className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            输入 {formatTokenCount(overviewStepTokenUsage.inputTokens)} · 输出 {formatTokenCount(overviewStepTokenUsage.outputTokens)}
                          </div>
                          <div className="text-[11px] leading-5 text-muted-foreground">
                            缓存命中 {formatTokenCount(overviewStepCacheHitTokens)} / {overviewStepCacheHitRatio}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">引擎</div>
                          <div className="mt-1 truncate text-sm font-semibold">{overviewStepRecord.engineName || '-'}</div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">模型</div>
                          <div className="mt-1 truncate text-sm font-semibold">{overviewStepRecord.modelName || '-'}</div>
                        </div>
                        <div className="rounded-lg border bg-background p-3">
                          <div className="text-xs text-muted-foreground">Session</div>
                          <div className="mt-1 truncate font-mono text-xs">{overviewStepRecord.sessionId || '-'}</div>
                        </div>
                      </div>
                      {overviewStepRecord.error ? (
                        <div>
                          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">执行错误</div>
                          <pre className="max-h-[65vh] overflow-auto rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive whitespace-pre-wrap break-words">
                            {overviewStepRecord.error}
                          </pre>
                        </div>
                      ) : (
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">详细对话过程</div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 shrink-0 gap-1.5 text-xs"
                              onClick={() => openPersistedStepRecord({
                                id: overviewStepRecord.id,
                                stepName: overviewStepRecord.stepName,
                                rawStepName: overviewStepRecord.rawStepName,
                                status: overviewStepRecord.status,
                                output: overviewStepRecord.output,
                                error: overviewStepRecord.error,
                              })}
                            >
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>description</span>
                              查看工作总结
                            </Button>
                          </div>
                          {overviewStepExternalOutputLoading && !overviewStepOutput ? (
                            <div className={styles.workbenchEmptyHint}>
                              <div className="flex items-center justify-center gap-2">
                                <ClipLoader size={14} />
                                <span>正在加载详细对话过程...</span>
                              </div>
                            </div>
                          ) : overviewStepOutput ? (
                            <div className={`${styles.markdownContent} max-h-[65vh] overflow-auto rounded-lg border bg-background p-4 text-sm leading-relaxed`}>
                              <AceAwareMarkdown content={prepareChunkForDisplay(overviewStepOutput)} />
                            </div>
                          ) : (
                            <div className={styles.workbenchEmptyHint}>
                              这个步骤还没有记录到详细对话过程。
                            </div>
                          )}
                          <div className="mt-2 text-[11px] text-muted-foreground">
                            工作总结会在独立抽屉中展示重点速览、下载和保存入口。
                          </div>
                        </div>
                      )}
                    </>
                  ) : null}
                </DetailDrawerBody>
              </DetailDrawerContent>
            </DetailDrawer>
            <DetailDrawer open={runInspectorPanelOpen && runDetailSection !== 'documents'} onOpenChange={setRunInspectorPanelOpen}>
              <DetailDrawerContent widthClassName="w-[min(420px,calc(100vw-1rem))]" className={cn(styles.workbenchInspectorDrawer, 'p-0')}>
              {!workflowConfig ? (
                <WorkbenchRunDetailLoadingSkeleton />
              ) : (
              <div className="flex flex-col h-full">
                {(() => {
                  // Resolve the latest iteration key for the selected step
                  const stepKey = selectedStep ? getLatestStepKey(selectedStep.name) : '';
                  const rawStepResult = selectedStep ? stepResults[stepKey] : null;
                  const isCurrentStepRunning = selectedStep && isRunning && (
                    currentStep === selectedStep.name || currentStep?.startsWith(selectedStep.name + '-迭代')
                    || currentStep?.endsWith('-' + selectedStep.name)
                    || activeSteps.some((stepName) =>
                      stepName === selectedStep.name
                      || stepName.startsWith(selectedStep.name + '-迭代')
                      || stepName.endsWith('-' + selectedStep.name)
                    )
                  );
                  // For steps with iteration suffix (e.g. "设计修复方案-迭代2"), also check the base name
                  // in completedSteps/failedSteps even if only a base name is recorded.
                  const stepBaseName = selectedStep?.name.match(/^(.+)-迭代\d+$/)
                    ? selectedStep.name.replace(/-迭代\d+$/, '')
                    : selectedStep?.name;
                  const matchesSelectedStepName = (name: string) => !!selectedStep && (
                    name === selectedStep.name ||
                    (!!stepBaseName && (
                      name === stepBaseName ||
                      name.startsWith(stepBaseName + '-') ||
                      name.endsWith('-' + stepBaseName)
                    ))
                  );
                  const isStepDone = selectedStep && (
                    completedSteps.includes(selectedStep.name) ||
                    (stepBaseName && completedSteps.some(s => s === stepBaseName || s.startsWith(stepBaseName + '-迭代'))) ||
                    !!rawStepResult
                  );
                  const isStepFailed = selectedStep && (
                    failedSteps.includes(selectedStep.name) ||
                    failedSteps.some(matchesSelectedStepName) ||
                    (stepBaseName && failedSteps.some(s => s === stepBaseName || s.startsWith(stepBaseName + '-迭代')))
                  );
                  const shouldShowStepError = !!rawStepResult?.error && !!isStepFailed && !isRunning && workflowStatus !== 'completed';
                  const stepResult = rawStepResult?.error && !shouldShowStepError ? null : rawStepResult;
                  return (<>
                <div className={styles.workbenchInspectorHeader}>
                  <div className="flex min-h-[58px] items-center justify-between gap-2 px-4">
                    <DetailDrawerTitle className="min-w-0 truncate text-sm font-semibold">
                      Agent Intel
                    </DetailDrawerTitle>
                    <Button type="button" variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={() => setRunInspectorPanelOpen(false)} title="关闭 Agent Intel">
                      <span className="material-symbols-outlined" style={{ fontSize: 17 }}>right_panel_close</span>
                    </Button>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto">
                  <div className={styles.workbenchInspectorBody}>
                    <div className={styles.workbenchInspectorHero}>
                      <div className={styles.workbenchInspectorAvatar}>
                        <span className="material-symbols-outlined" style={{ fontSize: 26 }}>psychology</span>
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-lg font-semibold">
                          {selectedAgent?.name || selectedAgentRoleConfig?.name || runtimeSupervisorAgent?.name || 'Agent Intel'}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          {selectedAgent ? 'Agent 资料、提示词和完成步骤记录' : '选择一个 Agent 查看资料'}
                        </div>
                      </div>
                    </div>
                    {selectedAgentRoleConfig?.temperature !== undefined ? (
                      <div className={styles.workbenchInspectorCard}>
                        <div className="flex items-center justify-between gap-2 text-xs">
                          <span className="font-medium text-muted-foreground">Temperature</span>
                          <span className="font-mono">{selectedAgentRoleConfig.temperature}</span>
                        </div>
                        <div className={styles.workbenchInspectorSlider}><span style={{ width: `${Math.max(0, Math.min(100, Number(selectedAgentRoleConfig.temperature) * 100))}%` }} /></div>
                      </div>
                    ) : null}
              {selectedAgent ? (<AgentPanel agent={selectedAgent} logs={logs} onClearLogs={(name) => dispatch({ type: 'CLEAR_AGENT_LOGS', payload: name })}
                stepSummary={undefined}
                persistedStepLogs={persistedStepLogs}
                selectedStepName={null}
                selectedStepExecutionId={null}
                runStatus={workflowStatus}
                runStatusReason={runStatusReason}
                currentStepName={currentStep || null}
                onSelectPersistedStep={selectStepByLogName}
                onOpenPersistedStep={openOverviewStepRecordFromLog}
                systemPrompt={selectedAgentRoleConfig?.systemPrompt}
                iterationPrompt={selectedAgentRoleConfig?.iterationPrompt}
                compact={false} />
              ) : (pageLoading || !workflowConfig ? <WorkbenchAgentDetailSkeleton /> : <div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">smart_toy</span><p>选择一个 Agent 查看详情</p></div>)}
                  </div>
            </div>
                  </>);
                })()}
              </div>
              )}
              </DetailDrawerContent>
            </DetailDrawer>
          </div>
        )}
        {isDesignMode && editingConfig && (<>
          <div className={cn(styles.designWorkbenchLayout, styles.designDrawerLayout)}>
            <aside className={styles.runListRail}>
              {renderWorkbenchNavigation()}
            </aside>
            <section className={styles.designEditorCanvas}>
              {!designAssistantPanelOpen ? (
                <div className="shrink-0 border-b bg-background px-5 py-3">
                  <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setDesignAssistantPanelOpen(true)}>
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }}>right_panel_open</span>
                    打开检查器
                  </Button>
                </div>
              ) : null}
              {hasUnsavedDesignConfigChanges ? (
                <div className="shrink-0 border-b border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="material-symbols-outlined mt-0.5 text-base text-amber-600 dark:text-amber-300">edit_note</span>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-amber-700 dark:text-amber-200">当前有未保存的工作流配置变更</div>
                        <div className="mt-1 text-xs text-amber-700/90 dark:text-amber-200/90">
                          这些修改目前只在草稿里，点击右上角“保存配置”后才会写入工作流 YAML。
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-8 border-amber-500/40 bg-background/85 text-amber-700 hover:bg-background dark:text-amber-200"
                      onClick={handleSaveConfig}
                      disabled={saving}
                    >
                      {saving ? '保存中...' : '保存配置'}
                    </Button>
                  </div>
                </div>
              ) : null}

              {/* Orchestration Tab */}
              {designTab === 'orchestration' && editingConfig?.workflow && (
                <div className="flex h-full flex-col overflow-hidden">
                  <div className="border-b bg-background/80 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">状态、步骤、转移与 Agent 编排</div>
                        <div className="mt-1 text-xs text-muted-foreground">维护当前工作流结构；执行参数统一放在“执行配置”。</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={handleOpenWorkflowOptimization}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_fix_high</span>
                          生成优化建议
                        </Button>
                        {editingPreflightSummary.configuredSteps > 0 ? (
                          <Badge variant="outline" className="text-[10px]">
                            已配置 {editingPreflightSummary.configuredSteps} 个步骤 / {editingPreflightSummary.totalCommands} 条命令
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px]">暂未配置 preflight</Badge>
                        )}
                        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={() => setPreflightManagerOpen(true)}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>fact_check</span>
                          Preflight 校验管理
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
                    <StateMachineDesignPanel
                      states={editingConfig.workflow.states || []}
                      onStatesChange={(states: any) => {
                        const newConfig = JSON.parse(JSON.stringify(editingConfig));
                        newConfig.workflow.states = states;
                        dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
                      }}
                      availableAgents={agentConfigs}
                      availableSkills={availableSkills}
                      specTasks={designOptimizationSpecTaskOptions}
                      onOptimizeState={handleOptimizeStateMachineState}
                      onOptimizeStep={handleOptimizeStateMachineStep}
                      onAgentSkillsChange={handleAgentSkillsChange}
                      protocolAdopted={isStateLevelReviewAdopted(editingConfig)}
                      onAdoptReviewProtocol={(states: any) => {
                        const newConfig = JSON.parse(JSON.stringify(editingConfig));
                        newConfig.workflow.reviewProtocol = 'state-level';
                        newConfig.workflow.states = states;
                        dispatch({ type: 'SET_EDITING_CONFIG', payload: newConfig });
                      }}
                    />
                  </div>
                </div>
              )}

              {designTab === 'spec' && specDesignEnabled && (
                <div className="flex-1 overflow-auto bg-muted/20 p-6">
                  <div className="mx-auto max-w-6xl space-y-4">
                    <div className="rounded-2xl border bg-background/75 p-4">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
                        <div>
                          <h3 className="text-base font-semibold">Spec 绑定与修订</h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            查看 requirements、design、tasks，维护修订候选，并校验任务与当前工作流步骤的绑定关系。
                          </p>
                        </div>
                      </div>
                    </div>

                    {renderSpecCodingPanel({ className: 'space-y-4', summaryOnly: true })}
                  </div>
                </div>
              )}

              {designTab === 'config' && (
                <div className="flex-1 overflow-auto bg-muted/20 p-6">
                  <div className="mx-auto max-w-6xl space-y-4">
                    <div className="rounded-2xl border bg-background/75 p-4">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>settings</span>
                        <div>
                          <h3 className="text-base font-semibold">执行配置</h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            编辑当前工作流运行参数、默认引擎、模型、工作区和执行校验设置。
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-card border rounded-lg shadow-sm">
                      <div className="p-5 border-b">
                        <h3 className="text-base font-semibold">工作流配置</h3>
                        <p className="text-xs text-muted-foreground mt-1">配置工作流运行时的基本参数</p>
                      </div>
                      <div className="p-5 space-y-5">
                        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div>
                              <Label className="text-sm font-medium">引擎与模型</Label>
                              <p className="mt-1 text-xs text-muted-foreground">
                                在这里统一设置当前工作流的默认引擎与模型，并按需覆盖本工作流涉及的 Agent。
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                                <Badge variant="outline">
                                  默认引擎: {engine
                                    ? (getEngineMeta(engine)?.name || engine)
                                    : (globalEngine ? `跟随全局 (${getEngineMeta(globalEngine)?.name || globalEngine})` : '跟随全局')}
                                </Badge>
                                <Badge variant="outline">
                                  默认模型: {workflowDefaultModel ? workflowDefaultModel : (globalDefaultModel ? `跟随全局 (${globalDefaultModel})` : '跟随全局')}
                                </Badge>
                                <Badge variant={workflowAutoCompactOnStepChange ? 'default' : 'outline'}>
                                  步骤级总结: {workflowAutoCompactOnStepChange ? '开启' : '关闭'}
                                </Badge>
                                {isLightweightWorkflow ? (
                                  <Badge variant="secondary">Supervisor: 轻量模式不适用</Badge>
                                ) : (
                                  <Badge variant={workflowSupervisorEnabled ? 'default' : 'outline'}>
                                    Supervisor: {workflowSupervisorEnabled ? '开启' : '关闭'}
                                  </Badge>
                                )}
                                <Badge variant="secondary">
                                  Agent 覆盖: {configuredWorkflowOverrideCount}
                                </Badge>
                              </div>
                            </div>
                            <Button type="button" variant="outline" onClick={() => setExecutionPolicyDialogOpen(true)}>
                              <span className="material-symbols-outlined mr-1 text-sm">tune</span>
                              配置 Agent 引擎与模型
                            </Button>
                          </div>
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

                        <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="material-symbols-outlined text-primary" style={{ fontSize: 17 }}>history</span>
                              <div className="min-w-0">
                                <Label className="text-sm font-medium">Git 基线与变更追踪</Label>
                                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                                  开启后，运行启动时会建立 Git 基线，并记录步骤前后的快照，用于“变更”页差异浏览。关闭后不会建立基线，也不会发起 Git 变更查询或轮询。
                                </p>
                              </div>
                            </div>
                            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
                              <Switch
                                checked={(editingConfig?.context?.gitBaselineEnabled ?? workflowConfig?.context?.gitBaselineEnabled) !== false}
                                onCheckedChange={(checked) => {
                                  const baseConfig = editingConfig || workflowConfig;
                                  if (!baseConfig) return;
                                  dispatch({
                                    type: 'SET_EDITING_CONFIG',
                                    payload: {
                                      ...baseConfig,
                                      context: {
                                        ...(baseConfig.context || {}),
                                        gitBaselineEnabled: checked ? undefined : false,
                                      },
                                    },
                                  });
                                }}
                              />
                              <span className="text-xs text-muted-foreground">
                                {(editingConfig?.context?.gitBaselineEnabled ?? workflowConfig?.context?.gitBaselineEnabled) === false ? '关闭' : '开启'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {editingConfig?.workflow?.mode === 'state-machine' ? (
                          <div className="rounded-xl border border-border/60 bg-muted/20 p-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                              <div className="flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary" style={{ fontSize: 17 }}>support_agent</span>
                                <div>
                                  <Label className="text-sm font-medium">步骤内人工答疑</Label>
                                  <p className="mt-1 text-xs text-muted-foreground">允许步骤内 AI 向人类发起求助类提问</p>
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-background px-3 py-2">
                                <Switch
                                  checked={editingConfig.workflow?.humanHelp?.enabled === true}
                                  onCheckedChange={(checked) => {
                                    const baseConfig = editingConfig || workflowConfig;
                                    if (!baseConfig?.workflow) return;
                                    dispatch({
                                      type: 'SET_EDITING_CONFIG',
                                      payload: {
                                        ...baseConfig,
                                        workflow: {
                                          ...baseConfig.workflow,
                                          humanHelp: {
                                            ...(baseConfig.workflow as any).humanHelp,
                                            enabled: checked,
                                          },
                                        },
                                      },
                                    });
                                  }}
                                />
                                <span className="text-xs text-muted-foreground">
                                  {editingConfig.workflow?.humanHelp?.enabled === true ? '开启' : '关闭'}
                                </span>
                              </div>
                            </div>
                          </div>
                        ) : null}

                        <div>
                          <Label className="text-sm font-medium">工作流描述</Label>
                          <Textarea
                            value={editingConfig?.workflow?.description ?? workflowConfig?.workflow?.description ?? ''}
                            onChange={(e) => {
                              const baseConfig = editingConfig || workflowConfig;
                              if (!baseConfig?.workflow) return;
                              dispatch({
                                type: 'SET_EDITING_CONFIG',
                                payload: {
                                  ...baseConfig,
                                  workflow: {
                                    ...baseConfig.workflow,
                                    description: e.target.value,
                                  },
                                },
                              });
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
                            value={timeoutMinutesInput}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setTimeoutMinutesInput(nextValue);
                              if (nextValue === '') return;
                              const parsedValue = Number.parseInt(nextValue, 10);
                              if (Number.isFinite(parsedValue)) {
                                dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: Math.max(1, parsedValue) });
                              }
                            }}
                            onBlur={() => {
                              const parsedValue = Number.parseInt(timeoutMinutesInput, 10);
                              const nextValue = Number.isFinite(parsedValue) ? Math.max(1, parsedValue) : Math.max(1, timeoutMinutes || 30);
                              setTimeoutMinutesInput(String(nextValue));
                              dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: nextValue });
                            }}
                            type="number"
                            min={1}
                            className="mt-2"
                          />
                          <p className="text-xs text-muted-foreground mt-1.5">每个步骤的最大执行时间</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">最大转移次数</Label>
                          <Input
                            value={maxTransitionsInput}
                            onChange={(e) => {
                              const nextValue = e.target.value;
                              setMaxTransitionsInput(nextValue);
                              if (nextValue === '') return;
                              const baseConfig = editingConfig || workflowConfig;
                              if (!baseConfig?.workflow) return;
                              const parsedValue = Number.parseInt(nextValue, 10);
                              if (!Number.isFinite(parsedValue)) return;
                              const val = Math.max(1, Math.min(200, parsedValue));
                              dispatch({
                                type: 'SET_EDITING_CONFIG',
                                payload: {
                                  ...baseConfig,
                                  workflow: {
                                    ...baseConfig.workflow,
                                    maxTransitions: val,
                                  },
                                },
                              });
                            }}
                            onBlur={() => {
                              const baseConfig = editingConfig || workflowConfig;
                              if (!baseConfig?.workflow) {
                                setMaxTransitionsInput(String(maxTransitionsValue));
                                return;
                              }
                              const parsedValue = Number.parseInt(maxTransitionsInput, 10);
                              const val = Number.isFinite(parsedValue)
                                ? Math.max(1, Math.min(200, parsedValue))
                                : Math.max(1, Math.min(200, maxTransitionsValue || 50));
                              setMaxTransitionsInput(String(val));
                              dispatch({
                                type: 'SET_EDITING_CONFIG',
                                payload: {
                                  ...baseConfig,
                                  workflow: {
                                    ...baseConfig.workflow,
                                    maxTransitions: val,
                                  },
                                },
                              });
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

                        <div>
                          <Label className="text-sm font-medium">MCP Servers</Label>
                          <div className="mt-2">
                            <MultiCombobox
                              value={mcpServers}
                              onValueChange={(value) => dispatch({ type: 'SET_MCP_SERVERS', payload: value })}
                              options={availableMcpServers.map((server) => ({
                                value: server.name,
                                label: server.name,
                                description: server.command,
                              }))}
                              placeholder={availableMcpServers.length > 0 ? '选择 MCP Servers...' : '当前没有可用 MCP Servers'}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">选择工作流运行时默认启用的 MCP Servers</p>
                        </div>

                        <div>
                          <Label className="text-sm font-medium">RAG 知识库</Label>
                          <div className="mt-2">
                            <MultiCombobox
                              value={ragKnowledgeBases}
                              onValueChange={handleWorkflowRagKnowledgeBasesChange}
                              options={availableKnowledgeBases.map((kb) => ({
                                value: kb.id,
                                label: kb.name || kb.id,
                                description: [kb.description, `Chunks ${kb.chunkCount ?? 0}`].filter(Boolean).join(' · '),
                              }))}
                              placeholder={availableKnowledgeBases.length > 0 ? '选择工作流可授权的 RAG 知识库...' : '当前没有可用 RAG 知识库'}
                            />
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">选择后运行时会自动启用 aceharness-rag，并授权 Agent 检索这些知识库</p>
                        </div>
                      </div>
                      <div className="p-5 border-t bg-muted/30 flex justify-end">
                        <Button className="bg-green-600 hover:bg-green-700 text-white" onClick={handleSaveConfig} disabled={saving}>
                          {saving ? <ClipLoader color="currentColor" size={14} className="mr-2" /> : <span className="material-symbols-outlined text-sm mr-2">save</span>}
                          {saving ? '保存中...' : '保存配置'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}            </section>
            <DetailDrawer open={designAssistantPanelOpen} onOpenChange={setDesignAssistantPanelOpen}>
              <DetailDrawerContent widthClassName="w-[min(420px,calc(100vw-1rem))]" className={cn(styles.workbenchInspectorDrawer, 'p-0')}>
              <div className={styles.workbenchInspectorHeader}>
                <div className="flex min-h-[58px] items-center justify-between gap-2 px-4">
                  <DetailDrawerTitle className="min-w-0 truncate text-sm font-semibold">Agent Intel</DetailDrawerTitle>
                  <Button type="button" variant="outline" size="sm" className="h-8 w-8 shrink-0 p-0" onClick={() => setDesignAssistantPanelOpen(false)} title="关闭 Agent Intel">
                    <span className="material-symbols-outlined" style={{ fontSize: 18 }}>right_panel_close</span>
                  </Button>
                </div>
              </div>
              <div className={styles.workbenchInspectorBody}>
                <div className={styles.workbenchInspectorHero}>
                  <div className={styles.workbenchInspectorAvatar}>
                    <span className="material-symbols-outlined" style={{ fontSize: 26 }}>psychology</span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-lg font-semibold">{editingConfig.workflow.name || configFile}</div>
                    <div className="mt-1 text-xs leading-5 text-muted-foreground">设计态检查器</div>
                  </div>
                </div>
                <div className={styles.workbenchInspectorCard}>
                  <div className="text-xs font-medium text-muted-foreground">当前对象</div>
                  <div className="mt-2 text-lg font-semibold">{editingConfig.workflow.name || configFile}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {isLightweightWorkflowConfig(editingConfig)
                      ? '轻量工作流 · 任务清单执行'
                      : `状态机工作流 · ${totalSteps} 步`}
                  </div>
                </div>
                <div className={styles.workbenchInspectorCard}>
                  <div className="text-xs font-medium text-muted-foreground">配置</div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg border bg-background px-2 py-2">
                      <div className="text-muted-foreground">模式</div>
                      <div className="mt-1 font-semibold">{isLightweightWorkflowConfig(editingConfig) ? '轻量工作流' : '状态机'}</div>
                    </div>
                    <div className="rounded-lg border bg-background px-2 py-2">
                      <div className="text-muted-foreground">{isLightweightWorkflowConfig(editingConfig) ? '执行方式' : '步骤'}</div>
                      <div className="mt-1 font-semibold">{isLightweightWorkflowConfig(editingConfig) ? '任务清单' : totalSteps}</div>
                    </div>
                  </div>
                </div>
                <div className={styles.workbenchInspectorCard}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">AI 优化</div>
                    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={handleOpenWorkflowOptimization}>
                      生成优化建议
                    </Button>
                  </div>
                  <div className="mt-2 text-xs leading-5 text-muted-foreground">
                    根据当前编排提供可审查的调整建议，确认后应用到草稿。
                  </div>
                </div>
                <div className={styles.workbenchInspectorCard}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium text-muted-foreground">校验建议</div>
                    <Badge variant="outline" className="text-[10px]">
                      {(designSpecBindingValidation?.errors.length || 0) + (designSpecBindingValidation?.warnings.length || 0)} 项
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                    {designSpecBindingValidation && [...designSpecBindingValidation.errors, ...designSpecBindingValidation.warnings].length ? (
                      [...designSpecBindingValidation.errors, ...designSpecBindingValidation.warnings].slice(0, 3).map((message, index) => (
                        <div key={`inspector-validation-${index}`}>{message}</div>
                      ))
                    ) : (
                      <div>当前结构校验状态良好。</div>
                    )}
                  </div>
                  <Button type="button" variant="outline" size="sm" className="mt-3 h-8 w-full text-xs" onClick={() => setPreflightManagerOpen(true)}>
                    打开校验管理
                  </Button>
                </div>
              </div>
              </DetailDrawerContent>
            </DetailDrawer>
          </div>
        </>)}
      </div>

      <Dialog open={showProcessPanel} onOpenChange={(open) => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: open })}>
        <DialogContent className="h-[80vh] w-[90vw] max-w-[1200px] overflow-hidden p-0">
          <DialogTitle className="sr-only">流程面板</DialogTitle>
          <ProcessPanel onClose={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: false })} />
        </DialogContent>
      </Dialog>
      <WorkflowPreflightManagerDialog
        open={preflightManagerOpen}
        onOpenChange={setPreflightManagerOpen}
        workflow={editingConfig?.workflow}
        onSave={(workflow) => {
          if (!editingConfig) return;
          const nextConfig = JSON.parse(JSON.stringify(editingConfig));
          nextConfig.workflow = workflow;
          dispatch({ type: 'SET_EDITING_CONFIG', payload: nextConfig });
        }}
      />
      {false && showLiveStream && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={stopLiveStream}>
          <div className={`bg-card rounded-lg border flex min-h-0 flex-col ${liveStreamFullscreen ? 'w-full h-full rounded-none' : 'h-[80vh] w-[80%] max-w-[800px]'}`} onClick={(e) => e.stopPropagation()}>
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
            <div ref={liveStreamScrollRef} className="min-h-0 flex-1 overflow-auto p-5" onScroll={(e) => {
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
                        if (feedbackContent) streamFeedbackMessages.add(feedbackContent);
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
                    const rawFilteredItems = items.filter(it => {
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
                    const filteredItems: Item[] = [];
                    let pendingChunkItems: Array<{ type: 'chunk'; content: string; index: number }> = [];
                    const flushPendingChunkItems = () => {
                      if (!pendingChunkItems.length) return;
                      filteredItems.push(...mergeAceSubtaskChunkItems(mergeAceProcessChunkItems(pendingChunkItems, CHUNK_SEP), CHUNK_SEP));
                      pendingChunkItems = [];
                    };
                    for (const rawItem of rawFilteredItems) {
                      if (rawItem.type === 'chunk') {
                        const chunkItem = rawItem as Extract<Item, { type: 'chunk' }>;
                        pendingChunkItems.push({ type: 'chunk', content: chunkItem.content, index: chunkItem.index });
                      } else {
                        flushPendingChunkItems();
                        filteredItems.push(rawItem);
                      }
                    }
                    flushPendingChunkItems();
                    const hasMore = filteredItems.length > liveStreamVisibleCount;
                    const visibleItems = hasMore ? filteredItems.slice(filteredItems.length - liveStreamVisibleCount) : filteredItems;
                    return (<>
                      {hasMore && (
                        <div className="flex justify-center pb-3 pt-1">
                          <button
                            className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:border-foreground/20 hover:bg-muted/50 hover:text-foreground"
                            onClick={() => setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE)}
                          >
                            加载更早的 {filteredItems.length - liveStreamVisibleCount} 条内容
                          </button>
                        </div>
                      )}
                      {visibleItems.slice(-40).map((item, i) => {
                      if (item.type === 'feedback') {
                        return (
                          <div key={`fb-${i}`} className="flex justify-end group">
                            <div className="bg-primary/15 border border-primary/30 rounded-lg px-3 py-2 max-w-[80%] relative">
                              <div className="text-[10px] text-muted-foreground mb-0.5 text-right font-mono flex items-center justify-end gap-1">
                                {new Date(item.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                {isRunning && (
                                  <button
                                    onClick={() => recallFeedback(item.message)}
                                    className="rounded text-destructive opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
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
                <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} className={styles.liveMarkdownContent} />
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
            <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} className={styles.liveMarkdownContent} />
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
            <div className="border-t p-3">
              <div className="flex gap-2">
                <Textarea
                  ref={liveStreamFeedbackRef}
                  defaultValue=""
                  onKeyDown={(event) => {
                    const nativeEvent = event.nativeEvent as KeyboardEvent;
                    const isComposing = nativeEvent.isComposing || event.keyCode === 229;
                    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
                      event.preventDefault();
                      void sendLiveFeedback();
                    }
                  }}
                  placeholder="输入反馈意见..."
                  rows={2}
                  className="min-h-[44px] flex-1 resize-none"
                  disabled={sendingFeedback}
                />
                <Button size="sm" onClick={() => sendLiveFeedback()} disabled={sendingFeedback} title="发送反馈（等待当前执行完成后处理）">
                  <span className="material-symbols-outlined text-sm">send</span>
                </Button>
                <Button size="sm" variant="destructive" onClick={() => sendLiveFeedback(true)} disabled={sendingFeedback} title="打断当前执行，立即处理反馈">
                  <span className="material-symbols-outlined text-sm">bolt</span>
                </Button>
              </div>
              <div className="mt-1 px-1 text-[10px] text-muted-foreground">Shift+Enter 换行</div>
            </div>
          </div>
        </div>
      )}
      <Dialog open={specDesignEnabled && specCodingModalOpen} onOpenChange={(open) => {
        setSpecCodingModalOpen(open);
        if (!open) setSpecCodingModalFullscreen(false);
      }}>
        <DialogContent className={`p-0 flex flex-col gap-0 ${specCodingModalFullscreen ? 'max-w-none w-screen h-screen rounded-none' : 'max-w-5xl w-[90vw] h-[80vh]'}`}>
          <DialogTitle className="sr-only">SpecCoding 文件管理器</DialogTitle>
          {renderSpecCodingExplorer()}
        </DialogContent>
      </Dialog>
      <Dialog
        open={designOptimizationDialogOpen}
        onOpenChange={(open) => {
          if (open) setDesignOptimizationDialogOpen(true);
        }}
      >
        <DialogContent
          className="max-w-5xl w-[94vw] h-[86vh] overflow-hidden p-0"
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogTitle className="sr-only">
            {designOptimizationTarget ? getDesignOptimizationDialogTitle(designOptimizationTarget) : 'AI 工作流优化'}
          </DialogTitle>
          {designOptimizationTarget ? (
            <div className="flex h-full min-w-0 flex-col overflow-hidden">
              <div className="min-w-0 border-b px-6 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base font-semibold">{getDesignOptimizationDialogTitle(designOptimizationTarget)}</div>
                    <div className="mt-1 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {getDesignOptimizationTargetLabel(designOptimizationTarget)} · {getDesignOptimizationScopeHint(designOptimizationTarget)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {designOptimizationTarget.workflowMode}
                    </Badge>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={handleCloseDesignOptimizationDialog}
                      aria-label="关闭 AI 工作流优化窗口"
                      title="关闭"
                    >
                      <span className="material-symbols-outlined text-[18px] leading-none">close</span>
                    </Button>
                  </div>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
                <div className="flex min-h-0 min-w-0 flex-col border-b bg-muted/10 lg:border-b-0 lg:border-r">
                  <div className="shrink-0 border-b px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">当前选择的优化建议</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          根据当前编排提供可审查的调整建议，确认后应用到草稿。
                        </div>
                      </div>
                      {designOptimizationGenerating ? (
                        <Badge variant="secondary" className="text-[10px]">生成中</Badge>
                      ) : designOptimizationSessionId ? (
                        <Badge variant="outline" className="text-[10px]">多轮</Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="home-chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
                    <div className="space-y-4">
                      {designOptimizationMessages.length ? (
                        designOptimizationMessages.map((message) => (
                          <div
                            key={message.id}
                            className={cn(
                              'group flex min-w-0',
                              message.role === 'user' ? 'justify-end' : 'items-start gap-2'
                            )}
                          >
                            {message.role === 'assistant' ? <RobotLogo size={28} className="mt-1 shrink-0" /> : null}
                            <div className={cn('min-w-0 space-y-1', message.role === 'user' ? 'max-w-[86%]' : 'max-w-[92%]')}>
                              <div
                                className={cn(
                                  'min-w-0 rounded-2xl px-4 py-2.5 text-sm shadow-sm',
                                  message.role === 'user'
                                    ? 'home-chat-bubble home-chat-bubble-user rounded-tr-sm text-primary-foreground'
                                    : 'home-chat-bubble home-chat-bubble-assistant rounded-tl-sm',
                                  message.status === 'failed' ? 'border border-red-500/30 bg-red-500/8 text-red-700 dark:text-red-300' : ''
                                )}
                              >
                                <div className="mb-1 flex items-center justify-between gap-2 text-[10px] opacity-70">
                                  <span>{message.role === 'user' ? '你' : 'AI'}</span>
                                  {message.status === 'streaming' ? <span>生成中</span> : null}
                                  {message.status === 'failed' ? <span>失败</span> : null}
                                </div>
                                {message.content.trim() ? (
                                  <div className={`${styles.markdownContent} min-w-0 break-words text-sm [overflow-wrap:anywhere] [&_code]:whitespace-pre-wrap [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap`}>
                                    <AceAwareMarkdown content={message.content} isStreaming={message.status === 'streaming'} />
                                  </div>
                                ) : (
                                  <div className="text-xs text-muted-foreground">等待 AI 输出...</div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="flex h-full min-h-[260px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                          <RobotLogo size={56} className="mb-3" />
                          <div className="font-medium text-foreground">描述当前选择需要优化的内容</div>
                          <div className="mt-1 max-w-sm text-xs leading-5">
                            右侧会展示基线与建议差异，确认后再应用到草稿。
                          </div>
                        </div>
                      )}
                      {designOptimizationGenerating ? (
                        <div className={styles.thinkingBot} aria-live="polite">
                          <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
                          <Shimmer as="span" className={styles.thinkingText}>AI 正在生成优化建议</Shimmer>
                          <span className={styles.thinkingDots}><span>.</span><span>.</span><span>.</span></span>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="shrink-0 border-t bg-background px-4 py-3">
                    <div className="home-chat-composer relative overflow-hidden rounded-[22px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
                      <Textarea
                        value={designOptimizationInstruction}
                        onChange={(event) => setDesignOptimizationInstruction(event.target.value)}
                        rows={3}
                        className="min-h-[92px] resize-none border-0 bg-transparent px-4 py-3 text-sm leading-6 shadow-none focus-visible:ring-0"
                        placeholder={designOptimizationSessionId
                          ? '继续说明要怎么调整当前候选...'
                          : specDesignEnabled
                            ? '例如：优化该步骤的 agent 选择和提示词，并补齐 spec task 绑定'
                            : '例如：优化该步骤的 agent 选择、提示词和完成标准'}
                        disabled={designOptimizationGenerating}
                      />
                      <div className="flex items-center justify-between gap-2 border-t px-3 py-2">
                        <Button
                          type="button"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => {
                            setDesignOptimizationCandidate(null);
                            setDesignOptimizationStream('');
                            setDesignOptimizationMessages([]);
                            setDesignOptimizationSessionId(null);
                            setDesignOptimizationInstruction(buildDefaultDesignOptimizationInstruction(designOptimizationTarget));
                          }}
                          disabled={designOptimizationGenerating}
                        >
                          重置
                        </Button>
                        <Button
                          type="button"
                          className="h-8 text-xs"
                          onClick={() => void handleGenerateDesignOptimization()}
                          disabled={designOptimizationGenerating || !designOptimizationInstruction.trim()}
                        >
                          {designOptimizationGenerating ? <ClipLoader color="currentColor" size={12} className="mr-2" /> : null}
                          {designOptimizationSessionId ? '发送调整' : '生成优化建议'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-col bg-background">
                  <div className="shrink-0 border-b px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">基线 / 当前建议差异</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {designOptimizationCandidate
                            ? `${new Date(designOptimizationCandidate.createdAt).toLocaleString()} · 先看差异，再应用到当前草稿`
                            : `等待 AI 生成 ${getDesignOptimizationTargetLabel(designOptimizationTarget)} 的优化建议`}
                        </div>
                      </div>
                      {designOptimizationCandidate ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={handleDiscardDesignOptimizationCandidate}
                          >
                            放弃建议
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            className="h-8 text-xs"
                            onClick={handleApplyDesignOptimizationCandidate}
                            disabled={
                              designOptimizationValidationErrors.length > 0
                              || (designOptimizationCandidate.bindingValidation?.errors.length || 0) > 0
                            }
                          >
                            应用建议
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 overflow-auto p-4">
                    {designOptimizationCandidate ? (
                      <div className="min-w-0 space-y-4">
                        <div className="min-w-0 rounded-lg border border-primary/25 bg-primary/5 p-3">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                            <Badge variant="secondary" className="text-[10px]">AI 建议</Badge>
                            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{designOptimizationCandidate.summary}</span>
                          </div>
                        </div>

                        <div className="grid min-w-0 grid-cols-2 gap-2 xl:grid-cols-4">
                          <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">配置错误</div>
                            <div className="mt-1 text-lg font-semibold text-red-600">{designOptimizationValidationErrors.length}</div>
                          </div>
                          <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">配置警告</div>
                            <div className="mt-1 text-lg font-semibold text-amber-600">{designOptimizationValidationWarnings.length}</div>
                          </div>
                          <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">绑定错误</div>
                            <div className="mt-1 text-lg font-semibold text-red-600">{designOptimizationCandidate.bindingValidation?.errors.length || 0}</div>
                          </div>
                          <div className="min-w-0 rounded-lg border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">绑定警告</div>
                            <div className="mt-1 text-lg font-semibold text-amber-600">{designOptimizationCandidate.bindingValidation?.warnings.length || 0}</div>
                          </div>
                        </div>

                        {designOptimizationValidationErrors.length > 0 ? (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3">
                            <div className="text-sm font-medium text-red-600">配置校验错误</div>
                            <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                              {designOptimizationValidationErrors.map((issue, index) => (
                                <div key={`design-opt-validation-error-${index}`}>
                                  {issue.path?.length ? `${issue.path.join('.')}：` : ''}{issue.message || '未知错误'}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {designOptimizationValidationWarnings.length > 0 ? (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
                            <div className="text-sm font-medium text-amber-700 dark:text-amber-300">配置校验警告</div>
                            <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                              {designOptimizationValidationWarnings.map((issue, index) => (
                                <div key={`design-opt-validation-warning-${index}`}>
                                  {issue.path?.length ? `${issue.path.join('.')}：` : ''}{issue.message || '未知提示'}
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {designOptimizationCandidate.bindingValidation?.errors.length ? (
                          <div className="rounded-lg border border-red-500/30 bg-red-500/8 p-3">
                            <div className="text-sm font-medium text-red-600">Spec 绑定错误</div>
                            <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                              {designOptimizationCandidate.bindingValidation.errors.map((message, index) => (
                                <div key={`design-opt-binding-error-${index}`}>{message}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        {designOptimizationCandidate.bindingValidation?.warnings.length ? (
                          <div className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3">
                            <div className="text-sm font-medium text-amber-700 dark:text-amber-300">Spec 绑定警告</div>
                            <div className="mt-2 space-y-1 break-words text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                              {designOptimizationCandidate.bindingValidation.warnings.map((message, index) => (
                                <div key={`design-opt-binding-warning-${index}`}>{message}</div>
                              ))}
                            </div>
                          </div>
                        ) : null}

                        <div className="min-w-0 overflow-hidden rounded-lg border">
                          <div className="border-b px-4 py-3">
                            <div className="text-sm font-medium">建议差异</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">
                              当前展示的是 {getDesignOptimizationTargetLabel(designOptimizationTarget)} 的前后 JSON 对比。
                            </div>
                          </div>
                          <div className="max-h-[54vh] min-w-0 overflow-auto p-4 font-mono text-xs leading-6">
                            {designOptimizationDiffRows.length ? (
                              designOptimizationDiffRows.map((row, index) => (
                                <div
                                  key={`${row.type}-${index}`}
                                  className={
                                    row.type === 'add'
                                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                      : row.type === 'remove'
                                        ? 'bg-red-500/10 text-red-700 dark:text-red-300'
                                        : 'text-muted-foreground'
                                  }
                                >
                                  <span className="mr-2 inline-block w-4 text-center align-top">
                                    {row.type === 'add' ? '+' : row.type === 'remove' ? '-' : ' '}
                                  </span>
                                  <span className="whitespace-pre-wrap break-all [overflow-wrap:anywhere]">{row.text || ' '}</span>
                                </div>
                              ))
                            ) : (
                              <div className="text-muted-foreground">没有差异。</div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed bg-muted/10 p-8 text-center">
                        <span className="material-symbols-outlined mb-3 text-3xl text-muted-foreground">difference</span>
                        <div className="text-sm font-medium">右侧将展示基线和优化建议的差异</div>
                        <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                          左侧发送第一条优化要求后，AI 生成的建议会出现在这里。后续多轮调整会更新当前建议。
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={specDesignEnabled && !!specBindingReview} onOpenChange={(open) => !open && setSpecBindingReview(null)}>
        <DialogContent className="max-w-3xl w-[92vw] max-h-[85vh] overflow-hidden p-0">
          <DialogTitle className="sr-only">task 绑定检查</DialogTitle>
          {specBindingReview ? (
            <div className="flex max-h-[85vh] flex-col">
              <div className="border-b px-6 py-4">
                <div className="text-base font-semibold">tasks.md 与工作流绑定检查</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  刚保存的 tasks.md 已重新解析。下面是当前工作流 step 与 task 的联动检查结果。
                </div>
              </div>
              <div className="flex-1 overflow-auto px-6 py-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[10px] text-muted-foreground">错误</div>
                    <div className="mt-1 text-lg font-semibold text-red-600">{specBindingReview.validation.errors.length}</div>
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[10px] text-muted-foreground">警告</div>
                    <div className="mt-1 text-lg font-semibold text-amber-600">{specBindingReview.validation.warnings.length}</div>
                  </div>
                  <div className="rounded-xl border bg-muted/20 p-3">
                    <div className="text-[10px] text-muted-foreground">未覆盖任务</div>
                    <div className="mt-1 text-lg font-semibold">{specBindingReview.validation.uncoveredTaskIds.length}</div>
                  </div>
                </div>

                {specBindingReview.validation.errors.length > 0 ? (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/8 p-4">
                    <div className="text-sm font-medium text-red-600">需要处理的问题</div>
                    <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      {specBindingReview.validation.errors.map((message, index) => (
                        <div key={`binding-error-${index}`}>{message}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {specBindingReview.validation.warnings.length > 0 ? (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 p-4">
                    <div className="text-sm font-medium text-amber-700 dark:text-amber-300">需要确认的联动提示</div>
                    <div className="mt-2 space-y-1 text-xs leading-5 text-muted-foreground">
                      {specBindingReview.validation.warnings.map((message, index) => (
                        <div key={`binding-warning-${index}`}>{message}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-xl border">
                  <div className="border-b px-4 py-3 text-sm font-medium">step 到 task 的绑定预览</div>
                  <div className="divide-y">
                    {specBindingReview.validation.bindings.map((binding) => (
                      <div key={binding.stepKey} className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-medium text-foreground">{binding.containerName} / {binding.stepName}</div>
                            <div className="mt-1 text-[11px] text-muted-foreground">{binding.agent || '未设置 Agent'}</div>
                          </div>
                          <Badge variant={binding.source === 'explicit' ? 'secondary' : 'outline'} className="text-[10px]">
                            {binding.source === 'explicit'
                              ? '显式绑定'
                              : binding.source === 'auto-title'
                                ? '按标题推断'
                                : binding.source === 'auto-index'
                                  ? '按顺序推断'
                                  : binding.source === 'auto-container'
                                    ? '按容器推断'
                                    : '未绑定'}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {binding.taskIds.length > 0 ? binding.taskIds.map((taskId) => (
                            <Badge key={`${binding.stepKey}-${taskId}`} variant="outline" className="text-[10px]">
                              {taskId}
                            </Badge>
                          )) : (
                            <span className="text-[11px] text-muted-foreground">当前没有匹配到 task</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="border-t px-6 py-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  一键应用会把系统能推断出的 task 绑定写入当前工作流草稿，你仍需要保存工作流配置。
                </div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="outline" onClick={() => setSpecBindingReview(null)}>
                    稍后处理
                  </Button>
                  <Button type="button" onClick={applySuggestedSpecTaskBindings}>
                    应用系统建议绑定
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
      <Dialog open={executionPolicyDialogOpen} onOpenChange={setExecutionPolicyDialogOpen}>
        <DialogContent className="max-w-4xl w-[92vw] max-h-[85vh] overflow-hidden p-0">
          <ComboboxPortalProvider>
            <DialogTitle className="sr-only">工作流引擎与模型</DialogTitle>
            <div className="flex max-h-[85vh] flex-col">
              <div className="border-b px-6 py-4">
                <div className="text-base font-semibold">工作流引擎与模型</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  为当前工作流设置默认引擎和模型，并仅对本工作流涉及的 Agent 做局部覆盖。
                </div>
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  点击“保存并应用”会立即写入当前工作流 YAML，并用于后续运行。
                </div>
              </div>
              <div className="flex-1 overflow-auto px-6 py-5 space-y-6">
                <section className="space-y-4">
                  <div>
                    <div className="text-sm font-medium">工作流默认策略</div>
                    <div className="mt-1 text-xs text-muted-foreground">未单独配置的 Agent 会直接继承这里。</div>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label className="text-sm font-medium">默认引擎</Label>
                      <div className="mt-2">
                        <EngineSelect
                          value={engine}
                          onChange={(value) => dispatch({ type: 'SET_ENGINE', payload: value })}
                          allowGlobal
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm font-medium">默认模型</Label>
                      <div className="mt-2">
                        <ModelSelect
                          value={workflowDefaultModel}
                          onChange={setWorkflowDefaultModel}
                          engine={engine || globalEngine}
                          allowGlobal
                          showChangeToast={false}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <Label htmlFor="workflow-auto-compact-on-step-change" className="text-sm font-medium">
                          步骤级自动上下文总结
                        </Label>
                        <div className="text-xs text-muted-foreground">
                          模型上下文较小时建议勾选。启用后，进入新的步骤时，如果该 Agent 之前已经执行过，系统会先自动压缩其上下文，再继续当前步骤。
                        </div>
                      </div>
                      <Switch
                        id="workflow-auto-compact-on-step-change"
                        checked={workflowAutoCompactOnStepChange}
                        onCheckedChange={setWorkflowAutoCompactOnStepChange}
                      />
                    </div>
                  </div>
                  {!isLightweightWorkflow ? (
                    <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <Label htmlFor="workflow-supervisor-enabled" className="text-sm font-medium">
                            Supervisor 阶段审阅
                          </Label>
                          <div className="text-xs text-muted-foreground">
                            默认关闭。启用后，每个状态执行结束时由 Supervisor 追加一次阶段审阅，人工审批前再追加一次检查点建议。
                            实测每次约 30–60 秒，一条 6 状态的工作流会多花 7–8 分钟。
                          </div>
                        </div>
                        <Switch
                          id="workflow-supervisor-enabled"
                          checked={workflowSupervisorEnabled}
                          onCheckedChange={setWorkflowSupervisorEnabled}
                        />
                      </div>
                    </div>
                  ) : null}
                </section>

                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">当前工作流 Agent 覆盖</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        只列出本工作流实际会用到的 Agent。默认继承工作流策略，只有例外才需要单独配置。
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setWorkflowAgentOverrides({})}
                      disabled={configuredWorkflowOverrideCount === 0}
                    >
                      全部恢复继承
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {workflowAgentNames.map((agentName) => {
                      const override = workflowAgentOverrides[agentName] || { enabled: false };
                      const roleConfig = agentConfigs.find((role: any) => role.name === agentName);
                      const effectiveEngine = override.enabled
                        ? (override.engine || engine || globalEngine)
                        : (engine || globalEngine);
                      return (
                        <div key={agentName} className="rounded-xl border border-border/60 bg-background/70 p-4">
                          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_180px_minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
                            <div>
                              <div className="text-sm font-medium">{agentName}</div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {(roleConfig?.team || 'blue')} · {roleConfig?.roleType || 'normal'}
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">策略模式</Label>
                              <Select
                                value={override.enabled ? 'custom' : 'inherit'}
                                onValueChange={(value) => {
                                  setWorkflowAgentOverrides((prev) => ({
                                    ...prev,
                                    [agentName]: value === 'custom'
                                      ? {
                                          enabled: true,
                                          engine: prev[agentName]?.engine || engine || globalEngine || undefined,
                                          model: prev[agentName]?.model || workflowDefaultModel || globalDefaultModel || undefined,
                                        }
                                      : { enabled: false },
                                  }));
                                }}
                              >
                                <SelectTrigger className="mt-2">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="inherit">继承工作流</SelectItem>
                                  <SelectItem value="custom">单独配置</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">引擎</Label>
                              <div className="mt-2">
                                <EngineSelect
                                  value={override.enabled ? (override.engine || '') : ''}
                                  onChange={(value) => setWorkflowAgentOverrides((prev) => ({
                                    ...prev,
                                    [agentName]: {
                                      ...(prev[agentName] || { enabled: true }),
                                      enabled: true,
                                      engine: value || undefined,
                                      model: prev[agentName]?.model || workflowDefaultModel || globalDefaultModel || undefined,
                                    },
                                  }))}
                                  allowGlobal={false}
                                />
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs font-medium text-muted-foreground">模型</Label>
                              <div className="mt-2">
                                <ModelSelect
                                  value={override.enabled ? (override.model || '') : ''}
                                  onChange={(value) => setWorkflowAgentOverrides((prev) => ({
                                    ...prev,
                                    [agentName]: {
                                      ...(prev[agentName] || { enabled: true }),
                                      enabled: true,
                                      engine: prev[agentName]?.engine || engine || globalEngine || undefined,
                                      model: value || undefined,
                                    },
                                  }))}
                                  engine={effectiveEngine}
                                  showChangeToast={false}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
              <div className="border-t px-6 py-4 flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setExecutionPolicyDialogOpen(false)} disabled={saving}>
                  关闭
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    if (await handleSaveConfig()) setExecutionPolicyDialogOpen(false);
                  }}
                  disabled={saving || !editingConfig}
                >
                  {saving ? '保存中...' : '保存并应用'}
                </Button>
              </div>
            </div>
          </ComboboxPortalProvider>
        </DialogContent>
      </Dialog>

      <Dialog open={specMergeDialogOpen} onOpenChange={setSpecMergeDialogOpen}>
        <DialogContent className="max-w-5xl w-[90vw] h-[80vh] p-0 flex flex-col gap-0">
          <div className="border-b px-4 py-3">
            <DialogTitle className="text-base font-semibold">合入 Master Spec</DialogTitle>
            <div className="mt-1 text-xs text-muted-foreground">
              AI 会根据 Delta Spec 生成合并候选，确认前不会写入 master spec.md。
            </div>
          </div>
          <div className="flex-1 overflow-hidden p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px]">
                  {getSpecMergeStatusLabel(specMergePreview?.mergeState.status || deltaMergeState?.status)}
                </Badge>
                {specMergePreview?.mergeState.mergedHash ? (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    mergedHash: {specMergePreview.mergeState.mergedHash.slice(0, 12)}...
                  </span>
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => void handlePreviewSpecMerge(true)}
                disabled={specMergeLoading || specMergeApplying}
              >
                {specMergeLoading ? <ClipLoader color="currentColor" size={12} className="mr-2" /> : null}
                重新生成预览
              </Button>
            </div>
            {specMergePreview?.aiSummary ? (
              <div className="rounded-xl border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
                {specMergePreview.aiSummary}
              </div>
            ) : null}
            {specMergeError ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs leading-5 text-destructive">
                {specMergeError}
              </div>
            ) : null}
            <div className="h-[calc(100%-7rem)] min-h-[260px] overflow-auto rounded-xl border bg-muted/20 p-3">
              {specMergeLoading ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <ClipLoader color="currentColor" size={16} className="mr-2" />
                  正在生成合并候选...
                </div>
              ) : specMergePreview?.diff ? (
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-foreground">
                  {specMergePreview.diff}
                </pre>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  暂无 diff。请生成预览。
                </div>
              )}
            </div>
          </div>
          <div className="border-t px-4 py-3 flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={() => setSpecMergeDialogOpen(false)} disabled={specMergeApplying}>
              取消
            </Button>
            <Button
              onClick={handleApplySpecMerge}
              disabled={specMergeLoading || specMergeApplying || !specMergePreview?.mergeState.mergedHash}
            >
              {specMergeApplying ? <ClipLoader color="currentColor" size={14} className="mr-2" /> : null}
              确认合入
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPromptAnalysis} onOpenChange={setShowPromptAnalysis}>
        <DialogContent className="max-w-6xl w-[94vw] h-[88vh] p-0 flex flex-col gap-0">
          <div className="border-b px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <DialogTitle className="text-base font-semibold">运行分析</DialogTitle>
                <div className="mt-1 text-xs text-muted-foreground">
                  基于实际 step 输出、token 消耗、重试情况和会话复用情况做运行分析。
                </div>
              </div>
              {analysisSummary ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline">步骤 {analysisSummary.totalSteps}</Badge>
                  <Badge variant="outline">平均分 {analysisSummary.avgScore}</Badge>
                  <Badge variant="outline">总 Token {Number(analysisSummary.totalTokens || 0).toLocaleString()}</Badge>
                  <Badge variant="outline">重试步骤 {analysisSummary.distinctRepeatedSteps || 0}</Badge>
                  <Badge variant="outline">失败步骤 {analysisSummary.failedSteps || 0}</Badge>
                  <Badge variant="outline">已选优化 {selectedOptimizations.size}</Badge>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-6 py-4">
            {analyzingRunId ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                <ClipLoader color="currentColor" size={18} className="mr-3" />
                正在分析运行 {analyzingRunId}...
              </div>
            ) : analysisResults.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-xl border border-dashed px-6 py-8 text-center text-sm text-muted-foreground">
                  当前运行没有可分析的提示词日志。
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {analysisSummary ? (
                  <div className="grid gap-4 lg:grid-cols-4">
                    <div className="rounded-xl border bg-background/70 p-4">
                      <div className="text-xs text-muted-foreground">增量输入 Token</div>
                      <div className="mt-2 text-lg font-semibold">{Number(analysisSummary.totalInputTokens || 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl border bg-background/70 p-4">
                      <div className="text-xs text-muted-foreground">增量输出 Token</div>
                      <div className="mt-2 text-lg font-semibold">{Number(analysisSummary.totalOutputTokens || 0).toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl border bg-background/70 p-4">
                      <div className="text-xs text-muted-foreground">会话数</div>
                      <div className="mt-2 text-lg font-semibold">{analysisSummary.sessionCount || 0}</div>
                    </div>
                    <div className="rounded-xl border bg-background/70 p-4">
                      <div className="text-xs text-muted-foreground">引擎</div>
                      <div className="mt-2 text-sm font-semibold break-words">{(analysisSummary.engineNames || []).join(', ') || '未记录'}</div>
                    </div>
                  </div>
                ) : null}

                {analysisSummary?.findings?.length ? (
                  <div className="rounded-xl border bg-muted/20 p-4">
                    <div className="text-xs font-medium text-muted-foreground">运行结论</div>
                    <div className="mt-2 space-y-1">
                      {analysisSummary.findings.map((item: string, itemIndex: number) => (
                        <div key={`finding-${itemIndex}`} className="text-xs leading-5">{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysisResults.map((result, index) => {
                  const score = result.analysis?.score || 0;
                  const optimizedPrompt = result.analysis?.optimizedPrompt || '';
                  const metrics = result.metrics || {};
                  return (
                    <div key={`${result.agentName || 'agent'}-${result.stepName || 'step'}-${index}`} className="rounded-xl border bg-background/70 p-4 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{result.stepName || `步骤 ${index + 1}`}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{result.agentName || '未知 Agent'}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge variant="outline">状态 {metrics.status || 'unknown'}</Badge>
                            <Badge variant="outline">尝试 {metrics.attemptIndex || 1}/{metrics.totalAttempts || 1}</Badge>
                            <Badge variant="outline">增量 Token {Number(metrics.incrementalTotalTokens || 0).toLocaleString()}</Badge>
                            {metrics.engineName ? <Badge variant="outline">{metrics.engineName}</Badge> : null}
                            {metrics.reusedSession ? <Badge variant="secondary">复用会话</Badge> : null}
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          {optimizedPrompt ? (
                            <label className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Checkbox
                                checked={selectedOptimizations.has(index)}
                                onCheckedChange={(checked) => toggleOptimizationSelection(index, checked)}
                              />
                              应用优化
                            </label>
                          ) : null}
                          <Badge
                            className={
                              score >= 85
                                ? 'bg-emerald-500/15 text-emerald-600 border border-emerald-500/30'
                                : score >= 70
                                  ? 'bg-amber-500/15 text-amber-600 border border-amber-500/30'
                                  : 'bg-red-500/15 text-red-600 border border-red-500/30'
                            }
                          >
                            评分 {score}
                          </Badge>
                        </div>
                      </div>

                      {result.analysis?.summary ? (
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">分析摘要</div>
                          <div className="mt-2 text-xs leading-5">{result.analysis.summary}</div>
                        </div>
                      ) : null}

                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">增量输入</div>
                          <div className="mt-2 text-sm font-semibold">{Number(metrics.incrementalInputTokens || 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">增量输出</div>
                          <div className="mt-2 text-sm font-semibold">{Number(metrics.incrementalOutputTokens || 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">累计 Token</div>
                          <div className="mt-2 text-sm font-semibold">{Number(metrics.cumulativeTotalTokens || 0).toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">输出字符</div>
                          <div className="mt-2 text-sm font-semibold">{Number(metrics.outputChars || 0).toLocaleString()}</div>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">优点</div>
                          <div className="mt-2 space-y-1">
                            {(result.analysis?.strengths || []).length > 0 ? (
                              result.analysis.strengths.map((item: string, itemIndex: number) => (
                                <div key={`strength-${itemIndex}`} className="text-xs leading-5">{item}</div>
                              ))
                            ) : (
                              <div className="text-xs text-muted-foreground">暂无</div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">问题</div>
                          <div className="mt-2 space-y-1">
                            {(result.analysis?.weaknesses || []).length > 0 ? (
                              result.analysis.weaknesses.map((item: string, itemIndex: number) => (
                                <div key={`weakness-${itemIndex}`} className="text-xs leading-5">{item}</div>
                              ))
                            ) : (
                              <div className="text-xs text-muted-foreground">暂无</div>
                            )}
                          </div>
                        </div>
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="text-xs font-medium text-muted-foreground">建议</div>
                          <div className="mt-2 space-y-1">
                            {(result.analysis?.suggestions || []).length > 0 ? (
                              result.analysis.suggestions.map((item: string, itemIndex: number) => (
                                <div key={`suggestion-${itemIndex}`} className="text-xs leading-5">{item}</div>
                              ))
                            ) : (
                              <div className="text-xs text-muted-foreground">暂无</div>
                            )}
                          </div>
                        </div>
                      </div>

                      {optimizedPrompt ? (
                        <div className="rounded-lg border bg-muted/20 p-3">
                          <div className="mb-2 text-xs font-medium text-muted-foreground">优化后 Prompt</div>
                          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-foreground">
                            {optimizedPrompt}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t px-6 py-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowPromptAnalysis(false)}>
              关闭
            </Button>
            <Button
              onClick={handleApplyOptimizations}
              disabled={applyingOptimization || selectedOptimizations.size === 0}
            >
              {applyingOptimization ? <ClipLoader color="currentColor" size={14} className="mr-2" /> : null}
              应用所选优化
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
      <NewConfigModal
        isOpen={creationDraftModalOpen}
        onClose={() => {
          setCreationDraftModalOpen(false);
          setResumeCreationDraftId(null);
          void loadCreationDrafts();
        }}
        onSuccess={(filename) => {
          setCreationDraftModalOpen(false);
          setResumeCreationDraftId(null);
          void loadCreationDrafts();
          if (filename) {
            if (embeddedInDashboard && dockWorkspace) {
              dockWorkspace.openTab({
                id: `workbench:${filename}:design:`,
                title: filename,
                kind: 'workbench',
                config: filename,
                mode: 'design',
                search: 'mode=design',
              });
              return;
            }
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }
        }}
        resumeCreationSessionId={resumeCreationDraftId}
        initialMode="lightweight"
        initialWorkflowName={workflowConfig?.workflow?.name || ''}
        initialReferenceWorkflow={configFile}
        initialDescription={requirements || workflowConfig?.workflow?.description || ''}
        initialWorkingDirectory={resolvedProjectRoot || ''}
        initialWorkspaceMode={workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}
      />
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

      <Dialog
        open={showStartWorkflowDialog && Boolean(pendingStartRequest)}
        onOpenChange={(open) => {
          if (open) return;
          if (pendingStartReviewPlanId) void workflowApi.discardStartPlan(pendingStartReviewPlanId).catch(() => {});
          setPendingStartReviewPlanId(null);
          setShowStartWorkflowDialog(false);
          setPendingStartRequest(null);
        }}
      >
        <DialogContent className="w-fit max-w-[96vw] overflow-visible border-0 bg-transparent p-0 shadow-none" overlayClassName="bg-foreground/10">
          {pendingStartRequest ? (
            <ContextWorkspaceDialog
              title={pendingStartRequest.mode === 'rehearsal' ? '设置演练上下文' : '设置启动上下文'}
              description={`补齐本次运行的全局背景和${startContextScopeLabel}约束；确认后会直接带着这些上下文进入${pendingStartRequest.mode === 'rehearsal' ? '演练' : '启动'}流程。`}
              modeLabel={
                pendingStartRequest.mode === 'rehearsal'
                  ? '演练'
                  : pendingStartRequest.skipPreflight
                    ? '跳过检查'
                    : '正式启动'
              }
              globalDraft={startGlobalContextDraft}
              phaseDrafts={startPhaseContextDrafts}
              taskInputDraft={startTaskInputDraft}
              taskInputEditable
              taskInputFields={workflowTaskInputFields}
              workingDirectoryDraft={startWorkingDirectoryDraft}
              workingDirectoryEditable
              footerText={pendingStartRequest.preflightPreview?.commands?.length
                ? '先补齐本次启动上下文，再在下一步确认检查命令并启动。'
                : '留空的项会沿用当前已保存内容；这里只覆盖你本次确认后提交的文本。'}
              actionLabel={pendingStartRequest.preflightPreview?.commands?.length
                ? (pendingStartRequest.mode === 'rehearsal' ? '执行检查并开始演练' : '执行检查并直接启动')
                : (pendingStartRequest.mode === 'rehearsal' ? '保存上下文并开始演练' : pendingStartRequest.skipPreflight ? '保存上下文并直接启动' : '保存上下文并启动')}
              actionBusyLabel="启动中..."
              actionBusy={starting}
              actionDisabled={starting}
              preflightPreview={pendingStartRequest.preflightPreview}
              startContextTargets={startContextTargets}
              startContextScopeLabel={startContextScopeLabel}
              projectRoot={resolvedProjectRoot || projectRoot}
              runReviewPlanning={workflowConfig?.workflow?.mode === 'state-machine' ? {
                configFile,
                rehearsal: pendingStartRequest.mode === 'rehearsal',
                baselineIntent: inferBaselineAdversarialIntent(workflowConfig),
              } : undefined}
              onReviewPlanIdChange={setPendingStartReviewPlanId}
              onCancel={() => {
                setPendingStartReviewPlanId(null);
                setShowStartWorkflowDialog(false);
                setPendingStartRequest(null);
              }}
              onSkipPreflight={
                pendingStartRequest.mode === 'real' && (Boolean(pendingStartRequest.skipPreflight) || Boolean(pendingStartRequest.preflightPreview?.commands?.length))
                  ? (contexts, review) => confirmStartWorkflow(contexts, review, 'skip')
                  : undefined
              }
              onConfirm={(contexts, review) => confirmStartWorkflow(contexts, review, pendingStartRequest.skipPreflight ? 'skip' : 'run')}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={showContextEditor} onOpenChange={setShowContextEditor}>
        <DialogContent className="w-fit max-w-[96vw] overflow-visible border-0 bg-transparent p-0 shadow-none" overlayClassName="bg-foreground/10">
          {showContextEditor ? (
            <ContextWorkspaceDialog
              title="上下文工作台"
              description={`统一编辑全局上下文和${startContextScopeLabel}上下文。保存后会立即更新当前 run 的 prompt 注入内容。`}
              modeLabel="运行中可修改"
              globalDraft={contextEditorGlobalDraft}
              phaseDrafts={contextEditorPhaseDrafts}
              workingDirectoryDraft={currentRunWorkspacePath || projectRoot}
              workingDirectoryEditable={false}
              footerText="保存会逐项更新当前运行上下文，后续步骤会按新内容继续执行。"
              actionLabel="保存"
              actionBusyLabel="保存中..."
              actionBusy={savingContextEditor}
              actionDisabled={savingContextEditor}
              startContextTargets={startContextTargets}
              startContextScopeLabel={startContextScopeLabel}
              projectRoot={projectRoot}
              onCancel={() => setShowContextEditor(false)}
              onConfirm={saveContext}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!selectedSubworkflowRun} onOpenChange={(open) => { if (!open) setSelectedSubworkflowRun(null); }}>
        <DialogContent className="max-w-3xl w-[94vw] max-h-[86vh] overflow-hidden p-0">
          <div className="flex max-h-[86vh] flex-col">
            <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <span className="material-symbols-outlined text-cyan-600">account_tree</span>
                  子工作流执行视图
                </DialogTitle>
                <DialogDescription className="mt-1">
                  在父流程内查看 child run 的当前状态和摘要。
                </DialogDescription>
              </div>
              {selectedSubworkflowRun ? (
                <Badge variant={
                  selectedSubworkflowRun.status === 'failed' || selectedSubworkflowRun.status === 'crashed'
                    ? 'destructive'
                    : selectedSubworkflowRun.status === 'completed'
                      ? 'default'
                      : 'secondary'
                }>
                  {selectedSubworkflowRun.status || 'unknown'}
                </Badge>
              ) : null}
            </div>
            {selectedSubworkflowRun ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Child Run</div>
                    <div className="mt-1 break-all text-sm font-medium">{selectedSubworkflowRun.runId}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">Config</div>
                    <div className="mt-1 break-all text-sm font-medium">{selectedSubworkflowRun.configFile}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">父状态</div>
                    <div className="mt-1 text-sm font-medium">{selectedSubworkflowRun.parentStateName || '-'}</div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="text-xs text-muted-foreground">父步骤</div>
                    <div className="mt-1 text-sm font-medium">{selectedSubworkflowRun.parentStepName || '-'}</div>
                  </div>
                </div>
                <div className="mt-4 rounded-lg border bg-background p-4">
                  <div className="mb-2 text-sm font-medium">运行摘要</div>
                  <div className="max-h-[38vh] overflow-y-auto whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {selectedSubworkflowRun.summary || '暂无 child run 摘要。'}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button variant="outline" onClick={() => setSelectedSubworkflowRun(null)}>关闭</Button>
              <Button onClick={() => openSubworkflowRunPage(selectedSubworkflowRun)}>
                打开完整工作台
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!forceTransitionModal} onOpenChange={(open) => { if (!open) setForceTransitionModal(null); }}>
        <DialogContent className="w-[min(600px,92vw)] p-0">
          {forceTransitionModal ? (
            <div className="flex flex-col">
              <div className="border-b px-5 py-4">
                <DialogTitle className="flex items-center gap-2 text-lg">
                  <span className="material-symbols-outlined text-amber-600" style={{ fontSize: 18 }}>alt_route</span>
                  {forceTransitionActionLabel}到: {forceTransitionModal.targetState}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {isRunning ? '可选：为 AI 提供跳转指令' : '该运行会从已结束状态恢复为执行中，并从目标状态继续执行。可选填写恢复指令。'}
                </DialogDescription>
              </div>

              <div className="px-5 py-4">
                <Textarea
                  value={forceTransitionModal.instruction}
                  onChange={(e) => setForceTransitionModal({ ...forceTransitionModal, instruction: e.target.value })}
                  placeholder="输入给 AI 的指令，例如：重点关注性能问题，忽略代码风格..."
                  rows={4}
                  className="w-full"
                />
                <p className="mt-2 text-xs text-muted-foreground">
                  此指令会记录到状态跳转历史中，帮助后续审计恢复原因
                </p>
              </div>

              <div className="flex justify-end gap-2 border-t px-5 py-4">
                <Button variant="outline" onClick={() => setForceTransitionModal(null)} disabled={forceTransitioning}>取消</Button>
                <Button variant="destructive" onClick={executeForceTransition} disabled={forceTransitioning}>
                  {forceTransitioning ? <ClipLoader color="currentColor" size={14} className="mr-1" /> : <span className="material-symbols-outlined text-sm mr-1">check</span>}
                  {forceTransitioning ? (isRunning ? '跳转中...' : '恢复中...') : (isRunning ? '确认跳转' : '确认恢复')}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

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
                        {check.commands?.length > 0 ? (
                          <div className="mt-3 space-y-2">
                            {check.commands.map((command, commandIndex) => (
                              <div key={`${check.id}-command-${commandIndex}`} className="rounded-md border bg-background/80 p-2">
                                <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                                  <span>命令结果</span>
                                  <span>状态: {formatQualityCheckStatus(command.status)}</span>
                                  <span>退出码: {command.exitCode ?? '无'}</span>
                                </div>
                                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/40 p-2 text-[11px] leading-5 text-foreground">
                                  {formatQualityCommandResult(command)}
                                </pre>
                              </div>
                            ))}
                          </div>
                        ) : null}
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
                  requestStartWorkflow('real', {
                    skipPreflight: true,
                    preflightChecks: preflightChecks.length > 0 ? preflightChecks : displayQualityChecks.filter((check) => check.stateName === '__preflight__'),
                  });
                }}
                disabled={!canStartWorkflow}
              >
                基于演练结果正式启动
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rehearsalProgressDialogOpen} onOpenChange={setRehearsalProgressDialogOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          <div className="flex flex-col">
            <div className="border-b px-6 py-4">
              <DialogTitle className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">pending_actions</span>
                {startupProgressMode === 'rehearsal' ? '演练进行中' : '正式启动中'}
              </DialogTitle>
              <div className="mt-1 text-xs text-muted-foreground">
                {startupProgressMode === 'rehearsal'
                  ? '正在执行演练模式，下面会显示当前启动与执行阶段。'
                  : '正在执行正式启动流程，下面会显示当前检查与启动阶段。'}
              </div>
            </div>
            <div className="px-6 py-4 space-y-3">
              {rehearsalProgressSteps.map((item, index) => (
                <div key={`${index}-${item}`} className="flex items-start gap-3 rounded-lg border bg-muted/20 px-3 py-2">
                  <span className={`material-symbols-outlined mt-0.5 text-sm ${index === rehearsalProgressSteps.length - 1 && starting ? 'animate-spin text-primary' : 'text-emerald-500'}`}>
                    {index === rehearsalProgressSteps.length - 1 && starting ? 'progress_activity' : 'check_circle'}
                  </span>
                  <div className="text-sm text-foreground leading-6">{normalizeStartupProgressLabel(item)}</div>
                </div>
              ))}
              {rehearsalProgressSteps.length === 0 ? (
                <div className="rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
                  {startupProgressMode === 'rehearsal' ? '正在准备演练...' : '正在准备正式启动...'}
                </div>
              ) : null}
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-2">
              {starting ? (
                <>
                  <Button variant="outline" onClick={() => setRehearsalProgressDialogOpen(false)}>
                    后台继续
                  </Button>
                  <Button variant="destructive" onClick={() => void requestCancelStartup()} disabled={startupCancelRequested}>
                    {startupCancelRequested ? '取消中...' : '取消启动'}
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setRehearsalProgressDialogOpen(false)}>
                  关闭
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={stopProgressDialogOpen} onOpenChange={setStopProgressDialogOpen}>
        <DialogContent className="sm:max-w-lg p-0 overflow-hidden">
          <div className="flex flex-col">
            <div className="border-b px-6 py-4">
              <DialogTitle className="flex items-center gap-2">
                <span className={cn('material-symbols-outlined', stopping ? 'animate-spin text-primary' : stopProgressSteps.some((step) => step.status === 'failed') ? 'text-red-500' : 'text-emerald-500')}>
                  {stopping ? 'progress_activity' : stopProgressSteps.some((step) => step.status === 'failed') ? 'error' : 'check_circle'}
                </span>
                停止工作流
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {stopProgressSummary || '正在停止运行实例并清理运行资源。'}
              </DialogDescription>
            </div>
            <div className="space-y-3 px-6 py-4">
              <Progress
                value={Math.round((stopProgressSteps.filter((step) => step.status === 'success' || step.status === 'skipped').length / Math.max(stopProgressSteps.length, 1)) * 100)}
                className="h-2"
              />
              <div className="space-y-2">
                {stopProgressSteps.map((step) => {
                  const icon = step.status === 'running'
                    ? 'progress_activity'
                    : step.status === 'success'
                      ? 'check_circle'
                      : step.status === 'failed'
                        ? 'error'
                        : step.status === 'skipped'
                          ? 'remove_circle'
                          : 'radio_button_unchecked';
                  const tone = step.status === 'running'
                    ? 'animate-spin text-primary'
                    : step.status === 'success'
                      ? 'text-emerald-500'
                      : step.status === 'failed'
                        ? 'text-red-500'
                        : 'text-muted-foreground';
                  return (
                    <div key={step.id} className="rounded-lg border bg-muted/20 px-3 py-2">
                      <div className="flex items-start gap-3">
                        <span className={cn('material-symbols-outlined mt-0.5 text-sm', tone)}>{icon}</span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-foreground">{step.label}</div>
                            {typeof step.durationMs === 'number' ? (
                              <div className="shrink-0 text-[11px] text-muted-foreground">{step.durationMs}ms</div>
                            ) : null}
                          </div>
                          {step.detail ? (
                            <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">{step.detail}</div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t px-6 py-4">
              <Button variant="outline" onClick={() => setStopProgressDialogOpen(false)}>
                {stopping ? '后台继续' : '关闭'}
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
    </div>
  );
}
