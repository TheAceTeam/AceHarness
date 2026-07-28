'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from '@/lib/navigation/client';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import AuthGuard from '@/components/AuthGuard';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import UserMenu from '@/components/UserMenu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import {
  DataCard,
  DataCardDescription,
  DataCardHeader,
  DataCardMeta,
  DataCardTitle,
} from '@/components/ui/data-card';
import { DataTable } from '@/components/ui/data-table';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { cn } from '@/lib/core/utils';
import type { RagDatabaseStats, RagDocument, RagImportJob, RagKnowledgeBase, RagTableSchema, RagVectorChunk } from '@/lib/rag/types';
import {
  useCreateRagKnowledgeBaseMutation,
  useDeleteRagDocumentMutation,
  useDeleteRagKnowledgeBaseMutation,
  useDeleteRagRowsMutation,
  useImportRagBundleMutation,
  useImportRagSampleMutation,
  useImportRagTextMutation,
  useRagApiDebuggerMutation,
  useRagDetailQuery,
  useRagKnowledgeBasesQuery,
  useSearchRagMutation,
} from '@/client/query/rag';
import {
  useRagChunkRows,
  useRagDocumentRows,
  useRagKnowledgeBaseRows,
  useSyncRagDetailRowsToDb,
  useSyncRagKnowledgeBasesToDb,
} from '@/client/db/collections';
import type { KnowledgeLibrarySearch } from '@/routes/knowledge.library';

type RagDetail = {
  documents: RagDocument[];
  chunks: RagVectorChunk[];
  importJobs: RagImportJob[];
  stats: RagDatabaseStats | null;
  schema: RagTableSchema | null;
};

type SearchResult = RagVectorChunk;
type KnowledgeConfirmAction =
  | { type: 'delete-kb'; knowledgeBase: RagKnowledgeBase }
  | { type: 'delete-source'; document: RagDocument }
  | { type: 'delete-selected-rows' }
  | { type: 'empty-collection' }
  | null;
const SOURCE_PAGE_SIZE = 8;
const VECTOR_PAGE_SIZE = 6;

interface KnowledgeLibraryPageProps {
  routeSearch?: KnowledgeLibrarySearch;
  onRouteSearchChange?: (next: KnowledgeLibrarySearch) => void;
}

