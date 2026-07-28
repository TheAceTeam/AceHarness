import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as postAuthLogin } from '@/server/api-routes/auth/login/route';

export const Route = createFileRoute('/api/auth/login')({
  server: {
    handlers: {
      POST: toStartHandler(postAuthLogin),
    },
  },
});
