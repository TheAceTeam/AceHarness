'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CircleAlert, Clock3, Loader2, Terminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { cn } from '@/lib/core/utils';
import { SCRIPT_INTERPRETER_LABELS, findScriptExecution, scriptDuration, scriptExecutionLabel, scriptFailureLabel, type ScriptExecutionRecord } from '@/lib/workflow/script-presentation';
import type { StateMachineState, WorkflowStep } from '@/lib/core/schemas';

function useScriptDuration(record?: ScriptExecutionRecord) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (record?.status !== 'running') return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [record?.status, record?.timestamp]);
  return record?.status === 'running' && record.timestamp ? Math.max(0, now - Date.parse(record.timestamp)) : record?.durationMs;
}
export function ScriptExecutionMetrics({ record, running = false }: { record?: ScriptExecutionRecord; running?: boolean }) {
  const duration = useScriptDuration(record);
  return <span className="inline-flex shrink-0 items-center gap-1 font-mono text-[9px]" title={`${scriptExecutionLabel(record, running)} · ${scriptDuration(duration)}`}>
    {record?.status === 'running' || running ? <Loader2 className="size-2.5 animate-spin" /> : null}
    {record?.scriptExitCode != null ? <span aria-label={`退出码 ${record.scriptExitCode}`}>exit {record.scriptExitCode}</span> : null}
    {duration !== undefined ? <span>{scriptDuration(duration)}</span> : null}
  </span>;
}
export function WorkflowScriptExecutionDetails({ step, record, running = false, hideOutput = false }: { step?: WorkflowStep; record?: ScriptExecutionRecord; running?: boolean; hideOutput?: boolean }) {
  const duration = useScriptDuration(record);
  const interpreter = record?.scriptInterpreter || step?.script?.interpreter;
  const failed = record?.status === 'failed';
  const output = (title: string, text: string | undefined, error = false) => <section className="min-w-0 overflow-hidden rounded-lg border">
    <div className="border-b bg-muted/40 px-3 py-2 font-mono text-xs font-medium">{title}</div>
    <pre className={cn('max-h-[35vh] overflow-auto whitespace-pre-wrap break-words bg-slate-950 px-4 py-3 font-mono text-xs leading-5 text-slate-200', error && Boolean(text) && 'text-rose-300')}>{text || (record?.status === 'running' ? '等待输出…' : '无输出')}</pre>
  </section>;
  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="gap-1.5"><Terminal className="size-3" />{interpreter ? SCRIPT_INTERPRETER_LABELS[interpreter] : '脚本'}</Badge>
      <Badge variant={failed && record?.scriptFailureAction === 'stop' ? 'destructive' : 'secondary'}>{scriptExecutionLabel(record, running)}</Badge>
    </div>
    <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/20 p-3 text-xs">
      <div><dt className="text-muted-foreground">退出码</dt><dd className="mt-1 font-mono font-semibold">{record?.scriptExitCode ?? '—'}</dd></div>
      <div><dt className="text-muted-foreground">执行用时</dt><dd className="mt-1 font-mono">{scriptDuration(duration)}</dd></div>
      <div><dt className="text-muted-foreground">失败时</dt><dd className="mt-1">{scriptFailureLabel(step, record)}</dd></div>
      <div><dt className="text-muted-foreground">超时</dt><dd className="mt-1">{step?.script ? `${step.script.timeoutMs / 1000}秒` : '—'}</dd></div>
    </dl>
    {record?.error && <p className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 text-xs leading-5 text-rose-700 dark:text-rose-300">{record.error}</p>}
    {!hideOutput && (record?.scriptStdout !== undefined || record?.scriptStderr !== undefined ? <>
      {output('stdout · 标准输出', record.scriptStdout)}
      {output('stderr · 错误输出', record.scriptStderr, true)}
    </> : output('执行输出', record?.output))}
    {!hideOutput && record?.scriptOutputTruncated && <p className="text-xs text-muted-foreground">此处显示各输出流的末尾内容；完整输出可在步骤文档中查看。</p>}
    {step?.script?.source && <details className="rounded-lg border"><summary className="cursor-pointer px-3 py-2 text-xs font-medium">查看执行脚本</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t bg-muted/20 p-3 font-mono text-xs leading-5">{step.script.source}</pre></details>}
  </div>;
}
export function WorkflowScriptExecutionDialog({ selection, records, onClose }: { selection: { stateName: string; step: WorkflowStep } | null; records: ScriptExecutionRecord[]; onClose: () => void }) {
  const record = selection ? findScriptExecution(records, selection.stateName, selection.step.name) : undefined;
  return <Dialog open={Boolean(selection)} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-0" aria-describedby={undefined}>
      <DialogTitle className="flex items-center gap-2 border-b px-4 py-4 pr-12 text-sm"><Terminal className="size-4" />{selection?.step.name || '脚本执行'}<span className="ml-auto truncate text-xs font-normal text-muted-foreground">{selection?.stateName}</span></DialogTitle>
      {selection && <WorkflowScriptExecutionDetails step={selection.step} record={record} />}
      <DialogClose asChild><Button type="button" variant="ghost" size="icon" className="absolute right-3 top-3 size-7" aria-label="关闭脚本执行详情"><X className="size-4" /></Button></DialogClose>
    </DialogContent>
  </Dialog>;
}
export function WorkflowScriptRunList({ states, records }: { states: StateMachineState[]; records: ScriptExecutionRecord[] }) {
  const [selection, setSelection] = useState<{ stateName: string; step: WorkflowStep } | null>(null);
  const scripts = states.flatMap(state => state.steps.filter(step => step.type === 'script').map(step => ({ stateName: state.name, step, record: findScriptExecution(records, state.name, step.name) })));
  if (!scripts.length) return null;
  return <section className="rounded-xl border bg-card p-4">
    <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Terminal className="size-4 text-violet-500" />脚本执行<span className="text-xs font-normal text-muted-foreground">{scripts.length} 个步骤</span></div>
    <div className="space-y-2">{scripts.map(({ stateName, step, record }) => <Button type="button" key={stateName + ':' + step.name} variant="outline" className="h-auto w-full justify-start gap-3 px-3 py-2.5 text-left" onClick={() => setSelection({ stateName, step })}>
      {record?.status === 'running' ? <Loader2 className="size-4 shrink-0 animate-spin text-blue-500" /> : record?.status === 'completed' ? <CheckCircle2 className="size-4 shrink-0 text-emerald-500" /> : record?.status === 'failed' ? <CircleAlert className="size-4 shrink-0 text-amber-500" /> : <Clock3 className="size-4 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{step.name}</span><span className="block truncate text-[11px] text-muted-foreground">{stateName} · {SCRIPT_INTERPRETER_LABELS[record?.scriptInterpreter || step.script?.interpreter || 'shell']}</span></span>
      <ScriptExecutionMetrics record={record} /><Badge variant="secondary" className="text-[10px]">{scriptExecutionLabel(record)}</Badge>
    </Button>)}</div>
    <WorkflowScriptExecutionDialog selection={selection} records={records} onClose={() => setSelection(null)} />
  </section>;
}
