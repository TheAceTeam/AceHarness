import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, PUT as apiRoutePUT, DELETE as apiRouteDELETE } from '@/server/api-routes/agents/[name]/memory/route';


export const Route = createFileRoute('/api/agents/$name/memory')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PUT: toStartHandler(apiRoutePUT),
      DELETE: toStartHandler(apiRouteDELETE),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
