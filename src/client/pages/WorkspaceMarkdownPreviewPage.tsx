'use client';

import { useEffect, useMemo } from 'react';
import { Loader2 } from 'lucide-react';

import Markdown from '@/components/Markdown';
import { useWorkspaceFileQuery } from '@/client/query/workspace';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

type WorkspaceMarkdownPreviewPageProps = {
  search?: string;
};

function getFileName(filePath: string) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || 'Markdown 预览';
}

export default function WorkspaceMarkdownPreviewPage({ search = '' }: WorkspaceMarkdownPreviewPageProps) {
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const workspacePath = params.get('workspace') || '';
  const filePath = params.get('file') || '';
  const title = getFileName(filePath);
  const fileQuery = useWorkspaceFileQuery(workspacePath, filePath, {
    enabled: Boolean(workspacePath && filePath),
  });

  useDashboardShellHeader({
    title,
    subtitle: filePath || workspacePath || 'Markdown 预览',
  }, [title, filePath, workspacePath]);
  useDocumentTitle(title);

  useEffect(() => {
    if (!fileQuery.data?.content || typeof document === 'undefined') return;
    document.documentElement.style.scrollBehavior = 'auto';
  }, [fileQuery.data?.content]);

  if (!workspacePath || !filePath) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-sm text-muted-foreground">
        缺少 Markdown 预览参数
      </main>
    );
  }

  if (fileQuery.isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在加载 Markdown
      </main>
    );
  }

  if (fileQuery.isError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 text-sm text-destructive">
        {fileQuery.error instanceof Error ? fileQuery.error.message : 'Markdown 加载失败'}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <article className="mx-auto w-full max-w-5xl px-8 py-8">
        <Markdown>{fileQuery.data?.content || ''}</Markdown>
      </article>
    </main>
  );
}
