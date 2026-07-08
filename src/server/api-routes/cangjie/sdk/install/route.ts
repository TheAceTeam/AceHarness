import { requireAdmin } from '@/lib/auth/middleware';
import { installSdk } from '@/lib/cangjie/sdk-manager';
import { readJsonBody } from '@/server/api-route-runtime/request-utils';

export async function POST(request: Request) {
  const auth = await requireAdmin(request);
  if (auth instanceof Response) return auth;

  const body = await readJsonBody<Record<string, any>>(request, {});
  const { version, channel } = body;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        const install = await installSdk(version, channel, (event) => {
          send(event);
        });
        send({ phase: 'done', install });
      } catch (error: any) {
        send({ phase: 'error', error: error?.message || '安装 SDK 失败' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
