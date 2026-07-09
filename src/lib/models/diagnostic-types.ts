export type DiagnosticRunStatus = 'passed' | 'warning' | 'failed' | 'skipped';
export type DiagnosticDriver = 'auto' | 'sdk' | 'stdio';
export type DiagnosticLogLevel = 'info' | 'success' | 'warning' | 'error';

export interface DiagnosticLogEntry {
  id: string;
  at: string;
  elapsedMs: number;
  level: DiagnosticLogLevel;
  message: string;
  detail?: string;
  fullDetail?: string;
  verbose?: boolean;
}

export interface DiagnosticStage {
  id: string;
  label: string;
  status: DiagnosticRunStatus;
  durationMs: number;
  startedAt: string;
  finishedAt: string;
  detail?: string;
}

export interface DiagnosticStreamEventSample {
  type: string;
  atMs: number;
  contentPreview?: string;
  content?: string;
  contentLength?: number;
  metadataKeys?: string[];
  metadata?: unknown;
}

export interface DiagnosticPromptRun {
  id: string;
  label: string;
  category: string;
  status: DiagnosticRunStatus;
  durationMs: number;
  firstEventMs: number | null;
  firstTextMs: number | null;
  outputChars: number;
  charsPerSecond: number | null;
  sessionId?: string;
  stopReason?: string;
  outputPreview?: string;
  error?: string;
  prompt?: string;
  eventCounts: Record<string, number>;
  eventSamples: DiagnosticStreamEventSample[];
}

export interface EngineDiagnosticSummary {
  engine: string;
  driver: DiagnosticDriver;
  effectiveEngine?: string;
  available: boolean;
  streamSupported: boolean;
  observedEventTypes: string[];
  stages: DiagnosticStage[];
  runs: DiagnosticPromptRun[];
}

export interface ModelCapabilityScore {
  id: string;
  label: string;
  score: number;
  status: DiagnosticRunStatus;
  summary: string;
  evidence: string[];
  metrics: Record<string, string | number | boolean | null>;
}

export interface ModelEvaluationSummary {
  overallScore: number;
  tier: 'strong' | 'stable' | 'usable' | 'weak';
  tierLabel: string;
  capabilities: ModelCapabilityScore[];
  runs: DiagnosticPromptRun[];
}

export interface ModelDiagnosticsRequest {
  modelRouteId?: string;
  engine?: string;
  driver?: DiagnosticDriver;
  model?: string;
  timeoutMs?: number;
  includeEngineDebug?: boolean;
  includeModelScore?: boolean;
  modelCapabilityIds?: string[];
}

export interface ModelDiagnosticsResponse {
  ok: boolean;
  engine: string;
  driver: DiagnosticDriver;
  model: string;
  startedAt: string;
  finishedAt: string;
  totalDurationMs: number;
  engineDebug?: EngineDiagnosticSummary;
  modelEvaluation?: ModelEvaluationSummary;
  logs?: DiagnosticLogEntry[];
  error?: string;
}
