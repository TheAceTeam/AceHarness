import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/runs/[id]/outputs/route';


export const Route = createFileRoute('/api/runs/$id/outputs')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
