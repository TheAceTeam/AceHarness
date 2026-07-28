import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/office/org/versions/route';


export const Route = createFileRoute('/api/office/org/versions')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
