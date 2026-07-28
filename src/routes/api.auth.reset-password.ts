import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as postAuthResetPassword } from '@/server/api-routes/auth/reset-password/route';

export const Route = createFileRoute('/api/auth/reset-password')({
  server: {
    handlers: {
      POST: toStartHandler(postAuthResetPassword),
    },
  },
});
