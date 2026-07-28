import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { DELETE as apiRouteDELETE } from '@/server/api-routes/runs/[id]/delete/route';


export const Route = createFileRoute('/api/runs/$id/delete')({
  server: {
    handlers: {
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
