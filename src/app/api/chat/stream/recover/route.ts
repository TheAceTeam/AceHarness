import { NextRequest, NextResponse } from 'next/server';
import { processManager } from '@/lib/core/process-manager';

export const dynamic = 'force-dynamic';

/**
 * Recovery endpoint: GET /api/chat/stream/recover?sessionId=xxx
 * Returns accumulated streamContent for a given backend sessionId.
 * Used when SSE connection was lost and frontend needs the full result.
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get('sessionId');
  if (!sessionId) {
    return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
  }

  const proc = processManager.getProcessBySessionId(sessionId);
  if (!proc) {
    // Session not found — tell frontend to start a new conversation
    return NextResponse.json({ content: '', status: 'not_found', startNew: true });
  }

  const fullContent = proc.output || proc.streamContent;
  return NextResponse.json({
    content: fullContent,
    status: proc.status,
  });
}
