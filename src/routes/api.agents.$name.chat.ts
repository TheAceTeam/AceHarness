import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/agents/[name]/chat/route';


export const Route = createFileRoute('/api/agents/$name/chat')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
