import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/agents/batch/route';


export const Route = createFileRoute('/api/agents/batch')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
