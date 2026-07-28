import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/collaboration/rooms/[roomId]/route';


export const Route = createFileRoute('/api/collaboration/rooms/$roomId')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
