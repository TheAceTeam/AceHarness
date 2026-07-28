import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/engine/models/smoke/route';


export const Route = createFileRoute('/api/engine/models/smoke')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
