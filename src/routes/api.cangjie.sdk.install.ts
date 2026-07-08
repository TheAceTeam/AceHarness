import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/cangjie/sdk/install/route';


export const Route = createFileRoute('/api/cangjie/sdk/install')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
