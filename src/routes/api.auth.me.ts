import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { DELETE as deleteAuthMe, GET as getAuthMe } from '@/server/api-routes/auth/me/route';

export const Route = createFileRoute('/api/auth/me')({
  server: {
    handlers: {
      GET: toStartHandler(getAuthMe),
      DELETE: toStartHandler(deleteAuthMe),
    },
  },
});
