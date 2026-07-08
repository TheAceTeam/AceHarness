import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/configs/create/route';


export const Route = createFileRoute('/api/configs/create')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
