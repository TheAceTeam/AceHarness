import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST } from '@/server/api-routes/workflow-templates/route';

export const Route = createFileRoute('/api/workflow-templates')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
