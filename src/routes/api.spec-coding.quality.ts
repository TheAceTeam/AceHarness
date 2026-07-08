import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/spec-coding/quality/route';


export const Route = createFileRoute('/api/spec-coding/quality')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
