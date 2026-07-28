import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/users/shareable/route';


export const Route = createFileRoute('/api/users/shareable')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
