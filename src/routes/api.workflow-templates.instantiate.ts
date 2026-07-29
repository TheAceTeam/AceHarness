import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workflow-templates/instantiate/route';

export const Route = createFileRoute('/api/workflow-templates/instantiate')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
