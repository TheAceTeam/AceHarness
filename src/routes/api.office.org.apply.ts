import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/office/org/apply/route';


export const Route = createFileRoute('/api/office/org/apply')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
