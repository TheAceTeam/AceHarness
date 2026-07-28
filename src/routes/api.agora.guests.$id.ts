import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/agora/guests/[id]/route';


export const Route = createFileRoute('/api/agora/guests/$id')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
