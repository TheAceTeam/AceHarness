import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/chat/debug-prompt/route';


export const Route = createFileRoute('/api/chat/debug-prompt')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
