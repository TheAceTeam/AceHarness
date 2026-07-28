import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/runs/by-config/[config]/route';


export const Route = createFileRoute('/api/runs/by-config/$config')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
