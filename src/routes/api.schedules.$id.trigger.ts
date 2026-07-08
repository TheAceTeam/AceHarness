import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/schedules/[id]/trigger/route';


export const Route = createFileRoute('/api/schedules/$id/trigger')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
