'use client';

import { useEffect, useMemo, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import type { ModelOption } from '@/lib/core/models';
import { AiModelSelectorField, type AiModelSelectorGroup } from '@/components/AiModelSelectorField';
import { useToast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { EngineIcon } from '@/components/EngineIcon';
import { getConcreteEngines, getEngineMeta } from '@/lib/core/engine-metadata';
import { resolveEffectiveEngine } from '@/lib/engines/engine-selection';
import { modelEnginesSupportEngine } from '@/lib/models/engine-compatibility';
import { useEngineAvailabilityQuery, useEngineConfigQuery, useModelsQuery } from '@/client/query/engines';
import { queryKeys } from '@/client/query/query-keys';

interface Props {
  engine: string;
  model: string;
  onEngineChange: (engine: string) => void;
  onModelChange: (model: string) => void;
  className?: string;
}

export function EngineModelSelect({ engine, model, onEngineChange, onModelChange, className = '' }: Props) {
  const queryClient = useQueryClient();
  const modelsQuery = useModelsQuery();
  const engineConfigQuery = useEngineConfigQuery();
  const engineAvailabilityQuery = useEngineAvailabilityQuery();
  const models = modelsQuery.data?.models || [];
  const globalEngine = typeof engineConfigQuery.data?.engine === 'string' ? engineConfigQuery.data.engine : '';
  const globalDriver = typeof engineConfigQuery.data?.driver === 'string' ? engineConfigQuery.data.driver : '';
  const globalDefaultModel = typeof engineConfigQuery.data?.defaultModel === 'string' ? engineConfigQuery.data.defaultModel : '';
  const engineAvailability = engineAvailabilityQuery.data || {};
  const hasLoadedModels = !modelsQuery.isLoading;
  const hasLoadedConfig = !engineConfigQuery.isLoading;
  const { toast } = useToast();

  const isModelCompatible = useMemo(() => {
    return (model: ModelOption, engineId: string): boolean => {
      return modelEnginesSupportEngine(model.engines, engineId);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.engines() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.engineAvailability() });
    };
    const onEngineUpdated = () => {
      refresh();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'engine-config-updated-at') {
        refresh();
      }
    };
    window.addEventListener('engine:updated', onEngineUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('engine:updated', onEngineUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [queryClient]);

  const isInitialLoading = !hasLoadedModels || !hasLoadedConfig;
  const effectiveGlobalEngine = resolveEffectiveEngine(globalEngine, globalDriver) || globalEngine;
  const effectiveEngine = engine || effectiveGlobalEngine;
  const selectedModel = useMemo(
    () => models.find((item) => item.value === model),
    [models, model]
  );
  const globalEngineInfo = getEngineMeta(effectiveGlobalEngine) || getEngineMeta(globalEngine);
  const globalLabel = globalEngineInfo?.name || globalEngine || '系统默认';
  const defaultModelLabel = models.find(m => m.value === globalDefaultModel)?.label || globalDefaultModel;
  const followSystemDescription = [globalLabel, defaultModelLabel].filter(Boolean).join(' / ');
  const followSystemLabel = followSystemDescription ? `跟随系统 (${followSystemDescription})` : '跟随系统';
  const isUsingGlobalEngine = !engine;
  const isUsingGlobalSelection = !engine && !model;
  const hasAnyAvailableEngine = useMemo(
    () => Object.values(engineAvailability).some((available) => available),
    [engineAvailability]
  );
  const isEngineSelectable = useCallback(
    (engineId: string) => !hasAnyAvailableEngine || engineAvailability[engineId] !== false,
    [engineAvailability, hasAnyAvailableEngine]
  );

  useEffect(() => {
    if (!hasLoadedModels || !hasLoadedConfig || !model) return;
    if (!selectedModel) {
      onModelChange('');
      return;
    }
    if (effectiveEngine && !isModelCompatible(selectedModel, effectiveEngine)) {
      onModelChange('');
    }
  }, [
    effectiveEngine,
    hasLoadedConfig,
    hasLoadedModels,
    isModelCompatible,
    model,
    onModelChange,
    selectedModel,
  ]);

  // Composite value: "engineId::modelValue" — empty engineId = follow system
  const compositeValue = `${engine}::${model}`;

  const groups: AiModelSelectorGroup[] = useMemo(() => {
    const result: AiModelSelectorGroup[] = [];

    // "跟随系统" group — uses the global engine's compatible models
    const sysModels = isEngineSelectable(effectiveGlobalEngine)
      ? models.filter((m) => isModelCompatible(m, effectiveGlobalEngine))
      : [];
    if (sysModels.length > 0 || isUsingGlobalSelection || Boolean(followSystemDescription)) {
      result.push({
        label: `跟随系统 (${globalLabel})`,
        icon: <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />,
        items: [
          {
            value: '::',
            label: '系统默认',
            icon: <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />,
            description: followSystemDescription || '跟随全局默认引擎与模型',
            keywords: [globalLabel, globalDefaultModel, '系统默认', '跟随系统'].filter(Boolean) as string[],
          },
          ...sysModels.map(m => ({
            value: `::${m.value}`,
            label: m.label,
            icon: <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />,
            description: m.value,
            keywords: [m.value, globalLabel],
          })),
        ],
      });
    }

    // Concrete engine groups
    for (const eng of getConcreteEngines()) {
      if (!isEngineSelectable(eng.id)) continue;
      const engineModels = models.filter((m) => isModelCompatible(m, eng.id));
      if (engineModels.length > 0) {
        result.push({
          label: eng.name,
          icon: <EngineIcon engineId={eng.id} className="h-4 w-4" />,
          items: engineModels.map(m => ({
            value: `${eng.id}::${m.value}`,
            label: m.label,
            icon: <EngineIcon engineId={eng.id} className="h-4 w-4" />,
            description: m.value,
            keywords: [m.value, eng.id, eng.name],
          })),
        });
      }
    }

    if (result.length === 0) {
      const fallbackItems = models.length > 0
        ? models.map((m) => ({
            value: `${engine || ''}::${m.value}`,
            label: m.label,
            icon: <EngineIcon engineId={effectiveEngine} className="h-4 w-4" />,
            description: m.value,
          }))
        : (model
            ? [{
                value: `${engine || ''}::${model}`,
                label: model,
                icon: <EngineIcon engineId={effectiveEngine} className="h-4 w-4" />,
                description: effectiveEngine,
              }]
            : []);
      if (fallbackItems.length > 0) {
        result.push({
          label: '模型',
          items: fallbackItems,
        });
      }
    }

    return result;
  }, [
    models,
    effectiveGlobalEngine,
    globalLabel,
    isEngineSelectable,
    isModelCompatible,
    engine,
    effectiveEngine,
    model,
    isUsingGlobalSelection,
    followSystemDescription,
    globalDefaultModel,
  ]);

  const modelLabel = selectedModel?.label || model;
  const triggerLabel = isUsingGlobalSelection
    ? followSystemLabel
    : (modelLabel || model || (engine ? '选择模型' : followSystemLabel));
  const triggerIcon = isUsingGlobalEngine
    ? <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />
    : (effectiveEngine ? <EngineIcon engineId={effectiveEngine} className="h-4 w-4" /> : null);

  const handleValueChange = (val: string) => {
    if (!val) return;
    const [engId, ...rest] = val.split('::');
    const modelVal = rest.join('::');
    onEngineChange(engId);
    onModelChange(modelVal);
    if (!engId && !modelVal) {
      toast('info', `已切换: ${followSystemLabel}`);
      return;
    }
    const engName = engId
      ? (getEngineMeta(engId)?.name || engId)
      : `跟随系统 (${globalLabel})`;
    const modLabel = models.find(m => m.value === modelVal)?.label || modelVal;
    toast('info', modLabel ? `已切换: ${engName} / ${modLabel}` : `已切换: ${engName}`);
  };

  if (isInitialLoading) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled
        className={`w-full justify-start gap-2 px-3 text-left font-normal text-muted-foreground ${className}`}
      >
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        <span className="truncate">加载模型配置中...</span>
      </Button>
    );
  }

  return (
    <AiModelSelectorField
      value={compositeValue}
      onValueChange={handleValueChange}
      groups={groups}
      triggerLabel={triggerLabel}
      triggerIcon={triggerIcon}
      placeholder="选择模型"
      searchPlaceholder="搜索模型或引擎..."
      className={`h-8 text-xs ${className}`}
    />
  );
}
