import { createFileRoute } from '@tanstack/react-router';
import WorkspaceMarkdownPreviewPage from '@/client/pages/WorkspaceMarkdownPreviewPage';

export const Route = createFileRoute('/workspace/markdown-preview')({
  component: WorkspaceMarkdownPreviewRoute,
});

function WorkspaceMarkdownPreviewRoute() {
  const search = Route.useSearch() as Record<string, unknown>;
  const params = new URLSearchParams();
  const workspace = typeof search.workspace === 'string' ? search.workspace : '';
  const file = typeof search.file === 'string' ? search.file : '';
  if (workspace) params.set('workspace', workspace);
  if (file) params.set('file', file);
  return <WorkspaceMarkdownPreviewPage search={params.toString()} />;
}
