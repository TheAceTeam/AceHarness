import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { PUT as putAuthPassword } from '@/server/api-routes/auth/password/route';

export const Route = createFileRoute('/api/auth/password')({
  server: {
    handlers: {
      PUT: toStartHandler(putAuthPassword),
    },
  },
});
