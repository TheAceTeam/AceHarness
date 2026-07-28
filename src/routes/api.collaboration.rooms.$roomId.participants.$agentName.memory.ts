import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/collaboration/rooms/[roomId]/participants/[agentName]/memory/route';


export const Route = createFileRoute('/api/collaboration/rooms/$roomId/participants/$agentName/memory')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
