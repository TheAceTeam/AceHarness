import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/spec-coding/validate-persisted-root/route';


export const Route = createFileRoute('/api/spec-coding/validate-persisted-root')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
