import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import { POST as apiRoutePOST } from '@/server/api-routes/configs/[filename]/copy/route';


export const Route = createFileRoute('/api/configs/$filename/copy')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
    },
  },
});
