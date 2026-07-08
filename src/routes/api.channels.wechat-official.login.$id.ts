import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/channels/wechat-official/login/[id]/route';


export const Route = createFileRoute('/api/channels/wechat-official/login/$id')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
