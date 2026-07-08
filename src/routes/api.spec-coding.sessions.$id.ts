import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, PUT as apiRoutePUT, DELETE as apiRouteDELETE } from '@/server/api-routes/spec-coding/sessions/[id]/route';


export const Route = createFileRoute('/api/spec-coding/sessions/$id')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PUT: toStartHandler(apiRoutePUT),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
