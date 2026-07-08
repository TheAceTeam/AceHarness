import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/agents/ai-draft/route';


export const Route = createFileRoute('/api/agents/ai-draft')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
