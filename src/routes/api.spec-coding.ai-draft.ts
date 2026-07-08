import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/spec-coding/ai-draft/route';


export const Route = createFileRoute('/api/spec-coding/ai-draft')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
