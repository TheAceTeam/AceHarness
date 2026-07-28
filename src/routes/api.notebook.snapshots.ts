import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, PUT as apiRoutePUT } from '@/server/api-routes/notebook/snapshots/route';


export const Route = createFileRoute('/api/notebook/snapshots')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
      PUT: toStartHandler(apiRoutePUT),
    },
  },
});
