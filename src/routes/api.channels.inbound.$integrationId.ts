import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/channels/inbound/[integrationId]/route';


export const Route = createFileRoute('/api/channels/inbound/$integrationId')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
