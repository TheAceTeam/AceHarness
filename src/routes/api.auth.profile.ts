import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { PUT as putAuthProfile } from '@/server/api-routes/auth/profile/route';

export const Route = createFileRoute('/api/auth/profile')({
  server: {
    handlers: {
      PUT: toStartHandler(putAuthProfile),
    },
  },
});
