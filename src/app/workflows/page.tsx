'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { configApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Search, Plus, LogIn, Edit, Copy, Trash2, ArrowLeft, FileText, History } from 'lucide-react';
import NewConfigModal from '@/components/NewConfigModal';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface WorkflowConfig {
  filename: string;
  name: string;
  description?: string;
  mode?: 'phase-based' | 'state-machine';
  phaseCount?: number;
  stepCount?: number;
  agentCount?: number;
  phases?: number;
  steps?: number;
}

const VIEW_MODE_KEY = 'aceharness:workflows:view-mode';

export default function WorkflowsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMode, setSelectedMode] = useState<string>('all');
  const [showNewModal, setShowNewModal] = useState(false);
  const [showAIGuide, setShowAIGuide] = useState(false);
  const [referenceWorkflow, setReferenceWorkflow] = useState<string>('');
  const [viewMode, setViewMode] = useState<'gallery' | 'table'>('table');
  const [selectedWorkflows, setSelectedWorkflows] = useState<Set<string>>(new Set());
  const [floatingFilterBar, setFloatingFilterBar] = useState(false);
  const filterBarAnchorRef = useRef<HTMLDivElement | null>(null);
  const filterBarMeasureRef = useRef<HTMLDivElement | null>(null);
  const [filterBarHeight, setFilterBarHeight] = useState(0);

  useDocumentTitle('工作流管理');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY);
      if (saved === 'gallery' || saved === 'table') setViewMode(saved);
    } catch {}
    loadWorkflows();
  }, []);

  useEffect(() => {
    const updateFloatingState = () => {
      const anchor = filterBarAnchorRef.current;
      if (!anchor) return;
      setFloatingFilterBar(anchor.getBoundingClientRect().top <= 8);
    };
    const updateMeasure = () => {
      if (filterBarMeasureRef.current) {
        setFilterBarHeight(filterBarMeasureRef.current.getBoundingClientRect().height);
      }
    };
    updateMeasure();
    updateFloatingState();
    window.addEventListener('scroll', updateFloatingState, { passive: true });
    window.addEventListener('resize', updateMeasure);
    window.addEventListener('resize', updateFloatingState);
    return () => {
      window.removeEventListener('scroll', updateFloatingState);
      window.removeEventListener('resize', updateMeasure);
      window.removeEventListener('resize', updateFloatingState);
    };
  }, []);

  const toggleViewMode = (mode: 'gallery' | 'table') => {
    setViewMode(mode);
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch {}
  };

  const loadWorkflows = async () => {
    try {
      setLoading(true);
      const data = await configApi.listConfigs();
      setWorkflows(data.configs || []);
    } catch (error) {
      console.error('Failed to load workflows:', error);
      toast('error', '无法加载工作流列表');
    } finally {
      setLoading(false);
    }
  };

  const handleAICreate = () => {
    setShowAIGuide(true);
  };

  const AI_GUIDE_SAMPLE_MESSAGE = '我想围绕【目标】创建一个工作流，工作目录是【路径】，请先帮我梳理需求、阶段、候选 Agent 和任务拆分。';

  const handleAIGuideConfirm = () => {
    setShowAIGuide(false);
    const encoded = encodeURIComponent(AI_GUIDE_SAMPLE_MESSAGE);
    router.push(`/?starterPrompt=${encoded}&sidebarTab=workflow&sessionTitle=创建工作流`);
  };

  const handleDelete = async (filename: string) => {
    const confirmed = await confirm({
      title: '删除工作流',
      description: `确定要删除工作流 "${filename}" 吗？此操作无法撤销。`,
      confirmLabel: '删除',
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (confirmed) {
      try {
        await configApi.deleteConfig(filename);
        toast('success', `工作流 "${filename}" 已删除`);
        setSelectedWorkflows((prev) => { const next = new Set(prev); next.delete(filename); return next; });
        loadWorkflows();
      } catch (error) {
        toast('error', '无法删除工作流');
      }
    }
  };

  const handleBatchDelete = async () => {
    if (selectedWorkflows.size === 0) return;
    const confirmed = await confirm({
      title: '批量删除工作流',
      description: `确定要删除选中的 ${selectedWorkflows.size} 个工作流吗？此操作无法撤销。`,
      confirmLabel: `删除 ${selectedWorkflows.size} 个`,
      cancelLabel: '取消',
      variant: 'destructive',
    });
    if (confirmed) {
      try {
        const result = await configApi.batchDeleteConfigs([...selectedWorkflows]);
        toast('success', `已删除 ${result.deletedCount} 个工作流`);
        setSelectedWorkflows(new Set());
        loadWorkflows();
      } catch (error) {
        toast('error', '批量删除失败');
      }
    }
  };

  const toggleSelect = (filename: string) => {
    setSelectedWorkflows((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedWorkflows.size === filteredWorkflows.length) {
      setSelectedWorkflows(new Set());
    } else {
      setSelectedWorkflows(new Set(filteredWorkflows.map((wf) => wf.filename)));
    }
  };

  const filteredWorkflows = workflows.filter((wf) => {
    const matchesSearch =
      wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wf.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
      wf.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesMode = selectedMode === 'all' || wf.mode === selectedMode;
    return matchesSearch && matchesMode;
  });

  const modeLabel = (mode?: string) => mode === 'state-machine' ? '状态机' : '阶段模式';
  const modeBadgeClass = (mode?: string) =>
    mode === 'state-machine'
      ? 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/30 backdrop-blur-xl sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  返回首页
                </Link>
              </Button>
              <div className="h-6 w-px bg-border" />
              <div>
                <h1 className="text-2xl font-bold">工作流管理</h1>
                <p className="text-xs text-muted-foreground">管理和配置工作流</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
              <Button size="sm" variant="outline" onClick={handleAICreate}>
                <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
                AI 创建
              </Button>
              <Button onClick={() => setShowNewModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                手动创建
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8 flex flex-col gap-6">
        {/* Floating filter anchor */}
        <div ref={filterBarAnchorRef} className="h-px" />
        {floatingFilterBar ? <div style={{ height: filterBarHeight }} /> : null}

        {/* Filter bar */}
        <section
          className={cn(
            floatingFilterBar
              ? 'fixed inset-x-0 top-2 z-40 px-6'
              : 'relative z-10'
          )}
        >
          <div className={cn(floatingFilterBar && 'mx-auto max-w-[1680px]')}>
            <div ref={filterBarMeasureRef} className="relative rounded-[24px] border border-border/70 bg-card/95 p-4 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/85">
              <div className="pointer-events-none absolute inset-0 rounded-[24px] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),transparent_55%)]" />
              <div className="relative flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-1 flex-col gap-3 xl:flex-row xl:items-center">
                  <Input
                    placeholder="搜索工作流..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-11 w-full max-w-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    {(['all', 'state-machine', 'phase-based'] as const).map((mode) => (
                      <Button
                        key={mode}
                        size="sm"
                        variant={selectedMode === mode ? 'default' : 'outline'}
                        className={cn(
                          'rounded-full',
                          selectedMode === mode && mode === 'state-machine' && 'bg-sky-500 text-white hover:bg-sky-400',
                          selectedMode === mode && mode === 'phase-based' && 'bg-amber-500 text-white hover:bg-amber-400',
                        )}
                        onClick={() => setSelectedMode(mode)}
                      >
                        {mode === 'all' ? '全部' : mode === 'state-machine' ? '状态机' : '阶段模式'}
                      </Button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    当前显示 {filteredWorkflows.length} / {workflows.length} 个工作流
                  </span>
                  {/* View mode toggle */}
                  <div className="inline-flex rounded-full border border-border/60 bg-muted/40 p-1">
                    <Button
                      size="sm"
                      variant={viewMode === 'gallery' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => toggleViewMode('gallery')}
                    >
                      <span className="material-symbols-outlined text-sm">grid_view</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={viewMode === 'table' ? 'default' : 'ghost'}
                      className="h-8 rounded-full px-3"
                      onClick={() => toggleViewMode('table')}
                    >
                      <span className="material-symbols-outlined text-sm">table_rows</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
        {/* Batch action bar */}
        {selectedWorkflows.size > 0 && (
          <div className="flex items-center gap-4 rounded-[20px] border border-destructive/30 bg-destructive/5 px-5 py-3">
            <span className="text-sm font-medium">已选 {selectedWorkflows.size} 个工作流</span>
            <Button size="sm" variant="destructive" onClick={handleBatchDelete}>
              <Trash2 className="w-3.5 h-3.5 mr-1.5" />
              批量删除
            </Button>
            <Button size="sm" variant="outline" onClick={() => setSelectedWorkflows(new Set())}>
              取消选择
            </Button>
          </div>
        )}

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <FileText className="w-12 h-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">
              {workflows.length === 0 ? '还没有工作流' : '没有匹配的工作流'}
            </h3>
            <p className="text-sm text-muted-foreground mb-4">
              {workflows.length === 0 ? '创建你的第一个工作流配置' : '尝试调整搜索条件'}
            </p>
            {workflows.length === 0 && (
              <div className="flex items-center gap-3">
                <Button size="sm" variant="outline" onClick={handleAICreate}>
                  <span className="material-symbols-outlined text-sm mr-1">auto_awesome</span>
                  AI 创建
                </Button>
                <Button onClick={() => setShowNewModal(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  手动创建
                </Button>
              </div>
            )}
          </div>
        ) : viewMode === 'table' ? (
          /* Table view */
          <div className="overflow-hidden rounded-[28px] border border-border/70 bg-card/80 shadow-sm">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedWorkflows.size === filteredWorkflows.length && filteredWorkflows.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>文件名</TableHead>
                  <TableHead>模式</TableHead>
                  <TableHead>阶段/状态</TableHead>
                  <TableHead>步骤</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredWorkflows.map((wf) => (
                  <TableRow key={wf.filename} data-state={selectedWorkflows.has(wf.filename) ? 'selected' : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selectedWorkflows.has(wf.filename)}
                        onCheckedChange={() => toggleSelect(wf.filename)}
                      />
                    </TableCell>
                    <TableCell className="min-w-[200px]">
                      <div className="font-medium">{wf.name}</div>
                      {wf.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{wf.description}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground font-mono">{wf.filename}</TableCell>
                    <TableCell>
                      <Badge className={modeBadgeClass(wf.mode)}>{modeLabel(wf.mode)}</Badge>
                    </TableCell>
                    <TableCell>{wf.phaseCount ?? 0}</TableCell>
                    <TableCell>{wf.stepCount ?? 0}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/workbench/${encodeURIComponent(wf.filename)}`}>
                            <LogIn className="w-3 h-3 mr-1" />
                            进入
                          </Link>
                        </Button>
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/workbench/${encodeURIComponent(wf.filename)}?mode=design`}>
                            <Edit className="w-3 h-3" />
                          </Link>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => { setReferenceWorkflow(wf.filename); setShowNewModal(true); }}
                        >
                          <Copy className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDelete(wf.filename)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          /* Gallery view */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredWorkflows.map((workflow, index) => (
              <motion.div
                key={workflow.filename}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className={cn(
                  'relative group rounded-xl border bg-card p-5 hover:shadow-md transition-all',
                  selectedWorkflows.has(workflow.filename)
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-border/50'
                )}
              >
                {/* Checkbox */}
                <div className="absolute top-3 left-3 z-10">
                  <Checkbox
                    checked={selectedWorkflows.has(workflow.filename)}
                    onCheckedChange={() => toggleSelect(workflow.filename)}
                  />
                </div>

                <div className="pl-6">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold truncate">{workflow.name}</h3>
                      <p className="text-xs text-muted-foreground mt-1 font-mono">{workflow.filename}</p>
                    </div>
                    <Badge className={cn('ml-2 shrink-0', modeBadgeClass(workflow.mode))}>
                      {modeLabel(workflow.mode)}
                    </Badge>
                  </div>

                  {workflow.description && (
                    <p className="text-sm text-muted-foreground mb-3 line-clamp-2">{workflow.description}</p>
                  )}

                  <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
                    <span>{workflow.phaseCount ?? 0} 个{workflow.mode === 'state-machine' ? '状态' : '阶段'}</span>
                    <span>{workflow.stepCount ?? 0} 个步骤</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}`}>
                        <LogIn className="w-3 h-3 mr-1" />
                        进入
                      </Link>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/workbench/${encodeURIComponent(workflow.filename)}?mode=design`}>
                        <Edit className="w-3 h-3" />
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => { setReferenceWorkflow(workflow.filename); setShowNewModal(true); }}
                      title="基于该工作流创建新的工作流"
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handleDelete(workflow.filename)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => { setShowNewModal(false); setReferenceWorkflow(''); }}
          initialReferenceWorkflow={referenceWorkflow || undefined}
          hideAiGuided
          onSuccess={(filename) => {
            setShowNewModal(false);
            setReferenceWorkflow('');
            loadWorkflows();
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }}
        />
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}

      {/* AI 引导创建指南弹窗 */}
      <Dialog open={showAIGuide} onOpenChange={setShowAIGuide}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="material-symbols-outlined text-xl">auto_awesome</span>
              AI 引导创建工作流
            </DialogTitle>
            <DialogDescription>
              先描述目标，再创建工作流
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              这类操作依赖当前对话上下文。先把目标、工作目录和约束告诉 AI，再让它生成右侧表单预填信息会更稳定。
            </p>

            <div className="text-sm font-medium">建议先发送这样一条消息</div>
            <div className="rounded-lg border bg-muted/50 p-3">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-base text-primary mt-0.5">smart_toy</span>
                <p className="text-sm italic text-muted-foreground">
                  {AI_GUIDE_SAMPLE_MESSAGE}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium flex items-center gap-1.5">
                <span className="material-symbols-outlined text-base text-primary">auto_awesome</span>
                AI 将这样推进
              </div>
              <ul className="space-y-1.5 text-sm text-muted-foreground pl-6">
                <li>先确认你的目标、输入、工作目录和约束。</li>
                <li>整理出阶段、候选 Agent、工作流结构和关键风险。</li>
                <li>把这些信息同步到右侧工作流表单，再进入创建。</li>
              </ul>
            </div>

            <p className="text-xs text-muted-foreground">
              点击下面按钮后，这条示例消息会直接放入输入框，不会自动发送。你可以先补充细节，再手动发出。
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowAIGuide(false)}>
              稍后再说
            </Button>
            <Button onClick={handleAIGuideConfirm}>
              <span className="material-symbols-outlined text-sm mr-1.5">edit_note</span>
              把示例消息放入输入框
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
