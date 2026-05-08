'use client';

import { useMemo, useState } from 'react';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run-state-persistence';
import Markdown from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';

function formatKind(kind: HumanQuestion['kind']) {
  switch (kind) {
    case 'approval':
      return '人工审查';
    case 'choice':
      return '选择确认';
    case 'confirmation':
      return '确认';
    case 'freeform':
      return '补充说明';
    default:
      return '澄清问题';
  }
}

function buildDefaultAnswer(question: HumanQuestion): HumanQuestionAnswer {
  if (question.answerSchema.type === 'approval-transition') {
    return { selectedState: question.suggestedNextState || question.availableStates?.[0] || '' };
  }
  if (question.answerSchema.type === 'single-choice') {
    return { selectedOption: question.answerSchema.options?.[0]?.value || '' };
  }
  if (question.answerSchema.type === 'multi-choice') {
    return { selectedOptions: [] };
  }
  return { text: '' };
}

function isAnswerReady(question: HumanQuestion, answer: HumanQuestionAnswer) {
  if (!question.answerSchema.required) return true;
  if (question.answerSchema.type === 'approval-transition') return Boolean(answer.selectedState);
  if (question.answerSchema.type === 'single-choice') return Boolean(answer.selectedOption);
  if (question.answerSchema.type === 'multi-choice') return Boolean(answer.selectedOptions?.length);
  return Boolean(answer.text?.trim());
}

interface HumanQuestionCardProps {
  question: HumanQuestion;
  compact?: boolean;
  autoFocus?: boolean;
  submitting?: boolean;
  onSubmit?: (answer: HumanQuestionAnswer) => Promise<void> | void;
  onNavigate?: (question: HumanQuestion) => void;
}

export default function HumanQuestionCard({
  question,
  compact = false,
  autoFocus = false,
  submitting = false,
  onSubmit,
  onNavigate,
}: HumanQuestionCardProps) {
  const [answer, setAnswer] = useState<HumanQuestionAnswer>(() => buildDefaultAnswer(question));
  const options: Array<{ label: string; value: string; description?: string }> = question.answerSchema.options || question.availableStates?.map((state) => ({ label: state, value: state })) || [];
  const ready = useMemo(() => isAnswerReady(question, answer), [answer, question]);

  const toggleOption = (value: string, checked: boolean) => {
    const current = new Set(answer.selectedOptions || []);
    if (checked) current.add(value);
    else current.delete(value);
    setAnswer((prev) => ({ ...prev, selectedOptions: Array.from(current) }));
  };

  return (
    <div className={`rounded-xl border bg-card shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={question.status === 'unanswered' ? 'default' : 'secondary'}>{formatKind(question.kind)}</Badge>
            {question.requiresWorkflowPause ? <Badge variant="outline">阻塞等待</Badge> : null}
            {question.currentState ? <span className="text-xs text-muted-foreground">{question.currentState}</span> : null}
          </div>
          <h3 className={`${compact ? 'mt-2 text-sm' : 'mt-3 text-base'} font-semibold leading-6`}>{question.title}</h3>
          <div className="mt-1 text-xs text-muted-foreground">
            {question.configFile} · {question.runId}
          </div>
        </div>
        {onNavigate ? (
          <Button size="sm" variant="outline" onClick={() => onNavigate(question)}>
            前往回答
          </Button>
        ) : null}
      </div>

      <div className={`${compact ? 'mt-2 line-clamp-3 text-xs' : 'mt-4 text-sm'} leading-6 text-foreground`}>
        <Markdown>{question.message || question.supervisorAdvice || 'Supervisor 请求补充信息。'}</Markdown>
      </div>

      {!compact && question.supervisorAdvice && question.supervisorAdvice !== question.message ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">Supervisor 建议</div>
          <Markdown>{question.supervisorAdvice}</Markdown>
        </div>
      ) : null}

      {!compact && onSubmit && question.status === 'unanswered' ? (
        <div className="mt-4 space-y-4">
          {question.answerSchema.type === 'approval-transition' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">选择下一步状态</div>
              <div className="grid gap-2">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setAnswer((prev) => ({ ...prev, selectedState: option.value }))}
                    className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                      answer.selectedState === option.value
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/50'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{option.label}</span>
                      {option.value === question.suggestedNextState ? <Badge variant="outline">推荐</Badge> : null}
                    </div>
                    {option.description ? <div className="mt-1 text-xs text-muted-foreground">{option.description}</div> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {question.answerSchema.type === 'single-choice' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">选择一个选项</div>
              {options.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
                  <input
                    type="radio"
                    className="mt-1 h-4 w-4 accent-primary"
                    checked={answer.selectedOption === option.value}
                    onChange={() => setAnswer((prev) => ({ ...prev, selectedOption: option.value }))}
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    {option.description ? <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          {question.answerSchema.type === 'multi-choice' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">可多选</div>
              {options.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm hover:bg-muted/50">
                  <Checkbox
                    className="mt-1"
                    checked={answer.selectedOptions?.includes(option.value) || false}
                    onCheckedChange={(checked) => toggleOption(option.value, checked === true)}
                  />
                  <span>
                    <span className="font-medium">{option.label}</span>
                    {option.description ? <span className="mt-1 block text-xs text-muted-foreground">{option.description}</span> : null}
                  </span>
                </label>
              ))}
            </div>
          ) : null}

          {question.answerSchema.type === 'text' ? (
            <div className="space-y-2">
              <div className="text-sm font-medium">回复内容</div>
              <Textarea
                autoFocus={autoFocus}
                value={answer.text || ''}
                onChange={(event) => setAnswer((prev) => ({ ...prev, text: event.target.value }))}
                placeholder={question.answerSchema.placeholder || '输入给 Supervisor 的回复...'}
                rows={4}
              />
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-sm font-medium">附加指令（可选）</div>
              <Textarea
                autoFocus={autoFocus}
                value={answer.instruction || ''}
                onChange={(event) => setAnswer((prev) => ({ ...prev, instruction: event.target.value }))}
                placeholder="补充希望 Supervisor 或后续 Agent 注意的事项..."
                rows={3}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button disabled={!ready || submitting} onClick={() => onSubmit(answer)}>
              {submitting ? '提交中...' : '提交回复'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
