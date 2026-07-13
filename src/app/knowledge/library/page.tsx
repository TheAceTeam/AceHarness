'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BookOpen,
  Copy,
  Database,
  Download,
  Eye,
  FileText,
  Layers,
  Loader2,
  Play,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { cn } from '@/lib/core/utils';
import type { RagDatabaseStats, RagDocument, RagImportJob, RagKnowledgeBase, RagTableSchema, RagVectorChunk } from '@/lib/rag/types';

type RagDetail = {
  documents: RagDocument[];
  chunks: RagVectorChunk[];
  importJobs: RagImportJob[];
  stats: RagDatabaseStats | null;
  schema: RagTableSchema | null;
};

type SearchResult = RagVectorChunk;
const SOURCE_PAGE_SIZE = 8;
const VECTOR_PAGE_SIZE = 6;

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error || `请求失败：HTTP ${response.status}`);
  }
  return data as T;
}

function formatTime(value: number) {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

function PaginationControls({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
      <span>{total} items · page {page + 1}/{pageCount}</span>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page <= 0} onClick={() => onPageChange(Math.max(0, page - 1))}>
          上一页
        </Button>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={page >= pageCount - 1} onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}>
          下一页
        </Button>
      </div>
    </div>
  );
}

function KnowledgePageContent() {
  const { toast } = useToast();
  useDocumentTitle('知识库');
  const { isDashboardShell } = useDashboardShellHeader({
    title: '知识库',
    subtitle: 'CSIHarness 原生 LanceDB RAG 数据库，管理来源、向量行和检索验证。',
  }, []);

  const [knowledgeBases, setKnowledgeBases] = useState<RagKnowledgeBase[]>([]);
  const [activeKbId, setActiveKbId] = useState('');
  const [detail, setDetail] = useState<RagDetail>({ documents: [], chunks: [], importJobs: [], stats: null, schema: null });
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [selectedDocumentId, setSelectedDocumentId] = useState('');
  const [previewChunk, setPreviewChunk] = useState<RagVectorChunk | null>(null);
  const [sourcePage, setSourcePage] = useState(0);
  const [vectorPage, setVectorPage] = useState(0);
  const [dataQuery, setDataQuery] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [apiMethod, setApiMethod] = useState('GET');
  const [apiPath, setApiPath] = useState('/api/rag/v1/collections');
  const [apiBody, setApiBody] = useState(JSON.stringify({ query: 'vector database RAG', topK: 8 }, null, 2));
  const [apiResponse, setApiResponse] = useState('{\n  "status": "ready"\n}');
  const [apiRunning, setApiRunning] = useState(false);
  const [selectedSchemaFieldName, setSelectedSchemaFieldName] = useState('vector');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState('RAG 知识库如何导入外部系统');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const activeKb = useMemo(
    () => knowledgeBases.find((item) => item.id === activeKbId) || knowledgeBases[0] || null,
    [activeKbId, knowledgeBases]
  );
  const selectedDocument = useMemo(
    () => detail.documents.find((item) => item.id === selectedDocumentId) || detail.documents[0] || null,
    [detail.documents, selectedDocumentId]
  );
  const selectedChunks = useMemo(
    () => selectedDocument ? detail.chunks.filter((chunk) => chunk.documentId === selectedDocument.id) : [],
    [detail.chunks, selectedDocument]
  );
  const dataRows = useMemo(() => {
    const filter = dataQuery.trim().toLowerCase();
    if (!filter) return selectedChunks;
    return selectedChunks.filter((row) => (
      row.text.toLowerCase().includes(filter)
      || row.sourceTitle.toLowerCase().includes(filter)
      || row.sourceSystem.toLowerCase().includes(filter)
      || row.externalId.toLowerCase().includes(filter)
      || row.metadataJson.toLowerCase().includes(filter)
    ));
  }, [dataQuery, selectedChunks]);
  const selectedSchemaField = useMemo(
    () => (detail.schema?.fields || []).find((field) => field.name === selectedSchemaFieldName) || detail.schema?.fields?.[0] || null,
    [detail.schema?.fields, selectedSchemaFieldName]
  );
  const sourcePageCount = Math.max(1, Math.ceil(detail.documents.length / SOURCE_PAGE_SIZE));
  const vectorPageCount = Math.max(1, Math.ceil(dataRows.length / VECTOR_PAGE_SIZE));
  const pagedDocuments = useMemo(
    () => detail.documents.slice(sourcePage * SOURCE_PAGE_SIZE, sourcePage * SOURCE_PAGE_SIZE + SOURCE_PAGE_SIZE),
    [detail.documents, sourcePage]
  );
  const pagedSelectedChunks = useMemo(
    () => dataRows.slice(vectorPage * VECTOR_PAGE_SIZE, vectorPage * VECTOR_PAGE_SIZE + VECTOR_PAGE_SIZE),
    [dataRows, vectorPage]
  );

  const loadKnowledgeBases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiJson<{ knowledgeBases: RagKnowledgeBase[] }>('/api/rag/knowledge-bases');
      setKnowledgeBases(data.knowledgeBases);
      setActiveKbId((prev) => prev || data.knowledgeBases[0]?.id || '');
    } catch (error: any) {
      toast('error', error?.message || '读取知识库失败');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadDetail = useCallback(async (knowledgeBaseId: string) => {
    if (!knowledgeBaseId) {
      setDetail({ documents: [], chunks: [], importJobs: [], stats: null, schema: null });
      return;
    }
    setDetailLoading(true);
    try {
      const data = await apiJson<RagDetail>(`/api/rag/detail?knowledgeBaseId=${encodeURIComponent(knowledgeBaseId)}&limit=500`);
      setDetail(data);
    } catch (error: any) {
      toast('error', error?.message || '读取知识库详情失败');
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadKnowledgeBases();
  }, [loadKnowledgeBases]);

  useEffect(() => {
    void loadDetail(activeKb?.id || '');
    setSearchResults([]);
    setSelectedDocumentId('');
    setSourcePage(0);
    setVectorPage(0);
  }, [activeKb?.id, loadDetail]);

  useEffect(() => {
    if (selectedDocumentId && detail.documents.some((item) => item.id === selectedDocumentId)) return;
    setSelectedDocumentId(detail.documents[0]?.id || '');
  }, [detail.documents, selectedDocumentId]);

  useEffect(() => {
    setVectorPage(0);
    setSelectedRowIds([]);
  }, [selectedDocumentId]);

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
      await apiJson('/api/rag/knowledge-bases?id=' + encodeURIComponent(id), { method: 'DELETE' });
      setKnowledgeBases((prev) => prev.filter((item) => item.id !== id));
      if (activeKbId === id) setActiveKbId('');
      toast('success', '知识库已删除');
    } catch (error: any) {
      toast('error', error?.message || '删除知识库失败');
    }
  };

  const importBundle = async (bundle: unknown) => {
    if (!activeKb) return;
    setImporting(true);
    try {
      await apiJson('/api/rag/import', {
        method: 'POST',
        body: JSON.stringify({ knowledgeBaseId: activeKb.id, mode: 'bundle', bundle }),
      });
      await loadKnowledgeBases();
      await loadDetail(activeKb.id);
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

  const deleteSource = async (document: RagDocument) => {
    if (!activeKb) return;
    try {
      await apiJson(`/api/rag/documents?knowledgeBaseId=${encodeURIComponent(activeKb.id)}&documentId=${encodeURIComponent(document.id)}`, { method: 'DELETE' });
      await loadKnowledgeBases();
      await loadDetail(activeKb.id);
      setSelectedDocumentId('');
      toast('success', '来源已删除');
    } catch (error: any) {
      toast('error', error?.message || '删除来源失败');
    }
  };

  const insertSampleData = async () => {
    if (!activeKb) return;
    setImporting(true);
    try {
      await apiJson(`/api/rag/v1/collections/${encodeURIComponent(activeKb.id)}/import`, {
        method: 'POST',
        body: JSON.stringify({ sample: true }),
      });
      await loadKnowledgeBases();
      await loadDetail(activeKb.id);
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
      await apiJson(`/api/rag/v1/collections/${encodeURIComponent(activeKb.id)}/rows`, {
        method: 'DELETE',
        body: JSON.stringify({ all: true }),
      });
      await loadKnowledgeBases();
      await loadDetail(activeKb.id);
      setSelectedRowIds([]);
      toast('success', 'collection 已清空');
    } catch (error: any) {
      toast('error', error?.message || '清空失败');
    }
  };

  const deleteSelectedRows = async () => {
    if (!activeKb || selectedRowIds.length === 0) return;
    try {
      await apiJson(`/api/rag/v1/collections/${encodeURIComponent(activeKb.id)}/rows`, {
        method: 'DELETE',
        body: JSON.stringify({ rowIds: selectedRowIds }),
      });
      await loadKnowledgeBases();
      await loadDetail(activeKb.id);
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
      const data = await apiJson<{ results: SearchResult[] }>('/api/rag/search', {
        method: 'POST',
        body: JSON.stringify({ knowledgeBaseId: activeKb.id, query, topK: 8 }),
      });
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
    setApiRunning(true);
    try {
      const response = await fetch(apiPath, {
        method: apiMethod,
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: apiMethod === 'GET' ? undefined : apiBody,
      });
      const text = await response.text();
      try {
        setApiResponse(JSON.stringify(JSON.parse(text), null, 2));
      } catch {
        setApiResponse(text);
      }
    } catch (error: any) {
      setApiResponse(error?.message || '请求失败');
    } finally {
      setApiRunning(false);
    }
  };

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
          <div className="shrink-0 border-b p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">知识库</div>
                <div className="text-xs text-muted-foreground">LanceDB 向量数据库</div>
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadKnowledgeBases()} disabled={loading}>
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-2">
            {knowledgeBases.map((kb) => (
              <button
                key={kb.id}
                onClick={() => setActiveKbId(kb.id)}
                className={cn(
                  'mb-2 w-full rounded-md border p-3 text-left transition-colors',
                  activeKb?.id === kb.id ? 'border-primary bg-primary/8' : 'bg-background hover:bg-accent/50'
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate text-sm font-medium">{kb.name}</div>
                  <Database className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <span>{kb.documentCount} 来源</span>
                  <span>{kb.chunkCount} 向量行</span>
                </div>
              </button>
            ))}
            {!loading && knowledgeBases.length === 0 ? (
              <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                正在初始化默认知识库...
              </div>
            ) : null}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border bg-card">
          {activeKb ? (
            <>
              <div className="shrink-0 border-b p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5 text-primary" />
                      <h2 className="truncate text-lg font-semibold">{activeKb.name}</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{activeKb.description || '无描述'}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => void loadDetail(activeKb.id)} disabled={detailLoading}>
                      <RefreshCw className={cn('h-4 w-4', detailLoading && 'animate-spin')} />
                      刷新
                    </Button>
                    {activeKb.id !== 'default' ? (
                      <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => void deleteKnowledgeBase(activeKb.id)}>
                        <Trash2 className="h-4 w-4" />
                        删除
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">来源</div>
                    <div className="mt-1 text-xl font-semibold">{activeKb.documentCount}</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">向量行</div>
                    <div className="mt-1 text-xl font-semibold">{activeKb.chunkCount}</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">Embedding</div>
                    <div className="mt-1 truncate text-sm font-medium">{activeKb.embeddingModel}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{activeKb.embeddingProvider} · {activeKb.embeddingDimension}d</div>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <div className="text-xs text-muted-foreground">LanceDB</div>
                    <div className="mt-1 truncate text-sm font-medium">{detail.stats?.tableName || activeKb.tableName}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{detail.stats?.rowCount ?? activeKb.chunkCount} rows</div>
                  </div>
                </div>
                <div className="mt-3 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">DB URI</span>
                  <span className="ml-2 break-all">{detail.stats?.databaseUri || activeKb.databaseUri}</span>
                  {detail.stats?.tableVersion ? <span className="ml-3">v{detail.stats.tableVersion}</span> : null}
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                <div className="grid gap-4">
                  <div className="hidden">
                    <section className="rounded-lg border bg-background p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">导入 RAG 数据</h3>
                          <p className="text-xs text-muted-foreground">选择 Dify、RAGFlow、AnythingLLM、Qdrant、Chroma 或 LanceDB 转换后的导出文件。</p>
                        </div>
                        <Upload className="h-4 w-4 text-muted-foreground" />
                      </div>
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
                      <div className="rounded-md border border-dashed p-4">
                        <div className="text-sm font-medium">RAG 导出文件</div>
                        <div className="mt-1 text-xs leading-5 text-muted-foreground">
                          文件应包含来源、向量行文本、sourceSystem、metadata 等字段；导入后会重新 embedding 并写入当前 LanceDB table。
                        </div>
                      </div>
                      <Button className="mt-3 w-full" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                        {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        选择文件并写入当前 RAG 数据库
                      </Button>
                    </section>

                    <section className="rounded-lg border bg-background p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">测试搜索</h3>
                          <p className="text-xs text-muted-foreground">使用当前知识库 embedding 执行 LanceDB vectorSearch。</p>
                        </div>
                        <Search className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="flex gap-2">
                        <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入测试问题" />
                        <Button onClick={searchKnowledgeBase} disabled={searching}>
                          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </Button>
                      </div>
                      <div className="mt-3 space-y-2">
                        {searchResults.map((result) => (
                          <div key={result.id} className="rounded-md border p-3">
                            <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                              <span className="truncate">{result.sourceTitle || result.documentId}</span>
                              <span>distance {typeof result._distance === 'number' ? result._distance.toFixed(4) : '-'}</span>
                            </div>
                            <p className="line-clamp-4 whitespace-pre-wrap text-sm leading-6">{result.text}</p>
                          </div>
                        ))}
                        {searchResults.length === 0 ? (
                          <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">暂无搜索结果。</div>
                        ) : null}
                      </div>
                    </section>
                  </div>

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
                    <Tabs defaultValue="schema" className="rounded-lg border bg-background">
                      <div className="flex items-center justify-between gap-3 border-b px-4 pt-3">
                        <TabsList variant="line">
                          <TabsTrigger value="schema">Schema</TabsTrigger>
                          <TabsTrigger value="data">Data</TabsTrigger>
                          <TabsTrigger value="sources">来源管理</TabsTrigger>
                          <TabsTrigger value="search">Vector Search</TabsTrigger>
                          <TabsTrigger value="jobs">导入任务</TabsTrigger>
                          <TabsTrigger value="api">API</TabsTrigger>
                        </TabsList>
                      </div>

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
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Field</TableHead>
                                <TableHead className="w-[150px]">Type</TableHead>
                                <TableHead className="w-[100px]">Index</TableHead>
                                <TableHead>Description</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(detail.schema?.fields || []).map((field) => (
                                <TableRow
                                  key={field.name}
                                  data-state={selectedSchemaField?.name === field.name ? 'selected' : undefined}
                                  onClick={() => setSelectedSchemaFieldName(field.name)}
                                  className="cursor-pointer"
                                >
                                  <TableCell className="font-medium">{field.name}</TableCell>
                                  <TableCell><Badge variant="outline">{field.type}</Badge></TableCell>
                                  <TableCell>{field.indexed ? <Badge>Indexed</Badge> : <Badge variant="outline">None</Badge>}</TableCell>
                                  <TableCell className="text-muted-foreground">{field.description || '-'}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
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
                                <Button variant="outline" className="justify-start" onClick={() => void loadDetail(activeKb.id)}>
                                  <RefreshCw className="h-4 w-4" />
                                  Refresh
                                </Button>
                                <Button variant="outline" className="justify-start" onClick={exportRowsAsJson} disabled={detail.chunks.length === 0}>
                                  <Download className="h-4 w-4" />
                                  Download Data
                                </Button>
                                <Button variant="outline" className="justify-start text-destructive hover:text-destructive" onClick={emptyCollection} disabled={activeKb.chunkCount === 0}>
                                  <Trash2 className="h-4 w-4" />
                                  Empty Collection
                                </Button>
                              </div>
                            </div>
                          </aside>
                        </div>
                      </TabsContent>

                      <TabsContent value="sources" className="m-0">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
                          <div className="text-sm font-medium">来源管理</div>
                          <div className="flex items-center gap-2">
                            <Button size="sm" variant="outline" onClick={() => void loadDetail(activeKb.id)} disabled={detailLoading}>
                              <RefreshCw className={cn('h-4 w-4', detailLoading && 'animate-spin')} />
                              刷新
                            </Button>
                            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                              导入文件
                            </Button>
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>来源</TableHead>
                              <TableHead className="w-[130px]">系统</TableHead>
                              <TableHead className="w-[90px]">向量行</TableHead>
                              <TableHead className="w-[150px]">导入时间</TableHead>
                              <TableHead className="w-[150px] text-right">操作</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedDocuments.map((document) => (
                              <TableRow key={document.id} data-state={selectedDocument?.id === document.id ? 'selected' : undefined}>
                                <TableCell>
                                  <button className="max-w-[260px] text-left" onClick={() => setSelectedDocumentId(document.id)}>
                                    <div className="truncate font-medium">{document.title}</div>
                                    <div className="mt-1 truncate text-xs text-muted-foreground">{document.externalId || document.id}</div>
                                  </button>
                                </TableCell>
                                <TableCell>
                                  <Badge variant="outline" className="max-w-[120px] truncate">{document.sourceSystem || document.sourceType}</Badge>
                                </TableCell>
                                <TableCell>{document.chunkCount}</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{formatTime(document.createdAt)}</TableCell>
                                <TableCell className="text-right">
                                  <div className="flex justify-end gap-2">
                                    <Button size="sm" variant="outline" className="h-8" onClick={() => setSelectedDocumentId(document.id)}>
                                      <Eye className="h-4 w-4" />
                                    </Button>
                                    <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={() => void deleteSource(document)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                            {pagedDocuments.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">暂无来源。</TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                        <PaginationControls page={sourcePage} pageCount={sourcePageCount} total={detail.documents.length} onPageChange={setSourcePage} />
                      </TabsContent>

                      <TabsContent value="data" className="m-0">
                        <div className="space-y-3 border-b px-4 py-3">
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                            <div>
                              <div className="mb-1 text-xs font-medium text-muted-foreground">Query Expression</div>
                              <Input value={dataQuery} onChange={(event) => setDataQuery(event.target.value)} placeholder="Filter text/source/metadata, e.g. lancedb" />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button variant="outline" onClick={() => { setDataQuery(''); setVectorPage(0); }}>
                                <RefreshCw className="h-4 w-4" />
                                Reset
                              </Button>
                              <Button onClick={() => setVectorPage(0)}>
                                <Search className="h-4 w-4" />
                                Query
                              </Button>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {selectedDocument ? <span>{selectedDocument.sourceSystem || selectedDocument.sourceType}</span> : null}
                            {selectedDocument?.externalId ? <span>{selectedDocument.externalId}</span> : null}
                              <span>{dataRows.length} / {selectedChunks.length} 向量行</span>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importing}>
                                {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                                Import File
                              </Button>
                              <Button size="sm" variant="outline" onClick={insertSampleData} disabled={importing}>
                                Insert Sample Data
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={emptyCollection} disabled={activeKb.chunkCount === 0}>
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
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => selectedDocument && void deleteSource(selectedDocument)} disabled={!selectedDocument}>
                                <Trash2 className="h-4 w-4" />
                                Delete Source
                              </Button>
                              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={deleteSelectedRows} disabled={selectedRowIds.length === 0}>
                                Delete ({selectedRowIds.length})
                              </Button>
                            </div>
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[44px]">
                                <Checkbox
                                  checked={pagedSelectedChunks.length > 0 && pagedSelectedChunks.every((row) => selectedRowIds.includes(row.id))}
                                  onCheckedChange={(checked) => {
                                    const pageIds = pagedSelectedChunks.map((row) => row.id);
                                    setSelectedRowIds((prev) => checked
                                      ? Array.from(new Set([...prev, ...pageIds]))
                                      : prev.filter((id) => !pageIds.includes(id)));
                                  }}
                                />
                              </TableHead>
                              <TableHead className="w-[80px]">Row</TableHead>
                              <TableHead>Text</TableHead>
                              <TableHead className="w-[130px]">Embedding</TableHead>
                              <TableHead className="w-[100px]">Tokens</TableHead>
                              <TableHead className="w-[90px] text-right">查看</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedSelectedChunks.map((chunk) => (
                              <TableRow key={chunk.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedRowIds.includes(chunk.id)}
                                    onCheckedChange={(checked) => setSelectedRowIds((prev) => checked ? [...prev, chunk.id] : prev.filter((id) => id !== chunk.id))}
                                  />
                                </TableCell>
                                <TableCell>#{chunk.chunkIndex + 1}</TableCell>
                                <TableCell>
                                  <div className="line-clamp-2 max-w-[360px] text-sm leading-5">{chunk.text}</div>
                                  {chunk.externalId ? <div className="mt-1 truncate text-xs text-muted-foreground">{chunk.externalId}</div> : null}
                                </TableCell>
                                <TableCell className="text-xs text-muted-foreground">{chunk.embeddingModel}<br />{chunk.embeddingDimension}d</TableCell>
                                <TableCell>{chunk.tokenCount}</TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" variant="outline" className="h-8" onClick={() => setPreviewChunk(chunk)}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {pagedSelectedChunks.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">暂无向量行。</TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                        <PaginationControls page={vectorPage} pageCount={vectorPageCount} total={dataRows.length} onPageChange={setVectorPage} />
                      </TabsContent>

                      <TabsContent value="search" className="m-0">
                        <div className="border-b px-4 py-3">
                          <div className="flex gap-2">
                            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入 vectorSearch 查询" />
                            <Button onClick={searchKnowledgeBase} disabled={searching}>
                              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                              Query
                            </Button>
                          </div>
                        </div>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Source</TableHead>
                              <TableHead>Text</TableHead>
                              <TableHead className="w-[110px]">Distance</TableHead>
                              <TableHead className="w-[90px] text-right">查看</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {searchResults.map((result) => (
                              <TableRow key={result.id}>
                                <TableCell className="max-w-[220px]">
                                  <div className="truncate font-medium">{result.sourceTitle || result.documentId}</div>
                                  <div className="mt-1 truncate text-xs text-muted-foreground">{result.sourceSystem || result.sourceType}</div>
                                </TableCell>
                                <TableCell><div className="line-clamp-2 max-w-[520px]">{result.text}</div></TableCell>
                                <TableCell>{typeof result._distance === 'number' ? result._distance.toFixed(4) : '-'}</TableCell>
                                <TableCell className="text-right">
                                  <Button size="sm" variant="outline" className="h-8" onClick={() => setPreviewChunk(result)}>
                                    <Eye className="h-4 w-4" />
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                            {searchResults.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">暂无搜索结果。</TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                      </TabsContent>

                      <TabsContent value="jobs" className="m-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>任务</TableHead>
                              <TableHead className="w-[120px]">类型</TableHead>
                              <TableHead className="w-[130px]">写入</TableHead>
                              <TableHead className="w-[160px]">时间</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {detail.importJobs.map((job) => (
                              <TableRow key={job.id}>
                                <TableCell>{job.message}</TableCell>
                                <TableCell><Badge variant="outline">{job.sourceType}</Badge></TableCell>
                                <TableCell>{job.documentCount} 来源 / {job.chunkCount} 向量行</TableCell>
                                <TableCell className="text-xs text-muted-foreground">{formatTime(job.createdAt)}</TableCell>
                              </TableRow>
                            ))}
                            {detail.importJobs.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">暂无任务。</TableCell>
                              </TableRow>
                            ) : null}
                          </TableBody>
                        </Table>
                      </TabsContent>

                      <TabsContent value="api" className="m-0">
                        <div className="grid min-h-[560px] gap-0 lg:grid-cols-2">
                          <div className="border-r p-4">
                            <div className="mb-3 flex items-center justify-between gap-3">
                              <div className="text-sm font-semibold">Play API</div>
                              <Button size="sm" onClick={runApiRequest} disabled={apiRunning}>
                                {apiRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
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
            <div className="flex min-h-[420px] flex-1 items-center justify-center p-8 text-center">
              <div>
                <Database className="mx-auto h-10 w-10 text-muted-foreground" />
                <h2 className="mt-4 text-lg font-semibold">正在初始化默认知识库</h2>
                <p className="mt-2 text-sm text-muted-foreground">默认 RAG 数据库会自动创建，向量数据写入本地 LanceDB。</p>
              </div>
            </div>
          )}
        </section>
      </main>
      <Dialog open={!!previewChunk} onOpenChange={(open) => { if (!open) setPreviewChunk(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>向量行详情</DialogTitle>
            <DialogDescription>
              {previewChunk?.sourceTitle || previewChunk?.documentId || ''}
            </DialogDescription>
          </DialogHeader>
          {previewChunk ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <Badge variant="outline">row #{previewChunk.chunkIndex + 1}</Badge>
                <Badge variant="outline">{previewChunk.embeddingModel}</Badge>
                <Badge variant="outline">{previewChunk.embeddingDimension}d</Badge>
                <Badge variant="outline">{previewChunk.tokenCount} tokens</Badge>
                {previewChunk.externalId ? <Badge variant="outline">{previewChunk.externalId}</Badge> : null}
              </div>
              <div className="max-h-[48vh] overflow-auto rounded-md border bg-muted/30 p-3 text-sm leading-6 whitespace-pre-wrap">
                {previewChunk.text}
              </div>
              {previewChunk.metadataJson && previewChunk.metadataJson !== '{}' ? (
                <pre className="max-h-40 overflow-auto rounded-md border bg-background p-3 text-xs text-muted-foreground">{previewChunk.metadataJson}</pre>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function KnowledgePage() {
  return (
    <AuthGuard>
      <KnowledgePageContent />
    </AuthGuard>
  );
}
