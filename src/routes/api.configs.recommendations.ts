import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/configs/recommendations/route';


export const Route = createFileRoute('/api/configs/recommendations')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
