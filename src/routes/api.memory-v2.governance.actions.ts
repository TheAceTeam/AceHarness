import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/memory-v2/governance/actions/route';

export const Route = createFileRoute('/api/memory-v2/governance/actions')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
