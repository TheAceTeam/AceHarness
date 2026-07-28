import { jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { processManager } from '@/lib/core/process-manager';

export const dynamic = 'force-dynamic';

/**
 * Recovery endpoint: GET /api/chat/stream/recover?sessionId=xxx
 * Returns accumulated streamContent for a given backend sessionId.
 * Used when SSE connection was lost and frontend needs the full result.
 */
export async function GET(request: Request) {
  const sessionId = requestUrl(request).searchParams.get('sessionId');
  if (!sessionId) {
    return jsonError('Missing sessionId', 400);
  }

  const proc = processManager.getProcessBySessionId(sessionId);
  if (!proc) {
    // Session not found — tell frontend to start a new conversation
    return jsonOk({ content: '', status: 'not_found', startNew: true });
  }

  const fullContent = proc.output || proc.streamContent;
  return jsonOk({
    content: fullContent,
    status: proc.status,
  });
}
