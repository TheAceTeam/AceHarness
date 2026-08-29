'use client';

import { useEffect, useMemo, useState } from 'react';
import type { HumanQuestion, HumanQuestionAnswer } from '@/lib/run/state-persistence';
import Markdown from '@/components/Markdown';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai-elements/task';

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

function formatWorkflowPathSegment(segment: NonNullable<HumanQuestion['workflowPath']>[number]) {
  return [
    segment.workflowName || segment.configFile,
    segment.stateName,
    segment.stepName,
  ].filter(Boolean).join(' / ');
}

interface HumanQuestionCardProps {
  question: HumanQuestion;
  compact?: boolean;
  presentation?: 'default' | 'decision';
  autoFocus?: boolean;
  submitting?: boolean;
  collapsible?: boolean;
  onSubmit?: (answer: HumanQuestionAnswer) => Promise<void> | void;
  onNavigate?: (question: HumanQuestion) => void;
}

export default function HumanQuestionCard({
  question,
  compact = false,
  presentation = 'default',
  autoFocus = false,
  submitting = false,
  collapsible = true,
  onSubmit,
  onNavigate,
}: HumanQuestionCardProps) {
  const isDecisionPresentation = presentation === 'decision';
  const defaultAnswer = useMemo(() => buildDefaultAnswer(question), [question]);
  const [answer, setAnswer] = useState<HumanQuestionAnswer>(() => defaultAnswer);
  const [approvalAcknowledged, setApprovalAcknowledged] = useState(false);
  const options: Array<{ label: string; value: string; description?: string }> = question.answerSchema.options || question.availableStates?.map((state) => ({ label: state, value: state })) || [];
  const orderedOptions = useMemo(() => {
    if (question.answerSchema.type !== 'approval-transition' || !question.suggestedNextState) return options;
    return [...options].sort((left, right) => {
      const leftRecommended = left.value === question.suggestedNextState ? 0 : 1;
      const rightRecommended = right.value === question.suggestedNextState ? 0 : 1;
      return leftRecommended - rightRecommended;
    });
  }, [options, question.answerSchema.type, question.suggestedNextState]);
  const ready = useMemo(() => (
    isAnswerReady(question, answer)
    && (question.answerSchema.type !== 'approval-transition' || approvalAcknowledged)
  ), [answer, approvalAcknowledged, question]);

  useEffect(() => {
    setAnswer(defaultAnswer);
    setApprovalAcknowledged(false);
  }, [defaultAnswer]);

  const toggleOption = (value: string, checked: boolean) => {
    const current = new Set(answer.selectedOptions || []);
    if (checked) current.add(value);
    else current.delete(value);
    setAnswer((prev) => ({ ...prev, selectedOptions: Array.from(current) }));
  };

  const triggerTitle = `[${formatKind(question.kind)}] ${question.title}`;
  const workflowPath = Array.isArray(question.workflowPath) ? question.workflowPath.filter(Boolean) : [];
  const collapseApprovalEvidence = !compact
    && Boolean(onSubmit)
    && question.status === 'unanswered'
    && question.answerSchema.type === 'approval-transition';

  const header = isDecisionPresentation ? (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge>需要你的决定</Badge>
        <span className="text-xs text-muted-foreground">工作流已暂停，完成选择后继续。</span>
      </div>
      <h3 className="mt-2 text-base font-semibold leading-6">选择接下来的处理路径</h3>
    </div>
  ) : (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <Badge variant={question.status === 'unanswered' ? 'default' : 'secondary'}>{formatKind(question.kind)}</Badge>
          {question.requiresWorkflowPause ? <Badge variant="outline">阻塞等待</Badge> : null}
          {workflowPath.length > 1 ? <Badge variant="outline">子工作流</Badge> : null}
          {question.currentState ? <span className="text-xs text-muted-foreground">{question.currentState}</span> : null}
        </div>
        {collapsible ? (
          <TaskTrigger title={triggerTitle}>
            <div className="flex w-full cursor-pointer items-center justify-between gap-2 text-sm transition-colors hover:text-foreground">
              <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold leading-6`}>{question.title}</h3>
              <div className="text-xs text-muted-foreground shrink-0">
                {question.configFile} · {question.runId}
              </div>
            </div>
          </TaskTrigger>
        ) : (
          <div className="flex w-full items-center justify-between gap-2 text-sm">
            <h3 className={`${compact ? 'text-sm' : 'text-base'} font-semibold leading-6`}>{question.title}</h3>
            <div className="text-xs text-muted-foreground shrink-0">
              {question.configFile} · {question.runId}
            </div>
          </div>
        )}
      </div>
      {onNavigate ? (
        <Button size="sm" variant="outline" onClick={() => onNavigate(question)}>
          前往回答
        </Button>
      ) : null}
    </div>
  );

  const content = (
    <>
      <TaskItem>
        {!isDecisionPresentation && workflowPath.length > 0 ? (
          <div className="mb-3 rounded-lg border bg-muted/25 px-3 py-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">来源路径</div>
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              {workflowPath.map((segment, index) => (
                <span key={`${segment.runId || index}-${index}`} className="inline-flex min-w-0 items-center gap-1.5">
                  {index > 0 ? <span className="text-muted-foreground">/</span> : null}
                  <span className="max-w-[220px] truncate rounded-md border bg-background px-2 py-1" title={formatWorkflowPathSegment(segment)}>
                    {formatWorkflowPathSegment(segment) || segment.runId || 'workflow'}
                  </span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {collapseApprovalEvidence ? (
          <details className="rounded-lg border bg-muted/20 px-3 py-2 text-sm leading-6" aria-label="完整审批依据">
            <summary className="cursor-pointer font-medium text-foreground">查看完整审批依据</summary>
            <div className="mt-2 text-foreground">
              <Markdown>{question.message || question.supervisorAdvice || 'Supervisor 请求补充信息。'}</Markdown>
              {question.supervisorAdvice && question.supervisorAdvice !== question.message ? (
                <div className="mt-3 border-t pt-3">
                  <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">Supervisor 建议</div>
                  <Markdown>{question.supervisorAdvice}</Markdown>
                </div>
              ) : null}
            </div>
          </details>
        ) : (
          <div className={`${compact ? 'line-clamp-3 text-xs' : 'text-sm'} leading-6 text-foreground`}>
            <Markdown>{question.message || question.supervisorAdvice || 'Supervisor 请求补充信息。'}</Markdown>
          </div>
        )}
      </TaskItem>

      {!collapseApprovalEvidence && !compact && question.supervisorAdvice && question.supervisorAdvice !== question.message ? (
        <TaskItem>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 dark:border-amber-900 dark:bg-amber-950/30">
            <div className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">Supervisor 建议</div>
            <Markdown>{question.supervisorAdvice}</Markdown>
          </div>
        </TaskItem>
      ) : null}

      {!compact && onSubmit && question.status === 'unanswered' ? (
        <TaskItem>
          <div className="space-y-4">
            {question.answerSchema.type === 'approval-transition' ? (
              <div className="space-y-2">
                <div className="text-sm font-medium">选择下一步状态</div>
                <div
                  className={isDecisionPresentation
                    ? 'grid gap-2 sm:grid-cols-2'
                    : 'grid max-h-[min(32vh,18rem)] gap-2 overflow-y-auto overscroll-contain pr-1'}
                  aria-label="下一步状态列表"
                  tabIndex={0}
                >
                  {orderedOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setAnswer((prev) => ({ ...prev, selectedState: option.value }))}
                      aria-pressed={answer.selectedState === option.value}
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

            {question.answerSchema.type === 'approval-transition' ? (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                <Checkbox
                  className="mt-0.5"
                  checked={approvalAcknowledged}
                  onCheckedChange={(checked) => setApprovalAcknowledged(checked === true)}
                />
                <span>
                  <span className="font-medium">我已核对审批依据与所选处理路径。</span>
                  <span className="mt-1 block text-xs text-muted-foreground">提交后工作流会按所选状态继续；如需返工，请在上方改选修复或验证状态。</span>
                </span>
              </label>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button disabled={!ready || submitting} onClick={() => onSubmit(answer)}>
                {submitting ? '提交中...' : question.answerSchema.type === 'approval-transition' ? '确认路径并继续' : '提交回复'}
              </Button>
            </div>
          </div>
        </TaskItem>
      ) : null}
    </>
  );

  if (!collapsible) {
    return (
      <div className={`rounded-xl border bg-card shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
        {header}
        <div className="mt-4 space-y-2 border-muted border-l-2 pl-4">
          {content}
        </div>
      </div>
    );
  }

  return (
    <Task defaultOpen={!compact} className={`rounded-xl border bg-card shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
      {header}
      <TaskContent>
        {content}
      </TaskContent>
    </Task>
  );
}
