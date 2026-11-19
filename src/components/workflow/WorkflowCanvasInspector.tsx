'use client';

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GitBranch, ListChecks, Workflow, X } from 'lucide-react';
import WorkflowScriptEditor from '@/components/workflow/WorkflowScriptEditor';
import { SCRIPT_INTERPRETER_LABELS } from '@/lib/workflow/script-presentation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SingleCombobox } from '@/components/ui/combobox';
import { useConfigOptionsQuery } from '@/client/query/configs';
import { isWorkflowStepSelectableAgent } from '@/lib/agent/catalog';
import type { StateMachineState, WorkflowScript, WorkflowScriptInterpreter, WorkflowStep } from '@/lib/core/schemas';
import type { StateMachineDesignPanelProps } from '@/components/StateMachineDesignPanel';
import {
  buildWorkflowStepFromEditData, getStepParallelGroup, insertDesignStep, moveCanvasStep, withParallelGroup, withoutParallelGroup,
} from '@/lib/workflow/state-machine-design';

export type CanvasStepKind = 'agent' | 'subworkflow';

export function InspectorTitle({ title, detail, onClose }: { title: string; detail?: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b bg-card px-4 py-3">
      <div className="min-w-0">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        {detail ? <p className="mt-1 truncate text-xs text-muted-foreground" title={detail}>{detail}</p> : null}
      </div>
      <Button variant="ghost" size="icon" className="size-7 shrink-0" aria-label="关闭属性" title="关闭属性" onClick={onClose}><X className="size-3.5" /></Button>
    </div>
  );
}

export function InspectorSelect({ label, value, onChange, options, disabled }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="h-9"><SelectValue placeholder="请选择" /></SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export function CanvasStateInspector({ state, states, onSave, onStep, onAdd, onGroup, children }: {
  state: StateMachineState;
  states: StateMachineState[];
  onSave: (next: StateMachineState) => void;
  onStep: (index: number) => void;
  onAdd: () => void;
  onGroup: () => void;
  children?: ReactNode;
}) {
  const [name, setName] = useState(state.name);
  const [description, setDescription] = useState(state.description || '');
  const [initial, setInitial] = useState(state.isInitial);
  const [final, setFinal] = useState(state.isFinal);
  const [approval, setApproval] = useState(Boolean(state.requireHumanApproval));
  const duplicateName = states.some((item) => item !== state && item.name === name.trim());
  const prefix = useId();
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || duplicateName) return;
    onSave({ ...state, name: name.trim(), description, isInitial: initial, isFinal: final, requireHumanApproval: approval });
  }
  return (
    <>
      <form onSubmit={submit} className="space-y-4 px-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor={prefix + '-name'}>状态名称</Label>
          <Input id={prefix + '-name'} value={name} onChange={(event) => setName(event.target.value)} required />
          {duplicateName ? <p role="alert" className="text-xs text-destructive">已存在同名状态。</p> : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={prefix + '-description'}>说明</Label>
          <Textarea id={prefix + '-description'} rows={3} value={description} onChange={(event) => setDescription(event.target.value)} />
        </div>
        <div className="space-y-3 rounded-lg border bg-muted/20 px-3 py-3">
          {([
            ['initial', '初始状态', initial, setInitial],
            ['final', '终止状态', final, setFinal],
            ['approval', '需要人工审查', approval, setApproval],
          ] as const).map(([key, label, value, setValue]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <Label className="text-xs" htmlFor={prefix + '-' + key}>{label}</Label>
              <Switch id={prefix + '-' + key} checked={value} onCheckedChange={setValue} />
            </div>
          ))}
        </div>
        {state.reviewPolicy ? <p className="text-xs text-muted-foreground">审查策略 · {state.reviewPolicy.mode === 'adversarial' ? '对抗' : '标准'}{state.reviewPolicy.locked ? ' · 已锁定' : ''}</p> : null}
        <Button type="submit" variant="primary" size="sm" disabled={!name.trim() || duplicateName}>应用</Button>
      </form>
      <section className="space-y-2 border-t px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold">步骤</h4>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onAdd}>添加步骤</Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" disabled={state.steps.length < 2} onClick={onGroup}>并发组</Button>
          </div>
        </div>
        {state.steps.map((step, index) => (
          <Button key={step.id ?? index} variant="outline" size="sm" className="flex h-8 w-full justify-start gap-2 px-2"
            onClick={() => onStep(index)}>
            {step.type === 'subworkflow' ? <Workflow className="size-3.5 shrink-0" /> : <ListChecks className="size-3.5 shrink-0" />}
            <span className="truncate">{step.name}</span>
            {getStepParallelGroup(step) ? <GitBranch className="ml-auto size-3.5 shrink-0 text-muted-foreground" /> : null}
          </Button>
        ))}
        {children}
      </section>
    </>
  );
}

