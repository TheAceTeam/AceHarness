import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/collaboration/rooms/route';


export const Route = createFileRoute('/api/collaboration/rooms')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
