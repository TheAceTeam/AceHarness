'use client';

import { CodeBlock } from '@/components/ai-elements/code-block';
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task';
import { Tool, ToolContent, ToolHeader } from '@/components/ai-elements/tool';
import { mergeRuntimeToolEvents, type RuntimeToolChange, type RuntimeToolEvent } from '@/lib/runtime-agent/tool-events';
import { ChevronDownIcon, WrenchIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

const RUNTIME_TOOL_AUTO_COLLAPSE_MS = 10_000;
const RUNTIME_TOOL_GROUP_STABILITY_MS = 3_000;

function toToolUiState(tool: RuntimeToolEvent): 'input-available' | 'output-available' | 'output-error' {
  if (tool.status === 'failed') return 'output-error';
  if (tool.status === 'completed') return 'output-available';
  return 'input-available';
}

function formatChange(change: RuntimeToolChange): string {
  const counts = [
    change.addedLines !== undefined ? `+${change.addedLines}` : '',
    change.removedLines !== undefined ? `-${change.removedLines}` : '',
    change.changedLines !== undefined ? `${change.changedLines} lines` : '',
  ].filter(Boolean).join(' ');
  return [change.filePath, change.kind, counts].filter(Boolean).join('  ');
}

function ToolStdio({ label, value, tone = 'normal' }: { label: string; value?: string; tone?: 'normal' | 'error' }) {
  if (!value) return null;
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <pre className={[
        'max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-[11px] leading-5',
        tone === 'error' ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-border/70 bg-muted/35 text-foreground',
      ].join(' ')}>
        {value}
      </pre>
    </div>
  );
}

function isFileContentTool(toolName: string): boolean {
  return ['read', 'write', 'edit', 'multiedit', 'patch'].includes(toolName.toLowerCase());
}

