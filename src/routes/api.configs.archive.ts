import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST, PUT as apiRoutePUT } from '@/server/api-routes/configs/archive/route';


export const Route = createFileRoute('/api/configs/archive')({
  server: {
    handlers: {
      PUT: toStartHandler(apiRoutePUT),
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
