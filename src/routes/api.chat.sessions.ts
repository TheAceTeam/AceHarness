import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST } from '@/server/api-routes/chat/sessions/route';


export const Route = createFileRoute('/api/chat/sessions')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
