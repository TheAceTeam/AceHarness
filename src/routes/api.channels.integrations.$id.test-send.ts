import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/channels/integrations/[id]/test-send/route';


export const Route = createFileRoute('/api/channels/integrations/$id/test-send')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