function SubworkflowPicker({ value, configFile, onChange }: { value: string; configFile?: string; onChange: (value: string) => void }) {
  const query = useConfigOptionsQuery({ mode: 'state-machine' });
  const items = (query.data?.configs || []).filter((config) => config.filename !== configFile);
  const options = items.map((config) => ({ value: config.filename, label: config.name || config.filename, description: config.filename }));
  if (value && !options.some((option) => option.value === value)) options.unshift({ value, label: value, description: value });
  return (
    <div className="space-y-1.5">
      <Label>子工作流配置</Label>
      <SingleCombobox value={value} onValueChange={onChange} options={options}
        placeholder={query.isFetching ? '正在加载…' : '选择工作流'}
        emptyText={query.isError ? '加载工作流失败' : '没有可选的工作流'} />
    </div>
  );
}

export function CanvasStepInspector({ state, index, kind, role, agents, configFile, onSave, onNavigate }: {
  state: StateMachineState;
  index?: number;
  kind: CanvasStepKind;
  role?: WorkflowStep['role'];
  agents: StateMachineDesignPanelProps['availableAgents'];
  configFile?: string;
  onSave: (next: StateMachineState) => void;
  onNavigate: (index?: number) => void;
}) {
  const step = index === undefined ? undefined : state.steps[index];
  const agentOptions = agents.filter(isWorkflowStepSelectableAgent).map((agent) => ({ value: agent.name as string, label: agent.name as string }));
  const [name, setName] = useState(step?.name || '');
  const [agent, setAgent] = useState(step ? step.agent || '' : agentOptions[0]?.value || '');
  const [task, setTask] = useState(step?.task || '');
  const [workflow, setWorkflow] = useState(step?.workflow || step?.subworkflow?.configFile || '');
  const locked = Boolean(state.reviewPolicy?.locked && (step?.provenance?.origin === 'review-policy' || step?.provenance?.managedRole === 'standard-closer'));
  const managedRole = !step && (role === 'judge' || role === 'attacker') && Boolean(state.reviewPolicy);
  const duplicateName = state.steps.some((other, otherIndex) => otherIndex !== index && other.name === name.trim());
  const nameId = useId();
  const taskId = useId();

  function canMove(to: number) {
    const neighbor = state.steps[to];
    return Boolean(step && neighbor && getStepParallelGroup(step) === getStepParallelGroup(neighbor));
  }

  function move(to: number) {
    if (index === undefined || !canMove(to)) return;
    const next = moveCanvasStep([state], 0, index, 0, getStepParallelGroup(step), to > index ? to + 1 : to)[0];
    onSave(next);
    onNavigate(to);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || locked || managedRole || duplicateName || (kind === 'agent' ? !agent || !task.trim() : !workflow)) return;
    const changes: WorkflowStep = kind === 'agent'
      ? { ...step, name: name.trim(), agent, task: task.trim(), role: step?.role ?? role }
      : buildWorkflowStepFromEditData({
          ...step, name: name.trim(), type: 'subworkflow', workflow,
          subworkflow: { ...step?.subworkflow, configFile: workflow },
          inputs: step?.inputs ?? { requirements: 'inherit', workspace: 'inherit', context: 'inherit', skills: 'merge', mcpServers: 'merge', rag: 'merge', engine: 'child' },
        }, step);
    if (index === undefined) onSave(insertDesignStep(state, changes));
    else onSave({ ...state, steps: state.steps.map((item, position) => position === index ? changes : item) });
    onNavigate();
  }

  const currentAgent = agent && !agentOptions.some((option) => option.value === agent)
    ? [{ value: agent, label: agent }, ...agentOptions]
    : agentOptions;
  if (managedRole) return <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">此状态已启用审查策略。攻击与裁判步骤由状态审查策略维护。</p>;
  return (
    <form onSubmit={submit} className="space-y-4 px-4 py-4">
      {locked ? <p className="rounded-md border bg-muted/35 p-2 text-xs text-muted-foreground">此步骤由审查策略管理。</p> : null}
      <div className="space-y-1.5">
        <Label htmlFor={nameId}>步骤名称</Label>
        <Input id={nameId} value={name} onChange={(event) => setName(event.target.value)} disabled={locked} required />
        {duplicateName ? <p role="alert" className="text-xs text-destructive">当前状态已存在同名步骤。</p> : null}
      </div>
      {kind === 'agent' ? (
        <>
          <InspectorSelect label="Agent" value={agent} options={currentAgent} onChange={setAgent} disabled={locked} />
          <div className="space-y-1.5">
            <Label htmlFor={taskId}>任务描述</Label>
            <Textarea id={taskId} rows={5} value={task} onChange={(event) => setTask(event.target.value)} disabled={locked} required />
          </div>
        </>
      ) : locked ? <p className="truncate text-xs text-muted-foreground">{workflow}</p>
        : <SubworkflowPicker value={workflow} onChange={setWorkflow} configFile={configFile} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={locked || duplicateName || !name.trim() || (kind === 'agent' ? !agent || !task.trim() : !workflow)}>
          {step ? '应用' : '添加步骤'}
        </Button>
        {index !== undefined ? (
          <>
            <Button size="icon" variant="ghost" className="size-8" aria-label="上移步骤" disabled={!canMove(index - 1)} onClick={() => move(index - 1)}><ArrowUp className="size-4" /></Button>
            <Button size="icon" variant="ghost" className="size-8" aria-label="下移步骤" disabled={!canMove(index + 1)} onClick={() => move(index + 1)}><ArrowDown className="size-4" /></Button>
          </>
        ) : null}
      </div>
    </form>
  );
}

