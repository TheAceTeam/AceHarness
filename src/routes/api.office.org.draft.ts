import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/office/org/draft/route';


export const Route = createFileRoute('/api/office/org/draft')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
