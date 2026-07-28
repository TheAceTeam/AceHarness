import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/rag/v1/collections/[id]/import/route';


export const Route = createFileRoute('/api/rag/v1/collections/$id/import')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
