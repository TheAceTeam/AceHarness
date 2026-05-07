'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/theme-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { useToast } from '@/components/ui/toast';
import { ArrowLeft, Check, Cpu, Zap, Search, Download } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { SingleCombobox } from '@/components/ui/combobox';
import { EngineIcon } from '@/components/EngineIcon';
import { getEngineMeta } from '@/lib/engine-metadata';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';

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
    id: 'cangjie-magic',
    name: 'CangjieMagic',
    description: '仓颉语言 AI Agent 框架，通过 MCP 协议提供智能工具调用能力',
    status: 'available',
    features: ['MCP 协议', 'JSON-RPC 2.0', '仓颉语言原生', 'Agent 工具调用'],
    endpoints: ['cangjie'],
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
    description: '基于 OpenCode 的 ngagent 套壳，ACP 与 OpenCode 一致，默认关闭自动更新',
    status: 'available',
    features: ['ACP 协议', '与 OpenCode 兼容', '流式输出', '默认 --disable-update'],
    endpoints: ['anthropic', 'openai'],
  },
  {
    id: 'codegenie',
    name: 'CodeGenie',
    description: 'OpenCode 内核的 CodeGenie CLI，通过 `codegenie acp` 走 ACP stdio，与 OpenCode 参数一致',
    status: 'available',
    features: ['ACP 协议', 'OpenCode 内核', '流式输出', 'codegenie acp'],
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
];

const CLAUDE_ALIAS_LABELS: Record<string, string> = {
  default: 'Auto (default)',
  best: 'Best',
  sonnet: 'Claude Sonnet',
  opus: 'Claude Opus',
  haiku: 'Claude Haiku',
  opusplan: 'Claude Opus Plan',
};

