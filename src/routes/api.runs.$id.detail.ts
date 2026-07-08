import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/runs/[id]/detail/route';


export const Route = createFileRoute('/api/runs/$id/detail')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
