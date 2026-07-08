import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { DELETE as apiRouteDELETE } from '@/server/api-routes/rag/v1/collections/[id]/sources/[sourceId]/route';


export const Route = createFileRoute('/api/rag/v1/collections/$id/sources/$sourceId')({
  server: {
    handlers: {
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
