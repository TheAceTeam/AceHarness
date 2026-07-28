import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/runtime/rag/search/route';


export const Route = createFileRoute('/api/runtime/rag/search')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
