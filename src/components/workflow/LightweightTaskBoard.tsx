'use client';

import { GitBranch, ListChecks, UserRound, UsersRound } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/core/utils';
import {
  adaptLightweightTaskBoardEvidence,
  type LightweightTaskBoardInput,
  type LightweightTaskBoardTask,
} from './lightweight-task-board-evidence';

interface LightweightTaskBoardProps extends LightweightTaskBoardInput {
  className?: string;
}

function taskStatusLabel(status: LightweightTaskBoardTask['status']): string {
  return {
    pending: '待处理',
    running: '执行中',
    completed: '已完成',
    failed: '失败',
    blocked: '阻塞',
    skipped: '已跳过',
    unknown: '状态未知',
  }[status];
}

function statusVariant(status: LightweightTaskBoardTask['status']) {
  if (status === 'failed') return 'destructive' as const;
  if (status === 'completed') return 'default' as const;
  if (status === 'running') return 'secondary' as const;
  return 'outline' as const;
}

export default function LightweightTaskBoard({ className, ...input }: LightweightTaskBoardProps) {
  const model = adaptLightweightTaskBoardEvidence(input);

  if (!model.isLightweight) return null;

  return (
    <section
      className={cn('flex min-h-0 flex-col gap-4 overflow-auto rounded-lg border bg-background p-4', className)}
      aria-label="轻量工作流任务板"
      data-testid="lightweight-task-board"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListChecks className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <h2 className="truncate text-sm font-semibold">任务清单</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">展示本次运行已获得的任务与执行证据。</p>
        </div>
        <div className="flex min-w-[10rem] items-center gap-2" aria-label="任务清单完成进度">
          {model.progressPercent !== null ? (
            <>
              <Progress value={model.progressPercent} className="h-2 flex-1" aria-label={`完成 ${model.progressPercent}%`} />
              <span className="shrink-0 text-xs font-medium">{model.progressPercent}%</span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">暂无进度证据</span>
          )}
        </div>
      </header>

      <div className="grid min-w-0 gap-3 md:grid-cols-2" aria-label="运行 Agent">
        <div className="min-w-0 rounded-md border bg-muted/20 p-3" aria-label="主 Agent">
          <div className="flex items-center gap-2 text-xs font-medium">
            <UserRound className="h-4 w-4 text-primary" aria-hidden="true" />
            主 Agent
          </div>
          {model.primaryAgent ? (
            <div className="mt-2 min-w-0">
              <div className="truncate text-sm font-medium">{model.primaryAgent.name}</div>
              <div className="mt-1 truncate text-xs text-muted-foreground">
                {model.primaryAgent.currentTask || model.primaryAgent.status || '已从工作流运行证据识别'}
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">暂无主 Agent 证据</p>
          )}
        </div>
        <div className="min-w-0 rounded-md border bg-muted/20 p-3" aria-label="子 Agent 活动">
          <div className="flex items-center gap-2 text-xs font-medium">
            <UsersRound className="h-4 w-4 text-primary" aria-hidden="true" />
            子 Agent 活动
          </div>
          {model.childAgents.length ? (
            <ul className="mt-2 space-y-2" aria-label="实际子 Agent 列表">
              {model.childAgents.map((agent) => (
                <li key={agent.name} className="min-w-0 rounded border border-border/70 bg-background/60 px-2 py-1.5 text-xs">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium">{agent.name}</span>
                    <span className="shrink-0 text-muted-foreground">{agent.status || '活动证据'}</span>
                  </div>
                  {agent.currentTask || agent.summary ? (
                    <div className="mt-1 truncate text-muted-foreground" title={agent.currentTask || agent.summary || undefined}>
                      {agent.currentTask || agent.summary}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">暂无子 Agent 活动证据</p>
          )}
        </div>
      </div>

      {model.tasks.length ? (
        <ol className="grid min-w-0 gap-2" aria-label="任务清单条目">
          {model.tasks.map((task) => (
            <li key={task.id} className="min-w-0 rounded-md border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{task.title}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                    {task.owner ? <span>负责人：{task.owner}</span> : null}
                    {task.dependencies.length ? <span>依赖：{task.dependencies.join('、')}</span> : null}
                    {task.parallelGroup ? <span className="inline-flex items-center gap-1"><GitBranch className="h-3 w-3" aria-hidden="true" />{task.parallelGroup}</span> : null}
                    {task.executionMode ? <span>{task.executionMode === 'parallel' ? '并行' : '串行'}</span> : null}
                  </div>
                </div>
                <Badge variant={statusVariant(task.status)} className="shrink-0 text-[10px]">{taskStatusLabel(task.status)}</Badge>
              </div>
              {task.progressPercent !== null ? <Progress value={task.progressPercent} className="mt-3 h-1.5" aria-label={`${task.title} 完成 ${task.progressPercent}%`} /> : null}
            </li>
          ))}
        </ol>
      ) : (
        <div className="rounded-md border border-dashed p-6 text-center" role="status" aria-label="任务数据状态">
          <p className="text-sm font-medium">暂无可用任务数据</p>
          <p className="mt-1 text-xs text-muted-foreground">任务清单证据到达后将在这里显示。</p>
        </div>
      )}
    </section>
  );
}

export type { LightweightTaskBoardInput } from './lightweight-task-board-evidence';
