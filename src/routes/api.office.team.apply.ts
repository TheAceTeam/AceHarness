import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/office/team/apply/route';


export const Route = createFileRoute('/api/office/team/apply')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
