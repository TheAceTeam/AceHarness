export type ModelProbeHealth = 'operational' | 'degraded' | 'down';
export type ModelProbeRuntimeStatus = ModelProbeHealth | 'paused' | 'unknown' | 'running';
export type ModelProbeRunSource = 'probe' | 'chat' | 'agent-chat';

export interface ModelProbeRunRecord {
  id: string;
  startedAt: string;
  finishedAt: string;
  success: boolean;
  engineAvailable: boolean;
  officialStatus: ModelProbeHealth;
  responseLatencyMs: number;
  availabilityCheckMs: number | null;
  totalDurationMs: number;
  source?: ModelProbeRunSource;
  resolvedModel?: string;
  outputPreview?: string;
  error?: string;
}

export interface ModelProbeRecord {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  modelRouteId?: string;
  engine: string;
  driver?: 'auto' | 'sdk' | 'stdio';
  model: string;
  endpoints: string[];
  intervalMinutes: number;
  timeoutMs: number;
  enabled: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  running?: boolean;
  runs: ModelProbeRunRecord[];
}

export interface ModelProbeAvailabilityWindow {
  successRate: number;
  successCount: number;
  totalCount: number;
}

export interface ModelProbeHistoryPoint {
  at: string;
  status: ModelProbeRuntimeStatus;
  success: boolean | null;
  responseLatencyMs: number | null;
}

export interface ModelProbeSummary {
  id: string;
  groupId: string;
  groupName: string;
  name: string;
  modelRouteId?: string;
  engine: string;
  engineLabel: string;
  driver?: 'auto' | 'sdk' | 'stdio';
  model: string;
  endpoints: string[];
  intervalMinutes: number;
  timeoutMs: number;
  enabled: boolean;
  note?: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  running: boolean;
  status: ModelProbeRuntimeStatus;
  consecutiveFailures: number;
  nextRunAt: string | null;
  latestRun: ModelProbeRunRecord | null;
  availability: {
    days7: ModelProbeAvailabilityWindow;
    days15: ModelProbeAvailabilityWindow;
    days30: ModelProbeAvailabilityWindow;
  };
  averageResponseLatencyMs: number | null;
  averageAvailabilityCheckMs: number | null;
  history: ModelProbeHistoryPoint[];
}

export interface ModelProbeListSummary {
  total: number;
  enabled: number;
  running: number;
  operational: number;
  degraded: number;
  down: number;
  paused: number;
  unknown: number;
  lastUpdatedAt: string | null;
  nextRunAt: string | null;
  minIntervalMinutes: number | null;
}

export interface ModelProbeListResponse {
  probes: ModelProbeSummary[];
  summary: ModelProbeListSummary;
}

export interface CreateModelProbeInput {
  groupId?: string;
  groupName?: string;
  name?: string;
  modelRouteId?: string;
  engine?: string;
  driver?: 'auto' | 'sdk' | 'stdio';
  model?: string;
  endpoints?: string[];
  intervalMinutes?: number;
  timeoutMs?: number;
  enabled?: boolean;
  note?: string;
}

export interface UpdateModelProbeInput {
  groupId?: string;
  groupName?: string;
  name?: string;
  modelRouteId?: string;
  engine?: string;
  driver?: 'auto' | 'sdk' | 'stdio';
  model?: string;
  endpoints?: string[];
  intervalMinutes?: number;
  timeoutMs?: number;
  enabled?: boolean;
  note?: string;
}

export interface RecordModelProbeObservationInput {
  modelRouteId?: string;
  engine?: string;
  model?: string;
  success: boolean;
  responseLatencyMs?: number | null;
  totalDurationMs?: number | null;
  availabilityCheckMs?: number | null;
  engineAvailable?: boolean;
  officialStatus?: ModelProbeHealth;
  source?: ModelProbeRunSource;
  resolvedModel?: string;
  outputPreview?: string;
  error?: string;
  occurredAt?: string;
}