/** Renders one structured tool event inside a chronological transcript. */
export function RuntimeToolEventCard({
  tool,
  isStreaming = false,
  className = '',
}: {
  tool: RuntimeToolEvent;
  isStreaming?: boolean;
  className?: string;
}) {
  const input = tool.input;
  const result = tool.result;
  const locations = [input?.filePath, input?.path, result?.filePath]
    .filter((value): value is string => Boolean(value));
  const changes = result?.changes?.length ? result.changes : input?.changes || [];
  const isRunning = tool.status === 'running';
  const showStdout = !isFileContentTool(tool.toolName);
  const subagentDetails = [
    input?.description ? ['任务', input.description] : null,
    input?.agent ? ['Agent', input.agent] : null,
    input?.childAgentCount ? ['子 Agent', `${input.childAgentCount} 个`] : null,
    input?.model ? ['模型', input.model] : null,
    input?.reasoningEffort ? ['推理等级', input.reasoningEffort] : null,
  ].filter((detail): detail is [string, string] => Boolean(detail));
  const [open, setOpen] = useState(isRunning);

  useEffect(() => {
    if (!isRunning) {
      setOpen(false);
      return;
    }
    const timer = window.setTimeout(() => setOpen(false), RUNTIME_TOOL_AUTO_COLLAPSE_MS);
    return () => window.clearTimeout(timer);
  }, [isRunning, tool.id, tool.updatedAt]);

  return (
    <Tool
      className={`mb-0 overflow-hidden rounded-md border-border/70 bg-background/70 shadow-sm ${className}`}
      data-tool-id={tool.id}
      data-tool-name={tool.toolName}
      data-tool-status={tool.status}
      open={open}
      onOpenChange={setOpen}
    >
      <ToolHeader
        type="dynamic-tool"
        toolName={tool.toolName || 'tool'}
        title={tool.title || tool.toolName || '工具调用'}
        state={toToolUiState(tool)}
        hideDefaultIcon
        className="bg-muted/30"
      />
      <ToolContent className="space-y-3">
        {input?.command ? <CodeBlock code={input.command} language="shell" /> : null}
        {locations.length > 0 ? (
          <div className="space-y-1">
            {Array.from(new Set(locations)).map((location) => (
              <div key={location} className="overflow-x-auto whitespace-nowrap font-mono text-[12px] text-muted-foreground">{location}</div>
            ))}
          </div>
        ) : null}
        {input?.pattern || input?.query || input?.url || input?.name ? (
          <div className="space-y-1 font-mono text-[12px] text-muted-foreground">
            {[input.pattern, input.query, input.url, input.name]
              .filter((value): value is string => Boolean(value))
              .map((value) => <div key={value}>{value}</div>)}
          </div>
        ) : null}
        {subagentDetails.length > 0 ? (
          <dl className="grid gap-1 text-[12px] sm:grid-cols-[auto_minmax(0,1fr)]">
            {subagentDetails.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="min-w-0 break-words text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {changes.length > 0 ? (
          <div className="space-y-1 text-[12px] text-muted-foreground">
            {changes.map((change, index) => <div key={`${change.filePath || change.kind || 'change'}:${index}`}>{formatChange(change)}</div>)}
          </div>
        ) : null}
        <ToolStdio label="标准输出" value={showStdout ? result?.stdout : undefined} />
        <ToolStdio label="标准错误" value={result?.stderr} tone="error" />
        {result?.error ? <ToolStdio label="错误" value={result.error} tone="error" /> : null}
        {result?.exitCode !== undefined ? <div className="font-mono text-[11px] text-muted-foreground">exit {result.exitCode}</div> : null}
        {!isStreaming && !isRunning && !result?.stdout && !result?.stderr && !result?.error && changes.length === 0 && locations.length === 0 ? (
          <div className="text-xs text-muted-foreground">已完成</div>
        ) : null}
      </ToolContent>
    </Tool>
  );
}

/** Groups consecutive tool calls while keeping each call independently inspectable. */
export function RuntimeToolEventGroup({
  events,
  isStreaming = false,
  className = '',
}: {
  events: readonly RuntimeToolEvent[];
  isStreaming?: boolean;
  className?: string;
}) {
  const pendingCount = events.filter((event) => event.status === 'running').length;
  const groupTitle = pendingCount > 0 && isStreaming ? '工具调用中' : '工具调用已完成';
  const groupSummary = `${events.length} 个步骤${pendingCount > 0 && isStreaming ? ` · 进行中 ${pendingCount}` : ''}`;
  const runningToolKey = events
    .filter((event) => event.status === 'running')
    .map((event) => `${event.id}:${event.updatedAt || event.createdAt || ''}`)
    .join('|');
  const [open, setOpen] = useState(pendingCount > 0);
  const previousPendingCountRef = useRef(pendingCount);
  const stabilityTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (stabilityTimerRef.current !== null) {
      window.clearTimeout(stabilityTimerRef.current);
      stabilityTimerRef.current = null;
    }

    if (!isStreaming) {
      setOpen(false);
      return;
    }

    const wasIdle = previousPendingCountRef.current === 0;
    previousPendingCountRef.current = pendingCount;
    if (pendingCount === 0) {
      stabilityTimerRef.current = window.setTimeout(() => {
        stabilityTimerRef.current = null;
        setOpen(false);
      }, RUNTIME_TOOL_GROUP_STABILITY_MS);
      return () => {
        if (stabilityTimerRef.current !== null) {
          window.clearTimeout(stabilityTimerRef.current);
          stabilityTimerRef.current = null;
        }
      };
    }
    if (wasIdle) setOpen(true);
    const timer = window.setTimeout(() => setOpen(false), RUNTIME_TOOL_AUTO_COLLAPSE_MS);
    return () => {
      window.clearTimeout(timer);
      if (stabilityTimerRef.current !== null) {
        window.clearTimeout(stabilityTimerRef.current);
        stabilityTimerRef.current = null;
      }
    };
  }, [isStreaming, pendingCount, runningToolKey]);

  return (
    <Task
      open={open}
      onOpenChange={setOpen}
      className={`rounded-md border-border/70 bg-background/60 px-3 py-3 shadow-sm ${className}`}
      data-testid="runtime-tool-group"
    >
      <TaskTrigger title={groupTitle}>
        <div className="group flex w-full cursor-pointer items-start gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <WrenchIcon className="mt-0.5 size-4 shrink-0 text-blue-500" />
          <div className="min-w-0 flex-1">
            <div className="text-sm">{groupTitle}</div>
            <div className="mt-1 text-xs text-muted-foreground">{groupSummary}</div>
          </div>
          <ChevronDownIcon className="mt-0.5 size-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
        </div>
      </TaskTrigger>
      <TaskContent className="mt-3 data-[state=closed]:hidden data-[state=open]:block" forceMount>
        <div className="space-y-2 border-l-0 pl-0">
          {events.map((event) => (
            <TaskItem key={`${event.id}-${event.status}`} className="text-sm">
              <RuntimeToolEventCard tool={event} isStreaming={isStreaming} />
            </TaskItem>
          ))}
        </div>
      </TaskContent>
    </Task>
  );
}

/** Renders structured ACP tool events without mixing them into assistant prose. */
export function RuntimeToolEventList({
  events,
  isStreaming = false,
  className = '',
}: {
  events: readonly RuntimeToolEvent[];
  isStreaming?: boolean;
  className?: string;
}) {
  const tools = useMemo(() => {
    let merged: RuntimeToolEvent[] = [];
    for (const event of events) merged = mergeRuntimeToolEvents(merged, event);
    return merged;
  }, [events]);

  if (tools.length === 0) return null;

  return (
    <div className={`space-y-2 ${className}`} data-testid="runtime-tool-events">
      {tools.length > 1 ? (
        <RuntimeToolEventGroup events={tools} isStreaming={isStreaming} />
      ) : (
        tools.map((tool) => <RuntimeToolEventCard key={`${tool.id}-${tool.status}`} tool={tool} isStreaming={isStreaming} />)
      )}
    </div>
  );
}
