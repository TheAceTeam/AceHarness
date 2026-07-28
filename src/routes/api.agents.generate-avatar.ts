import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/agents/generate-avatar/route';


export const Route = createFileRoute('/api/agents/generate-avatar')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
