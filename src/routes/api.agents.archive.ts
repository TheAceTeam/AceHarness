import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST, PUT as apiRoutePUT } from '@/server/api-routes/agents/archive/route';


export const Route = createFileRoute('/api/agents/archive')({
  server: {
    handlers: {
      PUT: toStartHandler(apiRoutePUT),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
