import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/marketplace/categories/route';


export const Route = createFileRoute('/api/marketplace/categories')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
