import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/workflow/step-logs/route';


export const Route = createFileRoute('/api/workflow/step-logs')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
