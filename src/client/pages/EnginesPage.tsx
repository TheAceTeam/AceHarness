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
import { ArrowLeft, Check, Cpu, Zap, Search, Download, RefreshCw, Info } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { AiModelSelectorField } from '@/components/AiModelSelectorField';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { getOfficeAwareReturnTarget } from '@/lib/navigation/return-target';
import { useDashboardShellHeader } from '@/components/dashboard/DashboardShellHeader';
import { modelEnginesSupportEngine, normalizeRuntimeEngineId } from '@/lib/models/engine-compatibility';
import { mergeDetectedModelsForImport } from '@/lib/models/import-merge';
import { cn } from '@/lib/core/utils';
import type { EnginesSearch } from '@/routes/engines';
import {
  useDetectEngineModelsMutation,
  useEngineAvailabilityReportsQuery,
  useEngineConfigQuery,
  useModelsQuery,
  useSaveEngineConfigMutation,
  useSaveModelsMutation,
} from '@/client/query/engines';

interface ModelOption {
  value: string;
  label: string;
  costMultiplier: number;
  engines?: string[];
  endpoints: string[];
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

interface Engine {
  id: string;
  name: string;
  description: string;
  status: 'available' | 'coming-soon';
  agentId: string;
  iconPath?: string;
  canDetectModels?: boolean;
  features: string[];
  endpoints: string[];
}

interface EngineAvailabilityReport {
  engine: string;
  available?: boolean;
  diagnostics?: {
    summary?: string;
    checkedAt?: string;
    error?: string;
    status?: string;
  };
}

interface EnginesPageProps {
  routeSearch?: EnginesSearch;
  onRouteSearchChange?: (next: EnginesSearch) => void;
}

const PRODUCT_ENGINE_ORDER = [
  'codex',
  'claude',
  'opencode',
  'cursor',
  'kiro',
  'trae',
  'nga',
  'codegenie',
  'cangjie-magic',
  'pi',
  'openclaw',
  'gemini',
  'copilot',
  'kilocode',
  'kimi',
  'mux',
  'qoder',
  'qwen',
] as const;

const RUNTIME_AGENT_ICON_PATHS: Record<string, string> = {
  claude: '/engines/claude.svg',
  kiro: '/engines/kiro.svg',
  opencode: '/engines/opencode.svg',
  nga: '/engines/code-agent.svg',
  codegenie: '/engines/code-genie.svg',
  codex: '/engines/codex.svg',
  cursor: '/engines/cursor.svg',
  trae: '/engines/trae.svg',
  'cangjie-magic': '/engines/magic-cli.svg',
  openclaw: '/engines/openclaw.svg',
  gemini: '/engines/gemini.svg',
  copilot: '/engines/copilot.svg',
  kilocode: '/engines/kilocode.svg',
  kimi: '/engines/kimi.svg',
  mux: '/engines/mux.svg',
  pi: '/engines/pi.svg',
  qoder: '/engines/generic-provider.svg',
  qwen: '/engines/qwen.svg',
};

const STATIC_ENGINE_METADATA: Record<string, Omit<Engine, 'id' | 'status' | 'agentId'>> = {
  claude: {
    name: 'Claude Code',
    description: '官方编程助手，适合仓库理解、代码编辑和任务执行。',
    features: ['完整的文件操作', '代码执行', 'Git 集成', 'MCP 工具支持'],
    endpoints: ['anthropic'],
  },
  kiro: {
    name: 'Kiro CLI',
    description: '面向日常开发的 AI 编程助手，支持按项目配置和持续输出。',
    features: ['自定义 Agent', 'JSON-RPC 2.0', '流式输出', '项目配置'],
    endpoints: ['anthropic', 'openai'],
  },
  opencode: {
    name: 'OpenCode',
    description: '开源 AI 编程助手，适合本地工作流和可控的模型配置。',
    features: ['开源', 'JSON-RPC 2.0', '流式输出', '本地工作流'],
    endpoints: ['anthropic', 'openai'],
  },
  nga: {
    name: 'NGA',
    description: '兼容 OpenCode 使用习惯的编程助手，适合命令行开发流程。',
    features: ['OpenCode 兼容', '流式输出', '命令行集成', '代码编辑'],
    endpoints: ['anthropic', 'openai'],
  },
  codegenie: {
    name: 'CodeGenie',
    description: '兼容 OpenCode 使用习惯的编程助手，适合代码编辑和执行任务。',
    features: ['OpenCode 兼容', '流式输出', '命令行集成', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
  codex: {
    name: 'Codex',
    description: 'Codex 编程助手，专注于代码生成、理解和仓库级任务执行。',
    features: ['代码生成', '代码补全', '多语言支持', '仓库理解'],
    endpoints: ['openai'],
  },
  cursor: {
    name: 'Cursor CLI',
    description: 'Cursor 的命令行编程助手，提供智能代码编辑和上下文辅助。',
    features: ['智能补全', '代码重构', '命令行集成', '上下文感知'],
    endpoints: ['anthropic', 'openai'],
  },
  trae: {
    name: 'Trae CLI',
    description: 'Trae 的 AI 编程助手，提供智能代码编辑和任务执行能力。',
    features: ['智能代码编辑', '代码执行', 'MCP 工具支持', '插件系统'],
    endpoints: ['anthropic', 'openai'],
  },
  'cangjie-magic': {
    name: 'Magic CLI',
    description: '仓颉 Magic 编程助手，适合仓颉项目的代码编辑和任务执行。',
    canDetectModels: false,
    features: ['JSON-RPC 2.0', '仓颉原生', '流式输出', '代码编辑'],
    endpoints: ['anthropic', 'openai'],
  },
  pi: {
    name: 'Pi',
    description: 'Pi 编程助手，适合探索式代码协作和任务执行。',
    features: ['代码编辑', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
  openclaw: {
    name: 'OpenClaw',
    description: 'OpenClaw 编程助手，适合本地命令行开发流程。',
    features: ['代码编辑', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
  gemini: {
    name: 'Gemini',
    description: 'Gemini 编程助手，适合多模态理解、代码编辑和仓库任务。',
    features: ['代码编辑', '上下文理解', '任务执行'],
    endpoints: ['openai'],
  },
  copilot: {
    name: 'Copilot',
    description: 'Copilot 编程助手，适合日常代码补全、编辑和任务执行。',
    features: ['代码补全', '代码编辑', '任务执行'],
    endpoints: ['openai'],
  },
  kilocode: {
    name: 'Kilo Code',
    description: 'Kilo Code 编程助手，适合命令行代码编辑和自动化执行。',
    features: ['代码编辑', '命令行集成', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
  kimi: {
    name: 'Kimi',
    description: 'Kimi 编程助手，适合长上下文阅读、代码理解和任务执行。',
    features: ['长上下文', '代码理解', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
  mux: {
    name: 'Mux',
    description: 'Mux 编程助手，适合多任务编排和命令行开发流程。',
    features: ['任务编排', '代码编辑', '命令行集成'],
    endpoints: ['anthropic', 'openai'],
  },
  qoder: {
    name: 'Qoder',
    description: 'Qoder 编程助手，适合仓库级代码生成、审查和任务执行。',
    features: ['代码生成', '代码审查', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
  qwen: {
    name: 'Qwen',
    description: 'Qwen 编程助手，适合中文代码协作、仓库理解和任务执行。',
    features: ['中文协作', '代码理解', '任务执行'],
    endpoints: ['anthropic', 'openai'],
  },
};

function normalizeEngineId(engine?: string | null) {
  return normalizeRuntimeEngineId(engine);
}

function buildRuntimeEngineCard(id: string): Engine {
  const canonicalId = normalizeEngineId(id);
  const metadata = STATIC_ENGINE_METADATA[canonicalId];
  return {
    id: canonicalId,
    name: metadata?.name || canonicalId,
    description: metadata?.description || `${canonicalId} 编程助手`,
    status: 'available',
    agentId: canonicalId,
    iconPath: metadata?.iconPath || RUNTIME_AGENT_ICON_PATHS[canonicalId],
    canDetectModels: metadata?.canDetectModels,
    features: metadata?.features || ['代码编辑', '任务执行'],
    endpoints: metadata?.endpoints || [],
  };
}

function RuntimeEngineIcon({ engine, className = 'h-8 w-8' }: { engine?: Pick<Engine, 'name' | 'iconPath'>; className?: string }) {
  if (engine?.iconPath) {
    return <img src={engine.iconPath} alt={engine.name} className={cn('shrink-0 object-contain', className)} />;
  }
  return <Cpu className={cn('shrink-0 text-muted-foreground', className)} />;
}

function EngineStatusPill({ available, checking }: { available?: boolean; checking?: boolean }) {
  if (checking && available === undefined) return <StatusPill tone="info">检查中</StatusPill>;
  if (available === true) return <StatusPill tone="success">可用</StatusPill>;
  if (available === false) return <StatusPill tone="danger">不可用</StatusPill>;
  return <StatusPill tone="neutral">未检测</StatusPill>;
}

function getDefaultModelLabel(modelValue: string, compatibleModels: ModelOption[]) {
  if (!modelValue) return '使用全局默认模型';
  return compatibleModels.find((model) => model.value === modelValue)?.label || modelValue;
}

function getAvailabilityValue(report?: EngineAvailabilityReport): boolean | undefined {
  if (!report) return undefined;
  if (report.available === true) return true;
  if (report.available === false && (report.diagnostics?.checkedAt || report.diagnostics?.error)) return false;
  return undefined;
}

function getDetectedModelSourceLabel(source?: string) {
  if (source === 'alias') return '官方别名';
  if (source === 'api') return '接口检测';
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
  const [availabilityRefreshToken, setAvailabilityRefreshToken] = useState(1);
  const availabilityQuery = useEngineAvailabilityReportsQuery({
    forceRefresh: availabilityRefreshToken > 0,
    refreshToken: availabilityRefreshToken,
  });
  const saveEngineConfigMutation = useSaveEngineConfigMutation();
  const saveModelsMutation = useSaveModelsMutation();
  const detectEngineModelsMutation = useDetectEngineModelsMutation();
  const [currentEngine, setCurrentEngine] = useState<string>(normalizeEngineId(routeSearch?.engine) || 'claude');
  const [selectedEngine, setSelectedEngine] = useState<string>(normalizeEngineId(routeSearch?.engine) || 'claude');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [engineAvailability, setEngineAvailability] = useState<Record<string, EngineAvailabilityReport>>({});
  const checkingAvailability = availabilityQuery.isFetching;
  const refreshingAvailability = availabilityQuery.isFetching;
  const engines = useMemo(() => PRODUCT_ENGINE_ORDER.map((id) => buildRuntimeEngineCard(id)), []);

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
      const nextEngine = normalizeEngineId(data.engine) || 'claude';
      setCurrentEngine(nextEngine);
      setSelectedEngine(nextEngine);
    }
    if (typeof data.defaultModel === 'string') {
      setDefaultModel(data.defaultModel);
    }
  }, [engineConfigQuery.data, routeSearch?.engine]);

  useEffect(() => {
    const routeEngine = normalizeEngineId(routeSearch?.engine);
    if (routeEngine && routeEngine !== selectedEngine) {
      setSelectedEngine(routeEngine);
    }
  }, [routeSearch?.engine, selectedEngine]);

  useEffect(() => {
    if (availabilityQuery.data) {
      setEngineAvailability(Object.fromEntries(
        Object.entries(availabilityQuery.data).map(([engine, report]) => [
          normalizeEngineId(engine) || engine,
          { ...report, engine: normalizeEngineId(report.engine) || report.engine },
        ]),
      ));
    }
  }, [availabilityQuery.data]);

  const getModelsForEngine = (engineId: string) => {
    const normalizedEngineId = normalizeEngineId(engineId);
    return models.filter((model) => {
      const engines = Array.isArray(model.engines) ? model.engines : [];
      if (engines.length === 0) return false;
      return modelEnginesSupportEngine(engines, normalizedEngineId);
    });
  };

  const isEngineAvailable = (engineId: string): boolean | undefined =>
    getAvailabilityValue(engineAvailability[normalizeEngineId(engineId)]);

  const checkEngineAvailability = async (forceRefresh = false) => {
    if (forceRefresh) {
      setAvailabilityRefreshToken((value) => value + 1);
      return;
    }
    await availabilityQuery.refetch();
  };

  const handleSelectEngine = async (engineId: string) => {
    const normalizedEngineId = normalizeEngineId(engineId);
    const engine = engines.find(e => e.id === normalizedEngineId);
    if (engine?.status === 'coming-soon') {
      return;
    }

    // Check if engine is available before switching
    if (isEngineAvailable(normalizedEngineId) === false) {
      const hints: Record<string, string> = {
        kiro: '安装方法：curl -fsSL https://cli.kiro.dev/install | bash',
        claude: '安装方法：npm install -g @anthropic-ai/claude-code',
        opencode: '安装方法：npm install -g opencode-ai',
        nga: '请先安装 ngagent，并确认 nga 命令可用',
        codegenie: '请先安装 CodeGenie，并确认 codegenie 命令可用',
        trae: '安装方法：curl -fsSL https://trae.cn/install | bash',
        'cangjie-magic': '请先配置 Magic CLI，并确认 magic-cli.sh 可用',
      };
      const hint = hints[normalizedEngineId] || '请确保已安装相应的命令行工具';
      toast('error', `引擎 ${engine?.name || normalizedEngineId} 不可用。${hint}`);
      return;
    }

    try {
      await saveEngineConfigMutation.mutateAsync({ engine: normalizedEngineId });
      setCurrentEngine(normalizedEngineId);
      setSelectedEngine(normalizedEngineId);
      onRouteSearchChange?.({ engine: normalizedEngineId });
      const compatible = getModelsForEngine(normalizedEngineId);
      if (defaultModel && !compatible.find(m => m.value === defaultModel)) {
        setDefaultModel('');
      }
      broadcastEngineUpdated();
      toast('success', `已切换到 ${engine?.name || normalizedEngineId}`);
    } catch (error) {
      console.error('Failed to set engine:', error);
      toast('error', '切换引擎失败: ' + (error as Error).message);
    }
  };

  const handleSetDefaultModel = async (modelValue: string) => {
    try {
      await saveEngineConfigMutation.mutateAsync({ engine: currentEngine, defaultModel: modelValue });
      setDefaultModel(modelValue);
      const label = modelValue ? models.find(m => m.value === modelValue)?.label || modelValue : '使用全局默认模型';
      broadcastEngineUpdated();
      toast('success', `默认模型已设置: ${label}`);
    } catch (error) {
      console.error('Failed to set default model:', error);
      toast('error', '设置默认模型失败');
    }
  };

  // --- Model detection ---
  const [detecting, setDetecting] = useState(false);
  const [detectedModels, setDetectedModels] = useState<DetectedModel[]>([]);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [detectingEngine, setDetectingEngine] = useState('');
  const [setupDrawerOpen, setSetupDrawerOpen] = useState(false);

  const handleDetectModels = async (engineId: string) => {
    setDetecting(true);
    setDetectingEngine(engineId);
    try {
      const data = await detectEngineModelsMutation.mutateAsync({ engine: engineId });
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
        costMultiplier: models.find(existingModel => existingModel.value === m.modelId)?.costMultiplier ?? 1,
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
    const merged = mergeDetectedModelsForImport({ models, detectedModels: toImport, engine: detectingEngine });
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

  const { isDashboardShell } = useDashboardShellHeader({
    title: '引擎管理',
    subtitle: '选择和配置 AI 编程引擎',
  }, []);
  const currentEngineMeta = engines.find(e => e.id === currentEngine);
  const selectedEngineMeta = engines.find(e => e.id === selectedEngine) || currentEngineMeta;
  const detectingEngineMeta = engines.find(e => e.id === detectingEngine);
  const selectedCompatibleModels = selectedEngineMeta ? getModelsForEngine(selectedEngineMeta.id) : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      {!isDashboardShell ? (
        <PageHeader
          className="sticky top-0 z-50 bg-card"
          title="引擎管理"
          subtitle="配置 AI 编程引擎、默认模型和可用性检测"
          eyebrow="SYSTEM"
          status={<EngineStatusPill available={isEngineAvailable(currentEngine)} checking={checkingAvailability} />}
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
              disabled={refreshingAvailability}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {refreshingAvailability ? '检测中...' : '刷新状态'}
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
                <div className="text-sm font-semibold">当前引擎：{currentEngineMeta?.name || currentEngine}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <EngineStatusPill available={isEngineAvailable(currentEngine)} checking={checkingAvailability} />
                  {getModelsForEngine(currentEngine).length > 0 ? (
                    <span>默认模型：{getDefaultModelLabel(defaultModel, getModelsForEngine(currentEngine))}</span>
                  ) : null}
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
          {engines.map((engine, index) => {
            const compatibleModels = getModelsForEngine(engine.id);
            const hasModels = compatibleModels.length > 0;
            const isCurrentEngine = currentEngine === engine.id;
            const isSelectedEngine = selectedEngine === engine.id;
            const availability = isEngineAvailable(engine.id);
            const canUseEngineActions = availability === true;
            const canDetectModels = canUseEngineActions && engine.canDetectModels !== false;

            return (
            <motion.div
              key={engine.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
            >
              <DataCard
                selected={isSelectedEngine}
                disabled={engine.status === 'coming-soon'}
                className={cn('relative min-h-full p-5', engine.status === 'coming-soon' ? 'opacity-60' : '')}
                onClick={() => {
                  if (engine.status !== 'coming-soon') setSelectedEngine(engine.id);
                }}
              >
              {/* Selected Badge */}
              {isCurrentEngine && (
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

              {/* Engine Icon */}
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg border border-border bg-background/80 shadow-sm">
                <RuntimeEngineIcon engine={engine} />
              </div>

              {/* Engine Info */}
              <h3 className="mb-2 text-base font-semibold">{engine.name}</h3>
              <p className="mb-4 text-sm text-muted-foreground">{engine.description}</p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <EngineStatusPill available={availability} checking={checkingAvailability} />
                {hasModels && isCurrentEngine ? (
                  <span className="max-w-full truncate">默认模型：{getDefaultModelLabel(defaultModel, compatibleModels)}</span>
                ) : null}
              </div>

              <div className="mt-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">特性：</p>
                <div className="flex flex-wrap gap-2">
                  {engine.features.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
              </div>

              {engine.endpoints.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">API 端点：</p>
                  <div className="flex flex-wrap gap-2">
                    {engine.endpoints.map((endpoint) => (
                      <Badge key={endpoint} variant="outline" className="text-xs">
                        {endpoint}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Select Button */}
              {engine.status === 'available' && (
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={refreshingAvailability}
                    onClick={() => checkEngineAvailability(true)}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {refreshingAvailability ? '检测中...' : '刷新状态'}
                  </Button>
                  {!isCurrentEngine && canUseEngineActions ? (
                    <Button
                      className="w-full"
                      variant="outline"
                      size="sm"
                      disabled={refreshingAvailability}
                      onClick={() => handleSelectEngine(engine.id)}
                    >
                      <Zap className="w-4 h-4 mr-2" />
                      切换到此引擎
                    </Button>
                  ) : null}
                  {canDetectModels ? (
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
                  ) : null}
                </div>
              )}

              {isCurrentEngine && (
                <div className="mt-4 pt-4 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
                  <p className="text-xs font-medium text-muted-foreground mb-2">默认模型</p>
                  <AiModelSelectorField
                    value={defaultModel}
                    onValueChange={(v) => handleSetDefaultModel(v)}
                    options={[
                      { value: '', label: '使用全局默认模型' },
                      ...compatibleModels.map((model) => ({
                        value: model.value,
                        label: model.label,
                        description: model.value,
                        keywords: [model.value, model.label],
                      })),
                    ]}
                    placeholder="使用全局默认模型"
                    searchPlaceholder="搜索模型..."
                    emptyLabel="暂无可选模型。"
                    className="h-9 text-sm"
                  />
                </div>
              )}
              </DataCard>
            </motion.div>
            );
          })}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6"
        >
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="font-semibold text-foreground">引擎安装与服务说明</div>
              <div className="mt-1">安装命令、可用性检查和 ACE Service 指导已集中到右侧说明面板。</div>
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
            <DetailDrawerDescription>选中引擎：{selectedEngineMeta?.name || selectedEngine}</DetailDrawerDescription>
          </DetailDrawerHeader>
          <DetailDrawerBody className="space-y-5">
            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">引擎范围</h3>
              <p className="text-sm leading-6 text-muted-foreground">
                Aceharness 支持 OpenCode、Claude Code、Kiro CLI 等 AI 编程助手，并接入代码编辑与执行流程。
              </p>
            </section>

            {selectedEngineMeta ? (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold text-foreground">{selectedEngineMeta.name}</h3>
                <p className="text-xs leading-5 text-muted-foreground">{selectedEngineMeta.description}</p>
                <div className="flex flex-wrap gap-2">
                  {selectedEngineMeta.features.map((feature) => (
                    <Badge key={feature} variant="outline" className="text-xs">
                      {feature}
                    </Badge>
                  ))}
                </div>
                {selectedCompatibleModels.length > 0 ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    当前可选模型：{selectedCompatibleModels.map((model) => model.label).slice(0, 4).join('、')}
                    {selectedCompatibleModels.length > 4 ? ` 等 ${selectedCompatibleModels.length} 个` : ''}
                  </p>
                ) : null}
              </section>
            ) : null}

            {[
              ['安装 Claude Code', 'npm install -g @anthropic-ai/claude-code', '安装后刷新状态，即可切换使用 Claude Code。'],
              ['安装 Kiro CLI', 'curl -fsSL https://cli.kiro.dev/install | bash', '安装后刷新状态，即可切换使用 Kiro CLI。'],
              ['安装 OpenCode', 'npm install -g opencode-ai', '安装后刷新状态，即可切换使用 OpenCode。'],
              ['安装 Codex', 'npm install -g @openai/codex-cli', '安装后刷新状态，即可切换使用 Codex。'],
              ['安装 Cursor CLI', 'curl -fsSL https://cursor.sh/install | bash', '安装后刷新状态，即可切换使用 Cursor CLI。'],
              ['安装 Trae CLI', 'curl -fsSL https://trae.cn/install | bash', '安装后刷新状态，即可切换使用 Trae CLI。'],
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
                从仓库克隆后，确保当前运行环境可以直接调用 magic-cli.sh；完成后刷新状态，即可切换使用 Magic CLI。
              </p>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">ACE Service 使用指导</h3>
              <div className="space-y-1.5 rounded-lg border border-border bg-background/60 p-3 text-xs leading-6 text-muted-foreground">
                <p>全局安装后，使用 <code>ace</code> 或 <code>ace start</code> 启动本地 ACE Service。首次启动会引导你完成语言、默认引擎、默认模型、管理员账号和网络模式配置。</p>
                <p>启动向导里可直接开启后台运行。后台模式会把服务脱离当前终端继续运行，适合常驻使用。</p>
                <p>服务启动后，可用 <code>ace service</code> 查看当前受管实例，并按提示停止指定实例。</p>
              </div>
            </section>
          </DetailDrawerBody>
          <DetailDrawerFooter className="justify-between">
            <Button
              variant="outline"
              size="sm"
              onClick={() => checkEngineAvailability(true)}
              disabled={refreshingAvailability}
            >
              {refreshingAvailability ? '检查中...' : '刷新状态'}
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
            导入模型 - {detectingEngineMeta?.name || detectingEngine}
          </span>
        )}
        description={`检测到 ${detectedModels.length} 个模型，勾选要导入到模型列表的模型。`}
        sourceOptions={[
          {
            id: detectingEngine || 'detected-engine',
            label: detectingEngineMeta?.name || detectingEngine || '检测结果',
            description: '使用当前引擎检测到的模型结果。',
            icon: detectingEngine ? <RuntimeEngineIcon engine={detectingEngineMeta} className="h-4 w-4" /> : <Download className="h-4 w-4" />,
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

    </div>
  );
}
