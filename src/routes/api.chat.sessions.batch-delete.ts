import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/chat/sessions/batch-delete/route';


export const Route = createFileRoute('/api/chat/sessions/batch-delete')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
