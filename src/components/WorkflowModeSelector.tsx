'use client';

import { ListTodo, Sparkles, Workflow } from 'lucide-react';
import { cn } from '@/lib/core/utils';

export type WorkflowCreationMode = 'lightweight' | 'state-machine' | 'ai-guided';

interface WorkflowModeSelectorProps {
  value: WorkflowCreationMode;
  onChange: (mode: WorkflowCreationMode) => void;
  showDetails?: boolean;
  disabled?: boolean;
}

const modes: Array<{
  id: WorkflowCreationMode;
  title: string;
  tagline: string;
  description: string;
  highlights: string[];
  icon: typeof ListTodo;
}> = [
  {
    id: 'lightweight',
    title: '轻量工作流',
    tagline: '任务清单驱动的协作执行',
    description: '围绕一个明确目标，由任务清单动态拆分、调度与验收。',
    highlights: ['任务清单驱动', '动态拆分与验收', '适合清晰目标'],
    icon: ListTodo,
  },
  {
    id: 'state-machine',
    title: '状态机',
    tagline: '可编排的多状态流程',
    description: '按状态、步骤和转移规则组织复杂的协作与回退。',
    highlights: ['多状态与并发步骤', '可定义转移规则', '适合复杂流程'],
    icon: Workflow,
  },
  {
    id: 'ai-guided',
    title: 'AI 引导创建',
    tagline: '描述需求，AI 整理最佳实践',
    description: '先通过对话梳理目标和约束，再生成合适的工作流草案。',
    highlights: ['自然语言描述需求', '交互式补充与确认', '生成可编辑草案'],
    icon: Sparkles,
  },
];

const detailCopy: Record<WorkflowCreationMode, { title: string; description: string; flow: string[] }> = {
  lightweight: {
    title: '关于轻量工作流',
    description: '适合目标和交付边界已经明确的协作任务，执行过程由任务清单持续推进。',
    flow: ['描述目标', '任务清单', '协作执行'],
  },
  'state-machine': {
    title: '关于状态机',
    description: '适合需要多个状态、条件转移或并发步骤的完整编排。',
    flow: ['定义状态', '配置步骤', '按规则转移'],
  },
  'ai-guided': {
    title: '关于 AI 引导创建',
    description: 'AI 会先收集需求，再展示可确认、可编辑的草案，然后才创建配置文件。',
    flow: ['描述需求', 'AI 分析', '确认草案'],
  },
};

export default function WorkflowModeSelector({
  value,
  onChange,
  showDetails = true,
  disabled = false,
}: WorkflowModeSelectorProps) {
  const detail = detailCopy[value];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="工作流类型">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const selected = mode.id === value;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={mode.id === 'ai-guided' ? 'AI 引导创建工作流' : mode.title}
              disabled={disabled}
              onClick={() => onChange(mode.id)}
              className={cn(
                'min-h-40 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary bg-primary/5 text-foreground'
                  : 'border-border bg-background text-foreground hover:border-primary/50 hover:bg-muted/50',
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
                  <span className={cn('mt-1 block text-xs font-medium', selected ? 'text-primary' : 'text-muted-foreground')}>
                    {mode.tagline}
                  </span>
                </span>
              </span>
              <span className="mt-4 block text-xs leading-5 text-muted-foreground">{mode.description}</span>
              <span className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
                {mode.highlights.map((highlight) => (
                  <span key={highlight} className={cn(
                    'rounded-full border px-2 py-0.5',
                    selected ? 'border-primary/25 bg-background/70' : 'border-border bg-muted/50',
                  )}>{highlight}</span>
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {showDetails ? (
        <section className="rounded-lg border bg-muted/20 p-4" aria-label={detail.title}>
          <h3 className="text-sm font-semibold">{detail.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail.description}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="创建流程">
            {detail.flow.map((step, index) => (
              <span key={step} className="flex items-center gap-2">
                <span className="rounded-md border bg-background px-2.5 py-1.5 text-xs font-medium">{step}</span>
                {index < detail.flow.length - 1 ? <span className="text-xs text-muted-foreground">{'->'}</span> : null}
              </span>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
