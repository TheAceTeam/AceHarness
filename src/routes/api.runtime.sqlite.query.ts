import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/runtime/sqlite/query/route';


export const Route = createFileRoute('/api/runtime/sqlite/query')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
