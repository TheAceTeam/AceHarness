'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type WorkflowStepLike = {
  name?: string;
  agent?: string;
  task?: string;
  preCommands?: string[];
};

type WorkflowLike = {
  mode?: 'state-machine';
  states?: Array<{ name?: string; steps?: WorkflowStepLike[] }>;
};

type StepEntry = {
  key: string;
  scopeLabel: string;
  stepLabel: string;
  agentLabel: string;
  commands: string[];
  stateIndex: number;
  stepIndex: number;
};

interface WorkflowPreflightManagerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflow: WorkflowLike | null | undefined;
  onSave: (workflow: WorkflowLike) => void;
}

function linesToList(value: string): string[] {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function collectStepEntries(workflow: WorkflowLike | null | undefined): StepEntry[] {
  if (!workflow) return [];
  return (workflow.states || []).flatMap((state, stateIndex) => (
    (state.steps || []).map((step, stepIndex) => ({
      key: `state:${stateIndex}:${stepIndex}`,
      scopeLabel: `状态 ${stateIndex + 1} · ${state.name || `状态${stateIndex + 1}`}`,
      stepLabel: step.name || `步骤 ${stepIndex + 1}`,
      agentLabel: step.agent || '未分配 Agent',
      commands: Array.isArray(step.preCommands) ? step.preCommands : [],
      stateIndex,
      stepIndex,
    }))
  ));
}

export default function WorkflowPreflightManagerDialog({
  open,
  onOpenChange,
  workflow,
  onSave,
}: WorkflowPreflightManagerDialogProps) {
  const entries = useMemo(() => collectStepEntries(workflow), [workflow]);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(entries.map((entry) => [entry.key, entry.commands.join('\n')])));
  }, [entries, open]);

  const summary = useMemo(() => {
    const configuredSteps = entries.filter((entry) => linesToList(draft[entry.key] || '').length > 0).length;
    const totalCommands = entries.reduce((sum, entry) => sum + linesToList(draft[entry.key] || '').length, 0);
    return {
      totalSteps: entries.length,
      configuredSteps,
      totalCommands,
    };
  }, [draft, entries]);

  const handleSave = () => {
    if (!workflow) return;
    const nextWorkflow = JSON.parse(JSON.stringify(workflow)) as WorkflowLike;
    const nextEntries = collectStepEntries(nextWorkflow);

    nextEntries.forEach((entry) => {
      const commands = linesToList(draft[entry.key] || '');
      const targetStep = nextWorkflow.states?.[entry.stateIndex]?.steps?.[entry.stepIndex];

      if (!targetStep) return;
      if (commands.length > 0) {
        targetStep.preCommands = commands;
      } else {
        delete targetStep.preCommands;
      }
    });

    onSave(nextWorkflow);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[94vw] max-h-[88vh] overflow-hidden p-0">
        <DialogTitle className="sr-only">统一管理启动前检查</DialogTitle>
        <div className="flex max-h-[88vh] flex-col">
          <div className="border-b px-6 py-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold">统一管理启动前检查</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  这里汇总所有步骤的 preflight 命令。运行前会按配置顺序去重汇总并统一执行。
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className="text-[10px]">步骤 {summary.totalSteps}</Badge>
                <Badge variant="outline" className="text-[10px]">已配置 {summary.configuredSteps}</Badge>
                <Badge variant="outline" className="text-[10px]">命令 {summary.totalCommands}</Badge>
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-6 py-5">
            {entries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-10 text-center text-sm text-muted-foreground">
                当前还没有可配置 preflight 的步骤。
              </div>
            ) : (
              <div className="space-y-4">
                {entries.map((entry) => {
                  const currentValue = draft[entry.key] || '';
                  const commandCount = linesToList(currentValue).length;
                  return (
                    <div key={entry.key} className="rounded-2xl border bg-background/80 p-4 space-y-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[11px] text-muted-foreground">{entry.scopeLabel}</div>
                          <div className="mt-1 text-sm font-semibold text-foreground">{entry.stepLabel}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{entry.agentLabel}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant={commandCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">
                            {commandCount > 0 ? `${commandCount} 条命令` : '未配置'}
                          </Badge>
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="h-7 px-2 text-xs"
                            onClick={() => setDraft((prev) => ({ ...prev, [entry.key]: '' }))}
                          >
                            清空
                          </Button>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label className="text-xs">启动前检查命令（每行一条）</Label>
                        <Textarea
                          rows={4}
                          value={currentValue}
                          onChange={(event) => setDraft((prev) => ({ ...prev, [entry.key]: event.target.value }))}
                          placeholder={'npm run lint\nnpm test\nnpm run build'}
                          className="font-mono text-xs leading-5"
                        />
                        <div className="text-[11px] text-muted-foreground">
                          留空表示这个步骤不单独贡献 preflight 命令。
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="border-t px-6 py-4 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="button" onClick={handleSave}>确认</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
