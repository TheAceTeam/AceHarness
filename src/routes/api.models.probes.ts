import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST } from '@/server/api-routes/models/probes/route';


export const Route = createFileRoute('/api/models/probes')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
