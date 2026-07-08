import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/dashboard/route';


export const Route = createFileRoute('/api/dashboard')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
