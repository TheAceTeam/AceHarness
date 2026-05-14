'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { SingleCombobox } from '@/components/ui/combobox';

export interface WorkflowDraftState {
  name: string;
  requirements: string;
  description: string;
  referenceWorkflow: string;
  workingDirectory: string;
  workspaceMode: 'isolated-copy' | 'in-place';
}

export interface WorkflowPanelProps {
  workflowDraft: WorkflowDraftState;
  setWorkflowDraft: Dispatch<SetStateAction<WorkflowDraftState>>;
  workflows: Array<{ filename: string; name?: string; mode?: string; description?: string }>;
  loading: boolean;
  selectedWorkflow: string;
  setSelectedWorkflow: (filename: string) => void;
  setInspectedWorkflow: (workflow: any) => void;
  boundWorkflow: string;
  effectiveWorkflowTarget: string;
  currentCreationSession: { workflowName?: string; filename?: string; status?: string; specCodingId?: string } | null;
  effectiveCreationSession: { workflowName?: string; filename?: string; status?: string; specCodingId?: string } | null;
  isWorkflowCreationCompleted: boolean;
  getCreationSessionStatusLabel: (status?: any) => string;
  onOpenModal: () => void;
  onOpenWorkflowsPage: () => void;
  onOpenDesignPage: (filename: string) => void;
}

export function WorkflowPanel({
  workflowDraft,
  setWorkflowDraft,
  workflows,
  loading,
  selectedWorkflow,
  setSelectedWorkflow,
  setInspectedWorkflow,
  boundWorkflow,
  effectiveWorkflowTarget,
  currentCreationSession,
  effectiveCreationSession,
  isWorkflowCreationCompleted,
  getCreationSessionStatusLabel,
  onOpenModal,
  onOpenWorkflowsPage,
  onOpenDesignPage,
}: WorkflowPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4">
        {isWorkflowCreationCompleted && effectiveCreationSession ? (
          <>
            <h3 className="text-sm font-medium">工作流已创建</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-5">
              当前对话已经完成工作流创建。这里保留基础信息和快捷入口，后续编辑直接进入工作流设计页。
            </p>
            <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
              <div className="font-medium text-foreground">创建结果</div>
              <div>工作流：{effectiveCreationSession.workflowName}</div>
              <div>配置文件：{effectiveCreationSession.filename}</div>
              <div>状态：{getCreationSessionStatusLabel(effectiveCreationSession.status)}</div>
              <div>Spec Coding：{effectiveCreationSession.specCodingId}</div>
            </div>
            {workflowDraft.workingDirectory ? (
              <div className="mt-4 rounded-xl border bg-muted/20 p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">工作目录</div>
                <div className="whitespace-normal break-all">目录：{workflowDraft.workingDirectory}</div>
                <div>模式：{workflowDraft.workspaceMode === 'isolated-copy' ? '创建副本工程后执行' : '直接在工作目录执行'}</div>
              </div>
            ) : null}
            <div className="mt-4 flex gap-2">
              <Button
                size="sm"
                onClick={() => onOpenDesignPage(effectiveCreationSession.filename!)}
              >
                打开工作流设计页
              </Button>
              <Button size="sm" variant="outline" onClick={onOpenWorkflowsPage}>
                打开工作流页
              </Button>
            </div>
          </>
        ) : (
          <>
            <h3 className="text-sm font-medium">AI 引导创建工作流</h3>
            <p className="mt-2 text-xs text-muted-foreground leading-5">
              从首页打开工作流创建面板，关键上下文会挂在当前对话下，方便回到原对话继续查看和恢复。
            </p>
            {currentCreationSession ? (
              <div className="mt-4 rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
                <div className="font-medium text-foreground">当前创建进度</div>
                <div>工作流：{currentCreationSession.workflowName}</div>
                <div>配置文件：{currentCreationSession.filename}</div>
                <div>状态：{getCreationSessionStatusLabel(currentCreationSession.status)}</div>
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
                <label className="text-xs text-muted-foreground">工作流模板</label>
                <SingleCombobox
                  value={workflowDraft.referenceWorkflow || '__none__'}
                  onValueChange={(value) => setWorkflowDraft((prev) => ({ ...prev, referenceWorkflow: value === '__none__' ? '' : value }))}
                  options={[
                    { value: '__none__', label: '不使用工作流模板' },
                    ...workflows.map((workflow) => ({
                      value: workflow.filename,
                      label: `${workflow.name} (${workflow.filename})`,
                    })),
                  ]}
                  placeholder={loading ? '加载中...' : '选择工作流模板'}
                />
                <p className="text-xs text-muted-foreground">
                  会尽量沿用模板的流程结构和 Agent 安排，只更新当前需求与任务分配。
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
              <Button size="sm" onClick={onOpenModal}>创建工作流</Button>
              <Button size="sm" variant="outline" onClick={onOpenWorkflowsPage}>
                打开工作流页
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="rounded-2xl border p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">当前工作流目标</h3>
          <Badge variant="outline">{effectiveWorkflowTarget ? '已锁定' : '待选择'}</Badge>
        </div>
        <div className="text-xs text-muted-foreground leading-5">
          {effectiveWorkflowTarget
            ? `当前会以 ${effectiveWorkflowTarget} 作为运行目标。`
            : '当前还没有选中的运行目标，可从下方已有工作流中挑一个，也可以先创建工作流。'}
        </div>
        <details className="rounded-xl border bg-muted/10 p-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">展开已有工作流列表</summary>
          <div className="mt-3 space-y-3">
            {loading ? (
              <div className="text-xs text-muted-foreground">加载中...</div>
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
  );
}
