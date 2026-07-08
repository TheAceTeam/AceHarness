import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/models/probes/batch/route';


export const Route = createFileRoute('/api/models/probes/batch')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
