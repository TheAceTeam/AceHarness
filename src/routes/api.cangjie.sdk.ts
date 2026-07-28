import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/cangjie/sdk/route';


export const Route = createFileRoute('/api/cangjie/sdk')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
