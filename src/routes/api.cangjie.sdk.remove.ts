import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { DELETE as apiRouteDELETE } from '@/server/api-routes/cangjie/sdk/remove/route';


export const Route = createFileRoute('/api/cangjie/sdk/remove')({
  server: {
    handlers: {
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
