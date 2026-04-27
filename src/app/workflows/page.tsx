'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { configApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useTranslations } from '@/hooks/useTranslations';
import { Search, Plus, LogIn, Edit, Copy, Trash2, ArrowLeft, FileText, History } from 'lucide-react';
import NewConfigModal from '@/components/NewConfigModal';
import { useToast } from '@/components/ui/toast';
import { useConfirmDialog } from '@/hooks/useConfirmDialog';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import ConfirmDialog from '@/components/ConfirmDialog';

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

export default function WorkflowsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const { toast } = useToast();
  const { confirm, dialogProps } = useConfirmDialog();
  const [workflows, setWorkflows] = useState<WorkflowConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [referenceWorkflow, setReferenceWorkflow] = useState<string>('');

  useDocumentTitle('工作流管理');

  useEffect(() => {
    loadWorkflows();
  }, []);

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
        loadWorkflows();
      } catch (error) {
        toast('error', '无法删除工作流');
      }
    }
  };

  const filteredWorkflows = workflows.filter(wf =>
    wf.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wf.filename.toLowerCase().includes(searchQuery.toLowerCase()) ||
    wf.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
              <Button onClick={() => setShowNewModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                新建工作流
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Search Bar */}
        <div className="mb-6">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="搜索工作流..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>

        {/* Workflows Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-muted-foreground">加载中...</div>
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <FileText className="w-16 h-16 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {searchQuery ? '未找到匹配的工作流' : '还没有工作流'}
            </p>
            {!searchQuery && (
              <Button onClick={() => setShowNewModal(true)}>
                <Plus className="w-4 h-4 mr-2" />
                创建第一个工作流
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredWorkflows.map((workflow, index) => (
              <motion.div
                key={workflow.filename}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="bg-card border border-border rounded-lg p-6 hover:border-primary/50 transition-colors"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold">{workflow.name}</h3>
                      {workflow.mode === 'state-machine' && (
                        <Badge className="bg-gradient-to-r from-purple-500 to-blue-500 text-white border-0 text-xs whitespace-nowrap shrink-0">
                          状态机
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mb-2">{workflow.filename}</p>
                    {workflow.description && (
                      <p className="text-sm text-muted-foreground line-clamp-2">{workflow.description}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-4">
                  <Badge variant="secondary">
                    {workflow.phases || workflow.phaseCount || 0} {workflow.mode === 'state-machine' ? '状态' : '阶段'}
                  </Badge>
                  <Badge variant="secondary">
                    {workflow.steps || workflow.stepCount || 0} 步骤
                  </Badge>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => router.push(`/workbench/${encodeURIComponent(workflow.filename)}?mode=run`)}
                    className="flex-1"
                  >
                    <LogIn className="w-3 h-3 mr-1" />
                    进入
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/workbench/${encodeURIComponent(workflow.filename)}?mode=history`)}
                    title="查看历史记录"
                  >
                    <History className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/workbench/${encodeURIComponent(workflow.filename)}?mode=design`)}
                  >
                    <Edit className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setReferenceWorkflow(workflow.filename);
                      setShowNewModal(true);
                    }}
                    title="基于该工作流创建新的工作流"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDelete(workflow.filename)}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {showNewModal && (
        <NewConfigModal
          isOpen={showNewModal}
          onClose={() => {
            setShowNewModal(false);
            setReferenceWorkflow('');
          }}
          initialReferenceWorkflow={referenceWorkflow || undefined}
          onSuccess={(filename) => {
            setShowNewModal(false);
            setReferenceWorkflow('');
            loadWorkflows();
            router.push(`/workbench/${encodeURIComponent(filename)}?mode=design`);
          }}
        />
      )}

      {dialogProps && <ConfirmDialog {...dialogProps} />}
    </div>
  );
}
