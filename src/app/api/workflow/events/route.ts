import { NextRequest } from 'next/server';
import { workflowRegistry } from '@/lib/workflow-registry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (data: any) => {
        const message = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(message));
      };

      // Normalized event handlers — forward from registry which tags with __configFile
      const handlers: Record<string, (data: any) => void> = {};
      const eventTypes = [
        'status', 'phase', 'step', 'result', 'checkpoint', 'agents',
        'iteration', 'iteration-complete', 'escalation', 'token-usage',
        'feedback-injected', 'feedback-recalled', 'context-updated',
        'route-decision',
        // State machine events forwarded with normalized type names
        'state-change', 'step-start', 'step-complete', 'transition',
        'force-transition', 'transition-forced', 'human-approval-required',
        'human-question-required', 'human-question-answered', 'human-question-updated',
        'agent-flow',
      ];

      // Map SM events to frontend-compatible types
      const smTypeMap: Record<string, string> = {
        'state-change': 'phase',
        'step-start': 'step',
        'step-complete': 'result',
        transition: 'sm-transition',
      };

      for (const evt of eventTypes) {
        handlers[evt] = (data: any) => {
          const { __configFile, ...rest } = data;
          const mappedType = smTypeMap[evt];
          if (evt === 'state-change') {
            sendEvent({ type: 'phase', data: { phase: rest.state, message: rest.message, configFile: __configFile } });
          } else if (evt === 'step-start') {
            sendEvent({ type: 'step', data: { ...rest, step: `${rest.state}-${rest.step}`, configFile: __configFile } });
          } else if (evt === 'step-complete') {
            sendEvent({ type: 'result', data: { ...rest, step: `${rest.state}-${rest.step}`, configFile: __configFile } });
          } else {
            sendEvent({ type: mappedType || evt, data: { ...rest, configFile: __configFile } });
          }
        };
        workflowRegistry.on(evt, handlers[evt]);
      }

      request.signal.addEventListener('abort', () => {
        for (const evt of eventTypes) {
          workflowRegistry.off(evt, handlers[evt]);
        }
        controller.close();
      });

      sendEvent({ type: 'connected', data: { message: '已连接到事件流' } });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
