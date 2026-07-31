'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FileText, FolderOpen, ListChecks, Terminal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/core/utils';

type LightweightSurface = 'overview' | 'documents' | 'output' | 'workspace';

interface LightweightWorkflowExecutionViewProps {
  workflow: any;
  runId?: string | null;
  status?: string | null;
  currentState?: string | null;
  currentStep?: string | null;
  activeSteps?: string[];
  completedSteps?: string[];
  failedSteps?: string[];
  humanQuestionPanel?: ReactNode;
  taskDocuments?: ReactNode;
  runtimeOutput?: ReactNode;
  workspace?: ReactNode;
  onOpenTaskDocuments?: () => void;
  onOpenRuntimeOutput?: () => void;
  onOpenWorkspace?: () => void;
  workspaceAvailable?: boolean;
  className?: string;
}

function getStatusPresentation(status: string, completed: boolean, failed: boolean) {
  if (failed || status === 'failed' || status === 'crashed') {
    return { label: '失败', progress: 100, variant: 'destructive' as const };
  }
  if (completed || status === 'completed') {
    return { label: '已完成', progress: 100, variant: 'default' as const };
  }
  if (status === 'waiting') {
    return { label: '等待人工处理', progress: 50, variant: 'secondary' as const };
  }
  if (status === 'running' || status === 'preparing') {
    return { label: '执行中', progress: 50, variant: 'secondary' as const };
  }
  if (status === 'stopped') {
    return { label: '已停止', progress: 0, variant: 'outline' as const };
  }
  return { label: '未开始', progress: 0, variant: 'outline' as const };
}

function stepNameMatches(value: string, stepName: string, stateName: string) {
  const base = value.replace(/-迭代\d+$/, '');
  return base === stepName
    || base === `${stateName}-${stepName}`
    || base.endsWith(`-${stepName}`);
}

