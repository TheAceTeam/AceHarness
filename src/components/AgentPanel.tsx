'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import Markdown from '@/components/Markdown';
import styles from '@/app/workbench/[config]/page.module.css';
import { copyText } from '@/lib/clipboard';

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
  chatMessages?: Array<{
    id: string;
    role: 'user' | 'assistant' | 'error';
    content: string;
    mode: 'standalone-chat' | 'workflow-chat';
    timestamp: number;
  }>;
  chatLoading?: boolean;
  onSendChat?: (input: { message: string; mode: 'workflow-chat' }) => Promise<void>;
  systemPrompt?: string;
  iterationPrompt?: string;
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
  chatMessages = [],
  chatLoading = false,
  onSendChat,
  systemPrompt,
  iterationPrompt,
}: AgentPanelProps) {
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const [chatDraft, setChatDraft] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const agentLogs = logs.filter((log) => log.agent === agent.name);
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
  const showRunStatusReason = Boolean(
    runStatusReason && ['failed', 'stopped', 'crashed'].includes(runStatus || '')
  );

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [agentLogs.length]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages.length]);

  useEffect(() => {
    setChatDraft('');
  }, [agent.name]);

  const getTeamLabel = (team: string) => {
    const labels: Record<string, string> = { blue: 'Blue Team', red: 'Red Team', judge: 'Judge Team' };
    return labels[team] || team;
  };

  const getStatusText = (status: string) => {
    const texts: Record<string, string> = { waiting: '等待中', running: '运行中', completed: '已完成', failed: '失败' };
    return texts[status] || status;
  };

  const copyOutput = async () => {
    if (agent.output) await copyText(agent.output);
  };

  const chatDisabledReason = agent.status === 'running'
    ? 'Agent 正在执行中，当前不支持插入对话。'
    : runStatus === 'preparing'
      ? '工作流准备中，暂不能与 Agent 对话。'
      : null;

  const sendChat = async () => {
    const message = chatDraft.trim();
    if (!message || !onSendChat || chatLoading || chatDisabledReason) return;
    await onSendChat({ message, mode: 'workflow-chat' });
    setChatDraft('');
  };

  const formatTokens = (n: number) => {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  const teamColor = agent.team === 'red' ? 'text-red-400' : agent.team === 'judge' ? 'text-yellow-400' : 'text-blue-400';
  const teamBg = agent.team === 'red' ? 'bg-red-500/20' : agent.team === 'judge' ? 'bg-yellow-500/20' : 'bg-blue-500/20';
  const statusColor = agent.status === 'running' ? 'bg-blue-500' : agent.status === 'completed' ? 'bg-green-500' : agent.status === 'failed' ? 'bg-red-500' : 'bg-muted-foreground';

  return (
    <div className="flex flex-col gap-4 p-4">
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
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${statusColor} ${agent.status === 'running' ? 'animate-pulse' : ''}`} />
          <span className="text-xs text-muted-foreground">{getStatusText(agent.status)}</span>
        </div>
      </div>
      {/* PLACEHOLDER_REST */}

      {agent.currentTask && (
        <div className="rounded-md bg-muted p-3">
          <div className="text-xs text-muted-foreground uppercase mb-1">当前任务</div>
          <div className="text-sm">{agent.currentTask}</div>
        </div>
      )}

      {(systemPrompt || iterationPrompt) && (
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
          <span className="block text-xs text-muted-foreground">已完成</span>
          <span className="block text-lg font-semibold">{agent.completedTasks}</span>
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

      {(stepSummary || agent.summary) && (
        <div>
          <div className="text-xs text-muted-foreground uppercase mb-1">工作总结</div>
          <div className={`${styles.markdownContent} text-sm bg-muted p-3 rounded-md`}><Markdown>{stepSummary || agent.summary!}</Markdown></div>
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground uppercase">角色对话</span>
          <Badge variant="outline" className="text-[10px]">workflow-chat</Badge>
        </div>
        <div className="mb-2 rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
          对这个 Agent 的对话始终带当前 workflow、步骤、运行态与 OpenSpec 上下文，适合直接追问当前阶段、风险、下一步和具体执行判断。
        </div>
        {chatDisabledReason ? (
          <div className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-300">
            {chatDisabledReason}
          </div>
        ) : null}
        <div ref={chatContainerRef} className="max-h-64 space-y-2 overflow-y-auto rounded-md border bg-background p-2">
          {chatMessages.length === 0 ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              还没有对话记录
            </div>
          ) : chatMessages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded-md p-2 text-xs ${
                msg.role === 'user'
                  ? 'ml-6 bg-primary/10'
                  : msg.role === 'error'
                    ? 'mr-6 border border-red-500/30 bg-red-500/10 text-red-200'
                    : 'mr-6 bg-muted'
              }`}
            >
              <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>{msg.role === 'user' ? '你' : msg.role === 'assistant' ? agent.name : '错误'}</span>
                <span>{msg.mode}</span>
              </div>
              <div className={`${styles.markdownContent} break-words`}>
                <Markdown>{msg.content}</Markdown>
              </div>
            </div>
          ))}
          {chatLoading ? (
            <div className="rounded-md bg-muted p-2 text-xs text-muted-foreground">
              {agent.name} 正在回复...
            </div>
          ) : null}
        </div>
        <div className="mt-2 space-y-2">
          <Textarea
            value={chatDraft}
            onChange={(e) => setChatDraft(e.target.value)}
            placeholder={chatDisabledReason || '询问当前工作流相关问题...'}
            rows={3}
            disabled={Boolean(chatDisabledReason)}
          />
          <Button className="w-full" size="sm" onClick={sendChat} disabled={chatLoading || Boolean(chatDisabledReason) || !chatDraft.trim() || !onSendChat}>
            {chatLoading ? '发送中...' : '发送消息'}
          </Button>
        </div>
      </div>

      {showRunStatusReason && (
        <div>
          <div className="text-xs text-muted-foreground uppercase mb-1">运行异常</div>
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-xs leading-relaxed text-red-200">
            <div className="mb-1 flex items-center gap-2">
              <Badge variant="destructive" className="text-[10px]">
                {runStatus === 'stopped' ? '已停止' : '失败'}
              </Badge>
              {currentStepName ? <span className="opacity-80">当前步骤: {currentStepName}</span> : null}
            </div>
            <div className="whitespace-pre-wrap break-words">{runStatusReason}</div>
          </div>
        </div>
      )}

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
          <span className="text-xs text-muted-foreground uppercase">执行日志</span>
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => onClearLogs(agent.name)}>清空</Button>
        </div>
        <div className="bg-muted rounded-md p-2 max-h-48 overflow-y-auto font-mono text-xs space-y-0.5" ref={logsContainerRef}>
          {agentLogs.map((log, index) => (
            <div key={index} className={`flex gap-2 ${log.level === 'error' ? 'text-red-400' : log.level === 'warn' ? 'text-yellow-400' : 'text-muted-foreground'}`}>
              <span className="opacity-60 shrink-0">{log.time}</span>
              <span>{log.message}</span>
            </div>
          ))}
          {agentLogs.length === 0 && <div className="text-muted-foreground text-center py-4">暂无日志</div>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-muted-foreground uppercase">持久化步骤记录</span>
          <Badge variant="outline" className="text-[10px]">
            {relevantPersistedLogs.length}
          </Badge>
        </div>
        <div className="space-y-2">
          {relevantPersistedLogs.map((log) => {
            const preview = log.status === 'failed'
              ? log.error
              : log.output.length > 240
                ? `${log.output.slice(0, 240)}...`
                : log.output;
            return (
              <div key={log.id || `${log.stepName}-${log.timestamp}`} className="rounded-md border bg-muted/40 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium">{log.stepName}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {new Date(log.timestamp).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={log.status === 'failed' ? 'destructive' : 'outline'} className="text-[10px]">
                      {log.status === 'failed' ? '失败' : '完成'}
                    </Badge>
                    {onViewPersistedStepOutput ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onViewPersistedStepOutput(log)}
                      >
                        查看完整日志
                      </Button>
                    ) : null}
                    {onSelectPersistedStep ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        onClick={() => onSelectPersistedStep(log.stepName)}
                      >
                        定位步骤
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className={`whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[11px] leading-relaxed ${
                  log.status === 'failed' ? 'text-red-300' : 'text-muted-foreground'
                }`}>
                  {preview || (log.status === 'failed' ? '执行失败，但没有记录到错误详情' : '无输出')}
                </div>
              </div>
            );
          })}
          {relevantPersistedLogs.length === 0 && (
            <div className="rounded-md bg-muted p-3 text-center text-xs text-muted-foreground">
              暂无持久化记录
            </div>
          )}
        </div>
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
