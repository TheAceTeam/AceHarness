import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workflow/iterate/route';


export const Route = createFileRoute('/api/workflow/iterate')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