export function CanvasScriptInspector({ state, states, index, interpreter, onSave }: {
  state: StateMachineState;
  states: StateMachineState[];
  index?: number;
  interpreter: WorkflowScriptInterpreter;
  onSave: (next: StateMachineState) => void;
}) {
  const step = index === undefined ? undefined : state.steps[index];
  const initial = step?.script;
  const [name, setName] = useState(step?.name || SCRIPT_INTERPRETER_LABELS[interpreter] + ' 脚本');
  const [language, setLanguage] = useState(initial?.interpreter ?? interpreter);
  const [source, setSource] = useState(initial?.source || '');
  const [action, setAction] = useState(initial?.onFailure.action || 'stop');
  const [target, setTarget] = useState(initial?.onFailure.action === 'transition' ? initial.onFailure.target : '');
  const [timeout, setTimeoutSeconds] = useState(String((initial?.timeoutMs || 120000) / 1000));
  const duplicate = state.steps.some((item, stepIndex) => stepIndex !== index && item.name === name.trim());
  const canSave = name.trim() && !duplicate && source.trim() && source.length <= 128 * 1024
    && Number(timeout) >= 1 && Number(timeout) <= 1800
    && (action !== 'transition' || states.some((item) => item.name === target));
  const prefix = useId();
  if (state.reviewPolicy?.mode === 'adversarial') {
    return <p className="px-4 py-4 text-xs leading-5 text-muted-foreground">请将脚本放进单独的状态，再连接到对抗状态。对抗状态按防守、攻击和裁判的角色顺序执行。</p>;
  }
  return (
    <form className="space-y-4 px-4 py-4" onSubmit={(event) => {
      event.preventDefault();
      if (!canSave) return;
      const script: WorkflowScript = {
        interpreter: language, source, timeoutMs: Math.round(Number(timeout) * 1000),
        onFailure: action === 'transition' ? { action, target } : { action },
      };
      const next: WorkflowStep = { ...step, type: 'script', name: name.trim(), agent: '', task: '', script };
      onSave(index === undefined ? insertDesignStep(state, next) : {
        ...state, steps: state.steps.map((item, position) => position === index ? next : item),
      });
    }}>
      <div className="space-y-1.5">
        <Label htmlFor={prefix + '-name'}>步骤名称</Label>
        <Input id={prefix + '-name'} value={name} onChange={(event) => setName(event.target.value)} />
        {duplicate ? <p role="alert" className="text-xs text-destructive">当前状态已存在同名步骤。</p> : null}
      </div>
      <InspectorSelect label="解释器" value={language} onChange={(value) => setLanguage(value as WorkflowScriptInterpreter)}
        options={Object.entries(SCRIPT_INTERPRETER_LABELS).map(([value, label]) => ({ value, label }))} />
      <div className="space-y-1.5">
        <Label id={prefix + '-code'}>脚本内容</Label>
        <div role="group" aria-labelledby={prefix + '-code'} className="overflow-hidden rounded-md border">
          <WorkflowScriptEditor value={source} interpreter={language} onChange={setSource} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={prefix + '-timeout'}>超时（秒）</Label>
        <Input id={prefix + '-timeout'} type="number" min={1} max={1800} value={timeout} onChange={(event) => setTimeoutSeconds(event.target.value)} />
      </div>
      <InspectorSelect label="执行失败时" value={action} onChange={(value) => setAction(value as typeof action)} options={[
        { value: 'continue', label: '继续执行下一步' }, { value: 'transition', label: '转移到指定状态' }, { value: 'stop', label: '停止工作流' },
      ]} />
      {action === 'transition' && <InspectorSelect label="目标状态" value={target} onChange={setTarget}
        options={states.filter((item) => item.name.trim()).map((item) => ({ value: item.name, label: item.name }))} />}
      <Button type="submit" size="sm" variant="primary" disabled={!canSave}>{step ? '应用' : '添加步骤'}</Button>
    </form>
  );
}

