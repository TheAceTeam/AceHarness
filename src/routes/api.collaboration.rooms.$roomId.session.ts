import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/collaboration/rooms/[roomId]/session/route';


export const Route = createFileRoute('/api/collaboration/rooms/$roomId/session')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
