import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/chat/stream/route';


export const Route = createFileRoute('/api/chat/stream')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
      GET: toStartHandler(apiRouteGET),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
