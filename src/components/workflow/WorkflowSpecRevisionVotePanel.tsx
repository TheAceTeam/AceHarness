'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FilePenLine, Vote } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import type {
  WorkflowSpecRevisionBallot,
  WorkflowSpecRevisionVoteChoice,
  WorkflowSpecRevisionVoteRecord,
} from '@/lib/run/state-persistence';
import { cn } from '@/lib/core/utils';

interface WorkflowSpecRevisionVotePanelProps {
  activeVote?: WorkflowSpecRevisionVoteRecord | null;
  voteHistory?: WorkflowSpecRevisionVoteRecord[];
}

const CHOICE_LABELS: Record<WorkflowSpecRevisionVoteChoice, string> = {
  revise: '修订',
  keep: '保持',
  defer: '暂缓',
};

const CHOICE_STYLES: Record<WorkflowSpecRevisionVoteChoice, string> = {
  revise: 'bg-amber-500',
  keep: 'bg-emerald-500',
  defer: 'bg-slate-400',
};

function formatTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: WorkflowSpecRevisionVoteRecord['status']) {
  if (status === 'running') return '表决中';
  if (status === 'failed') return '失败';
  return '已完成';
}

function choiceBadgeVariant(choice: WorkflowSpecRevisionVoteChoice) {
  if (choice === 'revise') return 'default' as const;
  if (choice === 'keep') return 'secondary' as const;
  return 'outline' as const;
}

function VoteTally({ vote }: { vote: WorkflowSpecRevisionVoteRecord }) {
  const total = Math.max(1, vote.ballots.length);
  const choices: WorkflowSpecRevisionVoteChoice[] = ['revise', 'keep', 'defer'];
  return (
    <div className="space-y-3">
      {choices.map((choice) => {
        const count = vote.tally?.[choice] || 0;
        const percent = Math.round((count / total) * 100);
        return (
          <div key={choice} className="space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 font-medium">
                <span className={cn('h-2 w-2 rounded-full', CHOICE_STYLES[choice])} />
                <span>{CHOICE_LABELS[choice]}</span>
              </div>
              <span className="text-muted-foreground">{count} 票 · {percent}%</span>
            </div>
            <Progress value={percent} className="h-1.5 bg-muted" />
          </div>
        );
      })}
    </div>
  );
}

function BallotRow({ ballot }: { ballot: WorkflowSpecRevisionBallot }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-background/80">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-between gap-3 px-3 py-2 text-left">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-sm font-medium">{ballot.agent}</span>
              <Badge variant={choiceBadgeVariant(ballot.choice)} className="text-[10px]">
                {CHOICE_LABELS[ballot.choice]}
              </Badge>
              <span className="text-xs text-muted-foreground">{formatTime(ballot.votedAt)}</span>
            </div>
            <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
              {ballot.reason || '未提供理由'}
            </div>
          </div>
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t px-3 py-3 text-sm leading-6 text-muted-foreground">
          {ballot.reason || '未提供理由'}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function VoteCard({ vote, compact = false }: { vote: WorkflowSpecRevisionVoteRecord; compact?: boolean }) {
  return (
    <section className="rounded-xl border bg-background p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={vote.status === 'running' ? 'default' : vote.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px]">
              {statusLabel(vote.status)}
            </Badge>
            {vote.recommendedChoice ? (
              <Badge variant="outline" className="text-[10px]">
                推荐：{CHOICE_LABELS[vote.recommendedChoice]}
              </Badge>
            ) : null}
          </div>
          <h3 className="mt-2 text-sm font-semibold">{vote.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{vote.question}</p>
        </div>
        <Vote className="h-4 w-4 shrink-0 text-muted-foreground" />
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {vote.stateName ? <span>状态：{vote.stateName}</span> : null}
        {vote.nextState ? <span>下一状态：{vote.nextState}</span> : null}
        <span>{formatTime(vote.createdAt)}</span>
      </div>

      <div className="mt-4">
        <VoteTally vote={vote} />
      </div>

      {!compact || vote.status === 'running' ? (
        <div className="mt-4 space-y-2">
          {vote.ballots.length > 0 ? vote.ballots.map((ballot) => (
            <BallotRow key={`${vote.id}-${ballot.agent}-${ballot.votedAt}`} ballot={ballot} />
          )) : (
            <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
              等待 Agent 投票
            </div>
          )}
        </div>
      ) : null}

      {vote.supervisorDecision || vote.revision ? (
        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <FilePenLine className="h-4 w-4" />
            <span>Supervisor 决策</span>
          </div>
          {vote.supervisorDecision?.summary ? (
            <p className="mt-2 leading-6 text-muted-foreground">{vote.supervisorDecision.summary}</p>
          ) : null}
          {vote.revision ? (
            <div className="mt-2 text-xs text-muted-foreground">
              {vote.revision.applied ? '已自动应用 spec 修订' : '未自动应用 spec 修订'}
              {vote.revision.error ? `：${vote.revision.error}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default function WorkflowSpecRevisionVotePanel({
  activeVote,
  voteHistory = [],
}: WorkflowSpecRevisionVotePanelProps) {
  const records = useMemo(() => {
    const byId = new Map<string, WorkflowSpecRevisionVoteRecord>();
    if (activeVote) byId.set(activeVote.id, activeVote);
    for (const item of voteHistory) byId.set(item.id, item);
    return [...byId.values()].sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
  }, [activeVote, voteHistory]);

  if (records.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        还没有 Spec 修订表决记录。
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-muted/20 p-4">
      <div className="mx-auto max-w-3xl space-y-4">
        {records.map((vote, index) => (
          <VoteCard key={vote.id} vote={vote} compact={index > 0} />
        ))}
      </div>
    </div>
  );
}
