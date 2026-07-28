import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/runtime/rag/knowledge-bases/route';


export const Route = createFileRoute('/api/runtime/rag/knowledge-bases')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
