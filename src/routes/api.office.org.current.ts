import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/office/org/current/route';


export const Route = createFileRoute('/api/office/org/current')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
