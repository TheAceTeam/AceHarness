import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/models/probes/run/route';


export const Route = createFileRoute('/api/models/probes/run')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
