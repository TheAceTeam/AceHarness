'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ModelOption } from '@/lib/core/models';
import { SingleCombobox, type ComboboxGroupDef } from '@/components/ui/combobox';
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

export function EngineModelSelect({ engine, model, onEngineChange, onModelChange, className = '' }: Props) {
  const [models, setModels] = useState<ModelOption[]>([]);
  const [globalEngine, setGlobalEngine] = useState('claude-code');
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
        if (!cancelled && d.engine) setGlobalEngine(d.engine);
      }).catch(() => {});

      const availability: Record<string, boolean> = {};
      await Promise.all(getConcreteEngines().map(async (eng) => {
        try {
          const response = await fetch(`/api/engine/availability?engine=${encodeURIComponent(eng.id)}`);
          const data = await response.json();
          availability[eng.id] = Boolean(data.available);
        } catch {
          availability[eng.id] = false;
        }
      }));
      if (!cancelled) {
        setEngineAvailability(availability);
      }
    };
    refresh();
    const onEngineUpdated = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'engine-config-updated-at') refresh();
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
  const isEngineSelectable = useCallback((engineId: string) => engineAvailability[engineId] !== false, [engineAvailability]);

  // Composite value: "engineId::modelValue" — empty engineId = follow system
  const compositeValue = `${engine}::${model}`;

  const groups: ComboboxGroupDef[] = useMemo(() => {
    const result: ComboboxGroupDef[] = [];

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
          })),
        });
      }
    }

    return result;
  }, [models, globalEngine, globalLabel, isEngineSelectable, isModelCompatible]);

  const modelLabel = models.find(m => m.value === model)?.label || model || '选择模型';
  const triggerLabel = modelLabel;
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
    <SingleCombobox
      value={compositeValue}
      onValueChange={handleValueChange}
      groups={groups}
      triggerLabel={triggerLabel}
      triggerIcon={triggerIcon}
      triggerClassName={`h-8 text-xs ${className}`}
    />
  );
}
