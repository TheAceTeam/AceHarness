import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/notebook/manage/route';


export const Route = createFileRoute('/api/notebook/manage')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
