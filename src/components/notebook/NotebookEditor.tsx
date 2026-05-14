'use client';

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { Copy, Download, History, Loader2, Save } from 'lucide-react';
import { workspaceApi, type NotebookScope, type NotebookSnapshotSummary } from '@/lib/core/api';
import { useToast } from '@/components/ui/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { copyText } from '@/lib/core/clipboard';

const RichNotebookEditor = dynamic(() => import('./RichNotebookEditor').then((mod) => mod.RichNotebookEditor), {
  ssr: false,
  loading: () => <div className="flex items-center justify-center h-full text-muted-foreground">加载 Notebook 编辑器...</div>,
});

interface NotebookEditorProps {
  filePath: string;
  content: string;
  onSave: (content: string) => Promise<void>;
  scope?: NotebookScope;
  shareToken?: string;
  permission?: 'read' | 'write';
  tocOpen?: boolean;
  onTocOpenChange?: (open: boolean) => void;
  dependencyGraphOpen?: boolean;
  onDependencyGraphOpenChange?: (open: boolean) => void;
}

export function NotebookEditor({
  filePath,
  content,
  onSave,
  scope = 'personal',
  shareToken,
  permission = 'write',
  tocOpen: tocOpenProp,
  onTocOpenChange,
  dependencyGraphOpen: dependencyGraphOpenProp,
  onDependencyGraphOpenChange,
}: NotebookEditorProps) {
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [saving, setSaving] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [lastSnapshotAt, setLastSnapshotAt] = useState<number | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [snapshotRows, setSnapshotRows] = useState<NotebookSnapshotSummary[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotRestoringId, setSnapshotRestoringId] = useState<string | null>(null);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffBaseContent, setDiffBaseContent] = useState<string>('');
  const [diffTargetContent, setDiffTargetContent] = useState<string>('');
  const [diffTargetSnapshotId, setDiffTargetSnapshotId] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState(content);
  const [savedContent, setSavedContent] = useState(content);
  const [tocOpenInner, setTocOpenInner] = useState(false);
  const [dependencyGraphOpenInner, setDependencyGraphOpenInner] = useState(false);
  const tocOpen = tocOpenProp ?? tocOpenInner;
  const dependencyGraphOpen = dependencyGraphOpenProp ?? dependencyGraphOpenInner;
  const handleTocOpenChange = onTocOpenChange ?? setTocOpenInner;
  const handleDependencyGraphOpenChange = onDependencyGraphOpenChange ?? setDependencyGraphOpenInner;

  useEffect(() => {
    setEditorContent(content);
    setSavedContent(content);
    setLastSavedAt(Date.now());
    setAutoSaveError(null);
  }, [content]);

  const loadSnapshots = useCallback(async () => {
    setSnapshotLoading(true);
    try {
      const data = await workspaceApi.listNotebookSnapshots(filePath, { scope, shareToken });
      const rows = data.rows || [];
      setSnapshotRows(rows);
      if (rows[0]?.createdAt) setLastSnapshotAt(rows[0].createdAt);
      if (rows.length === 0) {
        setSelectedSnapshotId(null);
        setDiffTargetSnapshotId(null);
      } else if (!selectedSnapshotId || !rows.some((r) => r.id === selectedSnapshotId)) {
        setSelectedSnapshotId(rows[0].id);
      }
    } catch (error: any) {
      toast('error', error?.message || '加载快照列表失败');
    } finally {
      setSnapshotLoading(false);
    }
  }, [filePath, scope, selectedSnapshotId, shareToken, toast]);

  const createSnapshot = useCallback(async (source: 'manual' | 'auto') => {
    if (permission === 'read') return;
    try {
      const result = await workspaceApi.createNotebookSnapshot(filePath, { scope, shareToken, source });
      if (result?.snapshot?.createdAt) setLastSnapshotAt(result.snapshot.createdAt);
      if (snapshotOpen) await loadSnapshots();
    } catch (error: any) {
      if (source === 'manual') {
        toast('error', error?.message || '创建快照失败');
      }
    }
  }, [filePath, loadSnapshots, permission, scope, shareToken, snapshotOpen, toast]);

  const doSave = useCallback(async (nextContent: string, source: 'manual' | 'auto') => {
    if (source === 'manual') {
      if (saving) return;
      setSaving(true);
    } else {
      if (autoSaving) return;
      setAutoSaving(true);
    }
    try {
      await onSave(nextContent);
      setSavedContent(nextContent);
      setLastSavedAt(Date.now());
      setAutoSaveError(null);
      if (source === 'manual') {
        await createSnapshot('manual');
      } else {
        const now = Date.now();
        if (!lastSnapshotAt || now - lastSnapshotAt > 10 * 60 * 1000) {
          await createSnapshot('auto');
        }
      }
      if (source === 'manual') {
        toast('success', 'Notebook 已保存');
      }
    } catch (error: any) {
      const message = error?.message || '保存失败';
      if (source === 'manual') {
        toast('error', message);
      } else {
        setAutoSaveError(message);
      }
    } finally {
      if (source === 'manual') {
        setSaving(false);
      } else {
        setAutoSaving(false);
      }
    }
  }, [autoSaving, createSnapshot, lastSnapshotAt, onSave, saving, toast]);

  const handleSave = useCallback(async () => {
    if (permission === 'read') return;
    await doSave(editorContent, 'manual');
  }, [doSave, editorContent, permission]);

  const handleRunCell = useCallback(async ({ code, cellId }: { pos: number; cellId: string; language: string; code: string }) => {
    try {
      const result = await workspaceApi.runCangjie(code, `cell_${cellId}`, 'markdown');
      const output = result.combinedOutput || [result.stdout, result.stderr].filter(Boolean).join('\n') || result.error || '无输出';
      toast(result.success ? 'success' : 'error', result.success ? '运行完成' : (result.error || '运行失败'));
      return { output, success: result.success };
    } catch (error: any) {
      const message = error?.message || '运行失败';
      toast('error', message);
      return { output: message, success: false };
    }
  }, [filePath, toast]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([editorContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filePath.split('/').pop() || 'notebook.cj.md';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast('success', '文件已下载');
  }, [editorContent, filePath, toast]);

  const handleCopyShareLink = useCallback(async () => {
    if (scope !== 'global') {
      toast('warning', '个人 Notebook 不支持分享链接');
      return;
    }
    const path = '/notebook';
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    params.set('notebook', '1');
    params.set('notebookScope', scope);
    const shared = shareToken
      ? { token: shareToken, permission }
      : await workspaceApi.createNotebookShare(filePath, permission === 'read' ? 'read' : 'write', 'global');
    params.set('notebookFile', filePath);
    params.set('notebookShare', shared.token);
    params.set('notebookPermission', shared.permission);
    const url = `${typeof window !== 'undefined' ? window.location.origin : ''}${path}?${params.toString()}`;
    const ok = await copyText(url);
    if (ok) {
      toast('success', 'Notebook 分享链接已复制');
    } else {
      toast('error', '复制失败，请手动复制链接');
    }
  }, [filePath, permission, scope, shareToken, toast]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleSave]);

  const isDirty = editorContent !== savedContent;
  const canAutoSave = permission !== 'read';

  useEffect(() => {
    if (!canAutoSave) return;
    if (!isDirty) return;
    if (saving || autoSaving) return;
    const timer = window.setTimeout(() => {
      void doSave(editorContent, 'auto');
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [autoSaving, canAutoSave, doSave, editorContent, isDirty, saving]);

  useEffect(() => {
    if (!snapshotOpen) return;
    void loadSnapshots();
  }, [loadSnapshots, snapshotOpen]);

  const handleRestoreSnapshot = useCallback(async (snapshotId: string) => {
    if (permission === 'read') return;
    const ok = await confirm({
      title: '恢复版本',
      description: '确认恢复该版本？当前未保存内容会被覆盖。',
      confirmLabel: '恢复',
      variant: 'destructive',
    });
    if (!ok) return;
    setSnapshotRestoringId(snapshotId);
    try {
      await workspaceApi.restoreNotebookSnapshot(filePath, snapshotId, { scope, shareToken });
      const data = await workspaceApi.getNotebookFile(filePath, { scope, shareToken });
      setEditorContent(data.content || '');
      setSavedContent(data.content || '');
      setLastSavedAt(Date.now());
      toast('success', '已恢复到所选版本');
      await loadSnapshots();
    } catch (error: any) {
      toast('error', error?.message || '恢复失败');
    } finally {
      setSnapshotRestoringId(null);
    }
  }, [confirm, filePath, loadSnapshots, permission, scope, shareToken, toast]);

  const handlePreviewSnapshotDiff = useCallback(async (row: NotebookSnapshotSummary) => {
    setDiffLoading(true);
    setSelectedSnapshotId(row.id);
    setDiffTargetSnapshotId(row.id);
    try {
      const [current, detail] = await Promise.all([
        workspaceApi.getNotebookFile(filePath, { scope, shareToken }),
        workspaceApi.getNotebookSnapshotDetail(filePath, row.id, { scope, shareToken }),
      ]);
      setDiffBaseContent(current.content || '');
      setDiffTargetContent(detail.snapshot?.content || '');
    } catch (error: any) {
      toast('error', error?.message || '加载差异预览失败');
    } finally {
      setDiffLoading(false);
    }
  }, [filePath, scope, shareToken, toast]);

  useEffect(() => {
    if (!snapshotOpen) return;
    const row = snapshotRows.find((r) => r.id === selectedSnapshotId) || snapshotRows[0];
    if (!row) return;
    void handlePreviewSnapshotDiff(row);
  }, [handlePreviewSnapshotDiff, selectedSnapshotId, snapshotOpen, snapshotRows]);

  useEffect(() => {
    if (!canAutoSave) return;
    const handler = () => {
      if (!isDirty || saving || autoSaving) return;
      void doSave(editorContent, 'auto');
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [autoSaving, canAutoSave, doSave, editorContent, isDirty, saving]);

  const statusText = autoSaving
    ? '自动保存中...'
    : autoSaveError
      ? `自动保存失败：${autoSaveError}`
      : isDirty
        ? '有未保存变更'
        : '已保存';
  const timeText = lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : '';
  const baseLines = diffBaseContent.split('\n');
  const targetLines = diffTargetContent.split('\n');
  const lineCount = Math.max(baseLines.length, targetLines.length);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="text-xs text-muted-foreground flex items-center gap-2">
          <span className={autoSaveError ? 'text-destructive' : (isDirty ? 'text-amber-500' : 'text-emerald-500')}>
            {statusText}
          </span>
          {timeText && !autoSaving && !autoSaveError && (
            <span className="text-muted-foreground/80">最近保存：{timeText}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setSnapshotOpen(true)}>
            <History className="mr-1 h-4 w-4" />
            历史版本
          </Button>
          {scope === 'global' && (
            <Button size="sm" variant="outline" onClick={() => { void handleCopyShareLink(); }}>
              <Copy className="mr-1 h-4 w-4" />
              复制链接
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={handleDownload}>
            <Download className="mr-1 h-4 w-4" />
            下载
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || autoSaving || !isDirty || permission === 'read'}>
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
            {saving ? '保存中' : isDirty ? '保存' : '已保存'}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <RichNotebookEditor
          filePath={filePath}
          content={editorContent}
          onChange={setEditorContent}
          onRunCell={handleRunCell}
          scope={scope}
          shareToken={shareToken}
          permission={permission}
          tocOpen={tocOpen}
          onTocOpenChange={handleTocOpenChange}
          dependencyGraphOpen={dependencyGraphOpen}
          onDependencyGraphOpenChange={handleDependencyGraphOpenChange}
        />
      </div>
      <Dialog open={snapshotOpen} onOpenChange={setSnapshotOpen}>
        <DialogContent className="max-w-[94vw] sm:max-w-7xl">
          <DialogHeader>
            <DialogTitle>历史版本</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3 h-[72vh]">
            <div className="rounded-md border overflow-auto">
              <div className="grid grid-cols-2 border-b bg-muted/40 text-xs font-medium">
                <div className="px-3 py-2">当前内容</div>
                <div className="px-3 py-2 border-l">目标版本</div>
              </div>
              {diffLoading ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">加载差异中...</div>
              ) : snapshotRows.length === 0 ? (
                <div className="px-4 py-6 text-sm text-muted-foreground">暂无历史版本</div>
              ) : (
                <div className="font-mono text-xs">
                  {Array.from({ length: lineCount }).map((_, idx) => {
                    const left = baseLines[idx] ?? '';
                    const right = targetLines[idx] ?? '';
                    const same = left === right;
                    return (
                      <div key={`diff-${idx}`} className="grid grid-cols-2">
                        <div className={`px-3 py-1 whitespace-pre-wrap break-words ${same ? '' : 'bg-amber-500/10'}`}>
                          <span className="text-muted-foreground mr-2">{idx + 1}</span>
                          {left}
                        </div>
                        <div className={`px-3 py-1 whitespace-pre-wrap break-words border-l ${same ? '' : 'bg-emerald-500/10'}`}>
                          <span className="text-muted-foreground mr-2">{idx + 1}</span>
                          {right}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="rounded-md border overflow-hidden flex flex-col min-h-0">
              <div className="px-3 py-2 border-b bg-muted/40 text-sm font-medium">版本列表</div>
              <div className="flex-1 overflow-auto">
                {snapshotLoading ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground">加载中...</div>
                ) : snapshotRows.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground">暂无历史版本</div>
                ) : (
                  snapshotRows.map((row) => (
                    <div
                      key={row.id}
                      role="button"
                      tabIndex={0}
                      className={`w-full text-left px-3 py-2 border-b hover:bg-accent/60 cursor-pointer ${selectedSnapshotId === row.id ? 'bg-accent' : ''}`}
                      onClick={() => setSelectedSnapshotId(row.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedSnapshotId(row.id);
                        }
                      }}
                    >
                      <div className="text-sm font-medium">{new Date(row.createdAt).toLocaleString()}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {row.source === 'auto' ? '自动' : row.source === 'manual' ? '手动' : '系统'} · {row.createdByName || '-'} · {Math.max(1, Math.round(row.contentSize / 1024))} KB
                      </div>
                      <div className="pt-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={permission === 'read' || snapshotRestoringId === row.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleRestoreSnapshot(row.id);
                          }}
                        >
                          {snapshotRestoringId === row.id ? '恢复中...' : '恢复到该版本'}
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="flex justify-between items-center pt-2">
            <div className="text-xs text-muted-foreground">每次保存会自动创建快照，每个文档最多保留 50 个版本</div>
          </div>
        </DialogContent>
      </Dialog>
      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
