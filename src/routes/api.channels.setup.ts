import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/channels/setup/route';


export const Route = createFileRoute('/api/channels/setup')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
