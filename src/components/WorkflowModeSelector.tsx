'use client';

import { ListTodo, Sparkles, Workflow } from 'lucide-react';
import { cn } from '@/lib/core/utils';

export type WorkflowCreationMode = 'lightweight' | 'state-machine';

interface WorkflowModeSelectorProps {
  value: WorkflowCreationMode;
  onChange: (mode: WorkflowCreationMode) => void;
  onAiGuidedCreate?: () => void;
  disabled?: boolean;
}

const modes: Array<{
  id: WorkflowCreationMode;
  title: string;
  description: string;
  icon: typeof ListTodo;
}> = [
  {
    id: 'lightweight',
    title: '轻量工作流',
    description: '通过任务清单动态拆分、调度与验收的协作执行。',
    icon: ListTodo,
  },
  {
    id: 'state-machine',
    title: '状态机',
    description: '面向多状态、转移和并发步骤的完整编排。',
    icon: Workflow,
  },
];

export default function WorkflowModeSelector({
  value,
  onChange,
  onAiGuidedCreate,
  disabled = false,
}: WorkflowModeSelectorProps) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="工作流类型">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const selected = value === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={mode.title}
              disabled={disabled}
              onClick={() => onChange(mode.id)}
              className={cn(
                'min-h-28 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border bg-background hover:bg-muted/50',
              )}
            >
              <span className="flex items-start gap-3">
                <span className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md border',
                  selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-muted text-muted-foreground',
                )}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{mode.title}</span>
                  <span className="mt-1 block text-xs leading-5 text-muted-foreground">{mode.description}</span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {onAiGuidedCreate ? (
        <button
          type="button"
          data-testid="ai-guided-workflow-entry"
          aria-label="AI 引导创建工作流"
          disabled={disabled}
          onClick={onAiGuidedCreate}
          className="w-full rounded-lg border border-primary/35 bg-primary/[0.06] p-4 text-left transition-colors hover:border-primary/60 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">AI 引导创建</span>
              <span className="mt-1 block text-xs font-medium text-primary/80">描述需求，AI 帮你整理轻量任务清单</span>
              <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                描述你的需求，AI 会帮你整理为轻量任务清单工作流
              </span>
              <span className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-primary/85">
                <span className="rounded-full border border-primary/20 bg-background/70 px-2 py-0.5">自然语言描述需求</span>
                <span className="rounded-full border border-primary/20 bg-background/70 px-2 py-0.5">整理目标与验收条件</span>
                <span className="rounded-full border border-primary/20 bg-background/70 px-2 py-0.5">轻量任务清单执行</span>
              </span>
            </span>
          </span>
        </button>
      ) : null}
    </div>
  );
}
