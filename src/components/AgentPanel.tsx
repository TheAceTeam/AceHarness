'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { VirtualList } from '@/client/virtual/VirtualList';
import { copyText } from '@/lib/core/clipboard';

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

interface ChangeRecord {
  file: string;
  action: 'created' | 'modified' | 'deleted';
  description: string;
}

interface Agent {
  name: string;
  team: string;
  model: string;
  status: 'waiting' | 'running' | 'completed' | 'failed';
  currentTask: string | null;
  completedTasks: number;
  sessionId?: string | null;
  output?: string;
  tokenUsage?: TokenUsage;
  iterationCount?: number;
  summary?: string;
  changes?: ChangeRecord[];
}

interface Log {
  agent: string;
  level: string;
  message: string;
  time: string;
}

interface PersistedStepLog {
  id: string;
  stepName: string;
  agent: string;
  status: 'completed' | 'failed';
  output: string;
  error: string;
  costUsd: number;
  durationMs: number;
  timestamp: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
    totalTokens?: number;
  };
}

interface AgentPanelProps {
  agent: Agent;
  logs: Log[];
  onClearLogs: (agentName: string) => void;
  stepSummary?: string;
  persistedStepLogs?: PersistedStepLog[];
  selectedStepName?: string | null;
  selectedStepExecutionId?: string | null;
  runStatus?: string;
  runStatusReason?: string | null;
  currentStepName?: string | null;
  onSelectPersistedStep?: (stepName: string) => void;
  onViewPersistedStepOutput?: (log: PersistedStepLog) => void;
  systemPrompt?: string;
  iterationPrompt?: string;
  /** When true, hide agent header card and prompt sections to avoid duplication with step config */
  compact?: boolean;
}

