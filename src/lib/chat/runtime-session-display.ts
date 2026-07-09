import type { RuntimeSessionRow, RuntimeTurnRow } from '@/client/db/runtime-agent-collections';
import { getEngineDisplayName } from '@/lib/core/engine-metadata';

export type ChatRuntimeDisplayStatus = 'running' | 'queued' | 'canceling' | 'failed' | 'idle';

export type ChatRuntimeDisplayState = {
  status: ChatRuntimeDisplayStatus;
  statusLabel: string;
  statusTone: 'accent' | 'warning' | 'danger' | 'neutral';
  routeLabel: string;
};

type RuntimeDisplayInput = {
  agentName?: string | null;
  engine?: string | null;
  model?: string | null;
  isStreaming?: boolean;
  isLoading?: boolean;
  hasError?: boolean;
  runtimeSession?: Pick<RuntimeSessionRow, 'agentId' | 'modelRouteId' | 'status'> | null;
  runtimeTurn?: Pick<RuntimeTurnRow, 'status'> | null;
};

export function resolveChatRuntimeDisplay(input: RuntimeDisplayInput): ChatRuntimeDisplayState {
  const status = resolveChatRuntimeStatus(input);
  return {
    status,
    statusLabel: getRuntimeStatusLabel(status),
    statusTone: getRuntimeStatusTone(status),
    routeLabel: resolveRuntimeRouteLabel(input),
  };
}

export function isRuntimeStatusVisible(status: ChatRuntimeDisplayStatus): boolean {
  return status === 'running' || status === 'queued' || status === 'canceling' || status === 'failed';
}

function resolveChatRuntimeStatus(input: RuntimeDisplayInput): ChatRuntimeDisplayStatus {
  const turnStatus = String(input.runtimeTurn?.status || '').toLowerCase();
  if (turnStatus === 'queued') return 'queued';
  if (turnStatus === 'running') return 'running';
  if (turnStatus === 'canceling') return 'canceling';
  if (turnStatus === 'failed') return 'failed';

  const sessionStatus = String(input.runtimeSession?.status || '').toLowerCase();
  if (sessionStatus === 'compacting' || sessionStatus === 'forking') return 'running';
  if (sessionStatus === 'invalid') return 'failed';

  if (input.hasError) return 'failed';
  if (input.isStreaming || input.isLoading) return 'running';
  return 'idle';
}

function getRuntimeStatusLabel(status: ChatRuntimeDisplayStatus): string {
  switch (status) {
    case 'running':
      return '运行中';
    case 'queued':
      return '排队中';
    case 'canceling':
      return '取消中';
    case 'failed':
      return '失败';
    default:
      return '空闲';
  }
}

function getRuntimeStatusTone(status: ChatRuntimeDisplayStatus): ChatRuntimeDisplayState['statusTone'] {
  switch (status) {
    case 'running':
      return 'accent';
    case 'queued':
    case 'canceling':
      return 'warning';
    case 'failed':
      return 'danger';
    default:
      return 'neutral';
  }
}

function resolveRuntimeRouteLabel(input: RuntimeDisplayInput): string {
  const agent = String(input.agentName || input.runtimeSession?.agentId || '').trim();
  const engine = String(input.engine || '').trim();
  const model = String(input.model || '').trim();
  const modelRoute = [engine ? getEngineDisplayName(engine) : '', model].filter(Boolean).join(' / ');

  if (agent && modelRoute) return `${agent} · ${modelRoute}`;
  if (agent) return agent;
  if (modelRoute) return modelRoute;
  return '默认助手';
}