export function CanvasGroupInspector({ state, groupId, onSave, onStep }: {
  state: StateMachineState;
  groupId?: string;
  onSave: (next: StateMachineState) => void;
  onStep: (index: number) => void;
}) {
  const inUse = state.steps.map((step, index) => ({ step, index })).filter(({ step }) => groupId && getStepParallelGroup(step) === groupId);
  const metadata = state.parallelGroups?.find((group) => group.id === groupId);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const available = state.steps.map((step, index) => ({ step, index })).filter(({ step }) => (
    step.type !== 'script' && !getStepParallelGroup(step)
  ));
  const allowedIndices = new Set(available.map(({ index }) => index));
  const tailOptions = start === '' ? [] : available.filter(({ index }) => {
    const startIndex = Number(start);
    return index > startIndex && state.steps.slice(startIndex, index + 1).every((_, offset) => allowedIndices.has(startIndex + offset));
  });
  const display = ({ step, index }: { step: WorkflowStep; index: number }) => ({ value: String(index), label: `${index + 1}. ${step.name}` });
  const [mode, setMode] = useState(inUse[0]?.step.concurrency?.joinPolicy?.mode || metadata?.joinPolicy?.mode || 'all');
  const [quorum, setQuorum] = useState(String(inUse[0]?.step.concurrency?.joinPolicy?.quorum ?? metadata?.joinPolicy?.quorum ?? 2));
  const size = groupId ? inUse.length : tailOptions.some(({ index }) => String(index) === end) ? Number(end) - Number(start) + 1 : 0;
  const canSave = (Boolean(metadata) || size > 1) && (mode !== 'quorum' || (Number.isInteger(Number(quorum)) && Number(quorum) >= 1 && (size < 2 || Number(quorum) <= size)));
  const qid = useId();
  return (
    <form className="space-y-4 px-4 py-4" onSubmit={(event) => {
      event.preventDefault();
      if (!canSave) return;
      const id = groupId || 'parallel-' + crypto.randomUUID();
      const steps = state.steps.map((step, index) => {
        const included = groupId ? getStepParallelGroup(step) === groupId : index >= Number(start) && index <= Number(end);
        if (!included) return step;
        const grouped = withParallelGroup(step, id, index);
        return {
          ...grouped, concurrency: {
            ...grouped.concurrency,
            joinPolicy: mode === 'quorum' ? { mode, quorum: Number(quorum) } : { mode },
          },
        };
      });
      const joinPolicy = mode === 'quorum' ? { mode, quorum: Number(quorum) } : { mode };
      onSave({ ...state, steps, parallelGroups: (state.parallelGroups || []).map((group) => group.id === id ? { ...group, joinPolicy } : group) });
    }}>
      {groupId ? (
        <div className="space-y-1.5">
          {!inUse.length && <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">将步骤拖入画布中的并发组。</p>}
          {inUse.map(({ step, index }) => (
            <Button key={step.id ?? index} variant="outline" size="sm" className="h-8 w-full justify-start px-2" onClick={() => onStep(index)}>
              <span className="truncate">{step.name}</span>
            </Button>
          ))}
        </div>
      ) : (
        <>
          <p className="text-xs leading-5 text-muted-foreground">将同一状态里相邻的步骤组合起来。</p>
          {available.some(({ index }) => allowedIndices.has(index + 1)) ? (
            <>
              <InspectorSelect label="首个步骤" value={start} options={available.filter(({ index }) => allowedIndices.has(index + 1)).map(display)} onChange={(value) => { setStart(value); setEnd(''); }} />
              <InspectorSelect label="末尾步骤" value={end} options={tailOptions.map(display)} onChange={setEnd} disabled={!tailOptions.length} />
            </>
          ) : <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">先添加至少两个相邻的普通步骤。</p>}
        </>
      )}
      <InspectorSelect label="汇合策略" value={mode} options={[
        { value: 'all', label: '全部完成' }, { value: 'any', label: '任一完成' }, { value: 'quorum', label: '达到指定数量' }, { value: 'manual', label: '人工确认' },
      ]} onChange={(value) => setMode(value as typeof mode)} />
      {mode === 'quorum' ? <div className="space-y-1.5">
        <Label htmlFor={qid}>完成数量</Label>
        <Input id={qid} type="number" min={1} max={size || undefined} value={quorum} onChange={(event) => setQuorum(event.target.value)} />
      </div> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!canSave}>{groupId ? '应用' : '创建并发组'}</Button>
        {groupId && <Button size="sm" variant="ghost" onClick={() => onSave({
          ...state, parallelGroups: state.parallelGroups?.filter((group) => group.id !== groupId),
          steps: state.steps.map((step) => getStepParallelGroup(step) === groupId ? withoutParallelGroup(step) : step),
        })}>解散并发组</Button>}
      </div>
    </form>
  );
}
