import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/configs/batch-delete/route';


export const Route = createFileRoute('/api/configs/batch-delete')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
