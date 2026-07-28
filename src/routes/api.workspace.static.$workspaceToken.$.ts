import { createFileRoute } from '@tanstack/react-router';
import { GET as apiRouteGET } from '@/server/api-routes/workspace/static/[workspaceToken]/[...filePath]/route';

function decodePathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function getStaticFilePathFromRequest(request: Request, workspaceToken: string): string[] {
  const pathname = new URL(request.url).pathname;
  const encodedSegments = pathname.split('/').filter(Boolean);
  const segments = encodedSegments.map(decodePathSegment);
  const staticIndex = segments.findIndex((segment, index) =>
    segment === 'static'
      && segments[index - 2] === 'api'
      && segments[index - 1] === 'workspace'
  );
  if (staticIndex < 0) return [];

  const tokenIndex = staticIndex + 1;
  const requestToken = segments[tokenIndex] || '';
  if (!requestToken || requestToken !== workspaceToken) return [];
  return encodedSegments.slice(tokenIndex + 1).filter(Boolean).map(decodePathSegment);
}

function getStaticFilePathFromParams(params: Record<string, unknown>): string[] {
  const rawSplat = String(
    params._splat
      ?? params.splat
      ?? params['*']
      ?? params._
      ?? params['$']
      ?? '',
  ).trim();
  return rawSplat.split('/').filter(Boolean).map(decodePathSegment);
}

export const Route = createFileRoute('/api/workspace/static/$workspaceToken/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => {
        const workspaceToken = String((params as any).workspaceToken || '');
        const filePath = getStaticFilePathFromRequest(request, workspaceToken);
        const fallbackFilePath = filePath.length > 0
          ? filePath
          : getStaticFilePathFromParams(params as Record<string, unknown>);
        return apiRouteGET(request, {
          params: {
            workspaceToken,
            filePath: fallbackFilePath,
          },
        });
      },
    },
  },
});
