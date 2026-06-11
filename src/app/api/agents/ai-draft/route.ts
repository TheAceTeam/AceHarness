import { NextRequest, NextResponse } from 'next/server';
import {
  generateAgentClarification,
  generateAgentDraft,
  type AgentClarificationStreamEvent,
  type AgentDraftStreamEvent,
} from '@/lib/agent/ai-draft-generator';

export const dynamic = 'force-dynamic';

function encodeSse(event: string, data: any) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function createAgentDraftStream(request: NextRequest, body: any) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event, data)));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      request.signal.addEventListener('abort', close);
      send('connected', { ok: true });

      try {
        const result = await generateAgentDraft(body, (event: AgentDraftStreamEvent) => {
          if (event.type === 'progress') {
            send('progress', event);
          } else if (event.type === 'delta') {
            send('delta', { content: event.content });
          } else if (event.type === 'thinking') {
            send('thinking', { content: event.content });
          } else if (event.type === 'session') {
            send('session', { sessionId: event.sessionId });
          } else if (event.type === 'engine_error') {
            send('engine_error', { message: event.message });
          } else if (event.type === 'item') {
            send('item', { item: event.item });
          } else if (event.type === 'repair') {
            send('repair', { event: event.event });
          } else if (event.type === 'validation') {
            send('validation', { validation: event.validation });
          }
        });
        send('done', result);
      } catch (error: any) {
        send('failed', { message: error?.message || '生成 Agent 草案失败' });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

function createAgentClarificationStream(request: NextRequest, body: any) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: any) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event, data)));
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch {}
      };

      request.signal.addEventListener('abort', close);
      send('connected', { ok: true });

      try {
        const result = await generateAgentClarification(body, (event: AgentClarificationStreamEvent) => {
          if (event.type === 'progress') {
            send('progress', event);
          } else if (event.type === 'delta') {
            send('delta', { content: event.content });
          } else if (event.type === 'thinking') {
            send('thinking', { content: event.content });
          } else if (event.type === 'session') {
            send('session', { sessionId: event.sessionId });
          } else if (event.type === 'engine_error') {
            send('engine_error', { message: event.message });
          } else if (event.type === 'item') {
            send('item', { item: event.item });
          } else if (event.type === 'form') {
            send('form', { form: event.form });
          } else if (event.type === 'repair') {
            send('repair', { event: event.event });
          }
        });
        send('done', result);
      } catch (error: any) {
        send('failed', { message: error?.message || '生成补充问答失败' });
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (body?.phase === 'clarification' && body?.stream === true) {
      return createAgentClarificationStream(request, body);
    }
    if (body?.phase === 'clarification') {
      const result = await generateAgentClarification(body);
      return NextResponse.json(result);
    }
    if (body?.stream === true) {
      return createAgentDraftStream(request, body);
    }
    const result = await generateAgentDraft(body);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || '生成 Agent 草案失败' },
      { status: Number.isFinite(error?.status) ? error.status : 500 },
    );
  }
}
