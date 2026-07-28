import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/mcp/test/route';


export const Route = createFileRoute('/api/mcp/test')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
