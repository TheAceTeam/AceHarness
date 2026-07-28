import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/agents/[name]/route';


export const Route = createFileRoute('/api/agents/$name')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
