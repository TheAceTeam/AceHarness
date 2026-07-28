import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/channels/integrations/[id]/bootstrap/route';


export const Route = createFileRoute('/api/channels/integrations/$id/bootstrap')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
