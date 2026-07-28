import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/chat/stream/recover/route';


export const Route = createFileRoute('/api/chat/stream/recover')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
