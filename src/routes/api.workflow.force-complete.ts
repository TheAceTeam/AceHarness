import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workflow/force-complete/route';


export const Route = createFileRoute('/api/workflow/force-complete')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
