import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workflow/spec-import/route';


export const Route = createFileRoute('/api/workflow/spec-import')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
