import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { DELETE, GET, POST } from '@/server/api-routes/marketplace/sources/route';

export const Route = createFileRoute('/api/marketplace/sources')({
  server: {
    handlers: {
      GET: toStartHandler(GET),
      POST: toStartHandler(POST),
      DELETE: toStartHandler(DELETE),
    },
  },
});
