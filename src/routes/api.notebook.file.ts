import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, PUT as apiRoutePUT } from '@/server/api-routes/notebook/file/route';


export const Route = createFileRoute('/api/notebook/file')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PUT: toStartHandler(apiRoutePUT),
    },
  },
});
