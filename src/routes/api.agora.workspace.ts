import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/agora/workspace/route';


export const Route = createFileRoute('/api/agora/workspace')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
