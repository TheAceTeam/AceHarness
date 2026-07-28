import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { GET as apiRouteGET } from '@/server/api-routes/channels/wechat-official/qrcode-image/route';


export const Route = createFileRoute('/api/channels/wechat-official/qrcode-image')({
  server: {
    handlers: {
      GET: toStartHandler(apiRouteGET),
    },
  },
});
