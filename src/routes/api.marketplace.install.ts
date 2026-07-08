import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/marketplace/install/route';


export const Route = createFileRoute('/api/marketplace/install')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
