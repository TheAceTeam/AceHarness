import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/chat/compact/route';


export const Route = createFileRoute('/api/chat/compact')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
