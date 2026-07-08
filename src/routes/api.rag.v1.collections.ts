import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/rag/v1/collections/route';


export const Route = createFileRoute('/api/rag/v1/collections')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
