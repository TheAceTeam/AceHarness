'use client';

import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/core/utils';

export interface WorkflowFinalReviewOutputScoreCard {
  agent: string;
  score: number;
  strengths: string[];
  weaknesses: string[];
}

export interface WorkflowFinalReviewOutput {
  summary: string;
  nextFocus: string[];
  experience: string[];
  scoreCards: WorkflowFinalReviewOutputScoreCard[];
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length === value.length ? items : null;
}

function parseReviewCandidate(candidate: string): WorkflowFinalReviewOutput | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate.trim());
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const requiredKeys = ['summary', 'nextFocus', 'experience', 'scoreCards'];
  if (!requiredKeys.every((key) => Object.prototype.hasOwnProperty.call(record, key))) return null;
  if (typeof record.summary !== 'string' || !record.summary.trim()) return null;

  const nextFocus = toStringArray(record.nextFocus);
  const experience = toStringArray(record.experience);
  if (!nextFocus || !experience || !Array.isArray(record.scoreCards)) return null;

  const scoreCards: WorkflowFinalReviewOutputScoreCard[] = [];
  for (const item of record.scoreCards) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const card = item as Record<string, unknown>;
    const strengths = toStringArray(card.strengths);
    const weaknesses = toStringArray(card.weaknesses);
    if (
      typeof card.agent !== 'string'
      || !card.agent.trim()
      || typeof card.score !== 'number'
      || !Number.isFinite(card.score)
      || !strengths
      || !weaknesses
    ) return null;
    scoreCards.push({
      agent: card.agent.trim(),
      score: card.score,
      strengths,
      weaknesses,
    });
  }

  return {
    summary: record.summary.trim(),
    nextFocus,
    experience,
    scoreCards,
  };
}

export function parseWorkflowFinalReviewOutput(content: string): WorkflowFinalReviewOutput | null {
  const text = String(content || '').trim();
  if (!text) return null;

  const direct = parseReviewCandidate(text);
  if (direct) return direct;

  const fencedBlocks = text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
  for (const match of fencedBlocks) {
    const parsed = parseReviewCandidate(match[1] || '');
    if (parsed) return parsed;
  }
  return null;
}

function normalizeScore(score: number): number {
  const normalized = score > 10 ? score / 10 : score;
  return Math.max(0, Math.min(10, normalized));
}

function formatScore(score: number): string {
  const normalized = normalizeScore(score);
  return normalized % 1 === 0 ? String(normalized) : normalized.toFixed(1);
}

function ReviewList({ title, items, tone }: { title: string; items: string[]; tone: 'focus' | 'experience' }) {
  if (!items.length) return null;
  return (
    <section className={cn(
      'rounded-xl border p-3',
      tone === 'focus'
        ? 'border-blue-200/70 bg-blue-50/60 dark:border-blue-900/60 dark:bg-blue-950/20'
        : 'border-emerald-200/70 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20',
    )}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
        <span className="material-symbols-outlined text-base" aria-hidden="true">
          {tone === 'focus' ? 'flag' : 'psychology'}
        </span>
        {title}
      </div>
      <ol className="space-y-1.5 text-xs leading-5 text-muted-foreground">
        {items.map((item, index) => (
          <li key={`${item}-${index}`} className="flex gap-2">
            <span className="shrink-0 font-medium text-foreground/60">{index + 1}.</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function WorkflowFinalReviewOutputCard({
  review,
  rawOutput,
  className,
}: {
  review: WorkflowFinalReviewOutput;
  rawOutput: string;
  className?: string;
}) {
  return (
    <article
      className={cn('overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm', className)}
      data-testid="workflow-final-review-output"
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-muted/25 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="material-symbols-outlined rounded-lg bg-primary/10 p-1.5 text-lg text-primary" aria-hidden="true">
            assignment_turned_in
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">运行复盘</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">工作流已生成本次运行的总结与改进建议</p>
          </div>
        </div>
        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
          复盘已生成
        </Badge>
      </header>

      <div className="space-y-3 p-4">
        <section className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="mb-1.5 text-xs font-medium text-foreground">运行总结</div>
          <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{review.summary}</p>
        </section>

        {review.scoreCards.length ? (
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
              <span className="material-symbols-outlined text-base" aria-hidden="true">groups</span>
              Agent 表现
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {review.scoreCards.map((card) => (
                <div key={card.agent} className="space-y-2 rounded-xl border border-border/60 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-medium text-foreground">{card.agent}</span>
                    <Badge variant="secondary" className="shrink-0 text-[10px]">{formatScore(card.score)}/10</Badge>
                  </div>
                  <Progress value={normalizeScore(card.score) * 10} className="h-1.5" />
                  {card.strengths.length ? (
                    <p className="text-[11px] leading-5 text-muted-foreground">优势：{card.strengths.join(' / ')}</p>
                  ) : null}
                  {card.weaknesses.length ? (
                    <p className="text-[11px] leading-5 text-muted-foreground">待改进：{card.weaknesses.join(' / ')}</p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="grid gap-2 md:grid-cols-2">
          <ReviewList title="下一步重点" items={review.nextFocus} tone="focus" />
          <ReviewList title="经验沉淀" items={review.experience} tone="experience" />
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="group flex w-full items-center justify-between rounded-lg border border-transparent px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:border-border hover:bg-muted/30 hover:text-foreground"
            >
              <span>查看原始输出</span>
              <span className="material-symbols-outlined text-base transition-transform group-data-[state=open]:rotate-180" aria-hidden="true">expand_more</span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-muted/30 p-3 text-[11px] leading-5 text-muted-foreground">
              {rawOutput.trim()}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </article>
  );
}
