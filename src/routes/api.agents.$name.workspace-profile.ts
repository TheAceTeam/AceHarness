import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST, PATCH as apiRoutePATCH } from '@/server/api-routes/agents/[name]/workspace-profile/route';


export const Route = createFileRoute('/api/agents/$name/workspace-profile')({
  server: {
    handlers: {
      PATCH: toStartHandler(apiRoutePATCH),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
