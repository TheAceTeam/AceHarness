import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/configs/[filename]/route';


export const Route = createFileRoute('/api/configs/$filename')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      POST: toStartHandler(apiRoutePOST),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
