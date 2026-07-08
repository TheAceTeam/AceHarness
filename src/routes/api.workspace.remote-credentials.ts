import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST, DELETE as apiRouteDELETE } from '@/server/api-routes/workspace/remote-credentials/route';


export const Route = createFileRoute('/api/workspace/remote-credentials')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
