'use client';

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { AiModelSelectorField, type AiModelSelectorOption } from '@/components/AiModelSelectorField';
import { useToast } from '@/components/ui/toast';
import { modelEnginesSupportEngine } from '@/lib/models/engine-compatibility';
import { useEngineConfigQuery, useModelsQuery } from '@/client/query/engines';
import { queryKeys } from '@/client/query/query-keys';

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** When set, only show models that include this engine in their engines list */
  engine?: string;
  /** Show a "use global" option */
  allowGlobal?: boolean;
  /** Show an explicit empty option for optional model fields */
  emptyOptionLabel?: string;
  /** Whether to show a toast when the selected model changes */
  showChangeToast?: boolean;
}

export function ModelSelect({
  value,
  onChange,
  className = '',
  engine,
  allowGlobal = false,
  emptyOptionLabel,
  showChangeToast = true,
}: ModelSelectProps) {
  const queryClient = useQueryClient();
  const modelsQuery = useModelsQuery();
  const engineConfigQuery = useEngineConfigQuery();
  const allModels = modelsQuery.data?.models || [];
  const loading = modelsQuery.isLoading || (allowGlobal && engineConfigQuery.isLoading);
  const globalDefaultModel = typeof engineConfigQuery.data?.defaultModel === 'string' ? engineConfigQuery.data.defaultModel : '';
  const { toast } = useToast();

  useEffect(() => {
    if (!allowGlobal) return;
    const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.engines() });
    const onEngineUpdated = () => { void refresh(); };
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'engine-config-updated-at') void refresh();
    };
    window.addEventListener('engine:updated', onEngineUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('engine:updated', onEngineUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [allowGlobal, queryClient]);

  // Filter by engine if specified; models without engines field are shown for all engines
  const models = engine
    ? allModels.filter((m) => {
      return modelEnginesSupportEngine(m.engines, engine);
    })
    : allModels;

  const options: AiModelSelectorOption[] = useMemo(
    () => {
      const items: AiModelSelectorOption[] = [];
      if (allowGlobal) {
        items.push({
          value: '__global__',
          label: globalDefaultModel ? `跟随全局 (${globalDefaultModel})` : '跟随全局',
          icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
        });
      }
      if (emptyOptionLabel && !allowGlobal) {
        items.push({
          value: '__empty__',
          label: emptyOptionLabel,
          icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
        });
      }
      items.push(...models.map(m => ({
        value: m.value,
        label: m.label,
        description: `${m.costMultiplier}x`,
        keywords: [m.value],
      })));
      return items;
    },
    [allowGlobal, emptyOptionLabel, globalDefaultModel, models],
  );

  const handleChange = (newValue: string) => {
    if (allowGlobal && newValue === '__global__') {
      onChange('');
      if (showChangeToast) {
        toast('info', globalDefaultModel ? `模型已切换: 跟随全局 (${globalDefaultModel})` : '模型已切换: 跟随全局');
      }
      return;
    }
    if (emptyOptionLabel && newValue === '__empty__') {
      onChange('');
      if (showChangeToast) {
        toast('info', `模型已切换: ${emptyOptionLabel}`);
      }
      return;
    }
    const selectedModel = models.find(m => m.value === newValue);
    onChange(newValue);
    if (showChangeToast && selectedModel) {
      toast('info', `模型已切换: ${selectedModel.label} (${selectedModel.costMultiplier}x)`);
    }
  };

  return (
    <AiModelSelectorField
      value={value || (allowGlobal ? '__global__' : emptyOptionLabel ? '__empty__' : '')}
      onValueChange={handleChange}
      options={options}
      placeholder="选择模型"
      searchPlaceholder="搜索模型..."
      disabled={loading}
      className={className}
    />
  );
}
