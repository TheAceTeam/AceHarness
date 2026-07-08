'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from '@/lib/navigation/client';
import Link from '@/lib/navigation/client';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { DataCard } from '@/components/ui/data-card';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import {
  DetailDrawer,
  DetailDrawerBody,
  DetailDrawerContent,
  DetailDrawerDescription,
  DetailDrawerFooter,
  DetailDrawerHeader,
  DetailDrawerTitle,
} from '@/components/ui/detail-drawer';
import { ImportModal } from '@/components/ui/import-modal';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { StatusPill } from '@/components/ui/status-pill';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useToast } from '@/components/ui/toast';
import { ArrowLeft, Check, Cpu, Zap, Search, Download, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SingleCombobox } from '@/components/ui/combobox';
import { EngineIcon } from '@/components/EngineIcon';
import { getEngineMeta } from '@/lib/core/engine-metadata';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { modelEnginesSupportEngine } from '@/lib/models/engine-compatibility';
import { cn } from '@/lib/core/utils';
import type { EnginesSearch } from '@/routes/engines';
import {
  useDetectEngineModelsMutation,
  useEngineAvailabilityReportsQuery,
  useEngineConfigQuery,
  useModelsQuery,
  useSaveEngineConfigMutation,
  useSaveModelsMutation,
  useSmokeTestEngineModelsMutation,
} from '@/client/query/engines';

interface ModelOption {
  value: string;
  label: string;
  costMultiplier: number;
  engines?: string[];
  endpoints?: string[];
}

interface DetectedModel {
  modelId: string;
  name: string;
  source?: string;
  recommended?: boolean;
  selected: boolean;
  label: string;
  costMultiplier: number;
}

interface ClaudeModelSmokeResult {
  model: string;
  ok: boolean;
  resolvedModel?: string;
  error?: string;
  durationMs: number;
  preview?: string;
}

interface Engine {
  id: string;
  name: string;
  description: string;
  status: 'available' | 'coming-soon';
  features: string[];
  endpoints: string[];
}

interface EngineAvailabilityReport {
  engine: string;
  available: boolean;
  drivers?: Partial<Record<'stdio' | 'sdk', boolean>>;
}

interface EnginesPageProps {
  routeSearch?: EnginesSearch;
  onRouteSearchChange?: (next: EnginesSearch) => void;
}

