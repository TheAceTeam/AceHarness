import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/onboarding/admin/progress/route';


export const Route = createFileRoute('/api/onboarding/admin/progress')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
