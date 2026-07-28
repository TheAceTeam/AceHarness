import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/rag/v1/collections/[id]/schema/route';


export const Route = createFileRoute('/api/rag/v1/collections/$id/schema')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