const engines: Engine[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic 官方 CLI 工具，功能强大，支持完整的代码编辑和执行能力',
    status: 'available',
    features: ['完整的文件操作', '代码执行', 'Git 集成', 'MCP 工具支持'],
    endpoints: ['anthropic'],
  },
  {
    id: 'kiro-cli',
    name: 'Kiro CLI',
    description: '基于 ACP 协议的 AI 编程助手，支持自定义 Agent 配置',
    status: 'available',
    features: ['ACP 协议', '自定义 Agent', 'JSON-RPC 2.0', '流式输出'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    description: '开源 AI 编程 Agent，支持 ACP 协议，模型在 opencode 配置中设置',
    status: 'available',
    features: ['ACP 协议', 'JSON-RPC 2.0', '开源', '流式输出'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'nga',
    name: 'NGA',
    description: 'OpenCode 兼容 CLI，支持 ACP 协议、流式输出与命令行接入',
    status: 'available',
    features: ['ACP 协议', 'OpenCode 兼容', '流式输出', '命令行集成'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'codegenie',
    name: 'CodeGenie',
    description: 'OpenCode 兼容 CLI，支持 ACP 协议、流式输出与命令行接入',
    status: 'available',
    features: ['ACP 协议', 'OpenCode 兼容', '流式输出', '命令行集成'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex 引擎，专注于代码生成和理解，基于 Codex SDK',
    status: 'available',
    features: ['Codex SDK', '代码生成', '代码补全', '多语言支持', 'API 集成'],
    endpoints: ['openai'],
  },
  {
    id: 'cursor',
    name: 'Cursor CLI',
    description: 'Cursor 命令行工具，提供智能代码编辑和 AI 辅助能力，支持 ACP 协议',
    status: 'available',
    features: ['ACP 协议', '智能补全', '代码重构', '命令行集成', '上下文感知'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'trae-cli',
    name: 'Trae CLI',
    description: 'Trae 命令行 AI 编程助手，支持 ACP 协议，提供智能代码编辑和执行能力',
    status: 'available',
    features: ['ACP 协议', '智能代码编辑', '代码执行', 'MCP 工具支持', '插件系统'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'magic-cli',
    name: 'Magic CLI',
    description: '仓颉 Magic CLI，支持 ACP 协议，[repo url](https://gitcode.com/Cangjie-SIG/magic-cli)',
    status: 'available',
    features: ['ACP 协议', 'JSON-RPC 2.0', '仓颉原生', '流式输出'],
    endpoints: ['anthropic', 'openai'],
  },
];

const CLAUDE_ALIAS_LABELS: Record<string, string> = {
  default: 'Auto (default)',
  best: 'Best',
  sonnet: 'Claude Sonnet',
  opus: 'Claude Opus',
  haiku: 'Claude Haiku',
  opusplan: 'Claude Opus Plan',
};

function AvailabilityPill({ available, checking }: { available?: boolean; checking?: boolean }) {
  if (checking) return <StatusPill tone="info">检查中</StatusPill>;
  if (available === true) return <StatusPill tone="success">可用</StatusPill>;
  if (available === false) return <StatusPill tone="danger">不可用</StatusPill>;
  return <StatusPill tone="neutral">未检测</StatusPill>;
}

function DriverAvailabilityPill({ available }: { available?: boolean }) {
  if (available === true) return <StatusPill tone="success" className="h-5 px-1.5 py-0 text-[10px]">可用</StatusPill>;
  if (available === false) return <StatusPill tone="danger" className="h-5 px-1.5 py-0 text-[10px]">不可用</StatusPill>;
  return <StatusPill tone="neutral" className="h-5 px-1.5 py-0 text-[10px]">未检测</StatusPill>;
}

function getDetectedModelSourceLabel(source?: string) {
  if (source === 'alias') return '官方别名';
  if (source === 'api') return 'Anthropic API';
  if (source === 'config') return '本地配置';
  return '检测结果';
}

export default function EnginesPage({ routeSearch, onRouteSearchChange }: EnginesPageProps = {}) {
  const searchParams = useSearchParams();
  const returnTarget = getOfficeAwareReturnTarget(searchParams.get('from'));
  const { toast } = useToast();
  useDocumentTitle('执行引擎');
  const engineConfigQuery = useEngineConfigQuery();
  const modelsQuery = useModelsQuery();
  const availabilityQuery = useEngineAvailabilityReportsQuery();
  const saveEngineConfigMutation = useSaveEngineConfigMutation();
  const saveModelsMutation = useSaveModelsMutation();
  const detectEngineModelsMutation = useDetectEngineModelsMutation();
  const smokeTestEngineModelsMutation = useSmokeTestEngineModelsMutation();
  const [currentEngine, setCurrentEngine] = useState<string>(routeSearch?.engine || 'claude-code');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [driverSelections, setDriverSelections] = useState<Record<string, 'stdio' | 'sdk'>>({});
  const [models, setModels] = useState<ModelOption[]>([]);
  const [engineAvailability, setEngineAvailability] = useState<Record<string, EngineAvailabilityReport>>({});
  const loading = engineConfigQuery.isLoading || modelsQuery.isLoading;
  const checkingAvailability = availabilityQuery.isFetching;

  const broadcastEngineUpdated = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('engine-config-updated-at', String(Date.now()));
    window.dispatchEvent(new CustomEvent('engine:updated'));
  };

  useEffect(() => {
    if (!modelsQuery.data?.models) return;
    setModels(modelsQuery.data.models as ModelOption[]);
  }, [modelsQuery.data?.models]);

  useEffect(() => {
    const data = engineConfigQuery.data;
    if (!data) return;
    if (data.engine && !routeSearch?.engine) {
      setCurrentEngine(data.engine);
    }
    if (typeof data.defaultModel === 'string') {
      setDefaultModel(data.defaultModel);
    }
    if (data.driver || data.drivers) {
      const validDrivers = Object.fromEntries(
        Object.entries(data.drivers || {}).filter((entry): entry is [string, 'stdio' | 'sdk'] =>
          entry[1] === 'stdio' || entry[1] === 'sdk'
        )
      );
      const currentDriver = data.driver === 'stdio' || data.driver === 'sdk' ? data.driver : undefined;
      setDriverSelections((prev) => ({
        ...prev,
        ...validDrivers,
        ...(data.engine && currentDriver ? { [data.engine]: currentDriver } : {}),
      }));
    }
  }, [engineConfigQuery.data, routeSearch?.engine]);

  useEffect(() => {
    if (routeSearch?.engine && routeSearch.engine !== currentEngine) {
      setCurrentEngine(routeSearch.engine);
    }
  }, [currentEngine, routeSearch?.engine]);

  useEffect(() => {
    if (availabilityQuery.data) {
      setEngineAvailability(availabilityQuery.data);
    }
  }, [availabilityQuery.data]);

  const getModelsForEngine = (engineId: string) =>
    models.filter(m => modelEnginesSupportEngine(m.engines, engineId));

  const getDriverForEngine = (engineId: string): 'stdio' | 'sdk' =>
    driverSelections[engineId] || (engineId === 'codegenie' || engineId === 'nga' ? 'stdio' : 'sdk');

  const getEngineReport = (engineId: string): EngineAvailabilityReport | undefined =>
    engineAvailability[engineId];

  const isEngineAvailable = (engineId: string): boolean | undefined =>
    getEngineReport(engineId)?.available;

  const isDriverAvailable = (engineId: string, driver: 'stdio' | 'sdk'): boolean | undefined =>
    getEngineReport(engineId)?.drivers?.[driver];

  const checkEngineAvailability = async (forceRefresh = false) => {
    if (forceRefresh) {
      await availabilityQuery.refetch();
      return;
    }
    await availabilityQuery.refetch();
  };

  const handleSelectEngine = async (engineId: string) => {
    const engine = engines.find(e => e.id === engineId);
    if (engine?.status === 'coming-soon') {
      return;
    }

    // Check if engine is available before switching
    if (isEngineAvailable(engineId) === false) {
      const hints: Record<string, string> = {
        'kiro-cli': '安装方法：curl -fsSL https://cli.kiro.dev/install | bash',
        'claude-code': '安装方法：npm install -g @anthropic-ai/claude-code',

        'opencode': '安装方法：npm install -g opencode-ai',
        'nga': '请确保已安装 ngagent 并把 nga 命令加入 PATH',
        'codegenie': '请确保已安装 codegenie 并把命令加入 PATH；若 IDE 里找不到命令，请按 CodeGenie 官方安装说明补齐可执行路径',
        'trae-cli': '安装方法：curl -fsSL https://trae.cn/install | bash',
        'magic-cli': '请从 https://gitcode.com/Cangjie-SIG/magic-cli 克隆仓库，并确保当前运行环境可以直接调用 magic-cli.sh',
      };
      const hint = hints[engineId] || '请确保已安装相应的命令行工具';
      toast('error', `引擎 ${engine?.name} 不可用。${hint}`);
      return;
    }

    try {
      await saveEngineConfigMutation.mutateAsync({ engine: engineId });
      setCurrentEngine(engineId);
      onRouteSearchChange?.({ engine: engineId });
      const compatible = getModelsForEngine(engineId);
      if (defaultModel && !compatible.find(m => m.value === defaultModel)) {
        setDefaultModel('');
      }
      broadcastEngineUpdated();
      toast('success', `已切换到 ${engine?.name} 引擎`);
    } catch (error) {
      console.error('Failed to set engine:', error);
      toast('error', '切换引擎失败: ' + (error as Error).message);
    }
  };

  const handleSetDefaultModel = async (modelValue: string) => {
    try {
      await saveEngineConfigMutation.mutateAsync({ engine: currentEngine, defaultModel: modelValue });
      setDefaultModel(modelValue);
      const label = models.find(m => m.value === modelValue)?.label || modelValue;
      broadcastEngineUpdated();
      toast('success', `默认模型已设置: ${label}`);
    } catch (error) {
      console.error('Failed to set default model:', error);
      toast('error', '设置默认模型失败');
    }
  };

  const handleSetEngineDriver = async (engineId: string, nextDriver: 'stdio' | 'sdk') => {
    if (isDriverAvailable(engineId, nextDriver) === false) {
      toast('error', `${engines.find((item) => item.id === engineId)?.name || engineId} 的 ${nextDriver} 驱动当前不可用`);
      return;
    }

    const previousDriver = getDriverForEngine(engineId);
    setDriverSelections((prev) => ({ ...prev, [engineId]: nextDriver }));
    try {
      await saveEngineConfigMutation.mutateAsync({ engine: currentEngine, targetEngine: engineId, driver: nextDriver });
      broadcastEngineUpdated();
      toast('success', `已设置 ${engines.find((item) => item.id === engineId)?.name || engineId} / ${nextDriver}`);
    } catch (error) {
      setDriverSelections((prev) => ({ ...prev, [engineId]: previousDriver }));
      toast('error', error instanceof Error ? error.message : '切换失败');
    }
  };

  // --- Model detection ---
  const [detecting, setDetecting] = useState(false);
  const [detectedModels, setDetectedModels] = useState<DetectedModel[]>([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [detectingEngine, setDetectingEngine] = useState('');
  const [smokeTesting, setSmokeTesting] = useState(false);
  const [showSmokeDialog, setShowSmokeDialog] = useState(false);
  const [smokeResults, setSmokeResults] = useState<ClaudeModelSmokeResult[]>([]);
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);

  const handleDetectModels = async (engineId: string) => {
    setDetecting(true);
    setDetectingEngine(engineId);
    try {
      const driver = getDriverForEngine(engineId);
      const data = await detectEngineModelsMutation.mutateAsync({ engine: engineId, driver });
      if (data.error) {
        toast('error', `检测失败: ${data.error}`);
        return;
      }
      const existing = new Set(models.map(m => m.value));
      const detected: DetectedModel[] = (data.models || []).map((m: any) => ({
        modelId: m.modelId,
        name: m.name,
        source: m.source,
        recommended: Boolean(m.recommended),
        selected: !existing.has(m.modelId),
        label: m.name || m.modelId,
        costMultiplier: models.find(existingModel => existingModel.value === m.modelId)?.costMultiplier || 0.1,
      }));
      setDetectedModels(detected);
      setShowImportDialog(true);
    } catch (error) {
      toast('error', `检测失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDetecting(false);
    }
  };

  const handleImportModels = async () => {
    const toImport = detectedModels.filter(m => m.selected);
    if (toImport.length === 0) {
      toast('warning', '请至少选择一个模型');
      return;
    }
    const mergedMap = new Map(models.map(model => [model.value, { ...model }]));
    for (const model of toImport) {
      const existing = mergedMap.get(model.modelId);
      if (existing) {
        mergedMap.set(model.modelId, {
          ...existing,
          label: model.label || existing.label,
          costMultiplier: model.costMultiplier || existing.costMultiplier,
          engines: Array.from(new Set([...(existing.engines || []), detectingEngine])),
        });
      } else {
        mergedMap.set(model.modelId, {
          value: model.modelId,
          label: model.label,
          costMultiplier: model.costMultiplier,
          endpoints: [],
          engines: [detectingEngine],
        });
      }
    }
    const merged = Array.from(mergedMap.values());
    try {
      await saveMergedModels(merged, `已导入 ${toImport.length} 个模型`);
      setShowImportDialog(false);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '保存模型失败');
    }
  };

  const saveMergedModels = async (merged: ModelOption[], successMessage: string) => {
    await saveModelsMutation.mutateAsync({ models: merged });
    setModels(merged);
    toast('success', successMessage);
  };

  const handleSmokeTestClaudeModels = async () => {
    setSmokeTesting(true);
    try {
      const data = await smokeTestEngineModelsMutation.mutateAsync(['default', 'best', 'sonnet', 'opus', 'haiku', 'opusplan']);
      if (data.error) {
        toast('error', data.error || 'Claude Code 模型测试失败');
        return;
      }
      setSmokeResults((data.results || []) as ClaudeModelSmokeResult[]);
      setShowSmokeDialog(true);
      const passed = (data.results || []).filter((item: ClaudeModelSmokeResult) => item.ok).length;
      toast('success', `Claude Code 模型测试完成：${passed}/${(data.results || []).length} 可用`);
    } catch (error) {
      toast('error', `Claude Code 模型测试失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSmokeTesting(false);
    }
  };

  const handleImportSmokePassedModels = async () => {
    const passed = smokeResults.filter((result) => result.ok);
    if (passed.length === 0) {
      toast('warning', '没有可导入的通过模型');
      return;
    }

    const mergedMap = new Map(models.map((model) => [model.value, { ...model }]));
    for (const result of passed) {
      const existing = mergedMap.get(result.model);
      const label = CLAUDE_ALIAS_LABELS[result.model] || result.resolvedModel || result.model;
      if (existing) {
        mergedMap.set(result.model, {
          ...existing,
          label: existing.label || label,
          engines: Array.from(new Set([...(existing.engines || []), 'claude-code'])),
          endpoints: Array.from(new Set([...(existing.endpoints || []), 'anthropic'])),
        });
      } else {
        mergedMap.set(result.model, {
          value: result.model,
          label,
          costMultiplier: 0.1,
          endpoints: ['anthropic'],
          engines: ['claude-code'],
        });
      }
    }

    try {
      await saveMergedModels(
        Array.from(mergedMap.values()),
        `已导入 ${passed.length} 个通过测试的 Claude Code 模型`,
      );
      setShowSmokeDialog(false);
    } catch (error) {
      toast('error', error instanceof Error ? error.message : '保存模型失败');
    }
  };

  const detectedModelColumns = useMemo<DataTableColumn<DetectedModel>[]>(() => [
    {
      id: 'modelId',
      header: '模型 ID',
      render: (model) => <span className="font-mono text-xs">{model.modelId}</span>,
    },
    {
      id: 'source',
      header: '来源',
      width: 120,
      render: (model) => (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>{getDetectedModelSourceLabel(model.source)}</span>
          {model.recommended ? <StatusPill tone="accent" className="h-5 px-1.5 py-0 text-[10px]">推荐</StatusPill> : null}
        </div>
      ),
    },
    {
      id: 'label',
      header: '显示名称',
      render: (model, index) => (
        <Input
          value={model.label}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDetectedModels((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))}
          className="h-8 text-xs"
        />
      ),
    },
    {
      id: 'costMultiplier',
      header: '费用倍率',
      width: 100,
      render: (model, index) => (
        <Input
          type="number"
          step="0.01"
          value={model.costMultiplier}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDetectedModels((prev) => prev.map((item, itemIndex) => itemIndex === index ? { ...item, costMultiplier: parseFloat(event.target.value) || 0 } : item))}
          className="h-8 w-20 text-xs"
        />
      ),
    },
  ], []);

  const smokeResultColumns = useMemo<DataTableColumn<ClaudeModelSmokeResult>[]>(() => [
    {
      id: 'model',
      header: '别名',
      width: 110,
      render: (result) => <span className="font-mono text-xs">{result.model}</span>,
    },
    {
      id: 'status',
      header: '状态',
      width: 90,
      render: (result) => <StatusPill tone={result.ok ? 'success' : 'danger'}>{result.ok ? '可用' : '失败'}</StatusPill>,
    },
    {
      id: 'resolvedModel',
      header: '实际模型',
      render: (result) => <span className="font-mono text-xs">{result.resolvedModel || '未返回'}</span>,
    },
    {
      id: 'duration',
      header: '耗时',
      width: 90,
      render: (result) => <span className="text-xs">{(result.durationMs / 1000).toFixed(1)}s</span>,
    },
    {
      id: 'detail',
      header: '详情',
      render: (result) => <span className="text-xs text-muted-foreground">{result.ok ? (result.preview || 'OK') : (result.error || 'Unknown error')}</span>,
    },
  ], []);

  const { isDashboardShell } = useDashboardShellHeader({
    title: '引擎管理',
    subtitle: '选择和配置 AI 编程引擎',
  }, []);
  const currentEngineMeta = engines.find(e => e.id === currentEngine);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      {!isDashboardShell ? (
        <PageHeader
          className="sticky top-0 z-50 bg-card"
          title="引擎管理"
          subtitle="配置 AI 编程引擎、默认模型和可用性检测"
          eyebrow="SYSTEM"
          status={<AvailabilityPill available={isEngineAvailable(currentEngine)} checking={checkingAvailability} />}
          secondaryActions={(
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href={returnTarget.href}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {returnTarget.label}
                </Link>
              </Button>
              <LanguageToggle />
              <ThemeToggle />
            </>
          )}
          primaryAction={(
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkEngineAvailability(true)}
              disabled={checkingAvailability}
            >
              {checkingAvailability ? '检查中...' : '刷新可用性'}
            </Button>
          )}
        />
      ) : null}

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Current Engine Banner */}
        <PageToolbar
          className="mb-5 rounded-lg border bg-card"
          search={(
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40 text-muted-foreground">
                <Cpu className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold">当前引擎：{currentEngineMeta?.name || 'Claude Code'}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <AvailabilityPill available={isEngineAvailable(currentEngine)} checking={checkingAvailability} />
                  <span>{getModelsForEngine(currentEngine).length} 个兼容模型</span>
                  <span>默认模型：{defaultModel || '未设置'}</span>
                </div>
              </div>
            </div>
          )}
          actions={(
            <Button variant="outline" size="sm" onClick={() => setSetupDrawerOpen(true)}>
              <Info className="mr-2 h-4 w-4" />
              安装与服务说明
            </Button>
          )}
        />

        {/* Engines Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {engines.map((engine, index) => (
            <motion.div
              key={engine.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <DataCard
                selected={currentEngine === engine.id}
                disabled={engine.status === 'coming-soon'}
                className={cn(
                  'relative min-h-full p-5',
                  engine.status === 'coming-soon' ? 'opacity-60' : 'cursor-pointer'
                )}
                onClick={() => handleSelectEngine(engine.id)}
              >
              {/* Selected Badge */}
              {currentEngine === engine.id && (
                <div className="absolute top-4 right-4">
                  <StatusPill tone="accent">
                    <Check className="w-3 h-3 mr-1" />
                    使用中
                  </StatusPill>
                </div>
              )}

              {/* Coming Soon Badge */}
              {engine.status === 'coming-soon' && (
                <div className="absolute top-4 right-4">
                  <StatusPill tone="neutral">即将推出</StatusPill>
                </div>
              )}

              {/* Availability Badge */}
              {engine.status === 'available' && currentEngine !== engine.id && (
                <div className="absolute top-4 right-4">
                  <AvailabilityPill available={isEngineAvailable(engine.id)} checking={checkingAvailability} />
                </div>
              )}

              {/* Engine Icon */}
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-muted/30">
                <EngineIcon engineId={engine.id} className="h-8 w-8" decorative={false} alt={engine.name} />
              </div>

              {/* Engine Info */}
              <h3 className="mb-2 text-base font-semibold">{engine.name}</h3>
              <p className="text-sm text-muted-foreground mb-4">{engine.description}</p>

              {/* Features */}
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">特性：</p>
                <div className="flex flex-wrap gap-2">
                  {engine.features.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* API Endpoints */}
              <div className="space-y-2 mt-3">
                <p className="text-xs font-medium text-muted-foreground">API 端点：</p>
                <div className="flex flex-wrap gap-2">
                  {engine.endpoints.map((endpoint) => (
                    <Badge key={endpoint} variant="outline" className="text-xs">
                      {endpoint}
                    </Badge>
                  ))}
                </div>
              </div>

              {engine.status === 'available' && ['claude-code', 'opencode', 'nga', 'codegenie'].includes(engine.id) && (
                <div className="mt-4 pt-4 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                  <p className="text-xs font-medium text-muted-foreground mb-2">驱动模式：</p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={getDriverForEngine(engine.id) === 'stdio' ? 'secondary' : 'outline'}
                      className="flex-1 h-8 text-xs justify-between gap-2"
                      disabled={checkingAvailability || isDriverAvailable(engine.id, 'stdio') === false}
                      onClick={() => handleSetEngineDriver(engine.id, 'stdio')}
                    >
                      <span>stdio (ACP)</span>
                      <DriverAvailabilityPill available={isDriverAvailable(engine.id, 'stdio')} />
                    </Button>
                    <Button
                      size="sm"
                      variant={getDriverForEngine(engine.id) === 'sdk' ? 'secondary' : 'outline'}
                      className="flex-1 h-8 text-xs justify-between gap-2"
                      disabled={checkingAvailability || isDriverAvailable(engine.id, 'sdk') === false}
                      onClick={() => handleSetEngineDriver(engine.id, 'sdk')}
                    >
                      <span>SDK (HTTP)</span>
                      <DriverAvailabilityPill available={isDriverAvailable(engine.id, 'sdk')} />
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {checkingAvailability
                      ? '驱动可用性检测中'
                      : '点击驱动按钮会切换到对应的引擎接入方式'}
                  </p>
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    {engine.id === 'claude-code'
                      ? (getDriverForEngine(engine.id) === 'sdk'
                        ? 'SDK 模式使用 @anthropic-ai/claude-agent-sdk，保持当前 Claude Code 默认接入方式'
                        : 'stdio 模式通过 claude-agent-acp 走 ACP 协议，适合统一到 ACP 驱动栈')
                      : (getDriverForEngine(engine.id) === 'sdk'
                        ? 'SDK 模式通过 HTTP API 通信，一个 server 服务所有会话，更稳定'
                        : 'stdio 模式通过子进程 stdin/stdout 通信，兼容旧版本')}
                  </p>
                </div>
              )}

              {/* Select Button */}
              {engine.status === 'available' && currentEngine !== engine.id && (
                <Button
                  className="w-full mt-4"
                  variant="outline"
                  disabled={checkingAvailability}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectEngine(engine.id);
                  }}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  切换到此引擎
                </Button>
              )}

              {engine.status === 'available' && !['codex', 'magic-cli'].includes(engine.id) && (
                <div className="mt-3" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={detecting}
                    onClick={() => handleDetectModels(engine.id)}
                  >
                    <Search className="w-4 h-4 mr-2" />
                    {detecting && detectingEngine === engine.id ? '检测中...' : '检测可用模型'}
                  </Button>
                  {engine.id === 'claude-code' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full mt-2"
                      disabled={smokeTesting}
                      onClick={handleSmokeTestClaudeModels}
                    >
                      <Search className="w-4 h-4 mr-2" />
                      {smokeTesting ? '测试中...' : '测试官方别名'}
                    </Button>
                  )}
                </div>
              )}

              {/* Default Model Selector — only for current engine */}
              {currentEngine === engine.id && (
                <div className="mt-4 pt-4 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                  <p className="text-xs font-medium text-muted-foreground mb-2">默认模型：</p>
                  <SingleCombobox
                    value={defaultModel}
                    onValueChange={(v) => handleSetDefaultModel(v)}
                    options={[
                      { value: '', label: '未设置（使用全局默认）' },
                      ...getModelsForEngine(engine.id).map(m => ({
                        value: m.value,
                        label: `${m.label} (${m.costMultiplier}x)`,
                      })),
                    ]}
                    placeholder="选择默认模型"
                    triggerClassName="h-9 text-sm"
                  />
                </div>
              )}
              </DataCard>
            </motion.div>
          ))}
        </div>

        {/* Setup summary */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6"
        >
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-semibold text-foreground">引擎安装与服务说明</div>
              <div className="mt-1">高级安装命令、驱动说明和 ACE Service 指导已集中到右侧说明面板。</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSetupDrawerOpen(true)}
            >
              <Info className="mr-2 h-4 w-4" />
              查看说明
            </Button>
          </div>
        </motion.div>
      </div>

      <DetailDrawer open={setupDrawerOpen} onOpenChange={setSetupDrawerOpen}>
        <DetailDrawerContent widthClassName="w-[min(520px,calc(100vw-1rem))]">
          <DetailDrawerHeader>
            <DetailDrawerTitle>安装与服务说明</DetailDrawerTitle>
            <DetailDrawerDescription>当前引擎：{currentEngineMeta?.name || currentEngine}</DetailDrawerDescription>
          </DetailDrawerHeader>
          <DetailDrawerBody className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">引擎范围</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Aceharness 支持 Opencode、Claude Code、Kiro CLI 等 AI Agent 框架，并通过 ACP/MCP 能力接入代码编辑与执行流程。
              </p>
            </section>

            {[
              ['安装 Claude Code', 'npm install -g @anthropic-ai/claude-code', '安装后刷新可用性检查，即可切换使用 Claude Code 引擎。'],
              ['安装 Kiro CLI', 'curl -fsSL https://cli.kiro.dev/install | bash', '安装后刷新可用性检查，即可切换使用 Kiro CLI 引擎。'],
              ['安装 OpenCode', 'npm install -g opencode-ai', '安装后刷新可用性检查，即可切换使用 OpenCode 引擎。'],
              ['安装 Codex', 'npm install -g @openai/codex-cli', '安装后刷新可用性检查，即可切换使用 Codex 引擎。'],
              ['安装 Cursor CLI', 'curl -fsSL https://cursor.sh/install | bash', '安装后刷新可用性检查，即可切换使用 Cursor CLI 引擎。'],
              ['安装 Trae CLI', 'curl -fsSL https://trae.cn/install | bash', '安装后刷新可用性检查，即可切换使用 Trae CLI 引擎。'],
            ].map(([title, command, description]) => (
              <section key={title} className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{title}</h3>
                <code className="block rounded-lg border border-border bg-background/60 p-2 text-xs text-foreground">
                  {command}
                </code>
                <p className="text-xs leading-5 text-muted-foreground">{description}</p>
              </section>
            ))}

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">配置 Magic CLI</h3>
              <p className="text-xs leading-5 text-muted-foreground">
                从仓库克隆后，确保当前运行环境可以直接调用 magic-cli.sh；完成后刷新可用性检查，即可切换使用 Magic CLI 引擎。
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">ACE Service 使用指导</h3>
              <div className="space-y-1.5 rounded-lg border border-border bg-background/60 p-3 text-xs leading-6 text-muted-foreground">
                <p>全局安装后，使用 <code>ace</code> 或 <code>ace start</code> 启动本地 ACE Service。首次启动会引导你完成语言、默认引擎、默认模型、管理员账号和网络模式配置。</p>
                <p>启动向导里可直接开启后台运行。后台模式会把服务脱离当前终端继续运行，适合常驻使用。</p>
                <p>若同时启用守护进程，ACE 会以 daemon 模式托管后台服务；当后台实例异常退出时，会自动重新拉起。</p>
                <p>服务启动后，可用 <code>ace service</code> 查看当前受管实例，并按提示停止指定实例。</p>
              </div>
            </section>
          </DetailDrawerBody>
          <DetailDrawerFooter className="justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkEngineAvailability(true)}
              disabled={checkingAvailability}
            >
              {checkingAvailability ? '检查中...' : '刷新可用性'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSetupDrawerOpen(false)}>
              关闭
            </Button>
          </DetailDrawerFooter>
        </DetailDrawerContent>
      </DetailDrawer>

      <ImportModal
        open={showImportDialog}
        title={(
          <span className="inline-flex items-center gap-2">
            <Download className="h-5 w-5" />
            导入模型 - {engines.find(e => e.id === detectingEngine)?.name}
          </span>
        )}
        description={`检测到 ${detectedModels.length} 个模型，勾选要导入到模型列表的模型。`}
        sourceOptions={[
          {
            id: detectingEngine || 'detected-engine',
            label: engines.find(e => e.id === detectingEngine)?.name || detectingEngine || '检测结果',
            description: '使用当前引擎检测到的模型结果。',
            icon: detectingEngine ? <EngineIcon engineId={detectingEngine} className="h-4 w-4" decorative={false} alt={detectingEngine} /> : <Download className="h-4 w-4" />,
            selected: true,
          },
        ]}
        stages={['preview']}
        currentStage="preview"
        contentClassName="max-w-3xl"
        nextLabel={(
          <span className="inline-flex items-center gap-2">
            <Download className="h-4 w-4" />
            导入选中模型
          </span>
        )}
        footerMeta={`已选择 ${detectedModels.filter(m => m.selected).length} / ${detectedModels.length}`}
        onNext={handleImportModels}
        onCancel={() => setShowImportDialog(false)}
        onOpenChange={setShowImportDialog}
        previewContent={(
          <DataTable
            columns={detectedModelColumns}
            rows={detectedModels}
            rowKey="modelId"
            density="compact"
            stickyHeader
            selection={{
              selectedKeys: detectedModels.filter((model) => model.selected).map((model) => model.modelId),
              onSelectedKeysChange: (keys) => {
                const selected = new Set(keys.map(String));
                setDetectedModels((prev) => prev.map((model) => ({ ...model, selected: selected.has(model.modelId) })));
              },
              ariaLabel: '选择要导入的模型',
            }}
            emptyState={{
              title: '未检测到模型',
              description: '当前引擎没有返回可导入模型。',
              className: 'min-h-[220px]',
            }}
            className="min-h-0 flex-1 overflow-auto"
            aria-label="检测模型导入预览"
          />
        )}
      />

      <Dialog open={showSmokeDialog} onOpenChange={setShowSmokeDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogTitle className="text-lg font-semibold">
            <Search className="w-5 h-5 inline mr-2" />
            Claude Code 官方别名测试
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            通过真实请求测试 alias 是否可用；如果 SDK 暴露了实际模型名，会显示在“实际模型”列。
          </p>
          <DataTable
            columns={smokeResultColumns}
            rows={smokeResults}
            rowKey="model"
            density="compact"
            stickyHeader
            emptyState={{
              title: '暂无测试结果',
              description: '运行官方别名测试后会显示结果。',
              className: 'min-h-[220px]',
            }}
            className="min-h-0 flex-1 overflow-auto"
            aria-label="Claude Code 官方别名测试结果"
          />
          <div className="flex justify-between items-center pt-2">
            <span className="text-xs text-muted-foreground">
              通过 {smokeResults.filter((result) => result.ok).length} / {smokeResults.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowSmokeDialog(false)}>关闭</Button>
              <Button onClick={handleImportSmokePassedModels}>
                <Download className="w-4 h-4 mr-2" />
                导入通过测试的模型
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
