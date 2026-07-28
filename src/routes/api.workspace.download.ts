import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/workspace/download/route';


export const Route = createFileRoute('/api/workspace/download')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
