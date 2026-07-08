import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/uploads/image/route';


export const Route = createFileRoute('/api/uploads/image')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
