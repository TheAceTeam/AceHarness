import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as getAuthSetup, POST as postAuthSetup } from '@/server/api-routes/auth/setup/route';

export const Route = createFileRoute('/api/auth/setup')({
  server: {
    handlers: {
      GET: toStartHandler(getAuthSetup),
      POST: toStartHandler(postAuthSetup),
    },
  },
});
