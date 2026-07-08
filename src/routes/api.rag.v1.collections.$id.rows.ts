import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, DELETE as apiRouteDELETE } from '@/server/api-routes/rag/v1/collections/[id]/rows/route';


export const Route = createFileRoute('/api/rag/v1/collections/$id/rows')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
