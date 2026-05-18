'use client';

import { useEffect, useMemo, useState } from 'react';
import AuthGuard from '@/components/AuthGuard';
import Markdown from '@/components/Markdown';
import { workspaceApi } from '@/lib/core/api';
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
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const workspace = useMemo(() => parentDirOf(absolutePath), [absolutePath]);
  const file = useMemo(() => fileNameOf(absolutePath), [absolutePath]);
  const ext = useMemo(() => extOf(absolutePath), [absolutePath]);
  const isMarkdown = ext === 'md' || ext === 'markdown' || ext === 'mdx';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setContent('');

    workspaceApi.getFile(workspace, file)
      .then((data) => {
        if (cancelled) return;
        setContent(data.content || '');
      })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.message || '读取文件失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [file, workspace]);

  const handleDownload = async () => {
    try {
      const blob = await workspaceApi.getFileBlob(workspace, file);
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
          ) : error ? (
            <div className="py-10 text-center text-sm text-destructive">{error}</div>
          ) : isMarkdown ? (
            <Markdown>{content}</Markdown>
          ) : (
            <pre className="whitespace-pre-wrap break-words text-sm leading-6">{content}</pre>
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
