import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/workspace/git-diff/route';


export const Route = createFileRoute('/api/workspace/git-diff')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
