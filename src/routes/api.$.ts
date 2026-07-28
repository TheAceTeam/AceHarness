import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: () => Response.json({ error: 'API route not found' }, { status: 404 }),
      POST: () => Response.json({ error: 'API route not found' }, { status: 404 }),
      PUT: () => Response.json({ error: 'API route not found' }, { status: 404 }),
      PATCH: () => Response.json({ error: 'API route not found' }, { status: 404 }),
      DELETE: () => Response.json({ error: 'API route not found' }, { status: 404 }),
    },
  },
});