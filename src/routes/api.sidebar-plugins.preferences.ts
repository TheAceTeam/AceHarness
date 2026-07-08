import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, PUT as apiRoutePUT } from '@/server/api-routes/sidebar-plugins/preferences/route';


export const Route = createFileRoute('/api/sidebar-plugins/preferences')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PUT: toStartHandler(apiRoutePUT),
    },
  },
});
