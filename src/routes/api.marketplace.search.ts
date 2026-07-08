import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/marketplace/search/route';


export const Route = createFileRoute('/api/marketplace/search')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
