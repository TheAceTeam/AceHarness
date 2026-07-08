import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/models/probes/query/route';


export const Route = createFileRoute('/api/models/probes/query')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
