import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/spec-coding/sessions/[id]/import-persisted/route';


export const Route = createFileRoute('/api/spec-coding/sessions/$id/import-persisted')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
