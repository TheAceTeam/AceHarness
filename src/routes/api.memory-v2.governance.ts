import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/memory-v2/governance/route';

export const Route = createFileRoute('/api/memory-v2/governance')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
