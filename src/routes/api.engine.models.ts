import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/engine/models/route';


export const Route = createFileRoute('/api/engine/models')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
