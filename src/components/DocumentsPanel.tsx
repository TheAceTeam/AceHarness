'use client';

import { useState, useEffect, useMemo, useCallback, useRef, type ReactNode } from 'react';
import { runsApi, workspaceApi, type NotebookScope, type TreeNode } from '@/lib/core/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import ConfirmDialog from '@/components/ConfirmDialog';
import Markdown from '@/components/Markdown';
import NotebookSaveDialog from '@/components/notebook/NotebookSaveDialog';
import { useTranslations } from '@/hooks/useTranslations';
import { useToast } from '@/components/ui/toast';
import styles from '@/app/workbench/[config]/page.module.css';

export interface DocFile {
  filename: string;
  stepName: string;
  baseName: string;
  logicalName?: string;
  iteration: number | null;
  agent: string;
  phaseName: string;
  role: string;
  documentKind?: 'conclusion' | 'detail';
  groupKey?: string;
  groupLabel?: string;
  size: number;
  modifiedTime: string;
}

interface DocTreeGroup {
  key: string;
  name: string;
  summary: DocFile | null;
  details: DocFile[];
  latestTime: number;
}

interface DocFolderGroup {
  key: string;
  label: string;
  files: DocFile[];
}

interface DocumentsPanelProps {
  runId: string | null;
  openLatestTimestampedRequest?: number;
  onOpenWorkspaceDirectory?: (path: string) => void;
}

type SortField = 'name' | 'time' | 'size';
type SortOrder = 'asc' | 'desc';
type DocFilter = 'all' | 'conclusion' | 'detail';

const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/;

function hasTimestamp(filename: string): boolean {
  return TIMESTAMP_RE.test(filename);
}

function stripTimestampPrefix(filename: string): string {
  return filename.replace(TIMESTAMP_RE, '');
}

function getDisplayFileName(file: DocFile): string {
  return stripTimestampPrefix(file.baseName || file.filename);
}

function getDocumentIcon(file: DocFile): string {
  return hasTimestamp(file.filename) ? 'article' : 'fact_check';
}

function getDocumentIconClass(file: DocFile): string {
  return hasTimestamp(file.filename)
    ? 'text-blue-500'
    : 'text-emerald-600 dark:text-emerald-400';
}

