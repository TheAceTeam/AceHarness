import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST, PUT as apiRoutePUT } from '@/server/api-routes/workflow/preflight/route';


export const Route = createFileRoute('/api/workflow/preflight')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
      PUT: toStartHandler(apiRoutePUT),
    },
  },
});
