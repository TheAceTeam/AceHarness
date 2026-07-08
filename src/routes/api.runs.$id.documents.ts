import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, PATCH as apiRoutePATCH, DELETE as apiRouteDELETE } from '@/server/api-routes/runs/[id]/documents/route';


export const Route = createFileRoute('/api/runs/$id/documents')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PATCH: toStartHandler(apiRoutePATCH),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
