import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/rag/search/route';


export const Route = createFileRoute('/api/rag/search')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
