import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/workflow/event-log/route';


export const Route = createFileRoute('/api/workflow/event-log')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