/** Parse timestamp prefix: "2026-03-30T11-06-14-" → "03-30 11:06" */
function parseTimestamp(filename: string): string {
  const m = filename.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-/);
  if (!m) return '';
  return `${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

const roleBadge: Record<string, string> = {
  attacker: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  defender: 'bg-red-500/15 text-red-600 dark:text-red-400',
  judge: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400',
};
const roleIcon: Record<string, string> = { attacker: 'swords', defender: 'shield', judge: 'gavel' };
const roleLabel: Record<string, string> = { attacker: '攻击方', defender: '防守方', judge: '裁判' };

function normalizeDocumentFolderLabel(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

function normalizeDocumentFolderKey(value: string): string {
  return normalizeDocumentFolderLabel(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'other';
}

function getFallbackFileGroupLabel(filename: string): string {
  const base = filename.replace(/\.(md|txt)$/i, '');
  // Strip ISO timestamp prefix like "2026-03-20T14-30-00-" from conclusion files
  const stripped = base.replace(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-/, '');
  const idx = stripped.indexOf('-');
  const raw = idx > 0 ? stripped.substring(0, idx) : stripped;
  return normalizeDocumentFolderLabel(raw) || '其他';
}

export function getDocumentFolderGroup(file: Pick<DocFile, 'filename' | 'phaseName'>): { key: string; label: string } {
  const label = normalizeDocumentFolderLabel(file.phaseName) || getFallbackFileGroupLabel(file.filename);
  return {
    key: normalizeDocumentFolderKey(label),
    label,
  };
}

function getTreeLinkName(file: DocFile): string {
  return file.groupLabel || file.logicalName || stripTimestampPrefix(file.baseName || file.filename);
}

function getTreeGroupKey(file: DocFile): string {
  if (file.groupKey) return file.groupKey;
  const logical = file.logicalName || stripTimestampPrefix(file.baseName || file.filename);
  return logical.replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
}

function sortDocFiles(files: DocFile[], sortField: SortField, sortOrder: SortOrder): DocFile[] {
  const next = [...files];
  next.sort((a, b) => {
    let c = 0;
    if (sortField === 'name') c = a.baseName.localeCompare(b.baseName);
    else if (sortField === 'time') c = new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
    else if (sortField === 'size') c = a.size - b.size;
    return sortOrder === 'asc' ? c : -c;
  });
  return next;
}

function buildTreeGroups(files: DocFile[], sortField: SortField, sortOrder: SortOrder): DocTreeGroup[] {
  const map = new Map<string, { name: string; summary: DocFile | null; details: DocFile[] }>();

  files.forEach((file) => {
    const key = getTreeGroupKey(file);
    const existing = map.get(key) || { name: getTreeLinkName(file), summary: null, details: [] };
    existing.name ||= getTreeLinkName(file);
    if (hasTimestamp(file.filename)) {
      existing.details.push(file);
    } else if (!existing.summary) {
      existing.summary = file;
    } else {
      existing.details.push(file);
    }
    map.set(key, existing);
  });

  return Array.from(map.entries())
    .map(([key, value]) => {
      const sortedDetails = sortDocFiles(value.details, sortField, sortOrder);
      const latestSource = value.summary
        ? [value.summary, ...sortedDetails]
        : sortedDetails;
      const latestTime = latestSource.reduce((max, item) => {
        const time = new Date(item.modifiedTime).getTime();
        return Number.isFinite(time) ? Math.max(max, time) : max;
      }, 0);
      return {
        key,
        name: value.name,
        summary: value.summary,
        details: sortedDetails,
        latestTime,
      };
    })
    .sort((a, b) => {
      let c = 0;
      if (sortField === 'name') c = a.name.localeCompare(b.name);
      else if (sortField === 'size') {
        const sizeA = (a.summary?.size || 0) + a.details.reduce((sum, item) => sum + item.size, 0);
        const sizeB = (b.summary?.size || 0) + b.details.reduce((sum, item) => sum + item.size, 0);
        c = sizeA - sizeB;
      } else {
        c = a.latestTime - b.latestTime;
      }
      return sortOrder === 'asc' ? c : -c;
    });
}

export default function DocumentsPanel({ runId, openLatestTimestampedRequest = 0, onOpenWorkspaceDirectory }: DocumentsPanelProps) {
  const { toast } = useToast();
  const [files, setFiles] = useState<DocFile[]>([]);
  const [documentDirectory, setDocumentDirectory] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Sorting / filtering
  const [sortField, setSortField] = useState<SortField>('time');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeGroup, setActiveGroup] = useState<string | null>(null); // null = all
  const [docFilter, setDocFilter] = useState<DocFilter>('all');

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Preview
  const [previewFile, setPreviewFile] = useState<DocFile | null>(null);
  const [previewContent, setPreviewContent] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Rename
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<string[] | null>(null);
  const [savingNotebookFile, setSavingNotebookFile] = useState<string | null>(null);
  const [saveNotebookDialogOpen, setSaveNotebookDialogOpen] = useState(false);
  const [saveNotebookTarget, setSaveNotebookTarget] = useState<DocFile | null>(null);
  const [saveNotebookScope, setSaveNotebookScope] = useState<NotebookScope>('personal');
  const [saveNotebookDirectory, setSaveNotebookDirectory] = useState('');
  const [saveNotebookDirs, setSaveNotebookDirs] = useState<Array<{ path: string; label: string }>>([]);
  const [saveNotebookDirsLoading, setSaveNotebookDirsLoading] = useState(false);

  // Fullscreen sidebar controls
  const FOLDER_TREE_WIDTH_KEY = 'doc-folder-tree-width';
  const FILE_LIST_WIDTH_KEY = 'doc-file-list-width';
  const FOLDER_TREE_VISIBLE_KEY = 'doc-folder-tree-visible';
  const FILE_LIST_VISIBLE_KEY = 'doc-file-list-visible';
  const FOLDER_TREE_DEFAULT = 192;
  const FOLDER_TREE_MIN = 120;
  const FOLDER_TREE_MAX = 320;
  const FILE_LIST_DEFAULT = 360;
  const FILE_LIST_MIN = 180;
  const FILE_LIST_MAX = 760;

  const [folderTreeVisible, setFolderTreeVisible] = useState(true);
  const [fileListVisible, setFileListVisible] = useState(true);
  const [folderTreeWidth, setFolderTreeWidth] = useState(FOLDER_TREE_DEFAULT);
  const [fileListWidth, setFileListWidth] = useState(FILE_LIST_DEFAULT);
  const resizingPanel = useRef<'folderTree' | 'fileList' | null>(null);
  const startX = useRef(0);
  const startWidth = useRef(0);
  const lastOpenLatestRequestRef = useRef(0);

  // Load persisted sidebar state
  useEffect(() => {
    try {
      const ftw = localStorage.getItem(FOLDER_TREE_WIDTH_KEY);
      const flw = localStorage.getItem(FILE_LIST_WIDTH_KEY);
      const ftv = localStorage.getItem(FOLDER_TREE_VISIBLE_KEY);
      const flv = localStorage.getItem(FILE_LIST_VISIBLE_KEY);
      if (ftw) setFolderTreeWidth(Math.max(FOLDER_TREE_MIN, Math.min(FOLDER_TREE_MAX, Number(ftw))));
      if (flw) setFileListWidth(Math.max(FILE_LIST_MIN, Math.min(FILE_LIST_MAX, Number(flw))));
      if (ftv !== null) setFolderTreeVisible(ftv !== 'false');
      if (flv !== null) setFileListVisible(flv !== 'false');
    } catch {}
  }, []);

  const toggleFolderTreeVisible = useCallback(() => {
    setFolderTreeVisible(v => {
      const next = !v;
      try { localStorage.setItem(FOLDER_TREE_VISIBLE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const toggleFileListVisible = useCallback(() => {
    setFileListVisible(v => {
      const next = !v;
      try { localStorage.setItem(FILE_LIST_VISIBLE_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const onResizeStart = useCallback((panel: 'folderTree' | 'fileList', e: React.MouseEvent) => {
    e.preventDefault();
    resizingPanel.current = panel;
    startX.current = e.clientX;
    startWidth.current = panel === 'folderTree' ? folderTreeWidth : fileListWidth;

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX.current;
      const newWidth = startWidth.current + delta;
      if (resizingPanel.current === 'folderTree') {
        setFolderTreeWidth(Math.max(FOLDER_TREE_MIN, Math.min(FOLDER_TREE_MAX, newWidth)));
      } else {
        setFileListWidth(Math.max(FILE_LIST_MIN, Math.min(FILE_LIST_MAX, newWidth)));
      }
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (resizingPanel.current === 'folderTree') {
        setFolderTreeWidth(w => { try { localStorage.setItem(FOLDER_TREE_WIDTH_KEY, String(w)); } catch {} return w; });
      } else {
        setFileListWidth(w => { try { localStorage.setItem(FILE_LIST_WIDTH_KEY, String(w)); } catch {} return w; });
      }
      resizingPanel.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [folderTreeWidth, fileListWidth]);

  const loadFiles = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await runsApi.listDocuments(runId);
      setFiles(data.files || []);
      setDocumentDirectory(data.documentDirectory || null);
    } catch {
      setFiles([]);
      setDocumentDirectory(null);
    }
    setLoading(false);
  }, [runId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  // Filter files by doc type
  const tabFiles = useMemo(() => {
    if (docFilter === 'conclusion') return files.filter(f => !hasTimestamp(f.filename));
    if (docFilter === 'detail') return files.filter(f => hasTimestamp(f.filename));
    return files;
  }, [files, docFilter]);

  // Build left folder groups from workflow metadata first, with filename fallback.
  const folderGroups = useMemo<DocFolderGroup[]>(() => {
    const map = new Map<string, DocFolderGroup>();
    tabFiles.forEach(f => {
      const group = getDocumentFolderGroup(f);
      const existing = map.get(group.key) || { key: group.key, label: group.label, files: [] };
      existing.files.push(f);
      map.set(group.key, existing);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'));
  }, [tabFiles]);

  // Filtered + sorted files
  const scopedFiles = useMemo(() => {
    return activeGroup ? (folderGroups.find(group => group.key === activeGroup)?.files || []) : [...tabFiles];
  }, [activeGroup, folderGroups, tabFiles]);

  const processedFiles = useMemo(() => {
    let filtered = [...scopedFiles];
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(f => f.filename.toLowerCase().includes(q) || f.baseName.toLowerCase().includes(q));
    }
    return sortDocFiles(filtered, sortField, sortOrder);
  }, [scopedFiles, searchQuery, sortField, sortOrder]);

  const treeGroups = useMemo(() => {
    const grouped = buildTreeGroups(scopedFiles, sortField, sortOrder);
    if (!searchQuery.trim()) return grouped;
    const q = searchQuery.toLowerCase();
    return grouped
      .map((group) => {
        const summaryMatches = Boolean(group.summary && (
          group.summary.filename.toLowerCase().includes(q) || group.summary.baseName.toLowerCase().includes(q)
        ));
        const detailMatches = group.details.filter((file) => (
          file.filename.toLowerCase().includes(q) || file.baseName.toLowerCase().includes(q)
        ));
        if (summaryMatches) {
          return { ...group };
        }
        if (detailMatches.length > 0) {
          return { ...group, details: detailMatches };
        }
        return null;
      })
      .filter(Boolean) as DocTreeGroup[];
  }, [scopedFiles, searchQuery, sortField, sortOrder]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortOrder(o => o === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortOrder('asc'); }
  };

  const selectFile = useCallback(async (file: DocFile) => {
    if (!runId) return;
    setPreviewFile(file);
    setLoadingPreview(true);
    try {
      const { content } = await runsApi.getDocumentContent(runId, file.filename);
      setPreviewContent(content);
    } catch { setPreviewContent('(无法加载)'); }
    setLoadingPreview(false);
  }, [runId]);

  const toggleExpandedGroup = useCallback((groupKey: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!previewFile) return;
    const key = getTreeGroupKey(previewFile);
    setExpandedGroups((prev) => {
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, [previewFile]);

  const openLatestTimestampedFile = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    try {
      const data = await runsApi.listDocuments(runId);
      const nextFiles = data.files || [];
      setFiles(nextFiles);
      const latestFile = nextFiles
        .filter(file => hasTimestamp(file.filename))
        .sort((a, b) => b.filename.localeCompare(a.filename))[0];

      if (!latestFile) {
        toast('error', '未找到 AI 最新结论文档');
        return;
      }

      setModalOpen(true);
      await selectFile(latestFile);
    } catch {
      toast('error', '打开最新 AI 结论文档失败');
    } finally {
      setLoading(false);
    }
  }, [runId, selectFile, toast]);

  useEffect(() => {
    if (!openLatestTimestampedRequest || openLatestTimestampedRequest === lastOpenLatestRequestRef.current) {
      return;
    }
    lastOpenLatestRequestRef.current = openLatestTimestampedRequest;
    void openLatestTimestampedFile();
  }, [openLatestTimestampedFile, openLatestTimestampedRequest]);

  const toggleSelect = (filename: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(filename) ? next.delete(filename) : next.add(filename);
      return next;
    });
  };
  const toggleSelectAll = () => {
    const visibleFiles = docFilter === 'all'
      ? treeGroups.flatMap(group => group.summary ? [group.summary, ...group.details] : group.details)
      : processedFiles;
    if (selected.size === visibleFiles.length) setSelected(new Set());
    else setSelected(new Set(visibleFiles.map(f => f.filename)));
  };

  const handleRename = async (file: string) => {
    if (!runId || !renameValue.trim()) return;
    try {
      await runsApi.renameDocument(runId, file, renameValue.trim());
      setRenamingFile(null);
      loadFiles();
    } catch { /* toast? */ }
  };

  const handleDelete = async (filenames: string[]) => {
    if (!runId) return;
    try {
      await runsApi.deleteDocuments(runId, filenames);
      setDeleteTarget(null);
      setSelected(prev => { const n = new Set(prev); filenames.forEach(f => n.delete(f)); return n; });
      if (previewFile && filenames.includes(previewFile.filename)) { setPreviewFile(null); setPreviewContent(''); }
      loadFiles();
    } catch { /* toast? */ }
  };

  const downloadFile = (file: DocFile) => {
    const blob = new Blob([previewContent || ''], { type: 'text/markdown;charset=utf-8' });
    if (!previewContent || previewFile?.filename !== file.filename) {
      runsApi.getDocumentContent(runId!, file.filename).then(({ content }) => {
        const b = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        triggerDownload(b, file.filename);
      });
    } else {
      triggerDownload(blob, file.filename);
    }
  };

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  };

  const sanitizeNotebookName = (name: string) => {
    return name
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const collectNotebookDirectories = useCallback((tree: TreeNode[]): Array<{ path: string; label: string }> => {
    const dirs = new Set<string>(['']);
    const walk = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        if (node.type === 'directory') {
          dirs.add(node.path || '');
          if (node.children && node.children.length > 0) walk(node.children);
        }
      });
    };
    walk(tree);
    return Array.from(dirs)
      .sort((a, b) => a.localeCompare(b))
      .map((path) => ({ path, label: path || '根目录 /' }));
  }, []);

  const loadNotebookDirectories = useCallback(async (scope: NotebookScope) => {
    setSaveNotebookDirsLoading(true);
    try {
      const result = await workspaceApi.getNotebookTree(8, { scope });
      const dirs = collectNotebookDirectories(result.tree || []);
      setSaveNotebookDirs(dirs.length > 0 ? dirs : [{ path: '', label: '根目录 /' }]);
      setSaveNotebookDirectory((prev) => {
        if (prev && dirs.some((item) => item.path === prev)) return prev;
        return dirs[0]?.path ?? '';
      });
    } catch {
      setSaveNotebookDirs([{ path: '', label: '根目录 /' }]);
      setSaveNotebookDirectory('');
    } finally {
      setSaveNotebookDirsLoading(false);
    }
  }, [collectNotebookDirectories]);

  const openSaveNotebookDialog = useCallback((file: DocFile) => {
    setSaveNotebookTarget(file);
    setSaveNotebookScope('personal');
    setSaveNotebookDirectory('');
    setSaveNotebookDialogOpen(true);
    void loadNotebookDirectories('personal');
  }, [loadNotebookDirectories]);

  const saveDocToNotebook = useCallback(async (file: DocFile, scope: NotebookScope = 'personal', directory = '') => {
    if (!runId) return;
    setSavingNotebookFile(file.filename);
    try {
      const content = (previewFile?.filename === file.filename && previewContent)
        ? previewContent
        : (await runsApi.getDocumentContent(runId, file.filename)).content;
      const base = sanitizeNotebookName(file.baseName.replace(/\.md$/i, '') || 'workflow-doc');
      const ts = new Date();
      const stamp = `${ts.getFullYear()}${String(ts.getMonth() + 1).padStart(2, '0')}${String(ts.getDate()).padStart(2, '0')}-${String(ts.getHours()).padStart(2, '0')}${String(ts.getMinutes()).padStart(2, '0')}${String(ts.getSeconds()).padStart(2, '0')}`;
      const fileName = `${base}-${stamp}.cj.md`;
      const normalizedDir = (directory || '').replace(/^\/+|\/+$/g, '');
      const notebookPath = normalizedDir ? `${normalizedDir}/${fileName}` : fileName;
      await workspaceApi.manageNotebook('create-file', { path: notebookPath }, { scope });
      await workspaceApi.saveNotebookFile(notebookPath, content, { scope });
      toast('success', `已保存到 Notebook：${notebookPath}`);
    } catch (error: any) {
      toast('error', error?.message || '保存到 Notebook 失败');
    } finally {
      setSavingNotebookFile((prev) => (prev === file.filename ? null : prev));
    }
  }, [previewContent, previewFile?.filename, runId, toast]);

  if (!runId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <span className="material-symbols-outlined text-5xl mb-4">description</span>
        <p>启动工作流后查看产出文档</p>
      </div>
    );
  }

  // --- Left sidebar: folder tree ---
  const folderTree = () => (
    <div className="w-48 shrink-0 border-r border-border bg-muted/20 flex flex-col overflow-hidden">
      <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border/50">文件夹</div>
      <div className="flex-1 overflow-y-auto">
        <div
          className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 ${activeGroup === null ? 'bg-accent text-accent-foreground font-medium' : ''}`}
          onClick={() => setActiveGroup(null)}
        >
          <span className="material-symbols-outlined text-sm">folder</span>
          <span className="flex-1">全部文件</span>
          <span className="text-[10px] text-muted-foreground">{tabFiles.length}</span>
        </div>
        {folderGroups.map(group => (
          <div
            key={group.key}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 ${activeGroup === group.key ? 'bg-accent text-accent-foreground font-medium' : ''}`}
            onClick={() => setActiveGroup(group.key)}
          >
            <span className="material-symbols-outlined text-sm">folder</span>
            <span className="flex-1 truncate">{group.label}</span>
            <span className="text-[10px] text-muted-foreground">{group.files.length}</span>
          </div>
        ))}
      </div>
    </div>
  );

  // --- Toolbar ---
  const toolbar = (compact?: boolean) => (
    <div className={`flex items-center gap-2 flex-wrap ${compact ? 'p-2' : 'p-3'}`}>
      {!compact && (
        <Input
          placeholder="搜索文件..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="h-7 text-xs w-40"
        />
      )}
      {!compact && (
        <Select value={sortField} onValueChange={v => { setSortField(v as SortField); }}>
          <SelectTrigger className="h-7 text-xs w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="name">按名称</SelectItem>
            <SelectItem value="time">按时间</SelectItem>
            <SelectItem value="size">按大小</SelectItem>
          </SelectContent>
        </Select>
      )}
      {!compact && (
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSortOrder(o => o === 'asc' ? 'desc' : 'asc')} title={sortOrder === 'asc' ? '升序' : '降序'}>
          <span className="material-symbols-outlined text-sm">{sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'}</span>
        </Button>
      )}
      {!compact && (
        <div className="flex items-center gap-1 ml-1">
          {([['all', '全部'], ['conclusion', '结论'], ['detail', '详情']] as const).map(([key, label]) => (
            <Badge
              key={key}
              variant={docFilter === key ? 'default' : 'outline'}
              className={`cursor-pointer text-[10px] h-5 px-1.5 select-none transition-colors ${docFilter === key ? '' : 'hover:bg-muted'}`}
              onClick={() => setDocFilter(key)}
            >
              {label}
              <span className="ml-0.5 text-[9px] opacity-70">
                {key === 'all' ? files.length : key === 'conclusion' ? files.filter(f => !hasTimestamp(f.filename)).length : files.filter(f => hasTimestamp(f.filename)).length}
              </span>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex-1" />
      {documentDirectory && onOpenWorkspaceDirectory && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => onOpenWorkspaceDirectory(documentDirectory)}
          title="使用工作区查看文档目录"
        >
          <span className="material-symbols-outlined text-sm mr-1">folder_open</span>
          工作区查看目录
        </Button>
      )}
      {selected.size > 0 && (
        <Button variant="destructive" size="sm" className="h-7 text-xs" onClick={() => setDeleteTarget(Array.from(selected))}>
          <span className="material-symbols-outlined text-sm mr-1">delete</span>删除 ({selected.size})
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadFiles} disabled={loading}>
        <span className="material-symbols-outlined text-sm">refresh</span>
      </Button>
      {compact && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setModalOpen(true)} title="弹出文件管理器">
          <span className="material-symbols-outlined text-sm">open_in_new</span>
        </Button>
      )}
      {!compact && fullscreen && (
        <>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleFolderTreeVisible}
            title={folderTreeVisible ? '隐藏文件夹' : '显示文件夹'}>
            <span className="material-symbols-outlined text-sm">side_navigation</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={toggleFileListVisible}
            title={fileListVisible ? '隐藏文件列表' : '显示文件列表'}>
            <span className="material-symbols-outlined text-sm">view_sidebar</span>
          </Button>
        </>
      )}
      {!compact && (
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setFullscreen(f => !f)} title={fullscreen ? '退出全屏' : '全屏'}>
          <span className="material-symbols-outlined text-sm">{fullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
        </Button>
      )}
    </div>
  );

  // --- File row ---
  const fileRow = (
    file: DocFile,
    compact: boolean,
    options?: { indent?: number; prefix?: ReactNode; muted?: boolean }
  ) => {
    const isRenaming = renamingFile === file.filename;
    const isSelected = selected.has(file.filename);
    const isActive = previewFile?.filename === file.filename;
    const rowStyle = options?.indent ? { paddingLeft: `${12 + options.indent}px` } : undefined;

    if (compact) {
      return (
        <div
          key={file.filename}
          className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/30 ${options?.muted ? 'text-muted-foreground' : ''}`}
          style={rowStyle}
          onClick={() => { setModalOpen(true); selectFile(file); }}
        >
          {options?.prefix}
          <span className={`material-symbols-outlined text-sm shrink-0 ${getDocumentIconClass(file)}`}>{getDocumentIcon(file)}</span>
          <span className="truncate flex-1" title={file.filename}>{getDisplayFileName(file)}</span>
        </div>
      );
    }

    return (
      <div
        key={file.filename}
        className={`flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer transition-colors hover:bg-muted/50 border-b border-border/30 ${isActive ? 'bg-accent' : ''}`}
        style={rowStyle}
        onClick={() => !isRenaming && selectFile(file)}
      >
        <Checkbox checked={isSelected} onCheckedChange={() => toggleSelect(file.filename)} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5" />
        {options?.prefix}
        <span className={`material-symbols-outlined text-sm shrink-0 ${getDocumentIconClass(file)}`}>{getDocumentIcon(file)}</span>
        {isRenaming ? (
          <Input
            autoFocus
            className="h-6 text-xs flex-1 min-w-0"
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleRename(file.filename); if (e.key === 'Escape') setRenamingFile(null); }}
            onBlur={() => setRenamingFile(null)}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 min-w-0" title={file.filename}>{getDisplayFileName(file)}</span>
        )}
        {file.role && (
          <Badge variant="secondary" className={`text-[9px] h-4 px-1 shrink-0 ${roleBadge[file.role] || ''}`}>
            <span className="material-symbols-outlined text-[9px] mr-0.5">{roleIcon[file.role]}</span>
            {roleLabel[file.role]}
          </Badge>
        )}
        {hasTimestamp(file.filename) && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 shrink-0 text-muted-foreground">
            {parseTimestamp(file.filename)}
          </Badge>
        )}
        <span className="text-[10px] text-muted-foreground shrink-0 w-14 text-right">{(file.size / 1024).toFixed(1)}K</span>
        <span className="text-[10px] text-muted-foreground shrink-0 w-20 text-right">{new Date(file.modifiedTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 shrink-0"><span className="material-symbols-outlined text-sm">more_vert</span></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem onClick={e => { e.stopPropagation(); setRenamingFile(file.filename); setRenameValue(file.baseName); }}>
              <span className="material-symbols-outlined text-sm mr-2">edit</span>重命名
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); downloadFile(file); }}>
              <span className="material-symbols-outlined text-sm mr-2">download</span>下载
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={e => { e.stopPropagation(); openSaveNotebookDialog(file); }}
              disabled={savingNotebookFile === file.filename}
            >
              <span className="material-symbols-outlined text-sm mr-2">save</span>保存到 Notebook…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={e => { e.stopPropagation(); setDeleteTarget([file.filename]); }}>
              <span className="material-symbols-outlined text-sm mr-2">delete</span>删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  };

  const treeChevron = (group: DocTreeGroup) => (
    <button
      type="button"
      className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
      onClick={(e) => {
        e.stopPropagation();
        toggleExpandedGroup(group.key);
      }}
      title={expandedGroups.has(group.key) ? '收起详情' : '展开详情'}
    >
      <span className="material-symbols-outlined text-[12px]">
        {expandedGroups.has(group.key) ? 'expand_more' : 'chevron_right'}
      </span>
    </button>
  );

  const renderTreeList = (compact: boolean) => {
    if (loading) {
      return <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>;
    }
    if (treeGroups.length === 0) {
      return <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>;
    }

    return (
      <>
        {!compact && (
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b border-border/30 bg-muted/20">
            <Checkbox
              checked={
                treeGroups.length > 0
                && selected.size === treeGroups.flatMap(group => group.summary ? [group.summary, ...group.details] : group.details).length
              }
              onCheckedChange={toggleSelectAll}
              className="h-3 w-3"
            />
            <span className="flex-1">总结 / 详情</span>
            <span className="w-14 text-right">大小</span>
            <span className="w-20 text-right">时间</span>
            <span className="w-5" />
          </div>
        )}
        {treeGroups.map((group) => {
          const expanded = expandedGroups.has(group.key);
          const summaryFile = group.summary;
          return (
            <div key={group.key}>
              {summaryFile ? (
                fileRow(summaryFile, compact, {
                  prefix: group.details.length > 0 ? treeChevron(group) : <span className="w-4 shrink-0" />,
                })
              ) : (
                <div
                  className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border/30 bg-muted/20"
                  style={compact ? undefined : { paddingLeft: '12px' }}
                >
                  {group.details.length > 0 ? treeChevron(group) : <span className="w-4 shrink-0" />}
                  <span className="material-symbols-outlined text-sm text-amber-600 shrink-0">topic</span>
                  <span className="flex-1 truncate font-medium">{group.name}</span>
                  {!compact && <span className="text-[10px] text-muted-foreground shrink-0">{group.details.length} 条详情</span>}
                </div>
              )}
              {expanded && group.details.map((file) => fileRow(file, compact, {
                indent: 22,
                prefix: <span className="material-symbols-outlined text-[12px] text-muted-foreground shrink-0">subdirectory_arrow_right</span>,
                muted: true,
              }))}
            </div>
          );
        })}
      </>
    );
  };

  // --- File list ---
  const fileList = (compact: boolean) => (
    <div className="flex-1 overflow-y-auto">
      {docFilter === 'all' ? renderTreeList(compact) : (
        <>
      {loading && <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>}
      {!loading && processedFiles.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
      )}
      {!loading && !compact && processedFiles.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1 text-[10px] text-muted-foreground border-b border-border/30 bg-muted/20">
          <Checkbox checked={selected.size === processedFiles.length && processedFiles.length > 0} onCheckedChange={toggleSelectAll} className="h-3 w-3" />
          <span className="flex-1 cursor-pointer" onClick={() => toggleSort('name')}>
            文件名 {sortField === 'name' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-14 text-right cursor-pointer" onClick={() => toggleSort('size')}>
            大小 {sortField === 'size' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-20 text-right cursor-pointer" onClick={() => toggleSort('time')}>
            时间 {sortField === 'time' ? (sortOrder === 'asc' ? '↑' : '↓') : ''}
          </span>
          <span className="w-5" />
        </div>
      )}
      {!loading && processedFiles.map(f => fileRow(f, compact))}
        </>
      )}
    </div>
  );

  // --- Compact embedded: show folder groups + files ---
  const compactView = () => (
    <div className="flex-1 overflow-y-auto">
      {docFilter === 'all' ? renderTreeList(true) : (
        <>
      {loading && <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>}
      {!loading && files.length === 0 && (
        <div className="text-center text-xs text-muted-foreground py-8">暂无文档</div>
      )}
      {!loading && folderGroups.map(group => (
        <div key={group.key}>
          <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/30 border-b border-border/30 sticky top-0 z-10">
            <span className="material-symbols-outlined text-xs">folder</span>
            {group.label} ({group.files.length})
          </div>
          {group.files.map(f => fileRow(f, true))}
        </div>
      ))}
        </>
      )}
    </div>
  );

  // --- Preview pane ---
  const previewPane = () => (
    <div className="flex-1 flex flex-col overflow-hidden">
      {previewFile ? (
        <>
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/20 shrink-0">
            <span className={`material-symbols-outlined text-sm ${getDocumentIconClass(previewFile)}`}>{getDocumentIcon(previewFile)}</span>
            <span className="text-xs font-medium truncate flex-1" title={previewFile.filename}>{getDisplayFileName(previewFile)}</span>
            {documentDirectory && onOpenWorkspaceDirectory && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-[11px]"
                onClick={() => onOpenWorkspaceDirectory(documentDirectory)}
                title="使用工作区查看文档目录"
              >
                <span className="material-symbols-outlined text-sm mr-1">folder_open</span>
                目录
              </Button>
            )}
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => downloadFile(previewFile)}>
              <span className="material-symbols-outlined text-sm">download</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  title="保存到Notebook"
                  disabled={savingNotebookFile === previewFile.filename}
                >
                  <span className="material-symbols-outlined text-sm">note_add</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => void saveDocToNotebook(previewFile, 'personal')}>
                  <span className="material-symbols-outlined text-sm mr-2">person</span>保存到 Notebook（个人）
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void saveDocToNotebook(previewFile, 'global')}>
                  <span className="material-symbols-outlined text-sm mr-2">groups</span>保存到 Notebook（团队）
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => { setPreviewFile(null); setPreviewContent(''); }}>
              <span className="material-symbols-outlined text-sm">close</span>
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {loadingPreview ? (
              <div className="text-center text-xs text-muted-foreground py-8">加载中...</div>
            ) : (
              <div className={styles.markdownBody}><Markdown>{previewContent}</Markdown></div>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
          <span className="material-symbols-outlined text-4xl mb-2">preview</span>
          <p className="text-xs">点击文件预览内容</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Embedded compact mode */}
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 p-2">
          <div className="flex items-center gap-1">
            {([['all', '全部'], ['conclusion', '结论'], ['detail', '详情']] as const).map(([key, label]) => (
              <Badge
                key={key}
                variant={docFilter === key ? 'default' : 'outline'}
                className={`cursor-pointer text-[10px] h-5 px-1.5 select-none transition-colors ${docFilter === key ? '' : 'hover:bg-muted'}`}
                onClick={() => setDocFilter(key)}
              >
                {label}
              </Badge>
            ))}
          </div>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadFiles} disabled={loading}>
            <span className="material-symbols-outlined text-sm">refresh</span>
          </Button>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setModalOpen(true)} title="弹出文件管理器">
            <span className="material-symbols-outlined text-sm">open_in_new</span>
          </Button>
        </div>
        {compactView()}
      </div>

      {/* Popup modal — Explorer style */}
      <Dialog open={modalOpen} onOpenChange={(open) => { setModalOpen(open); if (!open) setFullscreen(false); }}>
        <DialogContent className={`p-0 flex flex-col gap-0 ${fullscreen ? 'max-w-none w-screen h-screen rounded-none' : 'max-w-5xl w-[90vw] h-[80vh]'}`}>
          <DialogTitle className="sr-only">文件管理器</DialogTitle>
          <div className="border-b border-border">
            {toolbar(false)}
          </div>
          <div className="flex flex-1 overflow-hidden">
            {(!fullscreen || folderTreeVisible) && (
              <div
                style={fullscreen && folderTreeVisible ? { width: folderTreeWidth } : undefined}
                className={fullscreen ? 'shrink-0 flex flex-col overflow-hidden' : ''}
              >
                {folderTree()}
              </div>
            )}
            {fullscreen && folderTreeVisible && (
              <div
                className="w-1 hover:w-1.5 bg-border hover:bg-primary cursor-col-resize shrink-0 transition-colors"
                onMouseDown={e => onResizeStart('folderTree', e)}
              />
            )}
            {(!fullscreen || fileListVisible) && (
              <div
                style={fullscreen && fileListVisible ? { width: fileListWidth } : undefined}
                className={`flex flex-col overflow-hidden border-r border-border ${fullscreen ? 'shrink-0' : 'flex-1'}`}
              >
                {fileList(false)}
              </div>
            )}
            {fullscreen && fileListVisible && (
              <div
                className="w-1 hover:w-1.5 bg-border hover:bg-primary cursor-col-resize shrink-0 transition-colors"
                onMouseDown={e => onResizeStart('fileList', e)}
              />
            )}
            {previewPane()}
          </div>
        </DialogContent>
      </Dialog>

      <NotebookSaveDialog
        open={saveNotebookDialogOpen}
        onOpenChange={setSaveNotebookDialogOpen}
        scope={saveNotebookScope}
        onScopeChange={(scope) => {
          setSaveNotebookScope(scope);
          setSaveNotebookDirectory('');
          void loadNotebookDirectories(scope);
        }}
        directory={saveNotebookDirectory}
        onDirectoryChange={setSaveNotebookDirectory}
        directories={saveNotebookDirs}
        loadingDirectories={saveNotebookDirsLoading}
        saving={Boolean(saveNotebookTarget && savingNotebookFile === saveNotebookTarget.filename)}
        previewText={saveNotebookTarget
          ? `将保存：${saveNotebookDirectory ? `${saveNotebookDirectory}/` : ''}${sanitizeNotebookName(saveNotebookTarget.baseName.replace(/\.md$/i, '') || 'workflow-doc')}-YYYYMMDD-HHMMSS.cj.md`
          : '请选择文档'}
        onConfirm={async () => {
          if (!saveNotebookTarget) return;
          await saveDocToNotebook(saveNotebookTarget, saveNotebookScope, saveNotebookDirectory);
          setSaveNotebookDialogOpen(false);
        }}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        title="确认删除"
        description={deleteTarget?.length === 1 ? `确定要删除 "${deleteTarget[0]}" 吗？` : `确定要删除选中的 ${deleteTarget?.length || 0} 个文件吗？`}
        confirmLabel="删除"
        variant="destructive"
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </>
  );
}
