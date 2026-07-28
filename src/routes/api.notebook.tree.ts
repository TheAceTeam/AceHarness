import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/notebook/tree/route';


export const Route = createFileRoute('/api/notebook/tree')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
