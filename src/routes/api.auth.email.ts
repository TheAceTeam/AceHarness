import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { PUT as putAuthEmail } from '@/server/api-routes/auth/email/route';

export const Route = createFileRoute('/api/auth/email')({
  server: {
    handlers: {
      PUT: toStartHandler(putAuthEmail),
    },
  },
});
