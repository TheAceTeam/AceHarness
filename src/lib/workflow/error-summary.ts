const DEFAULT_ERROR_SUMMARY_LIMIT = 900;
const ENGINE_FAILURE_PREFIX = '引擎异常，已停止工作流：';
const CHUNK_BOUNDARY_RE = /<!--\s*chunk-boundary\s*-->/gi;
const TIMESTAMP_MARKER_RE = /<!--\s*timestamp\s*:[\s\S]*?-->/gi;
const HUMAN_FEEDBACK_MARKER_RE = /<!--\s*human-feedback:[\s\S]*?-->/gi;
const LIVE_TRUNCATION_MARKER_RE = /\n\n\[已截断\s+\d+\s+字，完整内容请查看实时输出或运行详情\]\s*$/;

function stripStreamMarkers(value: string): string {
  return value
    .replace(TIMESTAMP_MARKER_RE, '\n')
    .replace(HUMAN_FEEDBACK_MARKER_RE, '\n')
    .replace(CHUNK_BOUNDARY_RE, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const marker = `\n...[错误内容过长，已省略 ${value.length - limit} 字]...\n`;
  const available = Math.max(0, limit - marker.length);
  const headLength = Math.ceil(available * 0.58);
  const tailLength = Math.max(0, available - headLength);
  return `${value.slice(0, headLength)}${marker}${tailLength ? value.slice(-tailLength) : ''}`;
}

function removeEngineFailurePrefix(value: string): { body: string; hasPrefix: boolean } {
  let body = value.trim();
  let hasPrefix = false;
  while (body.startsWith(ENGINE_FAILURE_PREFIX)) {
    hasPrefix = true;
    body = body.slice(ENGINE_FAILURE_PREFIX.length).trim();
  }
  return { body, hasPrefix };
}

/**
 * Turns a streamed engine error into a short, actionable status reason.
 * The final stream chunk contains the provider error; earlier chunks are
 * progress/thought output and should remain available in the run transcript.
 */
export function formatWorkflowFailureReason(value: unknown, limit = DEFAULT_ERROR_SUMMARY_LIMIT): string {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!raw) return '';

  const { body, hasPrefix } = removeEngineFailurePrefix(raw);
  const chunks = body
    .split(CHUNK_BOUNDARY_RE)
    .flatMap((chunk) => chunk.split(TIMESTAMP_MARKER_RE))
    .map((chunk) => stripStreamMarkers(chunk))
    .filter(Boolean);
  const latestChunk = chunks.at(-1) || stripStreamMarkers(body);
  const normalized = latestChunk || body;
  const summary = hasPrefix ? `${ENGINE_FAILURE_PREFIX}${normalized}` : normalized;
  return compactMiddle(summary, Math.max(120, limit));
}

export function formatWorkflowFailureReasonWithStepLogs(
  value: unknown,
  failedStepKeys: unknown,
  stepLogs: unknown,
  limit = 1800,
): string {
  const base = formatWorkflowFailureReason(value, limit);
  const failedKeys = new Set(
    (Array.isArray(failedStepKeys) ? failedStepKeys : [])
      .map((stepKey) => String(stepKey || '').trim())
      .filter(Boolean),
  );
  const logs = Array.isArray(stepLogs) ? stepLogs : [];
  const latestByStep = new Map<string, any>();
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const log = logs[index];
    const stepName = String(log?.stepName || log?.step || '').trim();
    if (!stepName || latestByStep.has(stepName) || log?.superseded || log?.status !== 'failed') continue;
    if (failedKeys.size > 0 && !failedKeys.has(stepName)) continue;
    latestByStep.set(stepName, log);
  }

  const details = Array.from(latestByStep.entries())
    .map(([stepName, log]) => {
      const error = formatWorkflowFailureReason(log?.error || log?.errorPreview || '');
      return error ? `${stepName}: ${error}` : '';
    })
    .filter((detail) => detail && !base.includes(detail));
  if (details.length === 0) return base;

  const detailBlock = details.length === 1
    ? `失败步骤详情：${details[0]}`
    : `失败步骤详情：\n${details.map((detail) => `- ${detail}`).join('\n')}`;
  return formatWorkflowFailureReason([base, detailBlock].filter(Boolean).join('\n'), limit);
}

export function isLiveTextTruncated(value: unknown): boolean {
  return typeof value === 'string' && LIVE_TRUNCATION_MARKER_RE.test(value);
}
