import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/cli/run/route';


export const Route = createFileRoute('/api/cli/run')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
