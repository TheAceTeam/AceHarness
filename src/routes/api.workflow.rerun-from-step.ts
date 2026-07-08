import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workflow/rerun-from-step/route';


export const Route = createFileRoute('/api/workflow/rerun-from-step')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