export default function LightweightWorkflowExecutionView({
  workflow,
  runId,
  status,
  currentState,
  currentStep,
  activeSteps = [],
  completedSteps = [],
  failedSteps = [],
  humanQuestionPanel,
  taskDocuments,
  runtimeOutput,
  workspace,
  onOpenTaskDocuments,
  onOpenRuntimeOutput,
  onOpenWorkspace,
  workspaceAvailable = true,
  className,
}: LightweightWorkflowExecutionViewProps) {
  const state = workflow?.states?.[0] || {};
  const step = state?.steps?.[0] || {};
  const stateName = String(state?.name || currentState || '执行');
  const stepName = String(step?.name || currentStep || '任务');
  const normalizedStatus = String(status || '').toLowerCase();
  const completed = completedSteps.some((value) => stepNameMatches(String(value || ''), stepName, stateName));
  const failed = failedSteps.some((value) => stepNameMatches(String(value || ''), stepName, stateName));
  const presentation = getStatusPresentation(normalizedStatus, completed, failed);
  const tasklistDirectory = String(workflow?.lightweight?.tasklistDirectory || '').trim();
  const hasEmbeddedSurfaces = Boolean(taskDocuments || runtimeOutput || workspace);
  const [activeSurface, setActiveSurface] = useState<LightweightSurface>('overview');
  const availableSurfaces = useMemo<LightweightSurface[]>(() => [
    'overview',
    ...(taskDocuments ? ['documents' as const] : []),
    ...(runtimeOutput ? ['output' as const] : []),
    ...(workspace ? ['workspace' as const] : []),
  ], [runtimeOutput, taskDocuments, workspace]);

  useEffect(() => {
    if (!availableSurfaces.includes(activeSurface)) setActiveSurface('overview');
  }, [activeSurface, availableSurfaces]);

  const openSurface = (surface: LightweightSurface) => {
    if (surface === 'documents') {
      if (taskDocuments) setActiveSurface(surface);
      else onOpenTaskDocuments?.();
      return;
    }
    if (surface === 'output') {
      if (runtimeOutput) setActiveSurface(surface);
      else onOpenRuntimeOutput?.();
      return;
    }
    if (surface === 'workspace') {
      if (workspace) setActiveSurface(surface);
      else onOpenWorkspace?.();
    }
  };

  const runtimeStep = String(currentStep || activeSteps[0] || '').trim();
  const statusDescription = runtimeStep
    ? `当前步骤：${runtimeStep}`
    : presentation.label === '已完成'
      ? '单个步骤已完成。'
      : `固定步骤：${stateName} / ${stepName}`;

  const overview = (
    <div className="space-y-4 overflow-auto p-4">
      <section className="rounded-lg border bg-background p-4" aria-live="polite">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <h3 className="truncate text-sm font-semibold">{stepName}</h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{statusDescription}</p>
          </div>
          <Badge variant={presentation.variant} className="shrink-0 text-[10px]">{presentation.label}</Badge>
        </div>
        <div className="mt-4 flex items-center justify-between gap-3 text-xs">
          <span className="text-muted-foreground">固定单步进度</span>
          <span className="font-medium">{presentation.progress === 100 ? '1 / 1' : '0 / 1'}</span>
        </div>
        <Progress value={presentation.progress} className="mt-2 h-1.5" />
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
            <div className="text-[10px] text-muted-foreground">状态</div>
            <div className="mt-1 truncate font-medium">{stateName}</div>
          </div>
          <div className="min-w-0 rounded-md bg-muted/40 px-3 py-2">
            <div className="text-[10px] text-muted-foreground">执行 Agent</div>
            <div className="mt-1 truncate font-medium">{step?.agent || '未指定'}</div>
          </div>
        </div>
        {tasklistDirectory ? (
          <div className="mt-3 min-w-0 rounded-md border border-dashed px-3 py-2 text-xs">
            <div className="text-[10px] text-muted-foreground">任务文档目录</div>
            <code className="mt-1 block break-all font-mono text-[11px] text-foreground">{tasklistDirectory}</code>
          </div>
        ) : null}
        {runId ? <div className="mt-2 break-all text-[10px] text-muted-foreground">运行 ID：{runId}</div> : null}
      </section>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="轻量工作流运行资源">
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-16 justify-start gap-2 px-3 py-2 text-left"
          onClick={() => openSurface('documents')}
          disabled={!taskDocuments && !onOpenTaskDocuments}
        >
          <FileText className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs font-medium">任务文档</span>
            <span className="block truncate text-[10px] text-muted-foreground">{tasklistDirectory || '当前运行文档'}</span>
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-16 justify-start gap-2 px-3 py-2 text-left"
          onClick={() => openSurface('output')}
          disabled={!runtimeOutput && !onOpenRuntimeOutput}
        >
          <Terminal className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs font-medium">运行输出</span>
            <span className="block truncate text-[10px] text-muted-foreground">当前单步输出</span>
          </span>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-auto min-h-16 justify-start gap-2 px-3 py-2 text-left"
          onClick={() => openSurface('workspace')}
          disabled={!workspaceAvailable || (!workspace && !onOpenWorkspace)}
        >
          <FolderOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs font-medium">工作区</span>
            <span className="block truncate text-[10px] text-muted-foreground">查看运行文件</span>
          </span>
        </Button>
      </div>

      {humanQuestionPanel ? <div className="min-w-0">{humanQuestionPanel}</div> : null}
    </div>
  );

  if (!hasEmbeddedSurfaces) {
    return <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>{overview}</div>;
  }

  return (
    <div className={cn('flex h-full min-h-0 flex-col overflow-hidden', className)}>
      <Tabs value={activeSurface} onValueChange={(value) => setActiveSurface(value as LightweightSurface)} className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b bg-muted/20 px-3 pt-3">
          <TabsList className="grid h-8 w-full" style={{ gridTemplateColumns: `repeat(${availableSurfaces.length}, minmax(0, 1fr))` }} aria-label="轻量工作流运行面板">
            <TabsTrigger value="overview" className="text-xs">执行</TabsTrigger>
            {taskDocuments ? <TabsTrigger value="documents" className="text-xs">任务文档</TabsTrigger> : null}
            {runtimeOutput ? <TabsTrigger value="output" className="text-xs">运行输出</TabsTrigger> : null}
            {workspace ? <TabsTrigger value="workspace" className="text-xs">工作区</TabsTrigger> : null}
          </TabsList>
        </div>
        <TabsContent value="overview" className="m-0 min-h-0 flex-1 overflow-hidden">{overview}</TabsContent>
        {taskDocuments ? <TabsContent value="documents" className="m-0 min-h-0 flex-1 overflow-hidden">{taskDocuments}</TabsContent> : null}
        {runtimeOutput ? <TabsContent value="output" className="m-0 min-h-0 flex-1 overflow-hidden">{runtimeOutput}</TabsContent> : null}
        {workspace ? <TabsContent value="workspace" className="m-0 min-h-0 flex-1 overflow-hidden">{workspace}</TabsContent> : null}
      </Tabs>
    </div>
  );
}
