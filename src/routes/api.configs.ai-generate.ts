import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/configs/ai-generate/route';


export const Route = createFileRoute('/api/configs/ai-generate')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
