import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/cangjie/run/route';


export const Route = createFileRoute('/api/cangjie/run')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
