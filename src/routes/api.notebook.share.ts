import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST } from '@/server/api-routes/notebook/share/route';


export const Route = createFileRoute('/api/notebook/share')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
      GET: toStartHandler(apiRouteGET),
    },
  },
});
