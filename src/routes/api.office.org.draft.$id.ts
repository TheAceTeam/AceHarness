import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET, PATCH as apiRoutePATCH } from '@/server/api-routes/office/org/draft/[id]/route';


export const Route = createFileRoute('/api/office/org/draft/$id')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
      PATCH: toStartHandler(apiRoutePATCH),
    },
  },
});
