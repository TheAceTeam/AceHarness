import { jsonOk, requestUrl } from '@/server/api-route-runtime/request-utils';
import { requireAuth } from '@/lib/auth/middleware';

/**
 * Migration-only command discovery route. Runtime command metadata
 * should come from runtime-agent adapters. No old-architecture engine wrapper discovery
 * is executed here.
 */
function commandNamespaceForEngine(engine: string): string {
  const normalized = String(engine || '').trim();
  if (normalized === 'nga' || normalized === 'nga-sdk') return 'codeagent';
  return normalized.replace(/-sdk$/, '');
}

export async function GET(request: Request) {
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) return authResult;

  const requestedEngine = requestUrl(request).searchParams.get('engine') || '';
  const engine = String(requestedEngine || '').trim();
  const namespace = commandNamespaceForEngine(engine);
  return jsonOk({
    engine,
    namespace,
    commands: [],
    source: 'migration-only-empty-compat',
    migrationOnly: true,
    canonicalRoute: '/api/agents',
  });
}
