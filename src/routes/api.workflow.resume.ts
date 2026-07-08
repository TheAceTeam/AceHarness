import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/workflow/resume/route';


export const Route = createFileRoute('/api/workflow/resume')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
