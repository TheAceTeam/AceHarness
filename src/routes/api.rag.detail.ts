import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/rag/detail/route';


export const Route = createFileRoute('/api/rag/detail')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
