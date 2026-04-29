'use client';

import type { HumanQuestion } from '@/lib/run-state-persistence';
import HumanQuestionCard from '@/components/workflow/HumanQuestionCard';

interface HumanQuestionInboxProps {
  questions: HumanQuestion[];
  title?: string;
  emptyText?: string;
  compact?: boolean;
  onNavigate: (question: HumanQuestion) => void;
}

export default function HumanQuestionInbox({
  questions,
  title = 'Supervisor 消息 / 待回答',
  emptyText = '暂无待回答的 Supervisor 消息。',
  compact = true,
  onNavigate,
}: HumanQuestionInboxProps) {
  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">集中查看所有工作流等待人类回复的 Supervisor 消息。</p>
        </div>
        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-medium text-white">{questions.length}</span>
      </div>

      {questions.length === 0 ? (
        <div className="rounded-xl border border-dashed bg-background/60 p-4 text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3">
          {questions.map((question) => (
            <HumanQuestionCard
              key={question.id}
              question={question}
              compact={compact}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