export default function AgentPanel({
  agent,
  logs,
  onClearLogs,
  stepSummary,
  persistedStepLogs = [],
  selectedStepName,
  selectedStepExecutionId,
  runStatus,
  runStatusReason,
  currentStepName,
  onSelectPersistedStep,
  onViewPersistedStepOutput,
  systemPrompt,
  iterationPrompt,
  compact = false,
}: AgentPanelProps) {
  const [showPrompt, setShowPrompt] = useState(false);
  void logs;
  void onClearLogs;
  void runStatus;
  void runStatusReason;
  void currentStepName;
  void stepSummary;
  const relevantPersistedLogs = (selectedStepName
    ? persistedStepLogs.filter((log) => {
        if (selectedStepExecutionId && log.id === selectedStepExecutionId) return true;
        return log.agent === agent.name && (
          log.stepName === selectedStepName ||
          log.stepName.endsWith(`-${selectedStepName}`)
        );
      })
    : persistedStepLogs.filter((log) => log.agent === agent.name)
  ).slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  const completedPersistedLogs = relevantPersistedLogs.filter((log) => log.status === 'completed');

  const getTeamLabel = (team: string) => {
    const labels: Record<string, string> = { blue: 'Blue Team', red: 'Red Team', judge: 'Judge Team' };
    return labels[team] || team;
  };

  const copyOutput = async () => {
    if (agent.output) await copyText(agent.output);
  };

  const formatTokens = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };
  const totalStepTokens = (usage?: PersistedStepLog['tokenUsage']) => {
    if (!usage) return 0;
    return Number(usage.totalTokens || 0)
      || Number(usage.inputTokens || 0)
      + Number(usage.outputTokens || 0)
      + Number(usage.cacheCreationInputTokens || 0)
      + Number(usage.cacheReadInputTokens || 0);
  };

  const teamColor = agent.team === 'red' ? 'text-red-400' : agent.team === 'judge' ? 'text-yellow-400' : 'text-blue-400';
  const teamBg = agent.team === 'red' ? 'bg-red-500/20' : agent.team === 'judge' ? 'bg-yellow-500/20' : 'bg-blue-500/20';

  return (
    <div className="flex flex-col gap-4 p-4">
      {!compact && (
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full ${teamBg} flex items-center justify-center`}>
            <span className="material-symbols-outlined text-lg">smart_toy</span>
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm">{agent.name}</div>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className={`text-xs ${teamColor} border-current/30`}>
                {getTeamLabel(agent.team)}
              </Badge>
              <Badge variant="secondary" className="text-xs">{agent.model}</Badge>
            </div>
          </div>
        </div>
      )}

      {!compact && (systemPrompt || iterationPrompt) && (
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs text-muted-foreground uppercase">Agent 提示词</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                查看当前角色配置中的系统提示词和迭代提示词。
              </div>
            </div>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowPrompt((value) => !value)}>
              {showPrompt ? '收起' : '查看'}
            </Button>
          </div>
          {showPrompt ? (
            <div className="mt-3 space-y-3">
              {systemPrompt ? (
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">System Prompt</div>
                  <pre className="max-h-64 overflow-auto rounded border bg-background p-2 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {systemPrompt}
                  </pre>
                </div>
              ) : null}
              {iterationPrompt ? (
                <div>
                  <div className="mb-1 text-[11px] font-medium text-muted-foreground">Iteration Prompt</div>
                  <pre className="max-h-64 overflow-auto rounded border bg-background p-2 text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">
                    {iterationPrompt}
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      )}

      <div className="grid grid-cols-4 gap-2">
        <div className="text-center p-2 rounded-md bg-muted">
          <span className="block text-xs text-muted-foreground">完成步骤</span>
          <span className="block text-lg font-semibold">{completedPersistedLogs.length || agent.completedTasks}</span>
        </div>
        <div className="text-center p-2 rounded-md bg-muted">
          <span className="block text-xs text-muted-foreground">迭代轮次</span>
          <span className="block text-lg font-semibold">{agent.iterationCount || 0}</span>
        </div>
        <div className="text-center p-2 rounded-md bg-muted">
          <span className="block text-xs text-muted-foreground">Input</span>
          <span className="block text-lg font-semibold">{formatTokens(agent.tokenUsage?.inputTokens || 0)}</span>
        </div>
        <div className="text-center p-2 rounded-md bg-muted">
          <span className="block text-xs text-muted-foreground">Output</span>
          <span className="block text-lg font-semibold">{formatTokens(agent.tokenUsage?.outputTokens || 0)}</span>
        </div>
      </div>

      {agent.changes && agent.changes.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground uppercase mb-1">变更记录</div>
          <div className="space-y-1">
            {agent.changes.map((change, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono">
                <span className={change.action === 'created' ? 'text-green-500' : change.action === 'deleted' ? 'text-red-500' : 'text-yellow-500'}>
                  {change.action === 'created' ? '+' : change.action === 'deleted' ? '-' : '~'}
                </span>
                <span className="text-muted-foreground">{change.file}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground uppercase">完成过的步骤</span>
          <Badge variant="outline" className="text-[10px]">
            {completedPersistedLogs.length}
          </Badge>
        </div>
        {completedPersistedLogs.length === 0 ? (
          <div className="rounded-md bg-muted p-3 text-center text-xs text-muted-foreground">
            暂无完成步骤记录
          </div>
        ) : (
          <VirtualList
            items={completedPersistedLogs}
            estimateSize={112}
            height={Math.min(520, Math.max(180, completedPersistedLogs.length * 112))}
            className="min-h-0"
            testId="agent-persisted-step-log-virtual-list"
            maxRenderedItems={30}
            getKey={(log) => log.id || `${log.stepName}-${log.timestamp}`}
            renderItem={(log) => {
            const stepTokens = totalStepTokens(log.tokenUsage);
            return (
              <div className="mb-2 rounded-md border bg-muted/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{log.stepName}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>
                      {new Date(log.timestamp).toLocaleString('zh-CN')}
                      </span>
                      {stepTokens > 0 ? <span>Token 消耗 {formatTokens(stepTokens)}</span> : null}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={log.status === 'failed' ? 'destructive' : 'outline'} className="shrink-0 whitespace-nowrap text-[10px]">
                      {log.status === 'failed' ? '失败' : '完成'}
                    </Badge>
                    {onViewPersistedStepOutput ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onViewPersistedStepOutput(log)}
                      >
                        查看记录
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          }}
        />
        )}
      </div>

      {agent.output && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground uppercase">输出结果</span>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={copyOutput}>
              <span className="material-symbols-outlined text-sm mr-1">content_copy</span>
              复制
            </Button>
          </div>
          <pre className="bg-muted rounded-md p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap font-mono">{agent.output}</pre>
        </div>
      )}
    </div>
  );
}
