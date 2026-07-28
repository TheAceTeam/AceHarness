import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/office/org/clarify/route';


export const Route = createFileRoute('/api/office/org/clarify')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
