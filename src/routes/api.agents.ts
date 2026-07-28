import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/agents/route';


export const Route = createFileRoute('/api/agents')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
