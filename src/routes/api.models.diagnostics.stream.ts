import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/models/diagnostics/stream/route';


export const Route = createFileRoute('/api/models/diagnostics/stream')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
