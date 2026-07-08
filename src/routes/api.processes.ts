import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, DELETE as apiRouteDELETE } from '@/server/api-routes/processes/route';


export const Route = createFileRoute('/api/processes')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