export default function EnginesPage() {
  const router = useRouter();
  const { toast } = useToast();
  useDocumentTitle('执行引擎');
  const [currentEngine, setCurrentEngine] = useState<string>('claude-code');
  const [defaultModel, setDefaultModel] = useState<string>('');
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [engineAvailability, setEngineAvailability] = useState<Record<string, boolean>>({});
  const [checkingAvailability, setCheckingAvailability] = useState(false);

  const broadcastEngineUpdated = () => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('engine-config-updated-at', String(Date.now()));
    window.dispatchEvent(new CustomEvent('engine:updated'));
  };

  useEffect(() => {
    loadCurrentEngine();
    checkEngineAvailability();
    loadModels();
  }, []);

  const loadModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      setModels(data.models || []);
    } catch { /* ignore */ }
  };

  const getModelsForEngine = (engineId: string) =>
    models.filter(m => !m.engines || m.engines.length === 0 || m.engines.includes(engineId));

  const loadCurrentEngine = async () => {
    try {
      const response = await fetch('/api/engine');
      const data = await response.json();
      if (data.engine) {
        setCurrentEngine(data.engine);
      }
      if (data.defaultModel) {
        setDefaultModel(data.defaultModel);
      }
    } catch (error) {
      console.error('Failed to load current engine:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkEngineAvailability = async () => {
    setCheckingAvailability(true);
    const availability: Record<string, boolean> = {};

    for (const engine of engines) {
      if (engine.status === 'available') {
        try {
          const response = await fetch(`/api/engine/availability?engine=${engine.id}`);
          const data = await response.json();
          availability[engine.id] = data.available;
        } catch (error) {
          console.error(`Failed to check ${engine.id} availability:`, error);
          availability[engine.id] = false;
        }
      }
    }

    setEngineAvailability(availability);
    setCheckingAvailability(false);
  };

  const handleSelectEngine = async (engineId: string) => {
    const engine = engines.find(e => e.id === engineId);
    if (engine?.status === 'coming-soon') {
      return;
    }

    // Check if engine is available before switching
    if (engineAvailability[engineId] === false) {
      const hints: Record<string, string> = {
        'kiro-cli': '安装方法：curl -fsSL https://cli.kiro.dev/install | bash',
        'claude-code': '安装方法：npm install -g @anthropic-ai/claude-code',
        'cangjie-magic': '请在环境变量中配置 CANGJIE_HOME、CANGJIE_MAGIC_PATH、OPENSSL_PATH、CANGJIE_STDX_PATH',
        'opencode': '安装方法：npm install -g opencode-ai',
        'nga': '请确保已安装 ngagent 并把 nga 命令加入 PATH',
        'codegenie': '请确保已安装 codegenie 并把命令加入 PATH（参见 CodeGenie 官方安装说明）',
        'trae-cli': '安装方法：curl -fsSL https://trae.cn/install | bash',
      };
      const hint = hints[engineId] || '请确保已安装相应的命令行工具';
      toast('error', `引擎 ${engine?.name} 不可用。${hint}`);
      return;
    }

    try {
      const response = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: engineId }),
      });

      if (response.ok) {
        setCurrentEngine(engineId);
        // Check if current defaultModel is compatible with new engine
        const compatible = getModelsForEngine(engineId);
        if (defaultModel && !compatible.find(m => m.value === defaultModel)) {
          setDefaultModel('');
        }
        broadcastEngineUpdated();
        toast('success', `已切换到 ${engine?.name} 引擎`);
      } else {
        toast('error', '切换引擎失败');
      }
    } catch (error) {
      console.error('Failed to set engine:', error);
      toast('error', '切换引擎失败: ' + (error as Error).message);
    }
  };

  const handleSetDefaultModel = async (modelValue: string) => {
    try {
      const response = await fetch('/api/engine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine: currentEngine, defaultModel: modelValue }),
      });
      if (response.ok) {
        setDefaultModel(modelValue);
        const label = models.find(m => m.value === modelValue)?.label || modelValue;
        broadcastEngineUpdated();
        toast('success', `默认模型已设置: ${label}`);
      }
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
  const [smokeTesting, setSmokeTesting] = useState(false);
  const [showSmokeDialog, setShowSmokeDialog] = useState(false);
  const [smokeResults, setSmokeResults] = useState<ClaudeModelSmokeResult[]>([]);

  const handleDetectModels = async (engineId: string) => {
    setDetecting(true);
    setDetectingEngine(engineId);
    try {
      const res = await fetch(`/api/engine/models?engine=${engineId}`);
      const data = await res.json();
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
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ models: merged }),
    });
    if (!res.ok) {
      throw new Error('保存模型失败');
    }
    setModels(merged);
    toast('success', successMessage);
  };

  const handleSmokeTestClaudeModels = async () => {
    setSmokeTesting(true);
    try {
      const response = await fetch('/api/engine/models/smoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          models: ['default', 'best', 'sonnet', 'opus', 'haiku', 'opusplan'],
        }),
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        toast('error', data.error || 'Claude Code 模型测试失败');
        return;
      }
      setSmokeResults(data.results || []);
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
                <h1 className="text-2xl font-bold">引擎管理</h1>
                <p className="text-xs text-muted-foreground">选择和配置 AI 编程引擎</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-6 py-8">
        {/* Current Engine Banner */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-xl p-6"
        >
          <div className="flex items-center gap-3">
            <div className="p-3 bg-primary/20 rounded-lg">
              <Cpu className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">当前引擎</h2>
              <p className="text-sm text-muted-foreground">
                {engines.find(e => e.id === currentEngine)?.name || 'Claude Code'}
              </p>
            </div>
          </div>
        </motion.div>

        {/* Engines Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {engines.map((engine, index) => (
            <motion.div
              key={engine.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              className={`relative bg-card border rounded-xl p-6 transition-all ${
                currentEngine === engine.id
                  ? 'border-primary shadow-lg shadow-primary/20'
                  : 'border-border hover:border-primary/50'
              } ${engine.status === 'coming-soon' ? 'opacity-60' : 'cursor-pointer'}`}
              onClick={() => handleSelectEngine(engine.id)}
            >
              {/* Selected Badge */}
              {currentEngine === engine.id && (
                <div className="absolute top-4 right-4">
                  <Badge className="bg-primary text-primary-foreground">
                    <Check className="w-3 h-3 mr-1" />
                    使用中
                  </Badge>
                </div>
              )}

              {/* Coming Soon Badge */}
              {engine.status === 'coming-soon' && (
                <div className="absolute top-4 right-4">
                  <Badge variant="secondary">即将推出</Badge>
                </div>
              )}

              {/* Availability Badge */}
              {engine.status === 'available' && currentEngine !== engine.id && (
                <div className="absolute top-4 right-4">
                  {checkingAvailability ? (
                    <Badge variant="outline">检查中...</Badge>
                  ) : engineAvailability[engine.id] === false ? (
                    <Badge variant="destructive">不可用</Badge>
                  ) : engineAvailability[engine.id] === true ? (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">可用</Badge>
                  ) : null}
                </div>
              )}

              {/* Engine Icon */}
              <EngineIcon engineId={engine.id} className="w-24 h-24 mb-4" decorative={false} alt={engine.name} />

              {/* Engine Info */}
              <h3 className="text-xl font-bold mb-2">{engine.name}</h3>
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
                    <Badge key={endpoint} variant="default" className="text-xs bg-primary/10 text-primary hover:bg-primary/20">
                      {endpoint}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Select Button */}
              {engine.status === 'available' && currentEngine !== engine.id && (
                <Button
                  className="w-full mt-4"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectEngine(engine.id);
                  }}
                >
                  <Zap className="w-4 h-4 mr-2" />
                  切换到此引擎
                </Button>
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
                  {!['cangjie-magic', 'codex'].includes(engine.id) && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full mt-2"
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
                    </>
                  )}
                </div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Info Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 bg-muted/50 border border-border rounded-xl p-6"
        >
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">关于引擎</h3>
            <Button
              variant="outline"
              size="sm"
              onClick={checkEngineAvailability}
              disabled={checkingAvailability}
            >
              {checkingAvailability ? '检查中...' : '刷新可用性'}
            </Button>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed mb-3">
            Aceharness 提供包括 CangjieMagic、Opencode、Claude Code、Kiro CLI等 AI Agent 框架以提供完整的代码编辑和执行能力。
            Aceharness 目前已支持完全支持 ACP和MCP的能力，后续将提供更多工具的支持。
          </p>
          <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
            <p><strong>安装 Claude Code：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              npm install -g @anthropic-ai/claude-code
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Claude Code 引擎。</p>
            <p className="mt-2"><strong>安装 Kiro CLI：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              curl -fsSL https://cli.kiro.dev/install | bash
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Kiro CLI 引擎。</p>
            <p className="mt-2"><strong>配置 CangjieMagic：</strong></p>
            <p className="text-xs">在环境变量中配置以下变量后刷新可用性检查：</p>
            <code className="block bg-background/50 p-2 rounded text-xs whitespace-pre-line">
{`CANGJIE_HOME — 仓颉 SDK 根目录
CANGJIE_MAGIC_PATH — CangjieMagic 项目路径
OPENSSL_PATH — OpenSSL 动态库路径
CANGJIE_STDX_PATH — stdx 动态库路径`}
            </code>
            <p className="mt-2"><strong>安装 OpenCode：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              npm install -g opencode-ai
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 OpenCode 引擎。</p>
            <p className="mt-2"><strong>安装 Codex：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              npm install -g @openai/codex-cli
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Codex 引擎。</p>
            <p className="mt-2"><strong>安装 Cursor CLI：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              curl -fsSL https://cursor.sh/install | bash
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Cursor CLI 引擎。</p>
            <p className="mt-2"><strong>安装 Trae CLI：</strong></p>
            <code className="block bg-background/50 p-2 rounded text-xs">
              curl -fsSL https://trae.cn/install | bash
            </code>
            <p className="text-xs">安装后刷新可用性检查，即可切换使用 Trae CLI 引擎。</p>
          </div>
        </motion.div>
      </div>

      {/* Model Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogTitle className="text-lg font-semibold">
            <Download className="w-5 h-5 inline mr-2" />
            导入模型 — {engines.find(e => e.id === detectingEngine)?.name}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            检测到 {detectedModels.length} 个模型，勾选要导入到模型列表的模型：
          </p>
          <div className="flex-1 overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 w-8">
                    <input
                      type="checkbox"
                      checked={detectedModels.every(m => m.selected)}
                      onChange={(e) => setDetectedModels(prev => prev.map(m => ({ ...m, selected: e.target.checked })))}
                      className="rounded"
                    />
                  </th>
                  <th className="p-2 text-left">模型 ID</th>
                  <th className="p-2 text-left w-28">来源</th>
                  <th className="p-2 text-left">显示名称</th>
                  <th className="p-2 text-left w-24">费用倍率</th>
                </tr>
              </thead>
              <tbody>
                {detectedModels.map((m, i) => (
                  <tr key={m.modelId} className="border-t border-border/30 hover:bg-muted/30">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={m.selected}
                        onChange={(e) => setDetectedModels(prev => prev.map((dm, j) => j === i ? { ...dm, selected: e.target.checked } : dm))}
                        className="rounded"
                      />
                    </td>
                    <td className="p-2 font-mono text-xs">{m.modelId}</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {m.source === 'alias' ? '官方别名' : m.source === 'api' ? 'Anthropic API' : m.source === 'config' ? '本地配置' : '检测结果'}
                      {m.recommended && <span className="ml-1 text-primary">推荐</span>}
                    </td>
                    <td className="p-2">
                      <Input
                        value={m.label}
                        onChange={(e) => setDetectedModels(prev => prev.map((dm, j) => j === i ? { ...dm, label: e.target.value } : dm))}
                        className="h-7 text-xs"
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        step="0.01"
                        value={m.costMultiplier}
                        onChange={(e) => setDetectedModels(prev => prev.map((dm, j) => j === i ? { ...dm, costMultiplier: parseFloat(e.target.value) || 0 } : dm))}
                        className="h-7 text-xs w-20"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between items-center pt-2">
            <span className="text-xs text-muted-foreground">
              已选择 {detectedModels.filter(m => m.selected).length} / {detectedModels.length}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setShowImportDialog(false)}>取消</Button>
              <Button onClick={handleImportModels}>
                <Download className="w-4 h-4 mr-2" />
                导入选中模型
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showSmokeDialog} onOpenChange={setShowSmokeDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
          <DialogTitle className="text-lg font-semibold">
            <Search className="w-5 h-5 inline mr-2" />
            Claude Code 官方别名测试
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            通过真实请求测试 alias 是否可用；如果 SDK 暴露了实际模型名，会显示在“实际模型”列。
          </p>
          <div className="flex-1 overflow-auto border rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 text-left w-24">别名</th>
                  <th className="p-2 text-left w-24">状态</th>
                  <th className="p-2 text-left">实际模型</th>
                  <th className="p-2 text-left w-24">耗时</th>
                  <th className="p-2 text-left">详情</th>
                </tr>
              </thead>
              <tbody>
                {smokeResults.map((result) => (
                  <tr key={result.model} className="border-t border-border/30 hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{result.model}</td>
                    <td className="p-2">
                      <Badge variant={result.ok ? 'default' : 'secondary'}>
                        {result.ok ? '可用' : '失败'}
                      </Badge>
                    </td>
                    <td className="p-2 font-mono text-xs">{result.resolvedModel || '未返回'}</td>
                    <td className="p-2 text-xs">{(result.durationMs / 1000).toFixed(1)}s</td>
                    <td className="p-2 text-xs text-muted-foreground">
                      {result.ok ? (result.preview || 'OK') : (result.error || 'Unknown error')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
