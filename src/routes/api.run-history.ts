import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/run-history/route';


export const Route = createFileRoute('/api/run-history')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
