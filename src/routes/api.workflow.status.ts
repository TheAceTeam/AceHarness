import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/workflow/status/route';


export const Route = createFileRoute('/api/workflow/status')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
