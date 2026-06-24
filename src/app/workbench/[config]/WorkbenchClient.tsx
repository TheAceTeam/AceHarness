'use client';

import dynamic from 'next/dynamic';
import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTheme } from 'next-themes';
import type { RichTextEditorHandle } from '@/components/ui/RichTextEditor';
import { ClipLoader } from 'react-spinners';
import BrandLoadingScreen from '@/components/BrandLoadingScreen';
import { configApi, workflowApi, agentApi, runsApi, processApi, streamApi, workspaceApi, specCodingApi, type GitBrowserSummaryResponse, type NotebookScope } from '@/lib/core/api';
import { useWorkflowState } from '@/hooks/useWorkflowState';
import type { ViewMode } from '@/hooks/useWorkflowState';
import FlowDiagram from '@/components/FlowDiagram';
import StateMachineExecutionView from '@/components/StateMachineExecutionView';
import AgentFormationDiagram from '@/components/AgentFormationDiagram';
import AgentPanel from '@/components/AgentPanel';
import AgentConfigPanel from '@/components/AgentConfigPanel';
import AIAgentCreatorModal from '@/components/AIAgentCreatorModal';
import NewConfigModal from '@/components/NewConfigModal';
import EditNodeModal from '@/components/EditNodeModal';
import WorkflowPreflightManagerDialog from '@/components/WorkflowPreflightManagerDialog';
import { AgentHeroCard } from '@/components/agent/AgentHeroCard';
import Markdown from '@/components/Markdown';
import ResizablePanels from '@/components/ResizablePanels';
import { Button } from '@/components/ui/button';
import SpriteAvatar from '@/components/SpriteAvatar';
import { Badge } from '@/components/ui/badge';
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
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { EngineSelect } from '@/components/EngineSelect';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import WorkspaceDirectoryPicker from '@/components/common/WorkspaceDirectoryPicker';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { useDashboardDockWorkspace } from '@/components/dashboard/DashboardDockWorkspace';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useAttentionSignal } from '@/hooks/useAttentionSignal';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { WrapperProcessBlocks } from '@/components/chat/ChatMessage';
import { RobotLogo } from '@/components/brand/RobotLogo';
import { Shimmer } from '@/components/ai-elements/shimmer';
import WorkflowSupervisorAgoraPanel from '@/components/workflow/WorkflowSupervisorAgoraPanel';
import { resolveWorkflowAgentSelection, resolveWorkflowExecutionPolicy } from '@/lib/agent/engine-selection';
import { compileStepTaskBindings, type StepTaskBindingValidation } from '@/lib/spec/task-binding';
import { getStreamingAceProcessReadyContent, mergeAceSubtaskChunkItems, mergeAceSubtaskChunks } from '@/lib/chat/ai-process-blocks';
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
  buildWorkflowDesignConfigForSave,
  hasWorkflowDesignDraftChanges,
  type WorkflowDesignDraftState,
} from '@/lib/workflow/design-config-draft';
import type { TasksMarkdownValidationIssue } from '@/lib/spec/coding-store';
import {
  buildWorkflowConversationDirectory,
} from '@/lib/agent/conversations';
import { getEngineMeta } from '@/lib/core/engine-metadata';
import { createInitialAgentDraft, type AgentDraftState } from '@/lib/agent/draft';
import { resolveAgentAvatarSrc } from '@/lib/agent/personas';
import type { ManagedMcpServer } from '@/lib/mcp/types';
import type {
  DeltaMergeState,
  HumanQuestion,
  HumanQuestionAnswer,
  WorkflowSpecRevisionVoteRecord,
} from '@/lib/run/state-persistence';
import type { WorkflowAgentExecutionOverride } from '@/lib/core/schemas';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';
import { GitWorkspaceDiffPanel } from '@/components/workflow/GitWorkspaceDiffPanel';
import { cn } from '@/lib/core/utils';
import { createSafeEventSource } from '@/lib/core/safe-event-source';
import { resolveWorkspaceLinkTarget } from '@/lib/workspace/link-target';
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
const StateMachineDiagram = dynamic(() => import('@/components/StateMachineDiagram'), {
  ssr: false,
  loading: () => designTabLoadingPanel('正在加载状态图...'),
});
const StateMachineDesignPanel = dynamic(() => import('@/components/StateMachineDesignPanel'), {
  ssr: false,
  loading: () => designTabLoadingPanel('正在加载状态机编排...'),
});
const DesignPanel = dynamic(() => import('@/components/DesignPanel'), {
  ssr: false,
  loading: () => designTabLoadingPanel('正在加载流程编排...'),
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
type RunWorkbenchTab = 'execution' | 'workspace' | 'changes';

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

function countGitWorkingTreeFiles(summary?: GitBrowserSummaryResponse | null): number {
  if (!summary?.available) return 0;
  const changed = new Set<string>();
  for (const file of summary.workingTree.unstaged || []) changed.add(file.path);
  for (const file of summary.workingTree.staged || []) changed.add(file.path);
  for (const file of summary.workingTree.untracked || []) changed.add(file.path);
  return changed.size;
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
          <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-2xl border bg-background/80 p-4 space-y-4">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="h-[220px] w-full rounded-xl" />
            </div>
            <div className="rounded-2xl border bg-background/80 p-4 space-y-3">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-2 gap-3">
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
                <Skeleton className="h-16 w-full rounded-xl" />
              </div>
            </div>
          </div>
        </div>
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
  if (searchParams.get('changes') === '1') return 'changes';
  if (searchParams.get('workspace') === '1') return 'workspace';
  return 'execution';
}

function toRelativeWorkspaceFilePath(workspacePath: string, filePath?: string | null): string | null {
  const normalizedWorkspace = String(workspacePath || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  const normalizedFile = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalizedWorkspace || !normalizedFile) return null;
  const normalizedAbsoluteFile = String(filePath || '').replace(/\\/g, '/');
  if (normalizedAbsoluteFile === normalizedWorkspace) return null;
  if (isAbsoluteProjectPath(normalizedAbsoluteFile)) {
    if (!normalizedAbsoluteFile.startsWith(`${normalizedWorkspace}/`)) return null;
    return normalizedAbsoluteFile.slice(normalizedWorkspace.length + 1) || null;
  }
  return normalizedFile || null;
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
};

type ContextWorkspaceDialogProps = {
  title: string;
  description: string;
  modeLabel: string;
  globalDraft: string;
  phaseDrafts: Record<string, string>;
  focusTarget: string;
  onFocusTargetChange: (value: string) => void;
  footerText: string;
  actionLabel: string;
  actionBusyLabel: string;
  actionBusy?: boolean;
  actionDisabled?: boolean;
  preflightPreview?: Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null;
  startContextTargets: string[];
  startContextScopeLabel: string;
  projectRoot?: string;
  onCancel: () => void;
  onSkipPreflight?: (contexts: WorkflowStartContexts) => void;
  onConfirm: (contexts: WorkflowStartContexts) => void;
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

function computeSimpleDiff(base: string, next: string): Array<{ type: 'same' | 'add' | 'remove'; text: string }> {
  const baseLines = base.split('\n');
  const nextLines = next.split('\n');
  const rows: Array<{ type: 'same' | 'add' | 'remove'; text: string }> = [];
  const max = Math.max(baseLines.length, nextLines.length);
  for (let index = 0; index < max; index += 1) {
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
      : 'AI 修订 Spec 制品',
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
  const inputTokens = typeof source?.inputTokens === 'number' ? source.inputTokens : 0;
  const outputTokens = typeof source?.outputTokens === 'number' ? source.outputTokens : 0;
  const cacheCreationInputTokens = typeof source?.cacheCreationInputTokens === 'number' ? source.cacheCreationInputTokens : 0;
  const cacheReadInputTokens = typeof source?.cacheReadInputTokens === 'number' ? source.cacheReadInputTokens : 0;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens: inputTokens + outputTokens + cacheCreationInputTokens + cacheReadInputTokens,
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

function AceAwareMarkdown({
  content,
  isStreaming = false,
  className = '',
}: {
  content: string;
  isStreaming?: boolean;
  className?: string;
}) {
  const prepared = isStreaming
    ? getStreamingAceProcessReadyContent(content)
    : String(content || '');
  if (prepared.includes('<ace-process>')) {
    return (
      <div className={className}>
        <WrapperProcessBlocks content={prepared} isStreaming={isStreaming} />
      </div>
    );
  }
  return (
    <div className={className}>
      <Markdown>{prepared}</Markdown>
    </div>
  );
}

function ContextWorkspaceDialog(props: ContextWorkspaceDialogProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'global' | 'state'>('state');
  const startupFlowEnabled = (props.preflightPreview?.commands?.length || 0) > 0;
  const [startupStep, setStartupStep] = useState<'context' | 'preflight'>('context');
  const [localGlobalDraft, setLocalGlobalDraft] = useState(props.globalDraft);
  const [localPhaseDrafts, setLocalPhaseDrafts] = useState<Record<string, string>>(props.phaseDrafts);
  const [localFocusTarget, setLocalFocusTarget] = useState(props.focusTarget || props.startContextTargets[0] || '');
  const filledCount = props.startContextTargets.filter((name) => (localPhaseDrafts[name] || '').trim().length > 0).length;
  const coverage = props.startContextTargets.length > 0 ? Math.round((filledCount / props.startContextTargets.length) * 100) : 0;
  const currentTarget = localFocusTarget || props.startContextTargets[0] || '';
  const currentTargetValue = currentTarget ? (localPhaseDrafts[currentTarget] || '') : '';
  const previewCommands = props.preflightPreview?.commands || [];
  const workflowCommandCount = previewCommands.filter((item) => item.origin === 'workflow').length;
  const inferredCommandCount = previewCommands.filter((item) => item.origin === 'inferred').length;

  useEffect(() => {
    setLocalGlobalDraft(props.globalDraft);
  }, [props.globalDraft]);

  useEffect(() => {
    setLocalPhaseDrafts(props.phaseDrafts);
  }, [props.phaseDrafts]);

  useEffect(() => {
    setLocalFocusTarget(props.focusTarget || props.startContextTargets[0] || '');
  }, [props.focusTarget, props.startContextTargets]);

  useEffect(() => {
    setStartupStep('context');
  }, [startupFlowEnabled, props.preflightPreview]);

  return (
    <div className="flex max-h-[92vh] w-[1120px] max-w-full flex-col overflow-hidden rounded-2xl border border-border/70 bg-background shadow-2xl sm:rounded-3xl">
      <div className="shrink-0 border-b border-border/70 bg-muted/20 px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-sm">
                <span className="material-symbols-outlined text-[22px]">tune</span>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{props.title}</h3>
                <p className="mt-1 max-w-[720px] text-sm leading-6 text-muted-foreground">{props.description}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="h-6 rounded-full px-2.5 text-[10px]">全局 1 项</Badge>
            <Badge variant="outline" className="h-6 rounded-full px-2.5 text-[10px]">
              {props.startContextScopeLabel} {props.startContextTargets.length} 项
            </Badge>
            <Badge variant="secondary" className="h-6 rounded-full px-2.5 text-[10px]">{props.modeLabel}</Badge>
          </div>
        </div>

        {startupFlowEnabled ? (
          <div className="mt-5 flex items-center gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${startupStep === 'context' ? 'border-primary bg-primary text-primary-foreground' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'}`}>
                  1
                </div>
                <div className="text-sm font-medium">填写上下文</div>
              </div>
              <div className="h-px w-8 bg-border" />
              <div className="flex items-center gap-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold ${startupStep === 'preflight' ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background text-muted-foreground'}`}>
                  2
                </div>
                <div className="text-sm font-medium">确认检查并启动</div>
              </div>
            </div>
          </div>
        ) : null}

        {startupStep === 'context' ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Global</div>
              <div className="mt-1 text-sm font-semibold">共享背景</div>
              <div className="mt-1 text-xs text-muted-foreground">影响所有步骤的全局约束</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{props.startContextScopeLabel}</div>
              <div className="mt-1 text-sm font-semibold">局部注入</div>
              <div className="mt-1 text-xs text-muted-foreground">只进入对应节点的 prompt</div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Coverage</div>
              <div className="mt-1 text-sm font-semibold">{filledCount}/{props.startContextTargets.length || 0} 已填写</div>
              <div className="mt-2"><Progress value={coverage} className="h-1.5" /></div>
            </div>
            <div className="rounded-2xl border border-border/60 bg-background/85 px-4 py-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Focus</div>
              <div className="mt-1 truncate text-sm font-semibold">{currentTarget || `未选择${props.startContextScopeLabel}`}</div>
              <div className="mt-1 text-xs text-muted-foreground">优先编辑高风险或高不确定节点</div>
            </div>
          </div>
        ) : null}
      </div>

      {startupStep === 'context' ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[280px,minmax(0,1fr)] xl:grid-cols-[320px,minmax(0,1fr)]">
          <div className="min-h-0 overflow-hidden border-b border-border/70 bg-muted/10 lg:border-b-0 lg:border-r">
            <div className="flex h-full min-h-0 flex-col p-4">
              <div className="mb-3 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">状态导航</div>
              <Command className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-sm">
                <CommandInput placeholder={`搜索${props.startContextScopeLabel}...`} />
                <CommandList className="min-h-0 flex-1 overflow-y-auto">
                  <CommandEmpty>没有匹配的{props.startContextScopeLabel}</CommandEmpty>
                  <CommandGroup heading={`${props.startContextScopeLabel}列表`}>
                    {props.startContextTargets.map((name, index) => {
                      const filled = (props.phaseDrafts[name] || '').trim().length > 0;
                      const selected = currentTarget === name;
                      return (
                        <CommandItem
                          key={`context-target-${name}`}
                          value={`${name} ${index + 1}`}
                          onSelect={() => {
                            setLocalFocusTarget(name);
                            props.onFocusTargetChange(name);
                            setActiveTab('state');
                          }}
                          className={`cursor-pointer rounded-xl border px-3 py-3 transition-colors hover:bg-muted/40 ${selected ? 'border-blue-500/40 bg-blue-50 dark:bg-blue-950/20' : 'border-transparent'}`}
                        >
                          <div className="flex w-full items-center gap-3">
                            <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-xs font-semibold ${selected ? 'bg-blue-600 text-white' : 'bg-muted text-muted-foreground'}`}>
                              {index + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{name}</div>
                              <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                <span>{filled ? '已填写' : '待补充'}</span>
                                <span className={`h-2 w-2 rounded-full ${filled ? 'bg-emerald-500' : 'bg-muted-foreground/35'}`} />
                              </div>
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </div>

          <div className="min-h-0 min-w-0 overflow-hidden bg-background">
            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="flex h-full flex-col">
              <div className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-5">
                <TabsList className="grid w-full grid-cols-3 rounded-2xl sm:max-w-[420px]">
                  <TabsTrigger value="overview" className="rounded-xl">总览</TabsTrigger>
                  <TabsTrigger value="global" className="rounded-xl">全局</TabsTrigger>
                  <TabsTrigger value="state" className="rounded-xl">{props.startContextScopeLabel}</TabsTrigger>
                </TabsList>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
                <TabsContent value="overview" className="mt-0">
                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm">
                      <div className="text-sm font-semibold">填写建议</div>
                      <div className="mt-3 space-y-3 text-sm leading-6 text-muted-foreground">
                        <div className="rounded-2xl border border-border/60 bg-background/80 p-3">全局上下文写不变约束、兼容策略和统一交付边界。</div>
                        <div className="rounded-2xl border border-border/60 bg-background/80 p-3">{props.startContextScopeLabel}上下文写局部输入、特殊注意事项和额外检查点。</div>
                        <div className="rounded-2xl border border-border/60 bg-background/80 p-3">优先补齐高风险节点，避免每个节点都复制同一段全局说明。</div>
                      </div>
                    </div>
                    <div className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold">覆盖率</div>
                        <Badge variant="outline" className="rounded-full px-2.5 text-[10px]">{coverage}%</Badge>
                      </div>
                      <div className="mt-4"><Progress value={coverage} className="h-2" /></div>
                      <div className="mt-4 space-y-2">
                        {props.startContextTargets.slice(0, 6).map((name) => {
                          const filled = (localPhaseDrafts[name] || '').trim().length > 0;
                          return (
                            <button
                              key={`context-summary-${name}`}
                              type="button"
                              onClick={() => {
                                setLocalFocusTarget(name);
                                props.onFocusTargetChange(name);
                                setActiveTab('state');
                              }}
                              className="flex w-full items-center justify-between rounded-2xl border border-border/60 bg-background/80 px-3 py-2 text-left text-sm hover:bg-muted/40"
                            >
                              <span className="truncate">{name}</span>
                              <Badge variant={filled ? 'secondary' : 'outline'} className="rounded-full px-2 text-[10px]">
                                {filled ? '已填' : '空白'}
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                  {props.preflightPreview && props.preflightPreview.commands.length > 0 ? (
                    <div className="mt-4 rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">启动前检查命令</div>
                          <div className="mt-1 text-xs leading-5 text-muted-foreground">
                            以下命令会在服务器侧于目录 {props.preflightPreview.cwd} 中执行。你可以直接执行，也可以跳过本次检查。
                          </div>
                        </div>
                        <Badge variant="outline" className="rounded-full px-2.5 text-[10px]">
                          {props.preflightPreview.commands.length} 条
                        </Badge>
                      </div>
                      <div className="mt-4 space-y-2">
                        {props.preflightPreview.commands.map((item, index) => (
                          <div key={`preflight-preview-${index}-${item.command}`} className="rounded-2xl border border-border/60 bg-background/80 px-3 py-2">
                            <div className="flex items-start justify-between gap-3">
                              <code className="min-w-0 flex-1 whitespace-pre-wrap break-all text-xs leading-5 text-foreground">{item.command}</code>
                              <Badge variant={item.origin === 'inferred' ? 'outline' : 'secondary'} className="shrink-0 rounded-full px-2 text-[10px]">
                                {item.origin === 'inferred' ? '推断' : '配置'}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="global" className="mt-0">
                  <div className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium">全局上下文</Label>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">所有步骤都能看到。适合写共享原则，不适合堆局部执行细节。</p>
                      </div>
                      <Badge variant="secondary" className="rounded-full px-2.5 text-[10px]">共享</Badge>
                    </div>
                    <Textarea
                      value={localGlobalDraft}
                      onChange={(e) => setLocalGlobalDraft(e.target.value)}
                      placeholder="例如：优先保持现有架构、接口变更先兼容旧调用方、代码风格跟随仓库现状"
                      rows={16}
                      className="mt-4 min-h-[220px] resize-none rounded-2xl border-border/60 bg-background/90 text-sm leading-6 shadow-sm sm:min-h-[320px] lg:min-h-[420px]"
                    />
                  </div>
                </TabsContent>

                <TabsContent value="state" className="mt-0">
                  <div className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Label className="text-sm font-medium">{currentTarget || `当前${props.startContextScopeLabel}`}</Label>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">这里只编辑当前选中的{props.startContextScopeLabel}，内容只会注入对应节点。</p>
                      </div>
                      {currentTarget ? (
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="rounded-full px-2.5 text-[10px]">{props.startContextScopeLabel}</Badge>
                          <Badge variant={(currentTargetValue || '').trim() ? 'secondary' : 'outline'} className="rounded-full px-2.5 text-[10px]">
                            {(currentTargetValue || '').trim() ? '已填写' : '待补充'}
                          </Badge>
                        </div>
                      ) : null}
                    </div>
                    <Textarea
                      value={currentTargetValue}
                      onChange={(e) => {
                        if (!currentTarget) return;
                        const nextValue = e.target.value;
                        setLocalPhaseDrafts((prev) => ({ ...prev, [currentTarget]: nextValue }));
                      }}
                      placeholder={currentTarget ? `输入仅对「${currentTarget}」生效的上下文` : `先从左侧选择一个${props.startContextScopeLabel}`}
                      rows={16}
                      disabled={!currentTarget}
                      className="mt-4 min-h-[220px] resize-none rounded-2xl border-border/60 bg-background/90 text-sm leading-6 shadow-sm disabled:opacity-60 sm:min-h-[320px] lg:min-h-[420px]"
                    />
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4 sm:px-6 sm:py-6">
          <div className="space-y-4">
            <div className="rounded-3xl border border-amber-500/30 bg-amber-500/8 p-5">
              <div className="flex items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-500/35 bg-amber-500/15 text-amber-700">
                  <span className="material-symbols-outlined text-[18px]">warning</span>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span>危险提醒</span>
                    <Badge variant="outline" className="rounded-full border-amber-500/35 bg-amber-500/10 px-2 text-[10px] text-amber-700">请仔细确认</Badge>
                  </div>
                  <div className="mt-1 text-sm leading-6 text-muted-foreground">
                    启动前检查命令会在服务器侧执行，工作目录为 <code className="rounded bg-background px-1.5 py-0.5 text-xs">{props.preflightPreview?.cwd || props.projectRoot || '未提供'}</code>。确认这些命令符合预期后再执行；如果你暂时不想运行检查，可以直接跳过。
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-sm">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Commands</div>
                <div className="mt-1 text-2xl font-semibold">{previewCommands.length}</div>
                <div className="mt-1 text-xs text-muted-foreground">本次将展示的 preflight 命令总数</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-sm">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Workflow</div>
                <div className="mt-1 text-2xl font-semibold">{workflowCommandCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">直接来自当前 workflow 配置</div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-sm">
                <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Inferred</div>
                <div className="mt-1 text-2xl font-semibold">{inferredCommandCount}</div>
                <div className="mt-1 text-xs text-muted-foreground">系统按项目特征自动推断</div>
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/90 p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">启动前检查命令</div>
                  <div className="mt-1 text-xs text-muted-foreground">下一步请选择：暂不启动、跳过检查直接启动，或先执行这些检查再启动。</div>
                </div>
                <Badge variant="outline" className="rounded-full px-2.5 text-[10px]">{previewCommands.length} 条</Badge>
              </div>
              <div className="mt-4 space-y-2">
                {previewCommands.length > 0 ? previewCommands.map((item, index) => (
                  <div key={`preflight-preview-${index}-${item.command}`} className="rounded-2xl border border-border/60 bg-background/80 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 text-[11px] text-muted-foreground">命令 {index + 1}</div>
                        <pre className="overflow-x-auto rounded-xl border border-amber-500/20 bg-slate-950 px-3 py-2 text-xs leading-6 text-slate-100">
                          <code className="whitespace-pre-wrap break-all">{item.command}</code>
                        </pre>
                      </div>
                      <Badge variant={item.origin === 'inferred' ? 'outline' : 'secondary'} className="shrink-0 rounded-full px-2 text-[10px]">
                        {item.origin === 'inferred' ? '推断' : '配置'}
                      </Badge>
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-dashed border-border/60 bg-background/60 px-4 py-4 text-sm text-muted-foreground">当前没有需要执行的 preflight 命令。你可以直接启动。</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-border/70 bg-muted/15 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs leading-5 text-muted-foreground sm:max-w-[55%]">{props.footerText}</div>
          <div className="flex flex-wrap justify-end gap-2 sm:gap-3">
            {startupFlowEnabled ? (
              startupStep === 'context' ? (
                <>
                  <Button variant="destructive" onClick={props.onCancel} disabled={props.actionBusy}>取消</Button>
                  <Button onClick={() => setStartupStep('preflight')} disabled={props.actionDisabled}>下一步</Button>
                </>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setStartupStep('context')} disabled={props.actionBusy}>上一步</Button>
                  <Button variant="destructive" onClick={props.onCancel} disabled={props.actionBusy}>取消</Button>
                  {props.onSkipPreflight ? (
                    <Button
                      variant="outline"
                      onClick={() => props.onSkipPreflight?.({
                        globalContext: localGlobalDraft,
                        phaseContexts: localPhaseDrafts,
                      })}
                      disabled={props.actionBusy}
                    >
                      跳过检查启动
                    </Button>
                  ) : null}
                  <Button
                    onClick={() => props.onConfirm({
                      globalContext: localGlobalDraft,
                      phaseContexts: localPhaseDrafts,
                    })}
                    disabled={props.actionDisabled}
                  >
                    {props.actionBusy ? props.actionBusyLabel : props.actionLabel}
                  </Button>
                </>
              )
            ) : (
              <>
                <Button variant="destructive" onClick={props.onCancel} disabled={props.actionBusy}>取消</Button>
                <Button
                  onClick={() => props.onConfirm({
                    globalContext: localGlobalDraft,
                    phaseContexts: localPhaseDrafts,
                  })}
                  disabled={props.actionDisabled}
                >
                  {props.actionBusy ? props.actionBusyLabel : props.actionLabel}
                </Button>
              </>
            )}
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
    if (!embeddedInDashboard) return;
    setEmbeddedSearchState(embeddedSearch ?? '');
  }, [embeddedInDashboard, embeddedSearch]);

  const effectiveSearchParams = useMemo(
    () => new URLSearchParams(embeddedInDashboard ? embeddedSearchState : searchParams.toString()),
    [embeddedInDashboard, embeddedSearchState, searchParams]
  );
  const configFile = decodeURIComponent(embeddedConfig ?? (params.config as string));

  // 格式化状态名称
  const formatStateName = (name: string) => {
    if (name === '__origin__') return '开始';
    if (name === '__human_approval__') return '人工审查';
    return name;
  };

  const initialMode = (effectiveSearchParams.get('mode') as ViewMode) || 'run';
  const initialRunId = effectiveSearchParams.get('run') || effectiveSearchParams.get('runId');
  const focusTarget = effectiveSearchParams.get('focus');
  const focusQuestionId = effectiveSearchParams.get('questionId');
  const searchParamsString = effectiveSearchParams.toString();
  const { resolvedTheme } = useTheme();

  // Update URL query params without full navigation
  const updateUrl = useCallback((updates: Record<string, string | null>) => {
    const sp = new URLSearchParams(searchParamsString);
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) sp.delete(key);
      else sp.set(key, val);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'run')) {
      sp.delete('runId');
    }
    const qs = sp.toString();
    if (embeddedInDashboard) {
      setEmbeddedSearchState(qs);
      return;
    }
    const currentUrl = `/workbench/${encodeURIComponent(configFile)}${searchParamsString ? `?${searchParamsString}` : ''}`;
    const nextUrl = `/workbench/${encodeURIComponent(configFile)}${qs ? `?${qs}` : ''}`;
    if (nextUrl === currentUrl) {
      return;
    }
    router.replace(nextUrl, { scroll: false });
  }, [embeddedInDashboard, searchParamsString, configFile, router]);

  const goBackToWorkflows = useCallback(() => {
    if (embeddedInDashboard && dockWorkspace) {
      dockWorkspace.openTab({ id: 'workflows', title: '工作流管理', kind: 'workflows' });
      const sp = new URLSearchParams();
      sp.set('route', '/workflows');
      router.push(`/dashboard?${sp.toString()}`);
      return;
    }
    router.push('/workflows');
  }, [dockWorkspace, embeddedInDashboard, router]);

  const { toast } = useToast();
  const { confirm, dialogProps: confirmDialogProps } = useConfirmDialog();
  const { state, dispatch, addLog } = useWorkflowState(initialMode);
  const [pageLoading, setPageLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(initialMode === 'history');
  const [historyRuns, setHistoryRuns] = useState<any[]>([]);
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [focusedState, setFocusedState] = useState<string | null>(null); // 用于流程图视图跳转
  const [executionViewTabOverride, setExecutionViewTabOverride] = useState<string | null>(null);
  const [executionPolicyDialogOpen, setExecutionPolicyDialogOpen] = useState(false);
  const [runDetail, setRunDetail] = useState<any>(null);
  const [viewingHistoryRun, setViewingHistoryRun] = useState(false);
  const [pendingCheckpointPhase, setPendingCheckpointPhase] = useState<string | null>(null);
  const [fullStepOutput, setFullStepOutput] = useState<string | null>(null);
  const [loadingOutput, setLoadingOutput] = useState(false);
  const [markdownModal, setMarkdownModal] = useState<{ title: string; chunks: string[] } | null>(null);
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
  const [smStateHistory, setSmStateHistory] = useState<any[]>([]);
  const [runWorkbenchTab, setRunWorkbenchTab] = useState<RunWorkbenchTab>(() => getRunWorkbenchTabFromSearchParams(effectiveSearchParams));
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
  const [runAccumulatedWaitMs, setRunAccumulatedWaitMs] = useState<number>(0);
  const [runWaitStartedAt, setRunWaitStartedAt] = useState<string | null>(null);
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
  const [specRevisionVote, setSpecRevisionVote] = useState<WorkflowSpecRevisionVoteRecord | null>(null);
  const [specRevisionVoteHistory, setSpecRevisionVoteHistory] = useState<WorkflowSpecRevisionVoteRecord[]>([]);
  const pendingApprovalRedirectRef = useRef<string | null>(null);
  const [openLatestAiDocRequest, setOpenLatestAiDocRequest] = useState(0);
  const [liveStream, setLiveStream] = useState<string[]>([]);
  const [showLiveStream, setShowLiveStream] = useState(false);
  const [liveStreamFullscreen, setLiveStreamFullscreen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<'detail' | 'live'>('detail');
  const [isNewNode, setIsNewNode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [availableSkills, setAvailableSkills] = useState<{ name: string; description: string }[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<ManagedMcpServer[]>([]);
  const [starting, setStarting] = useState(false);
  const [rehearsalMode, setRehearsalMode] = useState(false);
  const [globalEngine, setGlobalEngine] = useState('');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [workflowDefaultModel, setWorkflowDefaultModel] = useState('');
  const [workflowAutoCompactOnStepChange, setWorkflowAutoCompactOnStepChange] = useState(false);
  const [workflowAgentOverrides, setWorkflowAgentOverrides] = useState<Record<string, WorkflowAgentExecutionOverride>>({});
  const [showAgentDrawer, setShowAgentDrawer] = useState(false);
  const [showRuntimeAgentCreator, setShowRuntimeAgentCreator] = useState(false);
  const [runtimeAgentDraft, setRuntimeAgentDraft] = useState<AgentDraftState>(createInitialAgentDraft());
  const [showDesignRequirements, setShowDesignRequirements] = useState(true);
  const [showRunRequirements, setShowRunRequirements] = useState(true);
  const [showAllSkills, setShowAllSkills] = useState(false);
  const [iterationFeedback, setIterationFeedback] = useState('');
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
    setRunWorkbenchTab('workspace');
    updateUrl({
      workspace: '1',
      changes: null,
      workspaceFile: relativeFilePath,
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
  const [memoryLayers, setMemoryLayers] = useState<WorkflowMemoryLayers | null>(null);
  const [workflowFrontendSessionId, setWorkflowFrontendSessionId] = useState<string | null>(null);
  const [workbenchConversationSessionId, setWorkbenchConversationSessionId] = useState<string | null>(null);
  const liveStreamFeedbackRef = useRef<HTMLInputElement>(null);
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
  const [contextEditorFocusTarget, setContextEditorFocusTarget] = useState('');
  const [savingContextEditor, setSavingContextEditor] = useState(false);
  const [showPromptAnalysis, setShowPromptAnalysis] = useState(false);
  const [analyzingRunId, setAnalyzingRunId] = useState<string | null>(null);
  const [analysisResults, setAnalysisResults] = useState<any[]>([]);
  const [analysisSummary, setAnalysisSummary] = useState<any | null>(null);
  const [selectedOptimizations, setSelectedOptimizations] = useState<Set<number>>(new Set());
  const [applyingOptimization, setApplyingOptimization] = useState(false);
  const [showStartWorkflowDialog, setShowStartWorkflowDialog] = useState(false);
  const [pendingStartRequest, setPendingStartRequest] = useState<WorkflowStartRequest | null>(null);
  const autoStartHandledRef = useRef(false);
  const [startGlobalContextDraft, setStartGlobalContextDraft] = useState('');
  const [startPhaseContextDrafts, setStartPhaseContextDrafts] = useState<Record<string, string>>({});
  const [startContextFocusTarget, setStartContextFocusTarget] = useState('');
  const [startupCancelRequested, setStartupCancelRequested] = useState(false);
  const startupCancelRequestedRef = useRef(false);
  const startupCreatedRunIdRef = useRef<string | null>(null);
  const startupExpectedRunIdRef = useRef<string | null>(null);
  const startupInProgressRef = useRef(false);
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const openWorkbenchConversation = useCallback((sessionId?: string | null, agent?: any) => {
    const targetSessionId = workflowFrontendSessionId || sessionId;
    if (!targetSessionId) return;

    setWorkbenchConversationSessionId(targetSessionId);
    setExecutionViewTabOverride('supervisor');
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'workflow' });

    if (agent) {
      dispatch({ type: 'SET_SELECTED_AGENT', payload: agent });
    }
  }, [dispatch, workflowFrontendSessionId]);

  type DesignTab = 'overview' | 'orchestration' | 'config';
  const [designTab, setDesignTab] = useState<DesignTab>('overview');
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
  }, [dispatch]);

  const handleDesignTabChange = useCallback((tab: DesignTab) => {
    setDesignTab(tab);
  }, []);
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
  const liveStreamScrollRef = useRef<HTMLDivElement | null>(null);
  const LIVE_STREAM_PAGE_SIZE = 30;
  const [liveStreamVisibleCount, setLiveStreamVisibleCount] = useState(LIVE_STREAM_PAGE_SIZE);
  const liveStreamUserScrolledUp = useRef(false);
  const [liveStreamScrollLocked, setLiveStreamScrollLocked] = useState(false);
  const {
    viewMode, workflowConfig, editingConfig, agentConfigs,
    workflowStatus, runId, currentPhase, currentStep, agents, logs, completedSteps, failedSteps,
    showCheckpoint, checkpointMessage, checkpointIsIterative, activeTab, selectedAgent, selectedStep,
    projectRoot, workspaceMode, requirements, timeoutMinutes, engine, skills, mcpServers, showProcessPanel,
    showEditNodeModal, editingNode, iterationStates, stepResults, stepIdMap,
    globalContext, phaseContexts,
  } = state;
  const latestRunIdRef = useRef<string | null>(runId || null);

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
    workflowAgentOverrides,
    skills,
    mcpServers,
  }), [
    engine,
    mcpServers,
    projectRoot,
    requirements,
    skills,
    timeoutMinutes,
    workflowAgentOverrides,
    workflowAutoCompactOnStepChange,
    workflowDefaultModel,
    workspaceMode,
  ]);
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
      workflowAgentOverrides: persistedExecutionPolicy.agentOverrides || {},
      skills: Array.isArray(workflowConfig.context?.skills) ? workflowConfig.context.skills.filter((item: unknown): item is string => typeof item === 'string') : [],
      mcpServers: Array.isArray(workflowConfig.context?.mcpServers) ? workflowConfig.context.mcpServers.filter((item: unknown): item is string => typeof item === 'string') : [],
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
  const configuredWorkflowOverrideCount = useMemo(
    () => Object.values(workflowAgentOverrides).filter((value) => value?.enabled).length,
    [workflowAgentOverrides],
  );
  const workflowAgentNames = useMemo(() => {
    const workflow = editingConfig?.workflow || workflowConfig?.workflow;
    if (!workflow) return [] as string[];
    const names = new Set<string>();
    const addName = (value?: string | null) => {
      if (value && value.trim()) names.add(value.trim());
    };
    const nodes = workflow.mode === 'state-machine'
      ? (workflow?.states || [])
      : (workflow?.phases || []);
    for (const node of nodes) {
      addName(node?.agent);
      for (const step of node?.steps || []) {
        addName(step?.agent);
      }
    }
    const supervisorFromWorkflow = workflow?.supervisor?.agent;
    const supervisorFromRoles = agentConfigs.find((agent: any) => agent?.roleType === 'supervisor')?.name;
    addName(supervisorFromWorkflow || supervisorFromRoles || 'default-supervisor');
    return Array.from(names);
  }, [agentConfigs, editingConfig?.workflow, workflowConfig?.workflow]);
  const startContextTargets = useMemo(() => {
    const workflow = workflowConfig?.workflow;
    if (!workflow) return [] as string[];
    if (workflow.mode === 'state-machine') {
      return (workflow.states || []).map((state: any) => state.name).filter((value: string) => !!value);
    }
    return (workflow.phases || []).map((phase: any) => phase.name).filter((value: string) => !!value);
  }, [workflowConfig]);
  const startContextScopeLabel = workflowConfig?.workflow?.mode === 'state-machine' ? '状态' : '阶段';

  // Explicitly convert viewMode to string for conditional rendering
  const isDesignMode = state.viewMode === 'design';
  const isRunMode = state.viewMode === 'run';
  const isHistoryMode = state.viewMode === 'history';

  const switchViewMode = useCallback((mode: ViewMode) => {
    if (mode !== 'history') {
      setViewingHistoryRun(false);
    }
    dispatch({ type: 'SET_VIEW_MODE', payload: mode });
    if (mode === 'design') {
      setDesignTab('overview');
    }
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

  const currentRunWorkspacePath = useMemo(
    () => state.workingDirectory || resolvedProjectRoot || projectRoot || '',
    [projectRoot, resolvedProjectRoot, state.workingDirectory],
  );
  const configGitBaselineEnabled = workflowConfig?.context?.gitBaselineEnabled !== false;
  const effectiveGitBaselineEnabled = configGitBaselineEnabled && runtimeGitBaselineEnabled;

  useEffect(() => {
    setRuntimeGitBaselineEnabled(workflowConfig?.context?.gitBaselineEnabled !== false);
  }, [workflowConfig?.context?.gitBaselineEnabled]);

  const handleRunWorkbenchTabChange = useCallback((tab: RunWorkbenchTab) => {
    setRunWorkbenchTab(tab);
    updateUrl({
      workspace: tab === 'workspace' ? '1' : null,
      changes: tab === 'changes' ? '1' : null,
    });
  }, [updateUrl]);

  useEffect(() => {
    if (runWorkbenchTab === 'changes' && (!currentRunWorkspacePath || !effectiveGitBaselineEnabled)) {
      handleRunWorkbenchTabChange('execution');
    }
  }, [currentRunWorkspacePath, effectiveGitBaselineEnabled, handleRunWorkbenchTabChange, runWorkbenchTab]);

  const refreshWorkspaceChangeCount = useCallback(async () => {
    const targetWorkspace = String(currentRunWorkspacePath || '').trim();
    if (!targetWorkspace || !effectiveGitBaselineEnabled) {
      setWorkspaceChangeCount(0);
      return;
    }
    try {
      const summary = await workspaceApi.getGitBrowserSummary(targetWorkspace, { commitLimit: 1 });
      setWorkspaceChangeCount(countGitWorkingTreeFiles(summary));
    } catch {
      setWorkspaceChangeCount(0);
    }
  }, [currentRunWorkspacePath, effectiveGitBaselineEnabled]);

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
    if (!specCodingDetails?.phases?.length) return null;
    return specCodingDetails.phases.find((phase) => phase.id === specCodingSummary?.progress?.activePhaseId)
      || specCodingDetails.phases.find((phase) => phase.title === currentPhase)
      || null;
  }, [currentPhase, specCodingDetails, specCodingSummary?.progress?.activePhaseId]);

  const effectiveSpecCodingTasks = useMemo(() => {
    const tasks = (specCodingDetails?.tasks || []) as RuntimeSpecTask[];
    const workflow = workflowConfig?.workflow as any;
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

    if (workflow.mode === 'state-machine') {
      (workflow.states || []).forEach((state: any) => {
        (state.steps || []).forEach((step: any) => bindStepStatus(step, state.name));
      });
    } else {
      (workflow.phases || []).forEach((phase: any) => {
        (phase.steps || []).forEach((step: any) => bindStepStatus(step, phase.name));
      });
    }

    return mapRuntimeSpecTasks(tasks, (task) => {
      if (task.status === 'completed' || task.status === 'blocked') return task;
      const derivedStatus = derivedStatusByTaskId.get(task.id);
      return derivedStatus && derivedStatus !== task.status
        ? { ...task, status: derivedStatus }
        : task;
    });
  }, [activeSteps, completedSteps, currentStep, failedSteps, specCodingDetails?.tasks, workflowConfig]);

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

  const concurrencyDesignSummary = useMemo(() => {
    const sourceConfig = editingConfig || workflowConfig;
    const workflow = sourceConfig?.workflow as any;
    const states = workflow?.mode === 'state-machine' ? (workflow.states || []) : [];
    const steps = states.flatMap((state: any) =>
      (state.steps || []).map((step: any) => ({ ...step, __stateName: state.name }))
    );
    const grouped = new Map<string, any[]>();
    const agentInstanceIds = new Set<string>();
    const channelIds = new Set<string>();
    const specTaskIds = new Set<string>();
    const joinPolicies: Array<{ scope: string; mode: string }> = [];

    states.forEach((state: any) => {
      (state.channels || []).forEach((id: string) => channelIds.add(id));
      if (state.joinPolicy?.mode) joinPolicies.push({ scope: `state:${state.name}`, mode: state.joinPolicy.mode });
    });

    steps.forEach((step: any) => {
      const groupId = step.concurrency?.groupId || step.parallelGroup;
      if (groupId) grouped.set(groupId, [...(grouped.get(groupId) || []), step]);
      if (step.agentInstanceId) agentInstanceIds.add(step.agentInstanceId);
      (step.channelIds || []).forEach((id: string) => channelIds.add(id));
      [
        ...((step.specTaskBinding?.taskIds || []) as string[]),
        step.specTaskBinding?.taskId,
      ].filter(Boolean).forEach((taskId: string) => specTaskIds.add(taskId));
      if (step.concurrency?.joinPolicy?.mode) {
        joinPolicies.push({ scope: `step:${step.name}`, mode: step.concurrency.joinPolicy.mode });
      }
    });

    (workflow?.concurrency?.agentInstances || []).forEach((instance: any) => agentInstanceIds.add(instance.id));
    (workflow?.concurrency?.channels || []).forEach((channel: any) => channelIds.add(channel.id));
    Object.entries(workflow?.concurrency?.joinPolicies || {}).forEach(([id, policy]: [string, any]) => {
      if (policy?.mode) joinPolicies.push({ scope: `workflow:${id}`, mode: policy.mode });
    });

    return {
      groups: Array.from(grouped.entries()).map(([id, groupSteps]) => ({ id, steps: groupSteps })),
      agentInstanceIds: Array.from(agentInstanceIds),
      channelIds: Array.from(channelIds),
      specTaskIds: Array.from(specTaskIds),
      joinPolicies,
      hasMetadata: grouped.size > 0 || agentInstanceIds.size > 0 || channelIds.size > 0 || specTaskIds.size > 0 || joinPolicies.length > 0,
    };
  }, [editingConfig, workflowConfig]);

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
  }, [specCodingDetails?.artifacts, structuredTasksMarkdown]);

  const currentSpecArtifacts = useMemo<SpecCodingArtifactDrafts>(
    () => normalizeSpecArtifactDrafts(specCodingDetails?.artifacts, {
      tasks: structuredTasksMarkdown || specCodingDetails?.artifacts?.tasks || '',
    }),
    [specCodingDetails?.artifacts, structuredTasksMarkdown]
  );
  const designOptimizationSpecTaskOptions = useMemo(() => (
    (specCodingDetails?.tasks || [])
      .filter((task: any) => !(Array.isArray(task?.children) && task.children.length > 0))
      .map((task: any) => ({
        id: task.id,
        title: task.title,
        phaseTitle: specCodingDetails?.phases?.find((phase: any) => phase.id === task.phaseId)?.title,
        ownerAgents: task.ownerAgents || [],
      }))
  ), [specCodingDetails?.phases, specCodingDetails?.tasks]);
  const effectiveSpecRevisionDraft = specRevisionCandidate
    ? specRevisionCandidate.artifacts[specRevisionTarget]
    : specRevisionDraft;

  const activeSpecCodingArtifact = useMemo(
    () => specCodingArtifactEntries.find((entry) => entry.key === specCodingArtifactTab) || specCodingArtifactEntries[0],
    [specCodingArtifactEntries, specCodingArtifactTab]
  );
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
      '你只生成候选，不要声称已经保存；系统会先展示 diff，由用户确认后再应用。',
      '必须同时返回完整 requirements、design、tasks 三份制品，即使用户只要求修改其中一份，也要保持三份制品互相一致。',
      '保持原文主语言、术语、需求编号、任务编号和 workflow step 绑定关系一致；不要删除仍然有效的 spec-coding-task 注释。',
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
      '2. 最终必须在 <result>...</result> 内输出一个 JSON 对象，不要包 ```json 代码块。',
      '3. JSON 格式必须是 {"kind":"spec_artifact_revision","payload":{"summary":"一句话摘要","revisionPlan":[{"artifact":"requirements","op":"modify","targetId":"R1","reason":"为什么改"}],"artifacts":{"requirements":"# requirements.md\\n...","design":"# design.md\\n...","tasks":"# tasks.md\\n..."}}}。',
      '4. artifacts 的三个字段都必须是完整 markdown 字符串，不能只返回片段或 patch。',
      '5. revisionPlan 必须用 add / modify / remove / rename 描述具体 R/D/T 或章节的变化；不要只写笼统影响。',
      '6. requirements 必须保留 R 编号、用户故事和 WHEN/THEN；design 必须保留 D 编号、接口/数据/测试/风险；tasks 必须保留 T 编号、需求追踪、设计追踪、动作、交付和验证。',
      '7. 输出 </result> 后不要追加任何文字。',
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
          displayMessage: `AI 修订 Spec：${instruction.slice(0, 80)}`,
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
          const data = JSON.parse((event as MessageEvent).data || '{}');
          accumulated += String(data.content || '');
          setSpecAiStream(accumulated);
          updateAssistantMessage(accumulated, 'streaming');
        });
        es.addEventListener('thinking', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
          thinkingAccumulated += String(data.content || '');
          if (!accumulated) {
            setSpecAiStream(thinkingAccumulated);
            updateAssistantMessage(thinkingAccumulated, 'streaming');
          }
        });
        es.addEventListener('session', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
          if (data.sessionId) {
            setSpecAiSessionId(String(data.sessionId));
          }
        });
        es.addEventListener('done', (event) => {
          if (settled) return;
          settled = true;
          const data = JSON.parse((event as MessageEvent).data || '{}');
          es.close();
          if (data.sessionId) {
            setSpecAiSessionId(String(data.sessionId));
          }
          if (data.isError) {
            updateAssistantMessage(data.error || data.result || accumulated || 'AI Spec 修订失败', 'failed');
            reject(new Error(data.error || data.result || accumulated || 'AI Spec 修订失败'));
            return;
          }
          const finalText = String(data.result || accumulated || '');
          updateAssistantMessage(finalText, 'completed');
          resolve(finalText);
        });
        es.addEventListener('engine_error', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
          fail(data.message || 'AI Spec 修订失败');
        });
        es.addEventListener('failed', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
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
        toast('warning', 'AI 已生成候选，但校验未通过；请让 AI 继续修正后再应用');
      } else {
        toast('success', specAiSessionId ? 'AI 已调整 Spec 候选，请检查 diff 后应用' : 'AI 已生成 Spec 修订候选，请检查 diff 后应用');
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
      toast('success', 'Spec 修订候选已应用');
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
    if (target.scope === 'workflow') {
      return '请根据最新 Spec 重新审视整个工作流编排，优化阶段/状态划分、Agent 分工、步骤任务说明、Spec 任务绑定和审查策略。';
    }
    if (target.scope === 'state') {
      return `请根据最新 Spec 优化状态「${target.stateName}」，重点检查状态描述、内部步骤拆分、Agent 分工、转移规则和人工审查策略。`;
    }
    return `请根据最新 Spec 优化步骤「${target.stepName}」，重点检查 Agent 选择、task 提示词、constraints、skills 和 specTaskBinding。`;
  }, []);
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
  const handleOptimizePhaseStep = useCallback((phaseIndex: number, stepIndex: number) => {
    const sourceConfig = editingConfig || workflowConfig;
    const phase = sourceConfig?.workflow?.phases?.[phaseIndex];
    const step = phase?.steps?.[stepIndex];
    if (!phase || !step) {
      toast('warning', '找不到要优化的步骤');
      return;
    }
    openDesignOptimizationDialog({
      scope: 'step',
      workflowMode: 'phase-based',
      containerType: 'phase',
      containerIndex: phaseIndex,
      containerName: phase.name || `阶段 ${phaseIndex + 1}`,
      stepIndex,
      stepName: step.name || `步骤 ${stepIndex + 1}`,
    });
  }, [editingConfig, openDesignOptimizationDialog, toast, workflowConfig]);
  const handleOptimizeStateMachineState = useCallback((stateIndex: number) => {
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
    });
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
        const updateAssistantMessage = (content: string, status: DesignOptimizationMessage['status']) => {
          setDesignOptimizationMessages((messages) => messages.map((message) => (
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
          const data = JSON.parse((event as MessageEvent).data || '{}');
          accumulated += String(data.content || '');
          setDesignOptimizationStream(accumulated);
          updateAssistantMessage(accumulated, 'streaming');
        });
        es.addEventListener('thinking', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
          thinkingAccumulated += String(data.content || '');
          if (!accumulated) {
            setDesignOptimizationStream(thinkingAccumulated);
            updateAssistantMessage(thinkingAccumulated, 'streaming');
          }
        });
        es.addEventListener('session', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
          if (data.sessionId) {
            setDesignOptimizationSessionId(String(data.sessionId));
          }
        });
        es.addEventListener('done', (event) => {
          if (settled) return;
          settled = true;
          const data = JSON.parse((event as MessageEvent).data || '{}');
          es.close();
          if (data.sessionId) {
            setDesignOptimizationSessionId(String(data.sessionId));
          }
          if (data.isError) {
            updateAssistantMessage(data.error || data.result || accumulated || 'AI 工作流优化失败', 'failed');
            reject(new Error(data.error || data.result || accumulated || 'AI 工作流优化失败'));
            return;
          }
          const finalText = String(data.result || accumulated || '');
          updateAssistantMessage(finalText, 'completed');
          resolve(finalText);
        });
        es.addEventListener('engine_error', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
          fail(data.message || 'AI 工作流优化失败');
        });
        es.addEventListener('failed', (event) => {
          const data = JSON.parse((event as MessageEvent).data || '{}');
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
      const bindingResult = specCodingDetails
        ? compileStepTaskBindings(candidateConfig as any, specCodingDetails as any, { requireFullCoverage: true })
        : null;
      const baseSnapshot = extractDesignOptimizationSnapshot(sourceConfig, target);
      const candidateSnapshot = extractDesignOptimizationSnapshot(candidateConfig, target);
      const patchValue = extractWorkflowPatchValue(payload, target);
      setDesignOptimizationCandidate({
        summary: payload.summary?.trim() || `${getDesignOptimizationTargetLabel(target)} ${designOptimizationSessionId ? '调整候选' : '优化候选'}`,
        createdAt: new Date().toISOString(),
        rawOutput: finalContent,
        filename: payload.filename,
        payload,
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
      toast('success', designOptimizationSessionId ? 'AI 已调整候选，请检查 diff 后应用' : 'AI 已生成优化候选，请检查 diff 后应用');
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
    specCodingDetails,
    toast,
    workflowConfig,
    workflowDefaultModel,
  ]);
  const handleApplyDesignOptimizationCandidate = useCallback(() => {
    if (!designOptimizationCandidate) return;
    dispatch({ type: 'SET_EDITING_CONFIG', payload: designOptimizationCandidate.candidateConfig });
    setDesignOptimizationCandidate(null);
    setDesignOptimizationDialogOpen(false);
    setDesignOptimizationStream('');
    setDesignTab('orchestration');
    toast('success', 'AI 优化候选已应用到当前工作流草稿，请记得保存配置');
  }, [designOptimizationCandidate, dispatch, toast]);
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
        team: roleConfig?.team || (name === (supervisorFromWorkflow || supervisorFromRoles) ? 'black-gold' : 'blue'),
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
  const canStartWorkflow = isRunMode && !starting && (!isRunning || workspaceMode === 'isolated-copy');
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
  const pendingHumanQuestionKindLabel = useMemo(() => {
    if (!pendingHumanQuestion) return null;
    if (pendingHumanQuestion.source?.type === 'human-help') return '人工客服';
    if (pendingHumanQuestion.source?.type === 'parallel-manual-join') return '并发人工确认';
    return '人工审查';
  }, [pendingHumanQuestion]);
  const pendingHumanAttentionTitle = pendingHumanQuestionKindLabel
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
    return result;
  }, [agentConfigs, orderedWorkflowAgents, runtimeSupervisorAgent]);
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
    displayWorkflowAgents.forEach((agent) => {
      const sessionId = String(agent.sessionId || '').trim();
      if (agent.name && sessionId) result[agent.name] = sessionId;
    });
    if (runtimeSupervisorAgent && runtimeSupervisorSessionId) {
      result[runtimeSupervisorAgent] = runtimeSupervisorSessionId;
    }
    return result;
  }, [displayWorkflowAgents, runtimeSupervisorAgent, runtimeSupervisorSessionId]);
  const workflowTokenAnalytics = useMemo(() => {
    const stepNameToPhase = new Map<string, string>();
    if (workflowConfig?.workflow?.mode === 'state-machine') {
      for (const stateNode of workflowConfig.workflow.states || []) {
        for (const step of stateNode.steps || []) {
          if (step?.name) stepNameToPhase.set(step.name, stateNode.name);
        }
      }
    } else {
      for (const phaseNode of workflowConfig?.workflow?.phases || []) {
        for (const step of phaseNode.steps || []) {
          if (step?.name) stepNameToPhase.set(step.name, phaseNode.name);
        }
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
    active: Boolean(pendingHumanAttentionTitle),
    title: pendingHumanAttentionTitle || `待人工审查 · ${workflowBaseTitle}`,
    notificationTitle: `ACEHarness - ${pendingHumanQuestionKindLabel ? `待${pendingHumanQuestionKindLabel}` : '待人工审查'}`,
    notificationBody: `${workflowBaseTitle} ${pendingHumanQuestionKindLabel ? `等待${pendingHumanQuestionKindLabel}` : '进入人工审查点'}，请及时处理。`,
    toast,
    toastMessage: `${workflowBaseTitle} ${pendingHumanQuestionKindLabel ? `等待${pendingHumanQuestionKindLabel}` : '已进入人工审查点'}`,
  });

  useDocumentTitle(attentionSignal.active ? attentionSignal.title || null : workflowTitle);

  const totalSteps = workflowConfig?.workflow?.mode === 'state-machine'
    ? (workflowConfig?.workflow?.states?.reduce(
        (sum: number, state: any) => sum + (state.steps?.length ?? 0), 0
      ) ?? 0)
    : (workflowConfig?.workflow?.phases?.reduce(
        (sum: number, phase: any) => sum + phase.steps.length, 0
      ) ?? 0);
  const editingPreflightSummary = useMemo(() => {
    const workflow = editingConfig?.workflow;
    if (!workflow) {
      return { configuredSteps: 0, totalCommands: 0 };
    }
    const steps = workflow.mode === 'state-machine'
      ? (workflow.states || []).flatMap((state: any) => state?.steps || [])
      : (workflow.phases || []).flatMap((phase: any) => phase?.steps || []);
    return steps.reduce((summary: { configuredSteps: number; totalCommands: number }, step: any) => {
      const commandCount = Array.isArray(step?.preCommands) ? step.preCommands.filter((item: any) => typeof item === 'string' && item.trim()).length : 0;
      if (commandCount > 0) {
        summary.configuredSteps += 1;
        summary.totalCommands += commandCount;
      }
      return summary;
    }, { configuredSteps: 0, totalCommands: 0 });
  }, [editingConfig?.workflow]);

  const applyWorkflowStatusPayload = (status: any, requestedRunId?: string) => {
    if (!status?.status) return;
    if (!shouldApplyRuntimePayload(status)) return;
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
      setWorkflowFrontendSessionId((status as any).workflowFrontendSessionId || null);
      if (typeof status.currentPhase === 'string') dispatch({ type: 'SET_CURRENT_PHASE', payload: status.currentPhase });
      else if (!statusIsActive) dispatch({ type: 'SET_CURRENT_PHASE', payload: '' });
      if (typeof status.currentStep === 'string') dispatch({ type: 'SET_CURRENT_STEP', payload: status.currentStep });
      else if (!statusIsActive) dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
      if (status.agents?.length) dispatch({ type: 'SET_AGENTS', payload: status.agents });
      if (status.completedSteps) dispatch({ type: 'SET_COMPLETED_STEPS', payload: status.completedSteps });
      dispatch({ type: 'SET_FAILED_STEPS', payload: status.failedSteps || [] });
      setActiveSteps(Array.isArray((status as any).activeSteps) ? (status as any).activeSteps : []);
      setActiveConcurrencyGroups(Array.isArray((status as any).activeConcurrencyGroups) ? (status as any).activeConcurrencyGroups : []);
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
      setSpecRevisionVote((status as any).specRevisionVote || null);
      setSpecRevisionVoteHistory(Array.isArray((status as any).specRevisionVoteHistory) ? (status as any).specRevisionVoteHistory : []);
      setRehearsalInfo((status as any).rehearsal || null);
      if ((status as any).workspaceGit) {
        setRuntimeGitBaselineEnabled((status as any).workspaceGit.enabled !== false);
      } else {
        setRuntimeGitBaselineEnabled(workflowConfig?.context?.gitBaselineEnabled !== false);
      }
      if ((status as any).agentFlow) {
        setAgentFlow((status as any).agentFlow);
      }
      setCreationSessionSummary((status as any).creationSession || null);
      const preferRunSpec = state.viewMode === 'run' || state.viewMode === 'history';
      const nextSpecCodingSummary = preferRunSpec
        ? ((status as any).runSpecCodingSummary || (status as any).specCodingSummary || (status as any).creationSpecCodingSummary || null)
        : ((status as any).creationSpecCodingSummary || ((status as any).specCodingSummary?.source === 'creation' ? (status as any).specCodingSummary : null));
      const nextSpecCodingDetails = preferRunSpec
        ? ((status as any).runSpecCodingDetails || (status as any).specCodingDetails || (status as any).creationSpecCodingDetails || null)
        : ((status as any).creationSpecCodingDetails || ((status as any).specCodingSummary?.source === 'creation' ? (status as any).specCodingDetails : null));
      setSpecCodingSummary(nextSpecCodingSummary);
      setSpecCodingDetails(nextSpecCodingDetails);
      setSpecCodingSourceOfTruth((status as any).sourceOfTruth || null);
      setPersistMode(status.persistMode);
      setDeltaSpecMerged(Boolean(status.deltaSpecMerged));
      setDeltaMergeState(status.deltaMergeState);
      setMasterSpecPath(status.masterSpecPath);
      setFinalReview((status as any).finalReview || null);
      setQualityChecks((status as any).qualityChecks || []);
      setMemoryLayers((status as any).memoryLayers || null);
      const nextPendingHumanQuestion = (status as any).pendingHumanQuestion || null;
      // 只有运行中的工作流才弹出人工审查
      if (status.status === 'running') {
        setPendingHumanQuestionIfChanged(nextPendingHumanQuestion);
      }

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
      setRunAccumulatedWaitMs(typeof status.accumulatedWaitMs === 'number' ? status.accumulatedWaitMs : 0);
      setRunWaitStartedAt(status.waitStartedAt ?? null);
  };

  const fetchCurrentStatus = async () => {
    try {
      const requestedRunId = startupExpectedRunIdRef.current
        || runId
        || selectedRun?.id
        || (startupInProgressRef.current ? undefined : initialRunId)
        || undefined;
      const status = await workflowApi.getStatus(configFile, requestedRunId);
      applyWorkflowStatusPayload(status, requestedRunId);
    } catch { /* server might not be ready */ }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const { runs } = await runsApi.listByConfig(configFile);
      setHistoryRuns(runs);
    } catch {
      setHistoryRuns([]);
    } finally {
      setHistoryLoading(false);
    }
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

  const applyWorkflowStatusSnapshot = useCallback((snapshot: any) => {
    if (!snapshot) return;
    if (typeof snapshot.status === 'string' && snapshot.status) {
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: snapshot.status });
      setRunStatusReason(snapshot.statusReason || null);
    }
    if (snapshot.runId) {
      dispatch({ type: 'SET_RUN_ID', payload: snapshot.runId });
    }
    if (snapshot.workflowFrontendSessionId !== undefined) {
      setWorkflowFrontendSessionId(snapshot.workflowFrontendSessionId || null);
    }
    const statusIsActive = snapshot.status === 'running' || snapshot.status === 'preparing' || snapshot.status === 'waiting';
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
    if (typeof snapshot.currentStep === 'string') {
      dispatch({ type: 'SET_CURRENT_STEP', payload: snapshot.currentStep });
    } else if (snapshot.status && !statusIsActive) {
      dispatch({ type: 'SET_CURRENT_STEP', payload: '' });
    }
    if (Array.isArray(snapshot.activeSteps)) {
      setActiveSteps(snapshot.activeSteps);
    }
    if (Array.isArray(snapshot.activeConcurrencyGroups)) {
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
      setRuntimeGitBaselineEnabled(snapshot.workspaceGit.enabled !== false);
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
    if (snapshot.runSpecCoding) {
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
    if (Object.prototype.hasOwnProperty.call(snapshot, 'specRevisionVote')) {
      setSpecRevisionVote(snapshot.specRevisionVote || null);
    }
    if (Array.isArray(snapshot.specRevisionVoteHistory)) {
      setSpecRevisionVoteHistory(snapshot.specRevisionVoteHistory);
    }
    if (snapshot.latestSupervisorReview) {
      setLatestSupervisorReview(snapshot.latestSupervisorReview);
    }
    if (snapshot.pendingHumanQuestion !== undefined && snapshot.status === 'running') {
      setPendingHumanQuestionIfChanged(snapshot.pendingHumanQuestion || null);
    }
  }, [dispatch, setPendingHumanQuestionIfChanged]);

  const clearHumanApprovalData = useCallback(() => {
    humanApprovalSignatureRef.current = null;
    setHumanApprovalData(null);
    setHumanApprovalMinimized(false);
    setHumanApprovalMinimizedPulse(false);
  }, []);

  const clearTransientRunUiState = useCallback(() => {
    setSelectedRun(null);
    setRunDetail(null);
    setViewingHistoryRun(false);
    setPendingCheckpointPhase(null);
    setFullStepOutput(null);
    setMarkdownModal(null);
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
    setMemoryLayers(null);
    setLatestSupervisorReview(null);
    setSpecRevisionVote(null);
    setSpecRevisionVoteHistory([]);
    setRehearsalInfo(null);
    setRuntimeGitBaselineEnabled(workflowConfig?.context?.gitBaselineEnabled !== false);
    dispatch({ type: 'SET_SELECTED_STEP', payload: null });
    dispatch({ type: 'SET_SHOW_CHECKPOINT', payload: false });
    dispatch({ type: 'SET_CHECKPOINT_MESSAGE', payload: '' });
    dispatch({ type: 'SET_CHECKPOINT_IS_ITERATIVE', payload: false });
    clearPendingHumanQuestion();
    clearHumanApprovalData();
  }, [clearHumanApprovalData, clearPendingHumanQuestion, dispatch, workflowConfig?.context?.gitBaselineEnabled]);

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
    setWorkbenchConversationSessionId(null);
  }, [runId, workflowFrontendSessionId]);

  useEffect(() => {
    if (!pendingHumanQuestion) return;
    // 已停止/已结束的工作流不再跳转人工审查
    if (workflowStatus === 'stopped' || workflowStatus === 'completed' || workflowStatus === 'failed' || workflowStatus === 'crashed') return;
    // 跳转到 workbench supervisor tab 而不是首页
    dispatch({ type: 'SET_ACTIVE_TAB', payload: 'workflow' });
    setExecutionViewTabOverride('supervisor');
  }, [dispatch, pendingHumanQuestion, workflowStatus]);

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
    if (isHistoryMode) {
      loadHistory();
      return;
    }

    if (isDesignMode) {
      loadWorkflowConfig();
      loadContexts(); // Design mode needs editable contexts immediately
      fetchCurrentStatus();
    } else {
      void loadWorkflowConfig({ background: true });
    }

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
      return () => eventSource?.close();
    }
  }, [viewMode, viewingHistoryRun, initialRunId, runId]);

  useEffect(() => {
    const modeFromUrl = (effectiveSearchParams.get('mode') as ViewMode) || 'run';
    const isViewingHistoricalRunDetail = viewingHistoryRun && state.viewMode === 'run';
    if (!isViewingHistoricalRunDetail && modeFromUrl !== state.viewMode) {
      dispatch({ type: 'SET_VIEW_MODE', payload: modeFromUrl });
    }
  }, [dispatch, searchParamsString, state.viewMode, viewingHistoryRun]);

  useEffect(() => {
    const nextTab = getRunWorkbenchTabFromSearchParams(effectiveSearchParams);
    setRunWorkbenchTab((prev) => (prev === nextTab ? prev : nextTab));
  }, [searchParamsString]);

  // Auto-load run from URL ?run=xxx on mount
  useEffect(() => {
    if (!initialRunId || runId) {
      return;
    }

    const modeFromUrl = (effectiveSearchParams.get('mode') as ViewMode) || 'run';
    if (modeFromUrl === 'history') {
      void viewHistoryRun(initialRunId);
      return;
    }

    dispatch({ type: 'SET_RUN_ID', payload: initialRunId });
    dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
    setViewingHistoryRun(false);
    void fetchCurrentStatus();
  }, [dispatch, fetchCurrentStatus, initialRunId, runId, searchParamsString]);

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
    const currentUrlRun = effectiveSearchParams.get('run');
    if (runId && runId !== currentUrlRun) {
      updateUrl({ run: runId });
    }
  }, [runId, searchParamsString, updateUrl]);

  // Live status stream replaces periodic /api/workflow/status polling.
  useEffect(() => {
    if (viewMode !== 'run' || viewingHistoryRun) return;
    const requestedRunId = startupExpectedRunIdRef.current
      || runId
      || selectedRun?.id
      || (startupInProgressRef.current ? undefined : initialRunId)
      || undefined;
    const eventSource = workflowApi.connectStatusStream(
      { configFile, runId: requestedRunId },
      (status) => applyWorkflowStatusPayload(status, requestedRunId),
    );
    return () => eventSource.close();
  }, [viewMode, viewingHistoryRun, configFile, initialRunId, runId, selectedRun?.id]);

  useEffect(() => {
    if (viewMode !== 'run') return;
    const targetWorkspace = String(currentRunWorkspacePath || '').trim();
    if (!targetWorkspace || !effectiveGitBaselineEnabled) {
      setWorkspaceChangeCount(0);
      return;
    }
    let gotLiveSummary = false;
    const eventSource = workspaceApi.connectGitBrowserSummaryStream(
      targetWorkspace,
      { commitLimit: 1 },
      (summary) => {
        gotLiveSummary = true;
        setWorkspaceChangeCount(countGitWorkingTreeFiles(summary));
      },
      () => {
        if (!gotLiveSummary) {
          void refreshWorkspaceChangeCount();
        }
      },
    );
    return () => eventSource.close();
  }, [currentRunWorkspacePath, effectiveGitBaselineEnabled, refreshWorkspaceChangeCount, viewMode]);

  useEffect(() => {
    if (isDesignMode && workflowConfig) {
      dispatch({ type: 'SET_EDITING_CONFIG', payload: JSON.parse(JSON.stringify(workflowConfig)) });
    }
  }, [viewMode, workflowConfig]);

  const viewHistoryRun = async (runId: string) => {
    try {
      const detail = await runsApi.getRunDetail(runId);
      if (!detail) return;

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
      setRunStatusReason(detail.statusReason || null);
      setWorkflowFrontendSessionId(detail.workflowFrontendSessionId || null);
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

  const loadWorkflowConfig = async (options?: { background?: boolean }) => {
    const background = options?.background === true;
    if (!background) {
      setPageLoading(true);
      setLoadError(null);
    }
    try {
      const { config, agents: loadedAgents } = await configApi.getConfig(configFile);
      dispatch({ type: 'SET_WORKFLOW_CONFIG', payload: config });
      dispatch({ type: 'SET_EDITING_CONFIG', payload: config });
      dispatch({ type: 'SET_AGENTS_CONFIG', payload: loadedAgents || [] });
      dispatch({ type: 'SET_PROJECT_ROOT', payload: config.context?.projectRoot || '' });
      dispatch({ type: 'SET_WORKSPACE_MODE', payload: config.context?.workspaceMode || 'isolated-copy' });
      dispatch({ type: 'SET_REQUIREMENTS', payload: config.context?.requirements || '' });
      dispatch({ type: 'SET_TIMEOUT_MINUTES', payload: config.context?.timeoutMinutes || 30 });
      const loadedExecutionPolicy = resolveWorkflowExecutionPolicy(config.context);
      dispatch({ type: 'SET_ENGINE', payload: loadedExecutionPolicy.defaultEngine || '' });
      setWorkflowDefaultModel(loadedExecutionPolicy.defaultModel || '');
      setWorkflowAutoCompactOnStepChange(loadedExecutionPolicy.autoCompactOnStepChange === true);
      setWorkflowAgentOverrides(loadedExecutionPolicy.agentOverrides || {});
      dispatch({ type: 'SET_SKILLS', payload: config.context?.skills || [] });
      dispatch({ type: 'SET_MCP_SERVERS', payload: config.context?.mcpServers || [] });

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
        if (event.data.workflowFrontendSessionId) setWorkflowFrontendSessionId(event.data.workflowFrontendSessionId);
        if (Array.isArray(event.data.activeSteps)) setActiveSteps(event.data.activeSteps);
        if (Array.isArray(event.data.completedSteps)) dispatch({ type: 'SET_COMPLETED_STEPS', payload: event.data.completedSteps });
        if (Array.isArray(event.data.failedSteps)) dispatch({ type: 'SET_FAILED_STEPS', payload: event.data.failedSteps });
        if (Array.isArray(event.data.activeConcurrencyGroups)) setActiveConcurrencyGroups(event.data.activeConcurrencyGroups);
        if (event.data.startTime) setRunStartTime(event.data.startTime);
        if (event.data.endTime) setRunEndTime(event.data.endTime);
        if (event.data.specCodingSummary) setSpecCodingSummary(event.data.specCodingSummary);
        if (event.data.specCodingDetails) setSpecCodingDetails(event.data.specCodingDetails);
        applyWorkflowStatusSnapshot(event.data);
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        if (event.data.workingDirectory) dispatch({ type: 'SET_WORKING_DIRECTORY', payload: event.data.workingDirectory });
        addLog('system', 'info', event.data.message);
        break;
      case 'phase':
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        dispatch({ type: 'SET_CURRENT_PHASE', payload: event.data.phase });
        addLog('system', 'info', `📍 ${event.data.message}`);
        break;
      case 'step':
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        dispatch({ type: 'SET_CURRENT_STEP', payload: event.data.step });
        if (event.data.id) {
          dispatch({ type: 'MAP_STEP_ID', payload: { stepName: event.data.step, stepId: event.data.id } });
        }
        addLog(event.data.agent, 'info', `开始执行: ${event.data.step}`);
        break;
      case 'result': {
        applyWorkflowStatusSnapshot(event.data.statusSnapshot);
        const resultKey = event.data.id || event.data.step;
        if (event.data.error) {
          addLog(event.data.agent, 'error', event.data.output);
          dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
          setRunStatusReason(event.data.errorDetail || event.data.output || '步骤执行失败');
          setActiveSteps([]);
          setActiveConcurrencyGroups([]);
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
  }, [selectedAgent, addLog, currentPhase, pendingHumanQuestion?.id, setPendingHumanQuestionIfChanged, setHumanApprovalDataIfChanged, clearPendingHumanQuestion, clearHumanApprovalData, shouldApplyRuntimePayload, applyWorkflowStatusSnapshot, liveStream.length, markInlineFeedbacksDelivered, upsertInlineFeedback]);

  // Keep a ref to the latest handleEvent so SSE callback never goes stale
  const handleEventRef = useRef(handleEvent);
  handleEventRef.current = handleEvent;

  const saveConfig = async () => {
    if (!workflowConfig) return;
    setSaving(true);
    try {
      const configBase = {
        ...workflowConfig,
        workflow: editingConfig?.workflow || workflowConfig.workflow,
        context: {
          ...(workflowConfig.context || {}),
          ...(editingConfig?.context || {}),
        },
      };
      const config = buildWorkflowDesignConfigForSave(configBase, currentWorkflowDesignDraftState);
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

  const hasContextEditableRun = Boolean(runId || initialRunId || selectedRun?.id);

  const requestStartWorkflow = useCallback(async (
    mode: 'rehearsal' | 'real' = (rehearsalMode ? 'rehearsal' : 'real'),
    options?: {
      skipPreflight?: boolean;
      preflightChecks?: QualityCheckRecord[];
    },
  ) => {
    const nextPhaseDrafts = Object.fromEntries(
      startContextTargets.map((name: string) => [name, phaseContexts[name] || ''])
    ) as Record<string, string>;
    let preflightPreview: Awaited<ReturnType<typeof workflowApi.preflightPreview>> | null = null;
    if (!options?.skipPreflight) {
      try {
        preflightPreview = await workflowApi.preflightPreview(configFile);
      } catch (error: any) {
        toast('error', error?.message || '获取启动前检查预览失败');
        return;
      }
    }
    setPendingStartRequest({
      mode,
      skipPreflight: options?.skipPreflight,
      preflightChecks: options?.preflightChecks,
      preflightPreview,
    });
    setStartGlobalContextDraft(globalContext || '');
    setStartPhaseContextDrafts(nextPhaseDrafts);
    setStartContextFocusTarget(startContextTargets[0] || '');
    setShowStartWorkflowDialog(true);
  }, [configFile, globalContext, phaseContexts, rehearsalMode, startContextTargets, toast]);

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
    },
  ) => {
    const isRehearsalStart = mode === 'rehearsal';
    const skipPreflight = !!options?.skipPreflight;
    const initialContexts = options?.initialContexts;
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
      dispatch({ type: 'SET_GLOBAL_CONTEXT', payload: normalizedGlobalContext });
      dispatch({ type: 'SET_PHASE_CONTEXTS', payload: normalizedPhaseContexts });
      setStartupProgressMode(mode);
      setRehearsalProgressSteps([
        isRehearsalStart
          ? (skipPreflight ? '已进入演练模式，跳过启动前检查，正在创建演练运行' : '已进入演练模式，正在执行启动前检查')
          : (skipPreflight ? '正在正式启动，已跳过启动前检查，正在创建运行' : '正在正式启动，正在执行启动前检查'),
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
      if (!skipPreflight) {
        preflight = await workflowApi.preflight(configFile);
      }
      if (startupCancelRequestedRef.current) {
        setRehearsalProgressSteps((prev) => [...prev, '启动已取消']);
        return;
      }
      setPreflightChecks(preflight.checks || []);
      if (!skipPreflight) {
        setRehearsalProgressSteps((prev) => [...prev, `启动前检查完成：${preflight.failedCount > 0 ? `${preflight.failedCount} 项失败` : preflight.warningCount > 0 ? `${preflight.warningCount} 项警告` : '全部通过'}`]);
      } else {
        setRehearsalProgressSteps((prev) => [...prev, '已跳过启动前检查']);
      }
      if (!preflight.ok) {
        setRehearsalProgressSteps((prev) => [...prev, isRehearsalStart ? '演练已停止，请先处理启动前检查失败项' : '正式启动已停止，请先处理启动前检查失败项']);
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
      setWorkflowFrontendSessionId(null);
      addLog('system', 'info', isRehearsalStart ? '正在启动演练模式...' : '正在启动工作流...');
      setRehearsalProgressSteps((prev) => [...prev, isRehearsalStart ? '已通过检查，正在创建演练运行并等待结果' : '已通过检查，正在创建正式运行']);
      const startResult = await workflowApi.start(configFile, undefined, {
        skipPreflight: true,
        rehearsal: isRehearsalStart,
        preflightChecks: preflight.checks || [],
        initialContexts: {
          globalContext: normalizedGlobalContext,
          phaseContexts: normalizedPhaseContexts,
        },
      });
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
        latestRunIdRef.current = startResult.runId;
        dispatch({ type: 'SET_RUN_ID', payload: startResult.runId });
        dispatch({ type: 'SET_VIEW_MODE', payload: 'run' });
        updateUrl({ mode: 'run', run: startResult.runId });
      }
      setWorkflowFrontendSessionId(startResult.frontendSessionId || null);
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
      if (isRehearsalStart) {
        setRehearsalProgressSteps((prev) => [...prev, `演练启动失败：${error.message}`]);
      }
      dispatch({ type: 'SET_WORKFLOW_STATUS', payload: 'failed' });
      addLog('system', 'error', `启动失败: ${error.message}`);
    } finally {
      startupCancelRequestedRef.current = false;
      startupInProgressRef.current = false;
      setStartupCancelRequested(false);
      startupCreatedRunIdRef.current = null;
      setStarting(false);
    }
  };

  const confirmStartWorkflow = useCallback((contexts: WorkflowStartContexts, preflightMode: 'run' | 'skip' = 'run') => {
    if (!pendingStartRequest) return;
    const request = pendingStartRequest;
    setShowStartWorkflowDialog(false);
    setPendingStartRequest(null);
    setStartGlobalContextDraft(contexts.globalContext);
    setStartPhaseContextDrafts(contexts.phaseContexts);
    void startWorkflow(request.mode, {
      skipPreflight: request.skipPreflight || preflightMode === 'skip',
      preflightChecks: request.preflightChecks,
      initialContexts: contexts,
    });
  }, [pendingStartRequest, startWorkflow]);

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

    try {
      const result = await workflowApi.forceCompleteStep(configFile);
      addLog('system', 'info', `步骤 "${result.step}" 已强制放行 (${result.outputLength} 字符)`);
      fetchCurrentStatus();
    } catch (error: any) {
      addLog('system', 'error', `强制放行失败: ${error.message}`);
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
    setShowSystemPrompt(false);
    setFullStepOutput(null);
    const agent = agents.find((a) => a.name === step.agent);
    if (agent) {
      dispatch({ type: 'SET_SELECTED_AGENT', payload: agent });
      dispatch({ type: 'SET_SELECTED_STEP', payload: step });
      dispatch({ type: 'SET_ACTIVE_TAB', payload: 'agents' });
    }
  };

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
          const chunks = mergeAceSubtaskChunks(splitStreamChunks(streamContent));
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
          const chunks = mergeAceSubtaskChunks(splitStreamChunks(streamContent));
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
  const CHUNK_BOUNDARY_REGEX = /\r?\n*\s*<!--\s*chunk-boundary\s*-->\s*\r?\n*/gi;
  const CHUNK_BOUNDARY_SEARCH_REGEX = /\r?\n*\s*<!--\s*chunk-boundary\s*-->\s*\r?\n*/i;
  const CHUNK_WITH_TIME_REGEX = /^<!-- timestamp: (.+?) -->\n/;
  const splitStreamChunks = (content: string): string[] =>
    String(content || '').split(CHUNK_BOUNDARY_REGEX).filter(Boolean);

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

    if (workflowConfig?.workflow?.mode === 'state-machine') {
      const preferredStates = new Set<string>();
      if ((selectedStep as any)?.__stateName) preferredStates.add((selectedStep as any).__stateName);
      if (currentPhase) preferredStates.add(currentPhase);
      const states = workflowConfig.workflow.states || [];
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
    } else {
      for (const phase of workflowConfig?.workflow?.phases || []) {
        for (const step of phase.steps || []) {
          const stepName = String(step?.name || '').trim();
          if (!stepName) continue;
          const stepBase = stepName.replace(/-迭代\d+$/, '');
          if (
            rawBase === stepName
            || rawBase === stepBase
            || rawBase.endsWith(`-${stepName}`)
            || rawBase.endsWith(`-${stepBase}`)
          ) {
            return {
              stateName: phase.name,
              stepName,
            };
          }
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

  useEffect(() => {
    const parallelActiveSteps = Array.from(new Set(activeSteps.filter(Boolean)));
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
  }, [activeSteps, liveStreamStepSelection, selectedStep?.name]);

  // --- Live stream via SSE (opencode) or polling fallback (claude-code) ---
  const startLiveStream = () => {
    setShowLiveStream(true);
    if (liveStreamFeedbackRef.current) liveStreamFeedbackRef.current.value = '';
    setLiveFeedbackDraft('');
    liveFeedbackEditorRef.current?.clear();
    liveStreamLenRef.current = 0;
    liveStreamRawRef.current = '';
    setLiveStreamVisibleCount(LIVE_STREAM_PAGE_SIZE);
    liveStreamUserScrolledUp.current = false;
    setLiveStreamScrollLocked(false);
    setInlineFeedbacks(pendingLiveFeedbackRef.current);
    setLiveStream([]);

    // Close previous connection
    if (liveStreamRef.current) {
      if (liveStreamRef.current instanceof EventSource) liveStreamRef.current.close();
      else clearInterval(liveStreamRef.current);
      liveStreamRef.current = null;
    }

    const rid = liveStreamTarget.runId;
    const activeStep = liveStreamTarget.activeStep;
    liveStreamRunRef.current = rid;
    liveStreamStepRef.current = liveStreamTarget.stepKey;
    setLiveStreamSource(resolveLiveStreamSource(activeStep));

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

          const parts = sseRaw.split(CHUNK_BOUNDARY_REGEX);
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
        const latestActiveSteps = Array.from(new Set(activeSteps.filter(Boolean)));
        const preferredLiveStep = latestActiveSteps.length > 1 ? liveStreamTarget.activeStep : '';
        const curStep = preferredLiveStep || runningProc?.step || currentStep || (latestActiveSteps.length === 1 ? latestActiveSteps[0] : '') || (!isRunning ? selectedStep?.name : '');

        if (curStep !== liveStreamStepRef.current) {
          liveStreamRunRef.current = curRid || '';
          liveStreamStepRef.current = curStep;
          setLiveStreamSource(resolveLiveStreamSource(curStep));
          liveStreamLenRef.current = 0;
          liveStreamRawRef.current = '';
          setLiveStream([]);
          setInlineFeedbacks(pendingLiveFeedbackRef.current);
        }

        let content: string | null = null;
        if (curRid && curStep) {
          content = await streamApi.getStreamContent(curRid, curStep);
        }
        if (!content) {
          const running = workflowProcesses.find((p: any) => p.status === 'running' && p.runId === curRid && (!curStep || p.step === curStep))
            || workflowProcesses.find((p: any) => p.status === 'running' && p.runId === curRid);
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
              const segs = merged.split(CHUNK_BOUNDARY_REGEX);
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
    liveStreamRunRef.current = '';
    liveStreamStepRef.current = '';
    liveStreamRawRef.current = '';
    setShowLiveStream(false);
    setLiveStreamFullscreen(false);
    setLiveStreamScrollLocked(false);
  };

  // Auto-reconnect live stream when the active run or step changes while the panel is open.
  useEffect(() => {
    if (!showLiveStream) return;
    if (!liveStreamTarget.runId && !liveStreamTarget.stepKey) return;
    if (
      liveStreamRef.current
      && liveStreamRunRef.current === liveStreamTarget.runId
      && liveStreamStepRef.current === liveStreamTarget.stepKey
    ) {
      return;
    }
    startLiveStream();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLiveStream, liveStreamTarget.runId, liveStreamTarget.stepKey]);

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
      
      const res = await workflowApi.injectFeedback(feedback.trim(), interrupt, configFile, feedbackId);
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
      await workflowApi.recallFeedback(message, configFile);
    } catch (error: any) {
      toast('error', `撤回失败: ${error.message}`);
    }
  };

  const renderLiveStreamItems = () => {
    if (liveStream.length === 0 && inlineFeedbacks.length === 0) {
      return <div className="py-8 text-center text-sm text-muted-foreground">(等待输出...)</div>;
    }

    type Item = { type: 'chunk'; content: string; index: number } | ({ type: 'feedback' } & InlineFeedback);
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

    const filteredItems: Item[] = [];
    let pendingChunkItems: Array<{ type: 'chunk'; content: string; index: number }> = [];
    const flushPendingChunkItems = () => {
      if (!pendingChunkItems.length) return;
      filteredItems.push(...mergeAceSubtaskChunkItems(pendingChunkItems, CHUNK_SEP));
      pendingChunkItems = [];
    };
    for (const rawItem of rawFilteredItems) {
      if (rawItem.type === 'chunk') pendingChunkItems.push(rawItem);
      else {
        flushPendingChunkItems();
        filteredItems.push(rawItem);
      }
    }
    flushPendingChunkItems();

    const hasMore = filteredItems.length > liveStreamVisibleCount;
    const visibleItems = hasMore ? filteredItems.slice(filteredItems.length - liveStreamVisibleCount) : filteredItems;

    return (
      <div className="space-y-3">
        {hasMore && (
          <div className="py-2 text-center">
            <button
              className="text-xs text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE)}
            >
              加载更早的 {filteredItems.length - liveStreamVisibleCount} 条内容...
            </button>
          </div>
        )}
        {visibleItems.map((item, i) => {
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
              <div key={`fb-${i}`} className="group flex justify-end">
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
          if (parsed.isHumanFeedback) {
            return (
              <div key={`c-${i}`} className="flex justify-end">
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
            <div key={`c-${i}`} className="border-b border-border/50 pb-3 last:border-0">
              {parsed.timestamp && (
                <div className="mb-1 font-mono text-[10px] text-muted-foreground">
                  {new Date(parsed.timestamp).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </div>
              )}
              <div className="text-sm">
                <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} />
              </div>
            </div>
          );
        })}
        {isRunning && (() => {
          const lastChunk = liveStream[liveStream.length - 1] || '';
          const isExecuting = /\*\*🔧 .+?\*\*[^]*$/.test(lastChunk) && !/<\/details>\s*$/.test(lastChunk.trim());
          const statusText = isExecuting ? '执行中...' : '思考中...';
          return (
            <div className={styles.thinkingBot} aria-live="polite">
              <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
              <Shimmer as="span" className={styles.thinkingText}>{statusText}</Shimmer>
              <span className={styles.thinkingDots}><span>.</span><span>.</span><span>.</span></span>
            </div>
          );
        })()}
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
          {liveStreamTarget.parallelActiveSteps.length > 1 ? (
            <div className="mt-2 flex items-center gap-2">
              <span className="shrink-0 text-[11px] text-muted-foreground">并发步骤</span>
              <Select
                value={liveStreamTarget.activeStep || liveStreamStepSelection || liveStreamTarget.parallelActiveSteps[0] || ''}
                onValueChange={(value) => setLiveStreamStepSelection(value)}
              >
                <SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
                  <SelectValue placeholder="选择实时输出步骤" />
                </SelectTrigger>
                <SelectContent>
                  {liveStreamTarget.parallelActiveSteps.map((stepKey) => {
                    const source = resolveLiveStreamSource(stepKey);
                    const label = [source.stateName ? formatStateName(source.stateName) : '', source.stepName || stepKey]
                      .filter(Boolean)
                      .join(' / ');
                    return (
                      <SelectItem key={stepKey} value={stepKey} className="text-xs">
                        {label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 px-0"
          onClick={startLiveStream}
          title="刷新实时输出"
        >
          <span className="material-symbols-outlined text-base">refresh</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 px-0"
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
        </Button>
      </div>
      <div
        ref={liveStreamScrollRef}
        className="min-h-0 flex-1 overflow-auto px-4 pb-4"
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
          liveStreamUserScrolledUp.current = !atBottom;
          setLiveStreamScrollLocked(!atBottom);
          if (el.scrollTop === 0 && liveStream.length > liveStreamVisibleCount) {
            setLiveStreamVisibleCount(prev => prev + LIVE_STREAM_PAGE_SIZE);
          }
        }}
      >
        {renderLiveStreamItems()}
      </div>
      <div className="p-3 pt-0">
        <div className="home-chat-composer relative overflow-hidden rounded-[24px] border border-border/70 bg-background shadow-[0_10px_26px_rgba(15,23,42,0.05)]">
          <RichTextEditor
            ref={liveFeedbackEditorRef}
            content={liveFeedbackDraft}
            onChange={(markdown) => setLiveFeedbackDraft(markdown)}
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

  const openContextEditor = (_scope: 'global' | 'phase' = 'global', phase?: string) => {
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
    setContextEditorFocusTarget(phase || '');
    setShowContextEditor(true);
  };

  const saveContext = async (contexts: WorkflowStartContexts) => {
    try {
      setSavingContextEditor(true);
      const rid = runId || initialRunId || selectedRun?.id;

      setContextEditorGlobalDraft(contexts.globalContext);
      setContextEditorPhaseDrafts(contexts.phaseContexts);

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
      const existingStep = newConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex] || {};
      const nextStep = {
        ...existingStep, ...data,
      };
      if (Object.prototype.hasOwnProperty.call(data, 'specTaskBinding') && !data.specTaskBinding) {
        delete nextStep.specTaskBinding;
      }
      if (Object.prototype.hasOwnProperty.call(data, 'preCommands') && (!Array.isArray(data.preCommands) || data.preCommands.length === 0)) {
        delete nextStep.preCommands;
      }
      newConfig.workflow.phases[editingNode.phaseIndex].steps[editingNode.stepIndex] = nextStep;
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
      const config = buildWorkflowDesignConfigForSave(editingConfig, currentWorkflowDesignDraftState);
      const specCodingDocument = specCodingSummary && specCodingDetails ? {
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
                { label: '进行中', value: specCodingTaskProgress.inProgress, tone: 'text-blue-600' },
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
                        ? 'border-blue-500/40 bg-blue-500/10 shadow-[0_0_0_1px_rgba(59,130,246,0.12)]'
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
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
                            <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
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

        <div className={`grid gap-3 ${hasQualityChecks && memoryLayers ? 'xl:grid-cols-2' : ''}`}>
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
            ) : (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-1">
                <div className="text-[11px] font-medium text-foreground">复盘记忆</div>
                <div className="text-[11px] leading-5 text-muted-foreground">暂无复盘内容</div>
              </div>
            )}
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
            ) : (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-foreground">角色长期记忆</div>
                <div className="text-[11px] leading-5 text-muted-foreground">暂无角色长期记忆</div>
              </div>
            )}
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
            ) : (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-foreground">项目级共享记忆</div>
                <div className="text-[11px] leading-5 text-muted-foreground">暂无项目共享记忆</div>
              </div>
            )}
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
            ) : (
              <div className="rounded-xl border bg-muted/20 p-3 space-y-2">
                <div className="text-[11px] font-medium text-foreground">Workflow 记忆</div>
                <div className="text-[11px] leading-5 text-muted-foreground">暂无 workflow 记忆</div>
              </div>
            )}
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

  const renderSpecCodingOverviewCard = () => {
    if (!specCodingSummary) {
      return (
        <div className="rounded-2xl border bg-background/75 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
                <h3 className="text-base font-semibold">Spec 基线</h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                当前工作流没有绑定 spec 规格；需要完整制品时可在配置页查看或维护。
              </p>
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setDesignTab('config')}>
              去配置
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border bg-background/75 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>fact_check</span>
              <h3 className="text-base font-semibold">Spec 基线摘要</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              概览只展示当前设计依据；完整制品、任务状态和修订入口放在配置页。
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="outline" className="text-[10px]">v{specCodingSummary.version}</Badge>
            <Badge variant="secondary" className="text-[10px]">{specCodingSummary.status}</Badge>
            {specCodingSummary.source ? (
              <Badge variant="outline" className="text-[10px]">
                {specCodingSummary.source === 'run' ? 'Run Snapshot' : 'Creation Baseline'}
              </Badge>
            ) : null}
          </div>
        </div>
        {specCodingSummary.summary ? (
          <div className="rounded-xl border bg-muted/20 p-3 text-sm leading-6 text-muted-foreground">
            {specCodingSummary.summary}
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="text-[10px] text-muted-foreground">阶段/状态</div>
            <div className="mt-1 text-lg font-semibold">{specCodingSummary.phaseCount || specCodingDetails?.phases?.length || 0}</div>
          </div>
          <div className="rounded-xl border bg-muted/20 p-3">
            <div className="text-[10px] text-muted-foreground">任务</div>
            <div className="mt-1 text-lg font-semibold">{specCodingTaskProgress.total || specCodingSummary.taskCount || 0}</div>
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
        {specCodingSummary.latestRevision ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs leading-5 text-muted-foreground">
            <div className="font-medium text-foreground">最近修订 v{specCodingSummary.latestRevision.version}</div>
            <div className="mt-1">{specCodingSummary.latestRevision.summary}</div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setDesignTab('config');
            }}
          >
            查看配置页
          </Button>
          <Button
            size="sm"
            className="h-8 text-xs"
            onClick={() => {
              setSpecArtifactViewMode('preview');
              setSpecCodingExplorerTab('artifacts');
              setSpecCodingModalOpen(true);
            }}
          >
            打开 Spec
          </Button>
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
                    { label: '进行中', value: specCodingTaskProgress.inProgress, tone: 'text-blue-600' },
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

  const renderSpecCodingExplorer = () => (
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
                        {specAiSessionId ? '发送调整' : '生成候选'}
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
                    onChange={(value) => setSpecRevisionDraft(value || '')}
                    onMount={(editor, monaco) => {
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

  if (pageLoading && isDesignMode && !isHistoryMode) {
    return <BrandLoadingScreen message="加载工作流配置..." />;
  }

  if (loadError && isDesignMode && !isHistoryMode) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-background text-foreground gap-4">
        <span className="material-symbols-outlined text-4xl text-destructive">error</span>
        <p className="text-sm text-destructive">{loadError}</p>
        <div className="flex gap-2">
          <Button variant="outline" asChild><Link href="/">返回首页</Link></Button>
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
      <div className="shrink-0 border-b bg-muted">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <div className="flex items-center gap-2 shrink-0 min-w-0">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={goBackToWorkflows}>
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
              onClick={() => requestStartWorkflow()}
              disabled={!canStartWorkflow}
            >
              {starting ? (
                <ClipLoader color="currentColor" size={14} className="mr-1" />
              ) : (
                <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>play_arrow</span>
              )}
              <span className="hidden sm:inline">{starting ? '启动中...' : rehearsalMode ? '开始演练' : '启动工作流'}</span>
              <span className="sm:hidden">{starting ? '...' : '启动'}</span>
            </Button>
            {!rehearsalMode ? (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => requestStartWorkflow('real', { skipPreflight: true })}
                disabled={!canStartWorkflow}
                title="跳过启动前检查，直接创建正式运行"
              >
                <span className="material-symbols-outlined mr-1" style={{ fontSize: 14 }}>fast_forward</span>
                <span className="hidden sm:inline">跳过检查启动</span>
                <span className="sm:hidden">跳过</span>
              </Button>
            ) : null}
            <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={requestStopWorkflow} disabled={!isRunning && workflowStatus !== 'running'}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>stop</span><span className="hidden sm:inline">停止</span>
            </Button>
            <ButtonGroup>
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => dispatch({ type: 'SET_SHOW_PROCESS_PANEL', payload: !showProcessPanel })}>
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>settings</span><span className="hidden sm:inline">进程</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => openContextEditor('global')}
                disabled={!hasContextEditableRun}
                title={hasContextEditableRun ? '全局上下文' : '当前没有可编辑上下文的运行记录'}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 14 }}>edit_note</span><span className="hidden sm:inline">上下文</span>
              </Button>
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
      </div>

      <div className="flex-1 flex overflow-hidden">
        {isRunMode && (
          <ResizablePanels
            leftPanel={
              <div className="flex flex-col h-full overflow-hidden">
              <ResizablePanelGroup orientation="vertical" className="h-full">
                <ResizablePanel defaultSize={32} minSize={18}>
                  <div className="flex h-full flex-col overflow-hidden border-b">
                    <button
                      className="w-full flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent hover:from-primary/15 transition-colors"
                      onClick={() => setShowRunRequirements(!showRunRequirements)}
                    >
                      <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>assignment</span>
                      <div className="min-w-0 flex-1 text-left">
                        <div className="text-sm font-semibold text-primary">运行摘要</div>
                        {!showRunRequirements ? (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                            <span>{workspaceMode === 'isolated-copy' ? '副本执行' : '目录执行'}</span>
                            <span>·</span>
                            <span>{timeoutMinutes} 分钟超时</span>
                            <span>·</span>
                            <span>{skills.length} Skills</span>
                          </div>
                        ) : null}
                      </div>
                      <span className="material-symbols-outlined text-muted-foreground ml-auto" style={{ fontSize: 16 }}>{showRunRequirements ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    {showRunRequirements ? (
                      <div className="flex-1 overflow-y-auto overflow-x-hidden bg-card/50 px-4 py-3">
                        <div className="space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="rounded-xl border bg-background/75 p-3">
                              <div className="text-[10px] text-muted-foreground">工作区模式</div>
                              <div className="mt-1 text-xs font-medium leading-5">{workspaceMode === 'isolated-copy' ? '先创建副本工程再执行' : '直接在工作目录执行'}</div>
                            </div>
                            <div className="rounded-xl border bg-background/75 p-3">
                              <div className="text-[10px] text-muted-foreground">步骤超时</div>
                              <div className="mt-1 text-xs font-medium leading-5">{timeoutMinutes} 分钟</div>
                            </div>
                          </div>
                          {projectRoot ? (
                            <div className="rounded-xl border bg-background/75 p-3">
                              <div className="text-[10px] text-muted-foreground">项目根目录</div>
                              <div className="mt-1 break-all text-xs leading-5">{projectRoot}</div>
                            </div>
                          ) : null}
                          <div className="rounded-xl border bg-background/75 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] text-muted-foreground">需求描述</div>
                              {requirements ? <Badge variant="outline" className="text-[10px]">Markdown</Badge> : null}
                            </div>
                            <div className="mt-2 text-xs leading-6 prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                              {requirements?.trim() ? (
                                <Markdown>{requirements}</Markdown>
                              ) : (
                                <div className="text-xs text-muted-foreground">暂无需求描述</div>
                              )}
                            </div>
                          </div>
                          {skills.length > 0 ? (
                            <div className="rounded-xl border bg-background/75 p-3">
                              <div className="text-[10px] text-muted-foreground">Skills</div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {skills.slice(0, showAllSkills ? skills.length : 8).map((s) => (
                                  <Badge key={s} variant="secondary" className="text-[10px] font-normal">{s}</Badge>
                                ))}
                                {skills.length > 8 && (
                                  <button
                                    className="text-[10px] text-muted-foreground hover:text-foreground px-1"
                                    onClick={() => setShowAllSkills(!showAllSkills)}
                                  >
                                    {showAllSkills ? '收起' : `+${skills.length - 8} 更多`}
                                  </button>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <div className="border-t bg-card/30 px-4 py-2">
                        <div className="flex flex-wrap gap-1.5">
                          {projectRoot ? <Badge variant="outline" className="max-w-full truncate text-[10px]">{projectRoot}</Badge> : null}
                          <Badge variant="secondary" className="text-[10px]">{workspaceMode === 'isolated-copy' ? '副本执行' : '目录执行'}</Badge>
                          <Badge variant="secondary" className="text-[10px]">{timeoutMinutes} 分钟</Badge>
                          {requirements?.trim() ? <Badge variant="outline" className="text-[10px]">已填写需求</Badge> : null}
                        </div>
                      </div>
                    )}
                  </div>
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={68} minSize={28}>
              <Tabs value={activeTab === 'spec-coding' ? 'spec' : activeTab} onValueChange={(val) => dispatch({ type: 'SET_ACTIVE_TAB', payload: val })} className="flex flex-col flex-1 h-full overflow-hidden">
                <TabsList className="w-full rounded-none border-b flex-shrink-0 px-1 !flex flex-wrap h-auto gap-0.5 py-1">
                  <TabsTrigger value="workflow" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>dashboard</span>总览
                  </TabsTrigger>
                  <TabsTrigger value="agents" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>groups</span>Agent
                  </TabsTrigger>
                  <TabsTrigger value="spec" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>fact_check</span>Spec
                  </TabsTrigger>
                  <TabsTrigger value="documents" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>description</span>文档
                  </TabsTrigger>
                  <TabsTrigger value="schedules" className="flex items-center justify-center gap-1 text-xs h-7 px-2">
                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>schedule</span>定时任务
                  </TabsTrigger>
                  {(isDesignMode) && <TabsTrigger value="config" className="flex items-center justify-center gap-1 text-xs h-7 px-2"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>settings</span>配置</TabsTrigger>}
                </TabsList>
                <div className="flex-1 overflow-hidden min-h-0">
                <TabsContent value="workflow" className="mt-0 overflow-y-auto h-full p-4">
                  {workflowConfig && (
                    <div>
                      {(() => {
                        const isStepRunningInNode = (step: any, nodeName?: string) => {
                          const candidates = [step?.name, nodeName ? `${nodeName}-${step?.name}` : ''].filter(Boolean);
                          return [...activeSteps, currentStep].filter(Boolean).some((key) =>
                            candidates.some((candidate) =>
                              key === candidate
                              || key.startsWith(`${candidate}-迭代`)
                              || key.endsWith(`-${candidate}`)
                            )
                          );
                        };

                        const isStepCompletedInNode = (step: any, nodeName?: string) => {
                          const candidates = [step?.name, nodeName ? `${nodeName}-${step?.name}` : ''].filter(Boolean);
                          return completedSteps?.some((key) =>
                            candidates.some((candidate) =>
                              key === candidate
                              || key.startsWith(`${candidate}-迭代`)
                              || key.endsWith(`-${candidate}`)
                            )
                          );
                        };

                        return (
                          <>
                      <div className="rounded-2xl border border-border/60 bg-background/75 p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>account_tree</span>
                              <h3 className="text-sm font-semibold leading-5">{workflowConfig.workflow.name}</h3>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <Badge variant="outline" className="text-[10px]">
                                {workflowConfig.workflow.mode === 'state-machine' ? '状态机' : '阶段式'}
                              </Badge>
                              {workflowStatus ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  {workflowStatus}
                                </Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>
                        <div className="mt-3 text-xs text-muted-foreground leading-6 prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
                          {workflowConfig.workflow.description?.trim() ? (
                            <Markdown>{workflowConfig.workflow.description}</Markdown>
                          ) : (
                            <div className="text-xs text-muted-foreground">暂无工作流描述</div>
                          )}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2">
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">{workflowConfig.workflow.mode === 'state-machine' ? '状态' : '阶段'}</div>
                            <div className="mt-1 text-base font-semibold">{workflowConfig.workflow.mode === 'state-machine' ? (workflowConfig.workflow.states?.length ?? 0) : (workflowConfig.workflow.phases?.length ?? 0)}</div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">步骤</div>
                            <div className="mt-1 text-base font-semibold">{totalSteps}</div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">Agent</div>
                            <div className="mt-1 text-base font-semibold">{orderedWorkflowAgents.length}</div>
                          </div>
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
                                return { name: s.agent, team: role?.team, role: s.role };
                              })
                            : [{ name: phase.agent, team: agentConfigs.find((r: any) => r.name === phase.agent)?.team, role: undefined }];
                          const iterState = iterationStates[phase.name];
                          const isActive = currentPhase === phase.name;
                          const hasRunningStep = (phase.steps || []).some((step: any) => isStepRunningInNode(step, phase.name));
                          const isDone = phase.steps 
                            ? phase.steps.every((s: any) => isStepCompletedInNode(s, phase.name))
                            : completedSteps?.includes(phase.name);
                          const nodeStatus = hasRunningStep || (isActive && workflowStatus === 'running')
                            ? 'running'
                            : isDone
                              ? 'completed'
                              : 'pending';
                          return (<div key={idx}
                            className={`bg-muted rounded-md p-2.5 cursor-pointer transition-colors hover:bg-accent border-l-[3px] ${
                              nodeStatus === 'running'
                                ? 'border-l-primary bg-accent'
                                : nodeStatus === 'completed'
                                  ? 'border-l-green-500'
                                  : 'border-transparent'
                            }`}
                            onClick={() => {
                              // 触发流程图跳转到该节点
                              if (workflowConfig.workflow.mode === 'state-machine') {
                                selectStateDetails(phase.name);
                              } else {
                                setFocusedState(phase.name);
                                if (phase.steps.length > 0) {
                                  selectStep(phase.steps[0]);
                                }
                              }
                            }}
                          >
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-sm font-medium">{phase.name}</span>
                              <div className="flex items-center gap-1">
                                <Badge
                                  variant="outline"
                                  className={`text-[10px] ${
                                    nodeStatus === 'running'
                                      ? 'border-blue-500/30 bg-blue-500/10 text-blue-600'
                                      : nodeStatus === 'completed'
                                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                                        : 'text-muted-foreground'
                                  }`}
                                >
                                  {nodeStatus === 'running' ? '运行中' : nodeStatus === 'completed' ? '已完成' : '未开始'}
                                </Badge>
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
                                <Badge key={i} variant="outline" className={`text-[10px] ${a.team === 'blue' ? 'bg-blue-500/20 text-blue-400 border-blue-500/30' : a.team === 'red' ? 'bg-red-500/20 text-red-400 border-red-500/30' : a.team === 'judge' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' : 'bg-muted/40 text-muted-foreground border-border'}`}>
                                  <span className="material-symbols-outlined" style={{ fontSize: 10 }}>{a.team === 'blue' ? 'swords' : a.team === 'judge' ? 'gavel' : a.team === 'red' ? 'shield' : 'radio_button_unchecked'}</span> {a.name}
                                </Badge>
                              ))}
                            </div>
                          </div>);
                        })}
                      </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="agents" className="mt-0 overflow-y-auto h-full p-4"><div className="flex flex-col gap-3">
                  <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                    <div className="text-sm font-medium">运行通讯录</div>
                    <div className="text-xs text-muted-foreground">查看当前 run 中的 Agent 状态。</div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-2 pr-2 font-medium">角色</th>
                          <th className="pb-2 pr-2 font-medium">状态</th>
                          <th className="pb-2 pr-2 font-medium">模型</th>
                          <th className="pb-2 font-medium">操作</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {orderedWorkflowAgents.map((agent) => {
                          const roleConfig = agentConfigs.find((role: any) => role.name === agent.name);
                          const entry = workflowDirectory.find((item) => item.label === agent.name);
                          const avatarSrc = resolveAgentAvatarSrc(roleConfig?.avatar, agent.name, {
                            team: roleConfig?.team || agent.team || 'blue',
                            roleType: roleConfig?.roleType || 'normal',
                          });
                          return (
                            <tr
                              key={agent.name}
                              className={`cursor-pointer transition-colors hover:bg-muted/30 ${selectedAgent?.name === agent.name ? 'bg-primary/5' : ''}`}
                              onClick={() => dispatch({ type: 'SET_SELECTED_AGENT', payload: agent })}
                            >
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-2">
                                  <SpriteAvatar
                                    avatar={avatarSrc}
                                    seed={agent.name}
                                    category="agent-default"
                                    alt={agent.name}
                                    fallback={agent.name.charAt(0).toUpperCase()}
                                    className="h-6 w-6 ring-1 ring-border/60"
                                    fallbackClassName="bg-primary/10 text-[10px] font-bold text-primary"
                                  />
                                  <div className="min-w-0">
                                    <div className="font-medium text-foreground truncate max-w-[140px]">{agent.name}</div>
                                    {roleConfig?.roleType && (
                                      <div className="text-[10px] text-muted-foreground">{roleConfig.roleType}</div>
                                    )}
                                  </div>
                                </div>
                              </td>
                              <td className="py-2 pr-2">
                                <div className="flex items-center gap-1.5">
                                  <span className={`h-2 w-2 shrink-0 rounded-full ${agent.status === 'running' ? 'bg-blue-500 animate-pulse' : agent.status === 'completed' ? 'bg-green-500' : agent.status === 'failed' ? 'bg-red-500' : 'bg-gray-400'}`} />
                                  <span className="text-muted-foreground">{agent.status}</span>
                                </div>
                              </td>
                              <td className="py-2 pr-2 text-muted-foreground truncate max-w-[80px]">{agent.model || '—'}</td>
                              <td className="py-2">
                                {workflowFrontendSessionId ? (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-6 px-2 text-[10px] relative z-10"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      openWorkbenchConversation(workflowFrontendSessionId, agent);
                                    }}
                                    title="打开本次运行的 Supervisor 协作议题"
                                  >
                                    <span className="material-symbols-outlined" style={{ fontSize: 14 }}>message</span>
                                  </Button>
                                ) : (
                                  <div className="cursor-not-allowed">
                                    <Button
                                      size="sm"
                                      variant="ghost"
                                      className="h-6 px-2 text-[10px] pointer-events-none opacity-40"
                                    >
                                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>message</span>
                                    </Button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div></TabsContent>
                <TabsContent value="spec" className="mt-0 overflow-y-auto h-full p-4">
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                      <div className="text-sm font-medium">spec 规格与任务状态</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        查看当前 run 的 spec 规格、tasks.md 状态跟踪、修订记录和制品列表。
                      </div>
                    </div>
                    {renderPersistedSpecCard()}
                    {renderSpecCodingPanel()}
                  </div>
                </TabsContent>
                <TabsContent value="documents" className="mt-0 h-full overflow-hidden p-4">
                  <div className="flex h-full min-h-0 flex-col gap-3">
                    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                      <div className="text-sm font-medium">文档</div>
                      <div className="mt-1 text-xs text-muted-foreground">查看本次运行产生的文档与制品目录。</div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-hidden rounded-xl border">
                      <DocumentsPanel
                        runId={runId || selectedRun?.id || null}
                        openLatestTimestampedRequest={openLatestAiDocRequest}
                        onOpenWorkspaceDirectory={(path) => openWorkspaceEditorAtPath(path, '文档目录')}
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="schedules" className="mt-0 overflow-y-auto h-full p-4">
                  <div className="space-y-3">
                    <div className="rounded-2xl border border-border/60 bg-background/70 px-3 py-3">
                      <div className="text-sm font-medium">定时任务</div>
                      <div className="mt-1 text-xs text-muted-foreground">查看与当前配置关联的定时运行安排。</div>
                    </div>
                    <div className="h-[calc(100vh-220px)] min-h-[360px] overflow-hidden rounded-xl border">
                      <SchedulesPanel configFile={configFile} />
                    </div>
                  </div>
                </TabsContent>
{isDesignMode && <TabsContent value="config" className="mt-0 overflow-y-auto h-full p-4">
                  <div className="mx-auto max-w-3xl space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold">高级配置</h4>
                      <p className="mt-1 text-xs text-muted-foreground">这些设置会保存到当前 workflow YAML，并影响后续运行。</p>
                    </div>
                    <div className="rounded-xl border border-border/60 bg-background/80 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="material-symbols-outlined text-primary" style={{ fontSize: 17 }}>history</span>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">Git 基线与变更追踪</div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              开启后，运行启动时会建立 Git 基线，并记录步骤前后的快照，用于“变更”页差异浏览。关闭后不会建立基线，也不会发起 Git 变更查询或轮询。
                            </p>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
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
                    <div className="flex justify-end">
                      <Button size="sm" className="h-8 text-xs" onClick={() => void saveConfig()} disabled={saving || !workflowConfig}>
                        {saving ? '保存中...' : '保存高级配置'}
                      </Button>
                    </div>
                  </div>
                </TabsContent>}
                </div>
              </Tabs>
                </ResizablePanel>
              </ResizablePanelGroup>
              </div>
            }
            centerPanel={
              <div className="flex h-full flex-col overflow-hidden">
                <div className="shrink-0 border-b bg-muted px-4 py-2">
                  <div className="mx-auto flex w-full max-w-5xl justify-center">
                    <div className="grid w-full max-w-4xl grid-cols-1 gap-2 md:grid-cols-3">
                      {[
                        {
                          key: 'execution' as const,
                          title: '执行追踪',
                          subtitle: '运行态势 / Supervisor / Token',
                          icon: 'monitoring',
                          disabled: false,
                        },
                        {
                          key: 'workspace' as const,
                          title: '工作区',
                          subtitle: '文件浏览 / 编辑器',
                          icon: 'folder_open',
                          disabled: !currentRunWorkspacePath,
                        },
                        {
                          key: 'changes' as const,
                          title: '变更',
                          subtitle: 'Git 工作树 / 差异浏览',
                          icon: 'history',
                          disabled: !currentRunWorkspacePath || !effectiveGitBaselineEnabled,
                        },
                      ].map((tab) => {
                        const active = runWorkbenchTab === tab.key;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            onClick={() => !tab.disabled && handleRunWorkbenchTabChange(tab.key)}
                            disabled={tab.disabled}
                            className={cn(
                              'flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl border px-3 py-2 text-center transition-colors',
                              active
                                ? 'border-primary bg-background text-foreground shadow-sm'
                                : 'border-border/60 bg-muted/25 text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                              tab.disabled && 'cursor-not-allowed opacity-45 hover:bg-muted/25 hover:text-muted-foreground',
                            )}
                          >
                            <div className="flex items-center gap-1.5 text-sm font-semibold leading-none">
                              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{tab.icon}</span>
                              <span>{tab.title}</span>
                              {tab.key === 'changes' && effectiveGitBaselineEnabled ? (
                                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                                  {workspaceChangeCount > 99 ? '99+' : workspaceChangeCount}
                                </span>
                              ) : null}
                            </div>
                            <div className="text-[10px] leading-3.5">{tab.subtitle}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {runWorkbenchTab === 'execution' ? (
                    <div className="flex h-full flex-col">
                      <div className="flex-1 min-h-0 overflow-hidden">
                        {workflowConfig ? (
                          workflowConfig.workflow.mode === 'state-machine' ? (
                            isDesignMode ? (
                              <StateMachineDiagram
                                states={workflowConfig.workflow.states || []}
                                agents={agentConfigs}
                                currentState={currentPhase}
                                currentStep={currentStep}
                                activeSteps={activeSteps}
                                completedSteps={completedSteps}
                                stateHistory={smStateHistory}
                                isRunning={isRunning}
                                allowForceTransition={canForceTransition}
                                onStateClick={selectStateDetails}
                                onStepClick={(step) => selectStep(step)}
                                onForceTransition={handleForceTransition}
                              />
                            ) : (
                              <div className="h-full p-4">
                                <StateMachineExecutionView
                                  states={workflowConfig.workflow.states || []}
                                  agents={agentConfigs}
                                  currentState={currentPhase}
                                  currentStep={currentStep}
                                  activeSteps={activeSteps}
                                  activeConcurrencyGroups={activeConcurrencyGroups}
                                  completedSteps={completedSteps}
                                  stateHistory={smStateHistory}
                                  issueTracker={smIssueTracker}
                                  transitionCount={smTransitionCount}
                                  maxTransitions={workflowConfig.workflow.maxTransitions || 50}
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
                                  overviewFooter={renderRuntimeInsightPanels()}
                                  supervisorDirectPanel={(
                                    <WorkflowSupervisorAgoraPanel
                                      sessionId={workbenchConversationSessionId || workflowFrontendSessionId}
                                      title={`Supervisor 协作 · ${workflowBaseTitle}`}
                                      configFile={configFile}
                                      runId={runId || selectedRun?.id || null}
                                      supervisorAgent={runtimeSupervisorAgent}
                                      supervisorSessionId={runtimeSupervisorSessionId}
                                      workingDirectory={currentRunWorkspacePath || projectRoot || ''}
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
                                              states={workflowConfig.workflow.states || []}
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
                                  )}
                                  supervisorFooter={workflowStatus === 'completed' ? renderFinalReviewCard() : null}
                                  activeTabOverride={executionViewTabOverride}
                                  hasPendingHumanQuestion={!!pendingHumanQuestion}
                                  pendingHumanQuestion={pendingHumanQuestion as any}
                                  formationAgents={supervisorFormationAgents}
                                  supervisorAgent={runtimeSupervisorAgent}
                                  onStateClick={selectStateDetails}
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
                        ) : (<WorkbenchExecutionLoadingSkeleton />)}
                      </div>
                    </div>
                  ) : runWorkbenchTab === 'workspace' ? (
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
                          />
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/70 p-6 text-center text-sm text-muted-foreground">
                          当前运行还没有可用的工作区目录。
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-muted/20 p-4">
                      {currentRunWorkspacePath && effectiveGitBaselineEnabled ? (
                        <GitWorkspaceDiffPanel
                          workspacePath={currentRunWorkspacePath}
                          runId={runId || selectedRun?.id || null}
                          isRunning={isRunning}
                          presentation="embedded"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/70 p-6 text-center text-sm text-muted-foreground">
                          {currentRunWorkspacePath ? '当前工作流已关闭 Git 基线与变更追踪。' : '当前运行还没有可用的 Git 工作区。'}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            }
            rightPanel={
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
                  // in completedSteps/failedSteps, since FlowDiagram marks non-last rounds as completed
                  // even if completedSteps only contains the base name or a different iteration key.
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
                <div className="border-b bg-muted">
                  <div className="flex h-10 items-center justify-between gap-2 px-3">
                    <h2 className="min-w-0 truncate text-sm font-semibold">
                      {rightPanelTab === 'live'
                        ? '实时输出'
                        : selectedStep ? (stepKey !== selectedStep.name ? stepKey : selectedStep.name) : selectedAgent ? selectedAgent.name : 'Agent 详情'}
                    </h2>
                  </div>
                  <div className="flex gap-1 px-2 pb-1">
                    {[
                      { key: 'detail' as const, label: '详情', icon: 'info' },
                      { key: 'live' as const, label: '实时', icon: 'cell_tower' },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => {
                          setRightPanelTab(tab.key);
                          if (tab.key === 'live') startLiveStream();
                        }}
                        className={`flex h-7 flex-1 items-center justify-center gap-1 rounded-md px-2 text-xs transition-colors ${rightPanelTab === tab.key ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'}`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{tab.icon}</span>
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={`flex-1 min-h-0 ${rightPanelTab === 'detail' ? 'overflow-auto' : 'overflow-hidden'}`}>
                  {rightPanelTab === 'live' ? renderLiveStreamPanel() : (<>
              {selectedStep && (
                <div className="bg-muted border-b p-3.5">
                  <div className="flex items-center gap-2 mb-2.5">
                    <span className="material-symbols-outlined text-base">
                      {selectedRoleConfig?.team === 'blue' ? 'swords' : selectedRoleConfig?.team === 'judge' ? 'gavel' : selectedRoleConfig?.team === 'red' ? 'shield' : 'radio_button_unchecked'}
                    </span>
                    <span className="text-sm font-semibold flex-1">{selectedStep.name}</span>
                    {isCurrentStepRunning ? (
                      <Badge className="border-blue-500/30 bg-blue-500/10 text-[10px] text-blue-600">运行中</Badge>
                    ) : isStepDone ? (
                      <Badge className="border-emerald-500/30 bg-emerald-500/10 text-[10px] text-emerald-600">已完成</Badge>
                    ) : isStepFailed ? (
                      <Badge variant="destructive" className="text-[10px]">失败</Badge>
                    ) : null}
                    {selectedStep.agent && (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{selectedStep.agent}</Badge>
                    )}
                    {selectedRoleConfig && (
                      <Badge className={selectedRoleConfig.team === 'blue' ? 'bg-blue-500/20 text-blue-400' : selectedRoleConfig.team === 'red' ? 'bg-red-500/20 text-red-400' : selectedRoleConfig.team === 'judge' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-muted text-muted-foreground'}>{selectedRoleConfig.team}</Badge>
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
                  {isCurrentStepRunning ? (
                    <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                      <div className="flex items-start gap-2">
                        <span className="material-symbols-outlined mt-0.5 text-amber-600" style={{ fontSize: 16 }}>warning</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">强制放行当前步骤</div>
                          <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                            仅当你确认实时输出已经足够作为结果时使用。系统会中断当前步骤，并用已有输出继续推进工作流。
                          </p>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="mt-2 h-8 text-xs"
                            onClick={forceCompleteStep}
                            disabled={!canForceCompleteStep}
                          >
                            <span className="material-symbols-outlined mr-1 text-sm">published_with_changes</span>
                            强制放行当前步骤
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : null}
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
                    const chunks = splitStreamChunks(displayText);
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
                              <AceAwareMarkdown content={prepareChunkForDisplay(chunk)} />
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
                systemPrompt={agentConfigs.find((role: any) => role.name === selectedAgent.name)?.systemPrompt}
                iterationPrompt={agentConfigs.find((role: any) => role.name === selectedAgent.name)?.iterationPrompt}
                compact={!!selectedStep} />
              ) : (pageLoading || !workflowConfig ? <WorkbenchAgentDetailSkeleton /> : <div className="flex flex-col items-center justify-center h-full text-muted-foreground"><span className="material-symbols-outlined text-5xl mb-4">smart_toy</span><p>选择一个 Agent 查看详情</p></div>)}
              </>)}
            </div>
                  </>);
                })()}
              </div>
            }
          />
        )}
        {isDesignMode && editingConfig && (<>
          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-1 min-h-0 flex-col min-w-0">
              {/* Design Tabs */}
              <div className="shrink-0 border-b bg-muted/30">
                <div className="flex gap-0.5 px-2 pt-1">
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'overview' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => handleDesignTabChange('overview')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">dashboard</span>
                    概览
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'orchestration' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => handleDesignTabChange('orchestration')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">account_tree</span>
                    编排
                  </button>
                  <button
                    className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${designTab === 'config' ? 'bg-card text-foreground border-t border-l border-r' : 'text-muted-foreground hover:text-foreground'}`}
                    onClick={() => handleDesignTabChange('config')}
                  >
                    <span className="material-symbols-outlined text-sm mr-1 align-middle">settings</span>
                    配置
                  </button>
                </div>
              </div>

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

              {/* Design Overview Tab */}
              {designTab === 'overview' && editingConfig?.workflow && (
                <div className="flex-1 overflow-auto bg-muted/20 p-6">
                  <div className="mx-auto max-w-6xl space-y-4">
                    <div className="rounded-2xl border bg-background/75 p-5 space-y-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>dashboard</span>
                            <h3 className="text-base font-semibold">工作流概览</h3>
                          </div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            查看设计基线、模式、角色/状态数量和 spec 规格基线摘要。
                          </p>
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {editingConfig.workflow.mode === 'state-machine' ? 'state-machine' : editingConfig.workflow.mode || 'phase-based'}
                        </Badge>
                      </div>

                      <div className="space-y-2">
                        <div className="text-sm font-medium">{editingConfig.workflow.name || workflowConfig?.workflow?.name || configFile}</div>
                        <div className="text-sm text-muted-foreground leading-relaxed prose prose-sm dark:prose-invert max-w-none [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1">
                          <Markdown>{editingConfig.workflow.description || workflowConfig?.workflow?.description || '暂无描述'}</Markdown>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-4">
                        <div className="rounded-xl border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">模式</div>
                          <div className="mt-1 text-sm font-semibold">{editingConfig.workflow.mode || 'phase-based'}</div>
                        </div>
                        <div className="rounded-xl border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">{editingConfig.workflow.mode === 'state-machine' ? '状态' : '阶段'}</div>
                          <div className="mt-1 text-lg font-semibold">
                            {editingConfig.workflow.mode === 'state-machine' ? (editingConfig.workflow.states?.length ?? 0) : (editingConfig.workflow.phases?.length ?? 0)}
                          </div>
                        </div>
                        <div className="rounded-xl border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">步骤</div>
                          <div className="mt-1 text-lg font-semibold">{totalSteps}</div>
                        </div>
                        <div className="rounded-xl border bg-muted/20 p-3">
                          <div className="text-[10px] text-muted-foreground">Agent</div>
                          <div className="mt-1 text-lg font-semibold">{workflowAgentNames.length}</div>
                        </div>
                      </div>
                    </div>

                    {concurrencyDesignSummary.hasMetadata ? (
                      <div className="rounded-2xl border bg-background/75 p-5 space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="material-symbols-outlined text-primary" style={{ fontSize: 18 }}>hub</span>
                              <h3 className="text-base font-semibold">并发设计</h3>
                            </div>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">
                              已保存到配置中；状态机运行时会把同一并发组内的连续 step 作为并发分支展示和调度。
                            </p>
                          </div>
                          <Badge variant="outline" className="text-[10px]">自动生成</Badge>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">并发组</div>
                            <div className="mt-1 text-lg font-semibold">{concurrencyDesignSummary.groups.length}</div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">Agent 实例</div>
                            <div className="mt-1 text-lg font-semibold">{concurrencyDesignSummary.agentInstanceIds.length}</div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">通讯通道</div>
                            <div className="mt-1 text-lg font-semibold">{concurrencyDesignSummary.channelIds.length}</div>
                          </div>
                          <div className="rounded-xl border bg-muted/20 p-3">
                            <div className="text-[10px] text-muted-foreground">Spec 任务</div>
                            <div className="mt-1 text-lg font-semibold">{concurrencyDesignSummary.specTaskIds.length}</div>
                          </div>
                        </div>
                        {concurrencyDesignSummary.groups.length ? (
                          <div className="space-y-2">
                            <div className="text-xs font-medium text-muted-foreground">并发组</div>
                            <div className="space-y-2">
                              {concurrencyDesignSummary.groups.map((group, groupIndex) => (
                                <div key={group.id} className="rounded-xl border bg-muted/10 p-3 text-xs">
                                  <div className="font-medium">并发组 {groupIndex + 1}</div>
                                  <div className="mt-1 text-muted-foreground">
                                    {group.steps.map((step: any) => `${step.__stateName}/${step.name}`).join(' · ')}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                        {concurrencyDesignSummary.joinPolicies.length ? (
                          <div className="flex flex-wrap gap-2">
                            {concurrencyDesignSummary.joinPolicies.map((policy, policyIndex) => {
                              const labelMap: Record<string, string> = {
                                all: '等待全部完成',
                                any: '任一完成即可',
                                quorum: '达到指定数量',
                                manual: '人工确认',
                              };
                              return (
                                <Badge key={`${policy.scope}-${policy.mode}`} variant="outline" className="text-[10px]">
                                  策略 {policyIndex + 1}: {labelMap[policy.mode] || policy.mode}
                                </Badge>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {renderSpecCodingOverviewCard()}
                  </div>
                </div>
              )}

              {/* Orchestration Tab */}
              {designTab === 'orchestration' && editingConfig?.workflow && (
                <div className="flex h-full flex-col overflow-hidden">
                  <div className="border-b bg-background/80 px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-semibold">编排设计</div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button type="button" size="sm" className="h-8 gap-1.5 px-3 text-xs" onClick={handleOpenWorkflowOptimization}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>auto_fix_high</span>
                          AI 修订工作流
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
                          启动前检查管理
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="min-h-0 flex-1">
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
                        specTasks={designOptimizationSpecTaskOptions}
                        onOptimizeState={handleOptimizeStateMachineState}
                        onOptimizeStep={handleOptimizeStateMachineStep}
                        onAgentSkillsChange={handleAgentSkillsChange}
                      />
                    ) : (
                      <DesignPanel workflow={editingConfig.workflow}
                        availableAgents={agentConfigs}
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
                        onJoinGroup={handleJoinGroup}
                        onOptimizeStep={handleOptimizePhaseStep} />
                    )}
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
                          <h3 className="text-base font-semibold">工作流配置</h3>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            编辑工作流运行参数，并维护 requirements/design/tasks、任务状态和修订记录。
                          </p>
                        </div>
                      </div>
                    </div>

                    {renderSpecCodingPanel({ className: 'space-y-4', summaryOnly: true })}
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
                                  默认引擎: {getEngineMeta(engine)?.name || engine || '未设置'}
                                </Badge>
                                <Badge variant="outline">
                                  默认模型: {workflowDefaultModel ? workflowDefaultModel : (globalDefaultModel ? `跟随全局 (${globalDefaultModel})` : '跟随全局')}
                                </Badge>
                                <Badge variant={workflowAutoCompactOnStepChange ? 'default' : 'outline'}>
                                  步骤级总结: {workflowAutoCompactOnStepChange ? '开启' : '关闭'}
                                </Badge>
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
                            value={editingConfig?.workflow?.maxTransitions ?? workflowConfig?.workflow?.maxTransitions ?? 50}
                            onChange={(e) => {
                              const baseConfig = editingConfig || workflowConfig;
                              if (!baseConfig?.workflow) return;
                              const val = Math.max(1, Math.min(200, parseInt(e.target.value) || 1));
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

                        {availableMcpServers.length > 0 && (
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
                                placeholder="选择 MCP Servers..."
                              />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1.5">选择工作流运行时默认启用的 MCP Servers</p>
                          </div>
                        )}
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
                variant="destructive"
                onClick={handleBatchDeleteRuns}
                disabled={batchDeleting}
              >
                <span className="material-symbols-outlined text-sm mr-1">delete</span>
                删除选中 ({selectedRunIds.length})
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {historyLoading ? (
              <BrandLoadingScreen message="正在加载运行记录..." fullscreen={false} />
            ) : historyRuns.length === 0 ? (
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
                      <th className="text-left p-3 text-sm font-semibold hidden lg:table-cell">Token</th>
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
                        <td className="p-3 text-sm font-mono hidden lg:table-cell">{formatTokenCount(run.totalTokens || 0)}</td>
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
                              <Button size="sm" variant="destructive" onClick={() => handleDeleteRun(run.id)}>
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
      {editingNode && (<EditNodeModal isOpen={showEditNodeModal} type={editingNode.type} data={getEditingNodeData()} roles={agentConfigs}
        availableSkills={availableSkills}
        specTasks={designOptimizationSpecTaskOptions}
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
                      filteredItems.push(...mergeAceSubtaskChunkItems(pendingChunkItems, CHUNK_SEP));
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
                              <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} />
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
                            <AceAwareMarkdown content={prepareChunkForDisplay(parsed.content)} isStreaming={isRunning} />
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
                        <AceAwareMarkdown content={prepareChunkForDisplay(chunk)} />
                      </div>
                    ));
                  })()}
                </div>
              ) : (
                <div className={styles.markdownContent}>
                  <AceAwareMarkdown content={prepareChunkForDisplay(markdownModal.chunks[0])} />
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
      <Dialog open={designOptimizationDialogOpen} onOpenChange={(open) => {
        setDesignOptimizationDialogOpen(open);
        if (!open) {
          setDesignOptimizationTarget(null);
          setDesignOptimizationGenerating(false);
          setDesignOptimizationCandidate(null);
          setDesignOptimizationStream('');
          setDesignOptimizationMessages([]);
          setDesignOptimizationSessionId(null);
        }
      }}>
        <DialogContent className="max-w-5xl w-[94vw] h-[86vh] overflow-hidden p-0">
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
                  <Badge variant="outline" className="text-[10px]">
                    {designOptimizationTarget.workflowMode}
                  </Badge>
                </div>
              </div>
              <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,1.08fr)]">
                <div className="flex min-h-0 min-w-0 flex-col border-b bg-muted/10 lg:border-b-0 lg:border-r">
                  <div className="shrink-0 border-b px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">对话调整候选</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          首轮会创建修订 session；后续直接续聊并替换当前候选。
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
                          <div className="font-medium text-foreground">描述你想怎么修订工作流</div>
                          <div className="mt-1 max-w-sm text-xs leading-5">
                            AI 会生成 workflow_patch 候选；你可以继续追问调整，右侧始终展示基线和当前候选的差异。
                          </div>
                        </div>
                      )}
                      {designOptimizationGenerating ? (
                        <div className={styles.thinkingBot} aria-live="polite">
                          <span className="deer-runner-sprite shrink-0" aria-hidden="true" />
                          <Shimmer as="span" className={styles.thinkingText}>AI 正在修订工作流</Shimmer>
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
                        placeholder={designOptimizationSessionId ? '继续说明要怎么调整当前候选...' : '例如：根据最新 spec 优化该步骤的 agent 选择和提示词，并确保 spec task 绑定完整'}
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
                          {designOptimizationSessionId ? '发送调整' : '生成候选'}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 min-w-0 flex-col bg-background">
                  <div className="shrink-0 border-b px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium">基线 / 当前候选 Diff</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {designOptimizationCandidate
                            ? `${new Date(designOptimizationCandidate.createdAt).toLocaleString()} · 先看差异，再应用到当前草稿`
                            : `等待 AI 生成 ${getDesignOptimizationTargetLabel(designOptimizationTarget)} 的候选版本`}
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
                            放弃候选
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
                            应用候选
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
                            <Badge variant="secondary" className="text-[10px]">AI 候选</Badge>
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
                            <div className="text-sm font-medium">候选差异</div>
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
                        <div className="text-sm font-medium">右侧将展示基线和最终候选的 diff</div>
                        <div className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                          左侧发送第一条修订要求后，AI 生成的候选会出现在这里。后续多轮调整会替换当前候选。
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
      <Dialog open={!!specBindingReview} onOpenChange={(open) => !open && setSpecBindingReview(null)}>
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
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
                  这里的修改只会写入当前工作流草稿，仍需点击页面右上角“保存配置”后才会真正写入 YAML。
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
                <Button type="button" variant="ghost" onClick={() => setExecutionPolicyDialogOpen(false)}>
                  关闭
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
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }
        }}
        resumeCreationSessionId={resumeCreationDraftId}
        initialMode="ai-guided"
        initialWorkflowName={workflowConfig?.workflow?.name || ''}
        initialReferenceWorkflow={configFile}
        initialDescription={requirements || workflowConfig?.workflow?.description || ''}
        initialWorkingDirectory={resolvedProjectRoot || ''}
        initialWorkspaceMode={workspaceMode === 'isolated-copy' ? 'isolated-copy' : 'in-place'}
        hideAiGuided={false}
        inheritEngine={globalEngine || engine}
        inheritModel={globalDefaultModel}
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

      {showStartWorkflowDialog && pendingStartRequest && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-6"
        onClick={() => {
          setShowStartWorkflowDialog(false);
          setPendingStartRequest(null);
        }}
      >
          <div className="mx-auto w-fit max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
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
              focusTarget={startContextFocusTarget}
              onFocusTargetChange={setStartContextFocusTarget}
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
              projectRoot={projectRoot}
              onCancel={() => {
                setShowStartWorkflowDialog(false);
                setPendingStartRequest(null);
              }}
              onSkipPreflight={
                pendingStartRequest.mode === 'real' && (Boolean(pendingStartRequest.skipPreflight) || Boolean(pendingStartRequest.preflightPreview?.commands?.length))
                  ? (contexts) => confirmStartWorkflow(contexts, 'skip')
                  : undefined
              }
              onConfirm={(contexts) => confirmStartWorkflow(contexts, pendingStartRequest.skipPreflight ? 'skip' : 'run')}
            />
          </div>
        </div>
      )}

      {showContextEditor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-3 sm:p-6" onClick={() => setShowContextEditor(false)}>
          <div className="mx-auto w-fit max-w-[96vw]" onClick={(e) => e.stopPropagation()}>
            <ContextWorkspaceDialog
              title="上下文工作台"
              description={`统一编辑全局上下文和${startContextScopeLabel}上下文。保存后会立即更新当前 run 的 prompt 注入内容。`}
              modeLabel="运行中可修改"
              globalDraft={contextEditorGlobalDraft}
              phaseDrafts={contextEditorPhaseDrafts}
              focusTarget={contextEditorFocusTarget}
              onFocusTargetChange={setContextEditorFocusTarget}
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
          </div>
        </div>
      )}

      <Dialog
        open={Boolean(pendingHumanQuestion && !humanApprovalMinimized)}
        onOpenChange={(open) => {
          if (!open) minimizeHumanApprovalDialog();
          else restoreHumanApprovalDialog();
        }}
      >
        <DialogContent className="max-w-2xl w-[94vw] max-h-[88vh] overflow-hidden p-0">
          <div className="flex max-h-[88vh] flex-col">
            <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
              <div className="min-w-0">
                <DialogTitle className="flex items-center gap-2 text-base">
                  <span className="material-symbols-outlined text-amber-600">support_agent</span>
                  {pendingHumanQuestionKindLabel ? `等待${pendingHumanQuestionKindLabel}` : '等待人工回复'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  当前步骤已阻塞，提交回复后工作流会继续执行。
                </DialogDescription>
              </div>
              <Button variant="outline" size="sm" onClick={minimizeHumanApprovalDialog}>
                最小化
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
              {pendingHumanQuestion ? (
                <HumanQuestionCard
                  question={pendingHumanQuestion}
                  submitting={submittingHumanQuestion}
                  onSubmit={handleSubmitHumanQuestion}
                  collapsible={false}
                  autoFocus
                />
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {pendingHumanQuestion && humanApprovalMinimized ? (
        <button
          type="button"
          onClick={restoreHumanApprovalDialog}
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full border border-amber-300 bg-amber-500 px-4 py-2 text-sm font-medium text-black shadow-lg transition hover:bg-amber-400 ${humanApprovalMinimizedPulse ? 'animate-pulse' : ''}`}
        >
          <span className="material-symbols-outlined text-base">support_agent</span>
          <span>{pendingHumanQuestionKindLabel ? `待${pendingHumanQuestionKindLabel}` : '待人工回复'}</span>
        </button>
      ) : null}

      {/* 强制跳转对话框 */}
      {forceTransitionModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50" onClick={() => setForceTransitionModal(null)}>
          <div className="bg-card rounded-lg w-[600px] max-w-[90%] border shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="p-5 border-b">
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <span className="material-symbols-outlined text-orange-500">alt_route</span>
                {forceTransitionActionLabel}到: {forceTransitionModal.targetState}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {isRunning ? '可选：为 AI 提供跳转指令' : '该运行会从已结束状态恢复为执行中，并从目标状态继续执行。可选填写恢复指令。'}
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
                此指令会记录到状态跳转历史中，帮助后续审计恢复原因
              </p>
            </div>

            <div className="p-5 border-t flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setForceTransitionModal(null)}>取消</Button>
              <Button onClick={executeForceTransition}>
                <span className="material-symbols-outlined text-sm mr-1">check</span>
                {isRunning ? '确认跳转' : '确认恢复'}
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
