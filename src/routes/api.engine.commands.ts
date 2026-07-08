import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/engine/commands/route';


export const Route = createFileRoute('/api/engine/commands')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
