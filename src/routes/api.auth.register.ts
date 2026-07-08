import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as postAuthRegister } from '@/server/api-routes/auth/register/route';

export const Route = createFileRoute('/api/auth/register')({
  server: {
    handlers: {
      POST: toStartHandler(postAuthRegister),
    },
  },
});
