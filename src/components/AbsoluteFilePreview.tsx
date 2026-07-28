'use client';

import { useMemo, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import Markdown from '@/components/Markdown';
import { useWorkspaceFileBlobQuery, useWorkspaceFileQuery } from '@/client/query/workspace';
import { Button } from '@/components/ui/button';

interface AbsoluteFilePreviewProps {
  absolutePath: string;
}

function fileNameOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] || path;
}

function parentDirOf(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}`;
}

function extOf(path: string): string {
  const name = fileNameOf(path);
  const idx = name.lastIndexOf('.');
  return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
}

function AbsoluteFilePreviewContent({ absolutePath }: AbsoluteFilePreviewProps) {
  const [error, setError] = useState('');

  const workspace = useMemo(() => parentDirOf(absolutePath), [absolutePath]);
  const file = useMemo(() => fileNameOf(absolutePath), [absolutePath]);
  const ext = useMemo(() => extOf(absolutePath), [absolutePath]);
  const isMarkdown = ext === 'md' || ext === 'markdown' || ext === 'mdx';
  const fileQuery = useWorkspaceFileQuery(workspace, file, { enabled: Boolean(workspace && file) });
  const blobQuery = useWorkspaceFileBlobQuery(workspace, file, { enabled: false });
  const loading = fileQuery.isLoading;
  const displayError = error || (fileQuery.error instanceof Error ? fileQuery.error.message : '');
  const displayContent = fileQuery.data?.content ?? '';

  const handleDownload = async () => {
    try {
      const result = await blobQuery.refetch();
      if (result.error) throw result.error;
      const blob = result.data;
      if (!blob) throw new Error('下载失败');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err?.message || '下载失败');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <div className="mb-4 rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold break-all">{file}</div>
              <div className="mt-1 text-xs text-muted-foreground break-all">{absolutePath}</div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void handleDownload()}>
              下载
            </Button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-muted-foreground">加载中...</div>
          ) : displayError ? (
            <div className="py-10 text-center text-sm text-destructive">{displayError}</div>
          ) : isMarkdown ? (
            <Markdown>{displayContent}</Markdown>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-sm leading-6">{displayContent}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AbsoluteFilePreview(props: AbsoluteFilePreviewProps) {
  return (
    <AuthGuard>
      <AbsoluteFilePreviewContent {...props} />
    </AuthGuard>
  );
}
