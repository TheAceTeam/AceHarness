import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, PUT as apiRoutePUT, PATCH as apiRoutePATCH, DELETE as apiRouteDELETE } from '@/server/api-routes/skills/route';


export const Route = createFileRoute('/api/skills')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
      PUT: toStartHandler(apiRoutePUT),
      PATCH: toStartHandler(apiRoutePATCH),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
