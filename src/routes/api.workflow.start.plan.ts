import { createFileRoute } from '@tanstack/react-router';
import { toStartHandler } from '@/routes/-api-route-handler';
import {
  DELETE as apiRouteDELETE,
  POST as apiRoutePOST,
  PUT as apiRoutePUT,
} from '@/server/api-routes/workflow/start/plan/route';

export const Route = createFileRoute('/api/workflow/start/plan')({
  server: {
    handlers: {
      POST: toStartHandler(apiRoutePOST),
      PUT: toStartHandler(apiRoutePUT),
      DELETE: toStartHandler(apiRouteDELETE),
    },
  },
});
