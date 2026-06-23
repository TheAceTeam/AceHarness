'use client';

import { useEffect, useMemo, useState } from 'react';
import Markdown from '@/components/Markdown';
import { workspaceApi } from '@/lib/core/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast';
import { Loader2, Download, ExternalLink, Eye } from 'lucide-react';

interface FilePreviewDialogProps {
  absolutePath: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico']);
const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);
const BINARY_EXTS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip', 'gz', 'tar', 'rar', '7z', 'jar', 'war',
  'exe', 'dll', 'so', 'dylib', 'bin', 'class',
  'mp3', 'mp4', 'avi', 'mov', 'mkv', 'wav', 'flac',
]);

function inferCodeLanguage(filePath: string): string | undefined {
  const ext = extOf(filePath);
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json',
    md: 'md', yaml: 'yaml', yml: 'yaml', css: 'css', html: 'html',
    sh: 'bash', bash: 'bash', zsh: 'bash', py: 'python', xml: 'xml', toml: 'toml',
    cj: 'cangjie',
  };
  return map[ext] || ext;
}

function describeKind(ext: string): 'image' | 'markdown' | 'text' | 'binary' {
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';
  if (BINARY_EXTS.has(ext)) return 'binary';
  return 'text';
}

export function FilePreviewDialog({ absolutePath, open, onOpenChange }: FilePreviewDialogProps) {
  const { toast } = useToast();
  const [content, setContent] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const file = useMemo(() => fileNameOf(absolutePath), [absolutePath]);
  const workspace = useMemo(() => parentDirOf(absolutePath), [absolutePath]);
  const ext = useMemo(() => extOf(absolutePath), [absolutePath]);
  const kind = useMemo(() => describeKind(ext), [ext]);
  const language = useMemo(() => inferCodeLanguage(absolutePath), [absolutePath]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    setContent('');
    setImageUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return '';
    });

    const task = kind === 'image' || kind === 'binary'
      ? workspaceApi.getFileBlob(workspace, file)
          .then((blob) => {
            if (cancelled) return;
            if (kind === 'image') {
              setImageUrl(URL.createObjectURL(blob));
            } else {
              setError('');
            }
          })
          .catch((err: any) => {
            if (cancelled) return;
            setError(err?.message || '读取文件失败');
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          })
      : workspaceApi.getFile(workspace, file)
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
      void task;
    };
  }, [open, file, workspace, kind]);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

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
      toast('error', err?.message || '下载失败');
    }
  };

  const handleOpenInPage = () => {
    if (typeof window === 'undefined') return;
    const encoded = absolutePath
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
    window.open(`/${encoded}`, '_blank', 'noopener,noreferrer');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] w-[min(1000px,92vw)] flex-col gap-0 p-0"
        overlayClassName="bg-black/70"
      >
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-4 py-3 text-left sm:flex-row sm:text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Eye className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{file}</span>
            </DialogTitle>
            <DialogDescription className="mt-0.5 break-all text-xs">
              {absolutePath}
            </DialogDescription>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={handleOpenInPage} title="在新页面打开">
              <ExternalLink className="size-3.5" />
              <span className="ml-1 hidden sm:inline">新页面</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => void handleDownload()} title="下载">
              <Download className="size-3.5" />
              <span className="ml-1 hidden sm:inline">下载</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto bg-muted/20 p-4">
          {loading ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 size-4 animate-spin" />
              加载中...
            </div>
          ) : error ? (
            <div className="flex h-full min-h-[200px] items-center justify-center text-sm text-destructive">
              {error}
            </div>
          ) : kind === 'image' && imageUrl ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <img
                src={imageUrl}
                alt={file}
                className="max-h-[72vh] max-w-full rounded border object-contain"
              />
            </div>
          ) : kind === 'binary' ? (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
              <p>该文件类型暂不支持在线预览</p>
              <Button variant="outline" size="sm" onClick={() => void handleDownload()}>
                <Download className="size-3.5" />
                <span className="ml-1">下载文件</span>
              </Button>
            </div>
          ) : kind === 'markdown' ? (
            <div className="prose-sm prose-neutral max-w-none dark:prose-invert [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5">
              <Markdown>{content}</Markdown>
            </div>
          ) : (
            <Markdown>{`\`\`\`${language || ''}\n${content || '(空文件)'}\n\`\`\``}</Markdown>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
