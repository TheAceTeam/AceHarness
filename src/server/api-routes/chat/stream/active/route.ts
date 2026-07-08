import { jsonError, jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { processManager } from '@/lib/core/process-manager';

export const dynamic = 'force-dynamic';

/**
 * Check if there's an active stream for a given frontend session ID.
 * GET /api/chat/stream/active?frontendSessionId=xxx
 * Returns chatId if found, 404 otherwise.
 * Used by frontend to detect and reconnect to interrupted streams after page refresh.
 */
export async function GET(request: Request) {
  const frontendSessionId = requestUrl(request).searchParams.get('frontendSessionId');
  if (!frontendSessionId) {
    return jsonError('Missing frontendSessionId', 400);
  }

  const chatId = processManager.getActiveStreamChatId(frontendSessionId);
  if (!chatId) {
    return jsonOk({ active: false }, { status: 404 });
  }

  const proc = processManager.getProcess(chatId);
  if (!proc) {
    return jsonOk({ active: false }, { status: 404 });
  }

  return jsonOk({
    active: true,
    chatId,
    status: proc.status,
    streamContent: proc.status === 'running' ? proc.streamContent : undefined,
  });
}