function formatTime(value: number) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function KnowledgePageContent({ routeSearch, onRouteSearchChange }: KnowledgeLibraryPageProps = {}) {
  const { toast } = useToast();
  useDocumentTitle('知识库');
  const { isDashboardShell } = useDashboardShellHeader({
    title: '知识库',
    subtitle: 'CSIHarness 原生 LanceDB RAG 数据库，管理来源、向量行和检索验证。',
  }, []);

  const [activeKbId, setActiveKbId] = useState(routeSearch?.kb || '');
  const [detail, setDetail] = useState<RagDetail>({ documents: [], chunks: [], importJobs: [], stats: null, schema: null });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState(routeSearch?.document || '');
  const [previewChunk, setPreviewChunk] = useState<RagVectorChunk | null>(null);
  const [sourcePage, setSourcePage] = useState(0);
  const [vectorPage, setVectorPage] = useState(0);
  const [dataQuery, setDataQuery] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [apiMethod, setApiMethod] = useState('GET');
  const [apiPath, setApiPath] = useState('/api/rag/v1/collections');
  const [apiBody, setApiBody] = useState(JSON.stringify({ query: 'vector database RAG', topK: 8 }, null, 2));
  const [apiResponse, setApiResponse] = useState('{\n  "status": "ready"\n}');
  const [selectedSchemaFieldName, setSelectedSchemaFieldName] = useState('vector');
  const [showCreateKbForm, setShowCreateKbForm] = useState(false);
  const [newKbName, setNewKbName] = useState('');
  const [newKbDescription, setNewKbDescription] = useState('');
  const [showTextImportForm, setShowTextImportForm] = useState(false);
  const [textImportTitle, setTextImportTitle] = useState('');
  const [textImportContent, setTextImportContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('RAG 知识库如何导入外部系统');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [confirmAction, setConfirmAction] = useState<KnowledgeConfirmAction>(null);
  const knowledgeBasesQuery = useRagKnowledgeBasesQuery();
  const ragDetailQuery = useRagDetailQuery(activeKbId || knowledgeBasesQuery.data?.knowledgeBases?.[0]?.id, 500);
  const createKnowledgeBaseMutation = useCreateRagKnowledgeBaseMutation();
  const deleteKnowledgeBaseMutation = useDeleteRagKnowledgeBaseMutation();
  const importBundleMutation = useImportRagBundleMutation();
  const importTextMutation = useImportRagTextMutation();
  const deleteDocumentMutation = useDeleteRagDocumentMutation();
  const importSampleMutation = useImportRagSampleMutation();
  const deleteRowsMutation = useDeleteRagRowsMutation();
  const searchRagMutation = useSearchRagMutation();
  const ragApiDebuggerMutation = useRagApiDebuggerMutation();
  useSyncRagKnowledgeBasesToDb(knowledgeBasesQuery.data?.knowledgeBases || []);
  const knowledgeBases = useRagKnowledgeBaseRows() as RagKnowledgeBase[];

  const activeKb = useMemo(
    () => knowledgeBases.find((item) => item.id === activeKbId) || knowledgeBases[0] || null,
    [activeKbId, knowledgeBases]
  );
  useSyncRagDetailRowsToDb(activeKb?.id, ragDetailQuery.data);
  const detailDocuments = useRagDocumentRows(activeKb?.id) as RagDocument[];
  const selectedDocument = useMemo(
    () => detailDocuments.find((item) => item.id === selectedDocumentId) || detailDocuments[0] || null,
    [detailDocuments, selectedDocumentId]
  );
  const selectedChunks = useRagChunkRows({
    knowledgeBaseId: activeKb?.id,
    documentId: selectedDocument?.id,
  }) as RagVectorChunk[];
  const dataRows = useRagChunkRows({
    knowledgeBaseId: activeKb?.id,
    documentId: selectedDocument?.id,
    keyword: dataQuery,
  }) as RagVectorChunk[];
  const selectedSchemaField = useMemo(
    () => (detail.schema?.fields || []).find((field) => field.name === selectedSchemaFieldName) || detail.schema?.fields?.[0] || null,
    [detail.schema?.fields, selectedSchemaFieldName]
  );
  const sourcePageCount = Math.max(1, Math.ceil(detailDocuments.length / SOURCE_PAGE_SIZE));
  const vectorPageCount = Math.max(1, Math.ceil(dataRows.length / VECTOR_PAGE_SIZE));
  const pagedDocuments = useMemo(
    () => detailDocuments.slice(sourcePage * SOURCE_PAGE_SIZE, sourcePage * SOURCE_PAGE_SIZE + SOURCE_PAGE_SIZE),
    [detailDocuments, sourcePage]
  );
  const pagedSelectedChunks = useMemo(
    () => dataRows.slice(vectorPage * VECTOR_PAGE_SIZE, vectorPage * VECTOR_PAGE_SIZE + VECTOR_PAGE_SIZE),
    [dataRows, vectorPage]
  );

  useEffect(() => {
    setLoading(knowledgeBasesQuery.isLoading);
    if (knowledgeBasesQuery.data?.knowledgeBases) {
      setActiveKbId((prev) => prev || routeSearch?.kb || knowledgeBasesQuery.data.knowledgeBases[0]?.id || '');
    }
    if (knowledgeBasesQuery.isError) {
      toast('error', knowledgeBasesQuery.error?.message || '读取知识库失败');
    }
  }, [knowledgeBasesQuery.data?.knowledgeBases, knowledgeBasesQuery.error, knowledgeBasesQuery.isError, knowledgeBasesQuery.isLoading, routeSearch?.kb, toast]);

  useEffect(() => {
    if (routeSearch?.kb && routeSearch.kb !== activeKbId) {
      setActiveKbId(routeSearch.kb);
    }
  }, [activeKbId, routeSearch?.kb]);

  useEffect(() => {
    if (routeSearch?.document && routeSearch.document !== selectedDocumentId) {
      setSelectedDocumentId(routeSearch.document);
    }
  }, [routeSearch?.document, selectedDocumentId]);

  useEffect(() => {
    setDetailLoading(ragDetailQuery.isFetching);
    if (!activeKb?.id) {
      setDetail({ documents: [], chunks: [], importJobs: [], stats: null, schema: null });
      return;
    }
    if (ragDetailQuery.data) {
      setDetail(ragDetailQuery.data);
    }
    if (ragDetailQuery.isError) {
      toast('error', ragDetailQuery.error?.message || '读取知识库详情失败');
    }
    setSearchResults([]);
    setSelectedDocumentId(routeSearch?.document || '');
    setSourcePage(0);
    setVectorPage(0);
  }, [activeKb?.id, ragDetailQuery.data, ragDetailQuery.error, ragDetailQuery.isError, ragDetailQuery.isFetching, routeSearch?.document, toast]);

  useEffect(() => {
    if (selectedDocumentId && detailDocuments.some((item) => item.id === selectedDocumentId)) return;
    setSelectedDocumentId(detailDocuments[0]?.id || '');
  }, [detailDocuments, selectedDocumentId]);

  useEffect(() => {
    setVectorPage(0);
    setSelectedRowIds([]);
  }, [selectedDocumentId]);

  const selectKnowledgeBase = useCallback((id: string) => {
    setActiveKbId(id);
    setSelectedDocumentId('');
    onRouteSearchChange?.({ kb: id, document: undefined });
  }, [onRouteSearchChange]);

  const selectDocument = useCallback((id: string) => {
    setSelectedDocumentId(id);
    onRouteSearchChange?.({ kb: activeKb?.id, document: id });
  }, [activeKb?.id, onRouteSearchChange]);

  const createKnowledgeBase = async () => {
    const name = newKbName.trim();
    const description = newKbDescription.trim();
    if (!name) {
      toast('error', '请填写知识库名称');
      return;
    }
    try {
      const data = await createKnowledgeBaseMutation.mutateAsync({ name, description });
      await knowledgeBasesQuery.refetch();
      setActiveKbId(data.knowledgeBase.id);
      setSelectedDocumentId('');
      onRouteSearchChange?.({ kb: data.knowledgeBase.id, document: undefined });
      setNewKbName('');
      setNewKbDescription('');
      setShowCreateKbForm(false);
      toast('success', '知识库已创建');
    } catch (error: any) {
      toast('error', error?.message || '创建知识库失败');
    }
  };

  useEffect(() => {
    setSelectedRowIds((prev) => prev.filter((id) => dataRows.some((row) => row.id === id)));
  }, [dataRows]);

  useEffect(() => {
    if (sourcePage < sourcePageCount) return;
    setSourcePage(Math.max(0, sourcePageCount - 1));
  }, [sourcePage, sourcePageCount]);

  useEffect(() => {
    if (vectorPage < vectorPageCount) return;
    setVectorPage(Math.max(0, vectorPageCount - 1));
  }, [vectorPage, vectorPageCount]);

  const deleteKnowledgeBase = async (id: string) => {
    if (!id) return;
    try {
      await deleteKnowledgeBaseMutation.mutateAsync(id);
      if (activeKbId === id) {
        setActiveKbId('');
        onRouteSearchChange?.({ kb: undefined, document: undefined });
      }
      toast('success', '知识库已删除');
    } catch (error: any) {
      toast('error', error?.message || '删除知识库失败');
    }
  };

  const importBundle = async (bundle: unknown) => {
    if (!activeKb) return;
    setImporting(true);
    try {
      await importBundleMutation.mutateAsync({ knowledgeBaseId: activeKb.id, bundle });
      await Promise.all([knowledgeBasesQuery.refetch(), ragDetailQuery.refetch()]);
      toast('success', '导入完成');
    } catch (error: any) {
      toast('error', error?.message || '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const importRagFile = async (file: File) => {
    const text = await file.text();
    const bundle = JSON.parse(text);
    await importBundle(bundle);
  };

  const importText = async () => {
    if (!activeKb) return;
    const title = textImportTitle.trim();
    const content = textImportContent.trim();
    if (!title || !content) {
      toast('error', '请填写文本标题和正文');
      return;
    }
    setImporting(true);
    try {
      await importTextMutation.mutateAsync({ knowledgeBaseId: activeKb.id, title, content });
      await Promise.all([knowledgeBasesQuery.refetch(), ragDetailQuery.refetch()]);
      setTextImportTitle('');
      setTextImportContent('');
      setShowTextImportForm(false);
      toast('success', '文本已导入');
    } catch (error: any) {
      toast('error', error?.message || '文本导入失败');
    } finally {
      setImporting(false);
    }
  };

  const deleteSource = async (document: RagDocument) => {
    if (!activeKb) return;
    try {
      await deleteDocumentMutation.mutateAsync({ knowledgeBaseId: activeKb.id, documentId: document.id });
      await Promise.all([knowledgeBasesQuery.refetch(), ragDetailQuery.refetch()]);
      setSelectedDocumentId('');
      onRouteSearchChange?.({ kb: activeKb.id, document: undefined });
      toast('success', '来源已删除');
    } catch (error: any) {
      toast('error', error?.message || '删除来源失败');
    }
  };

  const insertSampleData = async () => {
    if (!activeKb) return;
    setImporting(true);
    try {
      await importSampleMutation.mutateAsync(activeKb.id);
      await Promise.all([knowledgeBasesQuery.refetch(), ragDetailQuery.refetch()]);
      toast('success', '示例数据已写入');
    } catch (error: any) {
      toast('error', error?.message || '写入示例数据失败');
    } finally {
      setImporting(false);
    }
  };

  const emptyCollection = async () => {
    if (!activeKb) return;
    try {
      await deleteRowsMutation.mutateAsync({ knowledgeBaseId: activeKb.id, all: true });
      await Promise.all([knowledgeBasesQuery.refetch(), ragDetailQuery.refetch()]);
      setSelectedRowIds([]);
      toast('success', 'collection 已清空');
    } catch (error: any) {
      toast('error', error?.message || '清空失败');
    }
  };

  const deleteSelectedRows = async () => {
    if (!activeKb || selectedRowIds.length === 0) return;
    try {
      await deleteRowsMutation.mutateAsync({ knowledgeBaseId: activeKb.id, rowIds: selectedRowIds });
      await Promise.all([knowledgeBasesQuery.refetch(), ragDetailQuery.refetch()]);
      setSelectedRowIds([]);
      toast('success', '已删除选中向量行');
    } catch (error: any) {
      toast('error', error?.message || '删除向量行失败');
    }
  };

  const searchKnowledgeBase = async () => {
    if (!activeKb) return;
    setSearching(true);
    try {
      const data = await searchRagMutation.mutateAsync({ knowledgeBaseId: activeKb.id, query, topK: 8 });
      setSearchResults(data.results);
    } catch (error: any) {
      toast('error', error?.message || '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const selectedRows = selectedRowIds.length > 0
    ? dataRows.filter((row) => selectedRowIds.includes(row.id))
    : dataRows;

  const copyRowsAsJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(selectedRows, null, 2));
    toast('success', selectedRowIds.length > 0 ? '已复制选中向量行' : '已复制当前数据集');
  };

  const exportRowsAsJson = () => {
    const blob = new Blob([JSON.stringify(selectedRows, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${activeKb?.tableName || 'rag'}-rows.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runApiRequest = async () => {
    try {
      const data = await ragApiDebuggerMutation.mutateAsync({
        method: apiMethod,
        path: apiPath,
        bodyText: apiBody,
      });
      setApiResponse(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
    } catch (error: any) {
      setApiResponse(error?.message || '请求失败');
    }
  };

  const runConfirmAction = async () => {
    if (!confirmAction) return;
    if (confirmAction.type === 'delete-kb') {
      await deleteKnowledgeBase(confirmAction.knowledgeBase.id);
    } else if (confirmAction.type === 'delete-source') {
      await deleteSource(confirmAction.document);
    } else if (confirmAction.type === 'delete-selected-rows') {
      await deleteSelectedRows();
    } else if (confirmAction.type === 'empty-collection') {
      await emptyCollection();
    }
    setConfirmAction(null);
  };

  const confirmObjectName =
    confirmAction?.type === 'delete-kb'
      ? confirmAction.knowledgeBase.name
      : confirmAction?.type === 'delete-source'
        ? confirmAction.document.title
        : confirmAction?.type === 'delete-selected-rows'
          ? `${selectedRowIds.length} selected rows`
          : activeKb?.name;

  const confirmConsequence =
    confirmAction?.type === 'delete-kb'
      ? 'This removes the knowledge base and its RAG collection from the library. This action cannot be undone.'
      : confirmAction?.type === 'delete-source'
        ? 'This removes the source document and its vector rows from the current collection.'
        : confirmAction?.type === 'delete-selected-rows'
          ? 'This deletes the selected vector rows from the current collection.'
          : 'This deletes every vector row in the current collection while keeping the collection itself.';

  const confirmLabel =
    confirmAction?.type === 'empty-collection'
      ? 'Empty collection'
      : confirmAction?.type === 'delete-selected-rows'
        ? 'Delete rows'
        : 'Delete';

  const confirmLoading = deleteKnowledgeBaseMutation.isPending || deleteDocumentMutation.isPending || deleteRowsMutation.isPending;

  return (
    <div className={cn('bg-background text-foreground', isDashboardShell ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'min-h-screen')}>
      {!isDashboardShell ? (
        <header className="shrink-0 border-b">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
            <div className="flex items-center gap-4">
              <Link href="/dashboard" className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent">
                <ArrowLeft className="h-4 w-4" />
                返回
              </Link>
              <div>
                <h1 className="text-2xl font-semibold">知识库</h1>
                <p className="mt-1 text-sm text-muted-foreground">CSIHarness 原生 LanceDB RAG 数据库，管理来源、向量行和检索验证。</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <LanguageToggle />
              <ThemeToggle />
              <UserMenu />
            </div>
          </div>
        </header>
      ) : null}

      <main className={cn('mx-auto grid w-full max-w-7xl min-h-0 flex-1 gap-4 px-4 py-4 lg:grid-cols-[19rem_minmax(0,1fr)]', !isDashboardShell && 'px-6 py-6')}>
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          <PageHeader
            className="px-4 py-3"
            title="KB 集合"
            subtitle="LanceDB 向量数据库"
            status={<StatusPill tone={loading ? 'info' : 'neutral'}>{knowledgeBases.length} 个</StatusPill>}
            primaryAction={(
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setShowCreateKbForm((prev) => !prev)} disabled={createKnowledgeBaseMutation.isPending}>
                  {createKnowledgeBaseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  新建
                </Button>
                <Button size="sm" variant="outline" onClick={() => void knowledgeBasesQuery.refetch()} disabled={loading} aria-label="刷新知识库集合">
                  <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
                </Button>
              </div>
            )}
          />

          {showCreateKbForm ? (
            <div className="border-b bg-background/70 p-3">
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <label htmlFor="new-kb-name" className="text-xs font-medium text-muted-foreground">名称</label>
                  <Input
                    id="new-kb-name"
                    value={newKbName}
                    onChange={(event) => setNewKbName(event.target.value)}
                    placeholder="例如：产品资料库"
                  />
                </div>
                <div className="grid gap-1.5">
                  <label htmlFor="new-kb-description" className="text-xs font-medium text-muted-foreground">描述</label>
                  <Textarea
                    id="new-kb-description"
                    value={newKbDescription}
                    onChange={(event) => setNewKbDescription(event.target.value)}
                    placeholder="用于说明这个知识库的内容范围"
                    className="min-h-[84px] resize-none"
                  />
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowCreateKbForm(false)} disabled={createKnowledgeBaseMutation.isPending}>
                    取消
                  </Button>
                  <Button size="sm" onClick={createKnowledgeBase} disabled={createKnowledgeBaseMutation.isPending || !newKbName.trim()}>
                    {createKnowledgeBaseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    创建
                  </Button>
                </div>
              </div>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {knowledgeBases.map((kb) => (
              <button
                key={kb.id}
                onClick={() => selectKnowledgeBase(kb.id)}
                className={cn(
                  'mb-2 w-full rounded-lg border bg-card p-3 text-left transition-colors hover:border-muted-foreground/35 hover:bg-muted/20',
                  activeKb?.id === kb.id && 'border-primary/40 ring-1 ring-primary/25'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium">{kb.name}</div>
                  <StatusPill tone={kb.indexStatus === 'ready' ? 'success' : 'warning'} className="shrink-0 py-0.5 text-[10px]">
                    {kb.indexStatus}
                  </StatusPill>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <span>{kb.documentCount} 来源</span>
                  <span>{kb.chunkCount} 向量行</span>
                </div>
              </button>
            ))}
            {!loading && knowledgeBases.length === 0 ? (
              <EmptyState
                className="min-h-[180px]"
                icon={<Database className="h-5 w-5" />}
                title="正在初始化默认知识库"
                description="默认 RAG 数据库会自动创建。"
              />
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          {activeKb ? (
            <>
              <PageHeader
                title={activeKb.name}
                subtitle={activeKb.description || '可添加描述'}
                leading={<BookOpen className="h-5 w-5 text-primary" />}
                status={<StatusPill tone={activeKb.indexStatus === 'ready' ? 'success' : 'warning'}>{activeKb.indexStatus}</StatusPill>}
                secondaryActions={(
                  <Button size="sm" variant="outline" onClick={() => void ragDetailQuery.refetch()} disabled={detailLoading}>
                    <RefreshCw className={cn('h-4 w-4', detailLoading && 'animate-spin')} />
                    刷新
                  </Button>
                )}
                primaryAction={(
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowTextImportForm((prev) => !prev)} disabled={importing}>
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                      粘贴文本
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      导入文件
                    </Button>
                  </div>
                )}
                overflowActions={activeKb.id !== 'default' ? (
                  <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmAction({ type: 'delete-kb', knowledgeBase: activeKb })}>
                    <Trash2 className="h-4 w-4" />
                    删除
                  </Button>
                ) : null}
              >
                <div className="mt-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">DB URI</span>
                  <span className="ml-2 break-all">{detail.stats?.databaseUri || activeKb.databaseUri}</span>
                  {detail.stats?.tableVersion ? <span className="ml-3">v{detail.stats.tableVersion}</span> : null}
                </div>
              </PageHeader>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="grid gap-4">
                  <div className="space-y-4">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        void importRagFile(file).catch((error: any) => {
                          toast('error', error?.message || '导入文件失败');
                        });
                      }}
                    />
                    {showTextImportForm ? (
                      <div className="rounded-lg border bg-background p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">粘贴文本导入</div>
                            <div className="mt-1 text-xs text-muted-foreground">把单篇文本写入当前知识库，系统会生成来源和向量行。</div>
                          </div>
                          <StatusPill tone="neutral" dot={false}>text</StatusPill>
                        </div>
                        <div className="grid gap-3">
                          <div className="grid gap-1.5">
                            <label htmlFor="text-import-title" className="text-xs font-medium text-muted-foreground">标题</label>
                            <Input
                              id="text-import-title"
                              value={textImportTitle}
                              onChange={(event) => setTextImportTitle(event.target.value)}
                              placeholder="例如：产品 FAQ"
                            />
                          </div>
                          <div className="grid gap-1.5">
                            <label htmlFor="text-import-content" className="text-xs font-medium text-muted-foreground">正文</label>
                            <Textarea
                              id="text-import-content"
                              value={textImportContent}
                              onChange={(event) => setTextImportContent(event.target.value)}
                              placeholder="粘贴需要进入 RAG 检索的纯文本内容"
                              className="min-h-[180px]"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setShowTextImportForm(false)} disabled={importing}>
                              取消
                            </Button>
                            <Button size="sm" onClick={importText} disabled={importing || !textImportTitle.trim() || !textImportContent.trim()}>
                              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                              导入文本
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <Tabs defaultValue="overview" className="rounded-lg border bg-background">
                      <div className="flex items-center justify-between gap-3 border-b px-4 pt-3">
                        <TabsList variant="line">
                          <TabsTrigger value="overview">Overview</TabsTrigger>
                          <TabsTrigger value="schema">Schema</TabsTrigger>
                          <TabsTrigger value="data">Data</TabsTrigger>
                          <TabsTrigger value="sources">来源管理</TabsTrigger>
                          <TabsTrigger value="search">Vector Search</TabsTrigger>
                          <TabsTrigger value="jobs">导入任务</TabsTrigger>
                          <TabsTrigger value="api">API</TabsTrigger>
                        </TabsList>
                      </div>

                      <TabsContent value="overview" className="m-0">
                        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
                          <DataCard>
                            <DataCardTitle>来源</DataCardTitle>
                            <DataCardDescription className="text-2xl font-semibold text-foreground">{activeKb.documentCount}</DataCardDescription>
                            <DataCardMeta>documents</DataCardMeta>
                          </DataCard>
                          <DataCard>
                            <DataCardTitle>向量行</DataCardTitle>
                            <DataCardDescription className="text-2xl font-semibold text-foreground">{activeKb.chunkCount}</DataCardDescription>
                            <DataCardMeta>chunks</DataCardMeta>
                          </DataCard>
                          <DataCard>
                            <DataCardHeader>
                              <DataCardTitle>Embedding</DataCardTitle>
                              <StatusPill tone="neutral" dot={false}>{activeKb.embeddingDimension}d</StatusPill>
                            </DataCardHeader>
                            <DataCardDescription className="truncate">{activeKb.embeddingModel}</DataCardDescription>
                            <DataCardMeta>{activeKb.embeddingProvider}</DataCardMeta>
                          </DataCard>
                          <DataCard>
                            <DataCardTitle>LanceDB</DataCardTitle>
                            <DataCardDescription className="truncate">{detail.stats?.tableName || activeKb.tableName}</DataCardDescription>
                            <DataCardMeta>{detail.stats?.rowCount ?? activeKb.chunkCount} rows</DataCardMeta>
                          </DataCard>
                        </div>
                        <div className="border-t px-4 py-3 text-xs text-muted-foreground">
                          <div className="mb-3 text-sm font-semibold text-foreground">导入帮助</div>
                          <div className="grid gap-3 text-sm md:grid-cols-3">
                            <div className="rounded-md border bg-card p-3">
                              <div className="flex items-center gap-2 font-medium text-foreground">
                                <Upload className="h-4 w-4 text-muted-foreground" />
                                JSON bundle 文件
                              </div>
                              <p className="mt-2 leading-6">选择 JSON bundle 文件导入，系统会解析来源内容并重新生成向量行。</p>
                              <Button size="sm" variant="outline" className="mt-3" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                                导入 JSON
                              </Button>
                            </div>
                            <div className="rounded-md border bg-card p-3">
                              <div className="flex items-center gap-2 font-medium text-foreground">
                                <FileText className="h-4 w-4 text-muted-foreground" />
                                纯文本粘贴导入
                              </div>
                              <p className="mt-2 leading-6">填写标题并粘贴正文，内容会以 text 来源进入当前知识库。</p>
                              <Button size="sm" variant="outline" className="mt-3" onClick={() => setShowTextImportForm(true)} disabled={importing}>
                                粘贴文本
                              </Button>
                            </div>
                            <div className="rounded-md border bg-card p-3">
                              <div className="flex items-center gap-2 font-medium text-foreground">
                                <Database className="h-4 w-4 text-muted-foreground" />
                                示例数据
                              </div>
                              <p className="mt-2 leading-6">一键写入内置示例，适合快速查看来源、向量行和检索效果。</p>
                              <Button size="sm" variant="outline" className="mt-3" onClick={insertSampleData} disabled={importing}>
                                写入示例
                              </Button>
                            </div>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="schema" className="m-0">
                        <div className="border-b px-4 py-3">
                          <div className="flex items-center gap-2 text-sm font-medium">
                            <Database className="h-4 w-4 text-muted-foreground" />
                            {detail.schema?.tableName || activeKb.tableName}
                            <Badge variant="outline">{activeKb.indexStatus}</Badge>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
                            <span>rows {detail.stats?.rowCount ?? activeKb.chunkCount}</span>
                            <span>metric {activeKb.metric}</span>
                            <span>{activeKb.embeddingModel} / {activeKb.embeddingDimension}d</span>
                          </div>
                        </div>
                        <div className="grid lg:grid-cols-[minmax(0,1fr)_320px]">
                          <DataTable
                            rows={detail.schema?.fields || []}
                            rowKey="name"
                            density="compact"
                            onRowClick={(field) => setSelectedSchemaFieldName(field.name)}
                            columns={[
                              { id: 'field', header: 'Field', render: (field) => <span className="font-medium">{field.name}</span> },
                              { id: 'type', header: 'Type', width: 150, render: (field) => <Badge variant="outline">{field.type}</Badge> },
                              { id: 'index', header: 'Index', width: 100, render: (field) => field.indexed ? <Badge>Indexed</Badge> : <Badge variant="outline">None</Badge> },
                              { id: 'description', header: 'Description', render: (field) => <span className="text-muted-foreground">{field.description || '-'}</span> },
                            ]}
                            emptyState={{ title: 'No schema fields', description: 'Schema metadata is not available for this collection.' }}
                          />
                          <aside className="border-l p-4">
                            <div className="text-sm font-semibold">Properties</div>
                            {selectedSchemaField ? (
                              <div className="mt-4 space-y-4">
                                <div className="rounded-md border p-3">
                                  <div className="text-xs text-muted-foreground">Field</div>
                                  <div className="mt-1 font-medium">{selectedSchemaField.name}</div>
                                </div>
                                <div className="rounded-md border p-3">
                                  <div className="text-xs text-muted-foreground">Data Type</div>
                                  <div className="mt-1 font-medium">{selectedSchemaField.type}</div>
                                </div>
                                <div className="rounded-md border p-3">
                                  <div className="text-xs text-muted-foreground">Index</div>
                                  <div className="mt-1">{selectedSchemaField.indexed ? <Badge>Enabled</Badge> : <Badge variant="outline">No Index</Badge>}</div>
                                </div>
                                <div className="rounded-md border p-3">
                                  <div className="text-xs text-muted-foreground">Description</div>
                                  <div className="mt-1 text-sm leading-6">{selectedSchemaField.description || '-'}</div>
                                </div>
                              </div>
                            ) : null}
                            <div className="mt-6 border-t pt-4">
                              <div className="mb-2 text-sm font-semibold">Actions</div>
                              <div className="grid gap-2">
                                <Button variant="outline" className="justify-start" onClick={() => void ragDetailQuery.refetch()}>
                                  <RefreshCw className="h-4 w-4" />
                                  Refresh
                                </Button>
                                <Button variant="outline" className="justify-start" onClick={exportRowsAsJson} disabled={selectedChunks.length === 0}>
                                  <Download className="h-4 w-4" />
                                  Download Data
                                </Button>
                                <Button variant="outline" className="justify-start text-destructive hover:text-destructive" onClick={() => setConfirmAction({ type: 'empty-collection' })} disabled={activeKb.chunkCount === 0}>
                                  <Trash2 className="h-4 w-4" />
                                  Empty Collection
                                </Button>
                              </div>
                            </div>
                          </aside>
                        </div>
                      </TabsContent>

                      <TabsContent value="sources" className="m-0">
                        <PageToolbar
                          search={<div className="text-sm font-medium">来源管理</div>}
                          refresh={(
                            <Button size="sm" variant="outline" onClick={() => void ragDetailQuery.refetch()} disabled={detailLoading}>
                              <RefreshCw className={cn('h-4 w-4', detailLoading && 'animate-spin')} />
                              刷新
                            </Button>
                          )}
                          actions={(
                            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              导入文件
                            </Button>
                          )}
                        />
                        <DataTable
                          rows={pagedDocuments}
                          rowKey="id"
                          density="compact"
                          onRowClick={(document) => selectDocument(document.id)}
                          columns={[
                            {
                              id: 'source',
                              header: '来源',
                              render: (document) => (
                                <div className="max-w-[260px] text-left">
                                  <div className="truncate font-medium">{document.title}</div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">{document.externalId || document.id}</div>
                                </div>
                              ),
                            },
                            { id: 'system', header: '系统', width: 130, render: (document) => <Badge variant="outline" className="max-w-[120px] truncate">{document.sourceSystem || document.sourceType}</Badge> },
                            { id: 'rows', header: '向量行', width: 90, accessor: 'chunkCount' },
                            { id: 'created', header: '导入时间', width: 150, render: (document) => <span className="text-xs text-muted-foreground">{formatTime(document.createdAt)}</span> },
                          ]}
                          rowActions={(document) => [
                            {
                              actions: [
                                { id: 'select', label: '查看来源', icon: <Eye className="h-4 w-4" />, primary: true, onSelect: () => selectDocument(document.id) },
                                { id: 'delete', label: '删除来源', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setConfirmAction({ type: 'delete-source', document }) },
                              ],
                            },
                          ]}
                          pagination={{
                            page: sourcePage + 1,
                            pageSize: SOURCE_PAGE_SIZE,
                            total: detailDocuments.length,
                            onPageChange: (page) => setSourcePage(page - 1),
                          }}
                          emptyState={{ title: '暂无来源', description: '导入 JSON bundle 或写入示例数据后会显示来源。' }}
                        />
                      </TabsContent>

                      <TabsContent value="data" className="m-0">
                        <PageToolbar
                          search={<Input value={dataQuery} onChange={(event) => setDataQuery(event.target.value)} placeholder="Filter text/source/metadata, e.g. lancedb" />}
                          refresh={(
                            <Button size="sm" variant="outline" onClick={() => { setDataQuery(''); setVectorPage(0); }}>
                              <RefreshCw className="h-4 w-4" />
                              Reset
                            </Button>
                          )}
                          actions={(
                            <>
                              <Button size="sm" variant="outline" onClick={() => setVectorPage(0)}>
                                <Search className="h-4 w-4" />
                                Query
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                Import File
                              </Button>
                              <Button size="sm" variant="outline" onClick={insertSampleData} disabled={importing}>
                                Insert Sample Data
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmAction({ type: 'empty-collection' })} disabled={activeKb.chunkCount === 0}>
                                Empty
                              </Button>
                              <Button size="sm" variant="outline" onClick={copyRowsAsJson} disabled={dataRows.length === 0}>
                                <Copy className="h-4 w-4" />
                                Copy JSON
                              </Button>
                              <Button size="sm" variant="outline" onClick={exportRowsAsJson} disabled={dataRows.length === 0}>
                                <Download className="h-4 w-4" />
                                Export
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => selectedDocument && setConfirmAction({ type: 'delete-source', document: selectedDocument })} disabled={!selectedDocument}>
                                <Trash2 className="h-4 w-4" />
                                Delete Source
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setConfirmAction({ type: 'delete-selected-rows' })} disabled={selectedRowIds.length === 0}>
                                Delete ({selectedRowIds.length})
                              </Button>
                            </>
                          )}
                          activeFilters={(
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                              {selectedDocument ? <StatusPill tone="neutral" dot={false}>{selectedDocument.sourceSystem || selectedDocument.sourceType}</StatusPill> : null}
                              {selectedDocument?.externalId ? <StatusPill tone="neutral" dot={false}>{selectedDocument.externalId}</StatusPill> : null}
                              <StatusPill tone="neutral" dot={false}>{dataRows.length} / {selectedChunks.length} 向量行</StatusPill>
                            </div>
                          )}
                        />
                        <DataTable
                          rows={pagedSelectedChunks}
                          rowKey="id"
                          density="compact"
                          selection={{
                            selectedKeys: selectedRowIds,
                            onSelectedKeysChange: (keys) => setSelectedRowIds(keys.map(String)),
                            ariaLabel: 'Select vector rows',
                          }}
                          onRowClick={(chunk) => setPreviewChunk(chunk)}
                          columns={[
                            { id: 'row', header: 'Row', width: 80, render: (chunk) => `#${chunk.chunkIndex + 1}` },
                            {
                              id: 'text',
                              header: 'Text',
                              render: (chunk) => (
                                <div>
                                  <div className="line-clamp-2 max-w-[360px] text-sm leading-5">{chunk.text}</div>
                                  {chunk.externalId ? <div className="mt-1 truncate text-xs text-muted-foreground">{chunk.externalId}</div> : null}
                                </div>
                              ),
                            },
                            { id: 'embedding', header: 'Embedding', width: 130, render: (chunk) => <span className="text-xs text-muted-foreground">{chunk.embeddingModel}<br />{chunk.embeddingDimension}d</span> },
                            { id: 'tokens', header: 'Tokens', width: 100, accessor: 'tokenCount' },
                          ]}
                          rowActions={(chunk) => [
                            { actions: [{ id: 'preview', label: '查看向量行', icon: <Eye className="h-4 w-4" />, primary: true, onSelect: () => setPreviewChunk(chunk) }] },
                          ]}
                          pagination={{
                            page: vectorPage + 1,
                            pageSize: VECTOR_PAGE_SIZE,
                            total: dataRows.length,
                            onPageChange: (page) => setVectorPage(page - 1),
                          }}
                          emptyState={{ title: '暂无向量行', description: '当前来源或过滤条件没有匹配的向量行。' }}
                        />
                      </TabsContent>

                      <TabsContent value="search" className="m-0">
                        <PageToolbar
                          search={<Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 vectorSearch 查询" />}
                          actions={(
                            <Button size="sm" variant="outline" onClick={searchKnowledgeBase} disabled={searching}>
                              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                              Query
                            </Button>
                          )}
                        />
                        <DataTable
                          rows={searchResults}
                          rowKey="id"
                          density="compact"
                          onRowClick={(result) => setPreviewChunk(result)}
                          columns={[
                            {
                              id: 'source',
                              header: 'Source',
                              width: 220,
                              render: (result) => (
                                <div className="max-w-[220px]">
                                  <div className="truncate font-medium">{result.sourceTitle || result.documentId}</div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">{result.sourceSystem || result.sourceType}</div>
                                </div>
                              ),
                            },
                            { id: 'text', header: 'Text', render: (result) => <div className="line-clamp-2 max-w-[520px]">{result.text}</div> },
                            { id: 'distance', header: 'Distance', width: 110, render: (result) => typeof result._distance === 'number' ? result._distance.toFixed(4) : '-' },
                          ]}
                          rowActions={(result) => [
                            { actions: [{ id: 'preview', label: '查看结果', icon: <Eye className="h-4 w-4" />, primary: true, onSelect: () => setPreviewChunk(result) }] },
                          ]}
                          emptyState={{ title: '暂无搜索结果', description: '输入查询并运行 vector search 后会显示结果。' }}
                        />
                      </TabsContent>

                      <TabsContent value="jobs" className="m-0">
                        <DataTable
                          rows={detail.importJobs}
                          rowKey="id"
                          density="compact"
                          columns={[
                            { id: 'message', header: '任务', accessor: 'message' },
                            { id: 'type', header: '类型', width: 120, render: (job) => <Badge variant="outline">{job.sourceType}</Badge> },
                            { id: 'written', header: '写入', width: 130, render: (job) => `${job.documentCount} 来源 / ${job.chunkCount} 向量行` },
                            { id: 'created', header: '时间', width: 160, render: (job) => <span className="text-xs text-muted-foreground">{formatTime(job.createdAt)}</span> },
                          ]}
                          emptyState={{ title: '暂无任务', description: '导入任务执行后会在这里显示历史。' }}
                        />
                      </TabsContent>

                      <TabsContent value="api" className="m-0">
                        <div className="grid min-h-[560px] gap-0 lg:grid-cols-2">
                          <div className="border-r p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold">Play API</div>
                              <Button size="sm" onClick={runApiRequest} disabled={ragApiDebuggerMutation.isPending}>
                                {ragApiDebuggerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                                Run
                              </Button>
                            </div>
                            <div className="grid gap-3">
                              <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                                <select
                                  value={apiMethod}
                                  onChange={(event) => setApiMethod(event.target.value)}
                                  className="h-10 rounded-md border bg-background px-3 text-sm"
                                >
                                  <option>GET</option>
                                  <option>POST</option>
                                  <option>DELETE</option>
                                </select>
                                <Input value={apiPath} onChange={(event) => setApiPath(event.target.value)} />
                              </div>
                              <Textarea value={apiBody} onChange={(event) => setApiBody(event.target.value)} className="min-h-[360px] font-mono text-xs" />
                            </div>
                            <div className="mt-4 grid gap-2">
                              {[
                                ['GET', '/api/rag/v1/collections'],
                                ['GET', `/api/rag/v1/collections/${activeKb.id}/schema`],
                                ['GET', `/api/rag/v1/collections/${activeKb.id}/rows?page=0&pageSize=50`],
                                ['POST', `/api/rag/v1/collections/${activeKb.id}/search`],
                                ['POST', `/api/rag/v1/collections/${activeKb.id}/import`],
                                ['DELETE', `/api/rag/v1/collections/${activeKb.id}/rows`],
                              ].map(([method, path]) => (
                                <button
                                  key={`${method}-${path}`}
                                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs hover:bg-accent"
                                  onClick={() => {
                                    setApiMethod(method);
                                    setApiPath(path);
                                    if (method === 'POST' && path.endsWith('/search')) setApiBody(JSON.stringify({ query: 'vector database RAG', topK: 8 }, null, 2));
                                    if (method === 'POST' && path.endsWith('/import')) setApiBody(JSON.stringify({ sample: true }, null, 2));
                                    if (method === 'DELETE' && path.endsWith('/rows')) setApiBody(JSON.stringify({ rowIds: selectedRowIds }, null, 2));
                                  }}
                                >
                                  <Badge variant={method === 'DELETE' ? 'destructive' : method === 'POST' ? 'default' : 'outline'}>{method}</Badge>
                                  <code className="break-all">{path}</code>
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="p-4">
                            <div className="mb-3 text-sm font-semibold">Response</div>
                            <pre className="h-[500px] overflow-auto rounded-md border bg-muted/30 p-3 text-xs">{apiResponse}</pre>
                          </div>
                        </div>
                      </TabsContent>
                    </Tabs>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              className="m-6 min-h-[420px]"
              icon={<Database className="h-5 w-5" />}
              title="正在初始化默认知识库"
              description="默认 RAG 数据库会自动创建，向量数据写入本地 LanceDB。"
            />
          )}
        </section>
      </main>
      <DetailDrawer open={!!previewChunk} onOpenChange={(open) => { if (!open) setPreviewChunk(null); }}>
        <DetailDrawerContent widthClassName="w-[min(520px,calc(100vw-1rem))]">
          <DetailDrawerHeader>
            <DetailDrawerTitle>向量行详情</DetailDrawerTitle>
            <DetailDrawerDescription>{previewChunk?.sourceTitle || previewChunk?.documentId || ''}</DetailDrawerDescription>
          </DetailDrawerHeader>
          {previewChunk ? (
            <DetailDrawerBody className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <StatusPill tone="neutral" dot={false}>row #{previewChunk.chunkIndex + 1}</StatusPill>
                <StatusPill tone="neutral" dot={false}>{previewChunk.embeddingModel}</StatusPill>
                <StatusPill tone="neutral" dot={false}>{previewChunk.embeddingDimension}d</StatusPill>
                <StatusPill tone="neutral" dot={false}>{previewChunk.tokenCount} tokens</StatusPill>
                {previewChunk.externalId ? <StatusPill tone="neutral" dot={false}>{previewChunk.externalId}</StatusPill> : null}
              </div>
              <div className="max-h-[48vh] overflow-auto rounded-md border bg-muted/30 p-3 text-sm leading-6 whitespace-pre-wrap">
                {previewChunk.text}
              </div>
              {previewChunk.metadataJson && previewChunk.metadataJson !== '{}' ? (
                <pre className="max-h-40 overflow-auto rounded-md border bg-background p-3 text-xs text-muted-foreground">{previewChunk.metadataJson}</pre>
              ) : null}
            </DetailDrawerBody>
          ) : null}
        </DetailDrawerContent>
      </DetailDrawer>
      <ConfirmModal
        open={confirmAction !== null}
        variant={confirmAction?.type === 'empty-collection' ? 'reset' : 'delete'}
        title={confirmAction?.type === 'empty-collection' ? 'Empty collection?' : 'Delete item?'}
        objectName={confirmObjectName}
        consequence={confirmConsequence}
        confirmLabel={confirmLabel}
        loading={confirmLoading}
        onConfirm={runConfirmAction}
        onCancel={() => setConfirmAction(null)}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      />
    </div>
  );
}

export default function KnowledgePage(props: KnowledgeLibraryPageProps = {}) {
  return (
    <AuthGuard>
      <KnowledgePageContent {...props} />
    </AuthGuard>
  );
}
