import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { DELETE as apiRouteDELETE } from '@/server/api-routes/rag/documents/route';


export const Route = createFileRoute('/api/rag/documents')({
  server: {
    handlers: {
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
