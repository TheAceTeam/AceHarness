'use client';

import { useEffect, useMemo, useState } from 'react';
import type { StateMachineState } from '@/lib/core/schemas';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/core/utils';

type RuntimeStateStructurePanelProps = {
  states: StateMachineState[];
  currentState?: string | null;
  currentStep?: string | null;
  activeSteps?: string[];
  completedSteps?: string[];
  failedSteps?: string[];
  stateHistory?: Array<{ from?: string; to?: string; verdict?: string; timestamp?: string }>;
  workflowStatus?: string | null;
};

type RuntimeNodeStatus = 'running' | 'completed' | 'failed' | 'pending';
type RuntimeStepTone = 'defender' | 'attacker' | 'judge';

function stepMatchesRuntimeKey(stateName: string, stepName: string, runtimeKey: string) {
  const candidates = [stepName, `${stateName}-${stepName}`];
  return candidates.some((candidate) => (
    runtimeKey === candidate
    || runtimeKey.startsWith(`${candidate}-迭代`)
    || runtimeKey.endsWith(`-${candidate}`)
  ));
}

function conditionLabel(condition: any) {
  if (!condition || typeof condition !== 'object') return '默认';
  if (typeof condition.verdict === 'string' && condition.verdict.trim()) return condition.verdict.trim();
  if (typeof condition.expression === 'string' && condition.expression.trim()) return condition.expression.trim();
  if (typeof condition.field === 'string' && condition.field.trim()) {
    return [condition.field, condition.operator, condition.value].filter((value) => value !== undefined && value !== null && value !== '').join(' ');
  }
  const entries = Object.entries(condition).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return entries.length ? entries.map(([key, value]) => `${key}: ${String(value)}`).join(' · ') : '默认';
}

function modeLabel(state: StateMachineState) {
  if (state.isFinal) return '终止';
  return state.reviewPolicy?.mode === 'adversarial' ? '对抗' : '标准';
}

function modeKey(state: StateMachineState): 'standard' | 'adversarial' | 'terminal' {
  if (state.isFinal) return 'terminal';
  return state.reviewPolicy?.mode === 'adversarial' ? 'adversarial' : 'standard';
}

function modeIcon(state: StateMachineState) {
  const mode = modeKey(state);
  if (mode === 'adversarial') return 'swords';
  if (mode === 'terminal') return 'stop_circle';
  return 'radio_button_unchecked';
}

function statusLabel(status: RuntimeNodeStatus) {
  if (status === 'running') return '运行中';
  if (status === 'completed') return '已完成';
  if (status === 'failed') return '失败';
  return '未开始';
}

function statusBadgeClass(status: RuntimeNodeStatus) {
  if (status === 'running') return 'border-blue-500/20 bg-blue-500/12 text-blue-700 dark:text-blue-300';
  if (status === 'completed') return 'border-emerald-500/20 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/12 text-red-700 dark:text-red-300';
  return 'border-border/60 bg-background/70 text-muted-foreground';
}

function stateSurfaceClass(status: RuntimeNodeStatus) {
  if (status === 'running') return 'border-blue-500/20 bg-blue-500/[0.06]';
  if (status === 'completed') return 'border-emerald-500/15 bg-emerald-500/[0.04]';
  if (status === 'failed') return 'border-red-500/20 bg-red-500/[0.05]';
  return 'border-transparent bg-background/65';
}

function stepTone(step: StateMachineState['steps'][number], index: number): RuntimeStepTone {
  const managedRole = String(step.provenance?.managedRole || '').trim();
  if (step.role === 'attacker' || managedRole === 'attacker') return 'attacker';
  if (step.role === 'judge' || managedRole === 'judge' || managedRole === 'standard-closer') return 'judge';
  if (step.role === 'defender' || index === 0) return 'defender';
  return 'defender';
}

function stepToneClass(tone: RuntimeStepTone) {
  if (tone === 'attacker') return 'border-orange-500/15 bg-orange-500/10';
  if (tone === 'judge') return 'border-emerald-500/15 bg-emerald-500/10';
  return 'border-blue-500/15 bg-blue-500/10';
}

function stepToneLabel(tone: RuntimeStepTone, adversarial: boolean) {
  if (tone === 'attacker') return '挑战 / Attacker';
  if (tone === 'judge') return adversarial ? '裁决 / Judge' : '标准验收 / Verdict';
  return adversarial ? '产出 / Defender' : '执行 / Produce';
}

