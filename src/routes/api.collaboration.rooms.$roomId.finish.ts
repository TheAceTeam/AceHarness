import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/collaboration/rooms/[roomId]/finish/route';


export const Route = createFileRoute('/api/collaboration/rooms/$roomId/finish')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
