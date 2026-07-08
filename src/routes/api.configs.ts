import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/configs/route';


export const Route = createFileRoute('/api/configs')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
