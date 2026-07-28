import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/office/team/current/route';


export const Route = createFileRoute('/api/office/team/current')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
