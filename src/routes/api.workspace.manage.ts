import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workspace/manage/route';


export const Route = createFileRoute('/api/workspace/manage')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
