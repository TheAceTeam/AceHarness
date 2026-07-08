import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/channels/wechat-official/bridge/route';


export const Route = createFileRoute('/api/channels/wechat-official/bridge')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
