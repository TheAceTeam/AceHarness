import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/chat/route';


export const Route = createFileRoute('/api/chat')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
