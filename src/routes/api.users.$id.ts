import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, PUT as apiRoutePUT, DELETE as apiRouteDELETE } from '@/server/api-routes/users/[id]/route';


export const Route = createFileRoute('/api/users/$id')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PUT: toStartHandler(apiRoutePUT),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