export default function RuntimeStateStructurePanel({
  states,
  currentState,
  currentStep,
  activeSteps = [],
  completedSteps = [],
  failedSteps = [],
  stateHistory = [],
  workflowStatus,
}: RuntimeStateStructurePanelProps) {
  const [selectedStateName, setSelectedStateName] = useState<string | null>(currentState || states[0]?.name || null);

  useEffect(() => {
    if (currentState && states.some((state) => state.name === currentState)) {
      setSelectedStateName(currentState);
      return;
    }
    setSelectedStateName((selected) => states.some((state) => state.name === selected) ? selected : states[0]?.name || null);
  }, [currentState, states]);

  const selectedState = states.find((state) => state.name === selectedStateName) || states[0] || null;
  const reachedStates = useMemo(() => new Set(stateHistory.flatMap((entry) => [entry.from, entry.to]).filter(Boolean)), [stateHistory]);
  const terminalWorkflowStatus = ['completed', 'failed', 'stopped', 'crashed', 'cancelled'].includes(String(workflowStatus || '').toLowerCase());
  const activeRuntimeKeys = activeSteps.length > 0
    ? activeSteps.filter(Boolean)
    : [currentStep].filter((key): key is string => Boolean(key));

  const resolveStateStatus = (state: StateMachineState): RuntimeNodeStatus => {
    const stateFailed = failedSteps.some((key) => (state.steps || []).some((step) => stepMatchesRuntimeKey(state.name, step.name, key)));
    if (state.name === currentState && !terminalWorkflowStatus) return 'running';
    if (state.isFinal && state.name === currentState && workflowStatus === 'completed') return 'completed';
    // Leaving a state proves that a later attempt completed it. Historical
    // failed attempts remain in the audit log but must not paint the state red.
    if (stateHistory.some((entry) => entry.from === state.name)) return 'completed';
    if (stateFailed || (state.name === currentState && ['failed', 'crashed'].includes(String(workflowStatus || '').toLowerCase()))) return 'failed';
    if (reachedStates.has(state.name) && state.name !== currentState) return 'completed';
    return 'pending';
  };

  const resolveStepStatus = (state: StateMachineState, stepName: string, stepIndex: number): RuntimeNodeStatus => {
    const isCurrentStateActive = state.name === currentState && !terminalWorkflowStatus;
    const activeStepIndexes = isCurrentStateActive
      ? (state.steps || []).flatMap((step, index) => (
          activeRuntimeKeys.some((key) => stepMatchesRuntimeKey(state.name, step.name, key)) ? [index] : []
        ))
      : [];
    const isActiveStep = activeStepIndexes.includes(stepIndex);
    if (isActiveStep) return 'running';

    // When a state loops back to itself, completed/failed arrays also contain
    // previous attempts. Once the current attempt is visible, every later step
    // belongs to this attempt and has not started yet.
    if (isCurrentStateActive && activeStepIndexes.length > 0 && stepIndex > Math.max(...activeStepIndexes)) {
      return 'pending';
    }

    const failed = failedSteps.some((key) => stepMatchesRuntimeKey(state.name, stepName, key));
    const completed = completedSteps.some((key) => stepMatchesRuntimeKey(state.name, stepName, key));
    if (state.name === currentState && ['failed', 'crashed'].includes(String(workflowStatus || '').toLowerCase()) && failed) return 'failed';
    if (completed) return 'completed';
    if (failed) return 'failed';
    return 'pending';
  };

  if (!selectedState) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">本次运行没有可展示的状态结构。</div>;
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(250px,300px)_minmax(0,1fr)] gap-3 overflow-hidden" data-testid="runtime-state-structure-panel">
      <aside className="min-h-0 overflow-y-auto rounded-2xl bg-muted/45 p-4">
        <div className="mb-4 flex items-center justify-between border-b border-border/60 px-1 pb-3">
          <div>
            <div className="text-sm font-semibold">状态</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">本次运行实际结构</div>
          </div>
          <Badge variant="outline" className="text-[10px]">{states.length}</Badge>
        </div>
        <div className="space-y-1.5">
          {states.map((state) => {
            const status = resolveStateStatus(state);
            const selected = state.name === selectedState.name;
            return (
              <button
                key={state.id || state.name}
                type="button"
                data-selected={selected ? 'true' : 'false'}
                data-runtime-status={status}
                className={cn(
                  'w-full rounded-xl border px-3.5 py-3 text-left transition-all',
                  selected
                    ? 'border-blue-500 bg-blue-500 text-white shadow-sm ring-2 ring-blue-500/15'
                    : stateSurfaceClass(status),
                  !selected && 'hover:border-blue-500/20 hover:bg-blue-500/[0.06]',
                )}
                onClick={() => setSelectedStateName(state.name)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{state.name}</div>
                    <div className={cn('mt-1 text-[11px]', selected ? 'text-white/75' : 'text-muted-foreground')}>
                      {(state.steps || []).length} 步 · {(state.transitions || []).length} 转移
                    </div>
                  </div>
                  <span className={cn(
                    'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium',
                    statusBadgeClass(status),
                  )}>{statusLabel(status)}</span>
                </div>
                <div className="mt-2 flex min-h-5 items-center justify-between gap-2">
                  <span className={cn('text-[10px]', selected ? 'text-white/80' : 'text-muted-foreground')}>
                    {state.isInitial ? '初始状态' : ''}
                  </span>
                  <span
                    data-review-mode={modeKey(state)}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 text-[11px] font-medium',
                      selected ? 'text-white' : 'text-muted-foreground',
                    )}
                    aria-label={`${state.name}：${modeLabel(state)}模式`}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: 16 }} aria-hidden="true">
                      {modeIcon(state)}
                    </span>
                    {modeLabel(state)}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto rounded-2xl bg-muted/35 p-4">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border/60 pb-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{selectedState.name}</h2>
              <Badge
                variant="outline"
                className={selectedState.reviewPolicy?.mode === 'adversarial'
                  ? 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300'
                  : 'border-slate-500/15 bg-slate-500/10 text-slate-700 dark:text-slate-300'}
              >{modeLabel(selectedState)}模式</Badge>
              <Badge variant="outline" className={statusBadgeClass(resolveStateStatus(selectedState))}>{statusLabel(resolveStateStatus(selectedState))}</Badge>
            </div>
            {selectedState.description ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{selectedState.description}</p> : null}
          </div>
          {selectedState.reviewPolicy?.rationale ? (
            <div className="max-w-xl rounded-xl border border-border/60 bg-background/65 px-3 py-2 text-xs leading-5 text-muted-foreground">
              <span className="font-medium text-foreground">判断理由：</span>{selectedState.reviewPolicy.rationale}
            </div>
          ) : null}
        </header>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">状态内执行结构</h3>
            <span className="text-xs text-muted-foreground">{(selectedState.steps || []).length} 个执行步骤</span>
          </div>
          {(selectedState.steps || []).length ? (
            <div className="-mx-1 flex items-stretch gap-3 overflow-x-auto px-1 pb-3 pt-1">
              {/* `overflow-x` makes the y axis clip too, so the padding above is what
                  keeps a running/failed card's ring from being cut off at the edges;
                  the negative margin cancels the horizontal half so alignment holds. */}
              {(selectedState.steps || []).map((step, index) => {
                const status = resolveStepStatus(selectedState, step.name, index);
                const tone = stepTone(step, index);
                const adversarial = selectedState.reviewPolicy?.mode === 'adversarial';
                return (
                  <div key={step.id || `${selectedState.name}-${step.name}-${index}`} className="contents">
                    {index > 0 ? (
                      <div className="flex shrink-0 items-center text-muted-foreground" aria-hidden="true">
                        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>arrow_forward</span>
                      </div>
                    ) : null}
                    <article
                      data-step-tone={tone}
                      data-runtime-status={status}
                      className={cn(
                        'min-w-[220px] flex-1 rounded-xl border p-4',
                        stepToneClass(tone),
                        status === 'running' && 'ring-2 ring-blue-500/35',
                        status === 'failed' && 'ring-2 ring-red-500/35',
                      )}
                    >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs text-muted-foreground">{stepToneLabel(tone, adversarial)}</div>
                        <div className="mt-1 truncate text-sm font-semibold">{step.name}</div>
                      </div>
                      <Badge variant="outline" className={cn('shrink-0 text-[10px]', statusBadgeClass(status))}>{statusLabel(status)}</Badge>
                    </div>
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>smart_toy</span>
                      Agent
                    </div>
                    <div className="mt-1 truncate text-sm">{step.agent || step.agentInstanceId || '未绑定'}</div>
                    </article>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">终态没有执行步骤。</div>
          )}
        </div>

        <div className="mt-6 border-t pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold">状态转移</h3>
            <span className="text-xs text-muted-foreground">已发生 {stateHistory.filter((entry) => entry.from === selectedState.name).length} 次</span>
          </div>
          {(selectedState.transitions || []).length ? (
            <div className="space-y-2">
              {(selectedState.transitions || []).map((transition, index) => {
                const count = stateHistory.filter((entry) => entry.from === selectedState.name && entry.to === transition.to).length;
                return (
                  <div
                    key={`${selectedState.name}-${transition.to}-${index}`}
                    data-triggered={count > 0 ? 'true' : 'false'}
                    className={cn(
                      'grid grid-cols-[minmax(120px,0.7fr)_32px_minmax(120px,1fr)_auto] items-center gap-2 rounded-xl border px-3 py-2 text-sm',
                      count > 0 ? 'border-emerald-500/20 bg-emerald-500/[0.07]' : 'border-border/50 bg-background/60',
                    )}
                  >
                    <code className={cn('truncate rounded px-2 py-1 text-xs', count > 0 ? 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-200' : 'bg-muted')}>{conditionLabel(transition.condition)}</code>
                    <span className={cn('material-symbols-outlined text-center', count > 0 ? 'text-emerald-600' : 'text-muted-foreground')} style={{ fontSize: 18 }}>arrow_forward</span>
                    <span className="truncate font-medium">{transition.to}</span>
                    {count > 0 ? <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/12 text-[10px] text-emerald-700 dark:text-emerald-300">已触发 {count} 次</Badge> : <Badge variant="outline" className="text-[10px]">未触发</Badge>}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">终态没有后续转移。</div>
          )}
        </div>
      </section>
    </div>
  );
}
