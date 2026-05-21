'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ModelOption } from '@/lib/core/models';
import { AiModelSelectorField, type AiModelSelectorGroup } from '@/components/AiModelSelectorField';
import { useToast } from '@/components/ui/toast';
import { EngineIcon } from '@/components/EngineIcon';
import { getConcreteEngines, getEngineMeta } from '@/lib/core/engine-metadata';

interface Props {
  engine: string;
  model: string;
  onEngineChange: (engine: string) => void;
  onModelChange: (model: string) => void;
  className?: string;
}

let sharedAvailabilityCache: { value: Record<string, boolean>; expiresAt: number } | null = null;
let sharedAvailabilityPromise: Promise<Record<string, boolean>> | null = null;

async function loadSharedEngineAvailability(forceRefresh = false): Promise<Record<string, boolean>> {
  if (!forceRefresh && sharedAvailabilityCache && sharedAvailabilityCache.expiresAt > Date.now()) {
    return sharedAvailabilityCache.value;
  }
  if (!forceRefresh && sharedAvailabilityPromise) {
    return sharedAvailabilityPromise;
  }

  const promise = Promise.all(getConcreteEngines().map(async (eng) => {
    try {
      const response = await fetch(`/api/engine/availability?engine=${encodeURIComponent(eng.id)}`);
      const data = await response.json();
      return {
        engineId: eng.id,
        available: Boolean(data.available),
        cacheTtlMs: Number.isFinite(Number(data.cacheTtlMs)) ? Number(data.cacheTtlMs) : undefined,
      };
    } catch {
      return {
        engineId: eng.id,
        available: false,
        cacheTtlMs: undefined,
      };
    }
  }))
    .then((entries) => {
      const value = Object.fromEntries(entries.map((entry) => [entry.engineId, entry.available]));
      const ttlMs = entries.reduce((min, entry) => (
        typeof entry.cacheTtlMs === 'number' && entry.cacheTtlMs > 0
          ? Math.min(min, entry.cacheTtlMs)
          : min
      ), Number.POSITIVE_INFINITY);
      sharedAvailabilityCache = {
        value,
        expiresAt: Date.now() + (Number.isFinite(ttlMs) ? ttlMs : 30 * 60 * 1000),
      };
      return value;
    })
    .finally(() => {
      sharedAvailabilityPromise = null;
    });

  sharedAvailabilityPromise = promise;
  return promise;
}

export function EngineModelSelect({ engine, model, onEngineChange, onModelChange, className = '' }: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [globalEngine, setGlobalEngine] = useState('claude-code');
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const [engineAvailability, setEngineAvailability] = useState<Record<string, boolean>>({});
  const { toast } = useToast();

  const isModelCompatible = useMemo(() => {
    return (model: ModelOption, engineId: string): boolean => {
      if (!model.engines || model.engines.length === 0) return true;
      if (model.engines.includes(engineId)) return true;
      // nga / codegenie 与 OpenCode 内核兼容：复用 opencode 的模型声明
      if ((engineId === 'nga' || engineId === 'codegenie') && model.engines.includes('opencode')) return true;
      return false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      fetch('/api/models').then(r => r.json()).then(d => {
        if (!cancelled) setModels(d.models || []);
      }).catch(() => {});
      fetch('/api/engine').then(r => r.json()).then(d => {
        if (!cancelled) {
          if (d.engine) setGlobalEngine(d.engine);
          setGlobalDefaultModel(typeof d.defaultModel === 'string' ? d.defaultModel : '');
        }
      }).catch(() => {});

      const availability = await loadSharedEngineAvailability();
      if (!cancelled) setEngineAvailability(availability);
    };
    refresh();
    const onEngineUpdated = () => {
      void loadSharedEngineAvailability(true).then((availability) => {
        if (!cancelled) setEngineAvailability(availability);
      });
      void refresh();
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'engine-config-updated-at') {
        void loadSharedEngineAvailability(true).then((availability) => {
          if (!cancelled) setEngineAvailability(availability);
        });
        void refresh();
      }
    };
    window.addEventListener('engine:updated', onEngineUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener('engine:updated', onEngineUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const effectiveEngine = engine || globalEngine;
  const globalEngineInfo = getEngineMeta(globalEngine);
  const globalLabel = globalEngineInfo?.name || globalEngine;
  const hasAnyAvailableEngine = useMemo(
    () => Object.values(engineAvailability).some((available) => available),
    [engineAvailability]
  );
  const isEngineSelectable = useCallback(
    (engineId: string) => !hasAnyAvailableEngine || engineAvailability[engineId] !== false,
    [engineAvailability, hasAnyAvailableEngine]
  );

  // Composite value: "engineId::modelValue" — empty engineId = follow system
  const compositeValue = `${engine}::${model}`;

  const groups: AiModelSelectorGroup[] = useMemo(() => {
    const result: AiModelSelectorGroup[] = [];

    // "跟随系统" group — uses the global engine's compatible models
    const sysModels = isEngineSelectable(globalEngine)
      ? models.filter((m) => isModelCompatible(m, globalEngine))
      : [];
    if (sysModels.length > 0) {
      result.push({
        label: `跟随系统 (${globalLabel})`,
        icon: <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />,
        items: sysModels.map(m => ({
          value: `::${m.value}`,
          label: m.label,
          icon: <RefreshCw className="h-4 w-4 shrink-0 text-muted-foreground" />,
          description: m.value,
          keywords: [m.value, globalLabel],
        })),
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
  }, [models, globalEngine, globalLabel, isEngineSelectable, isModelCompatible, engine, effectiveEngine, model]);

  const defaultModelLabel = models.find(m => m.value === globalDefaultModel)?.label || globalDefaultModel;
  const modelLabel = models.find(m => m.value === model)?.label || model;
  const triggerLabel = modelLabel || defaultModelLabel || '选择模型';
  const triggerIcon = <EngineIcon engineId={effectiveEngine} className="h-4 w-4" />;

  const handleValueChange = (val: string) => {
    if (!val) return;
    const [engId, ...rest] = val.split('::');
    const modelVal = rest.join('::');
    onEngineChange(engId);
    onModelChange(modelVal);
    const engName = engId
      ? (getEngineMeta(engId)?.name || engId)
      : `跟随系统 (${globalLabel})`;
    const modLabel = models.find(m => m.value === modelVal)?.label || modelVal;
    toast('info', `已切换: ${engName} / ${modLabel}`);
  };

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
