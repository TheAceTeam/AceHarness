'use client';

import { useState, useEffect, useMemo } from 'react';
import { Globe } from 'lucide-react';
import { ModelOption } from '@/lib/models';
import { SingleCombobox, type ComboboxOption } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** When set, only show models that include this engine in their engines list */
  engine?: string;
  /** Show a "use global" option */
  allowGlobal?: boolean;
}

export function ModelSelect({ value, onChange, className = '', engine, allowGlobal = false }: ModelSelectProps) {
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [globalDefaultModel, setGlobalDefaultModel] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then(data => {
        setAllModels(data.models || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!allowGlobal) return;
    const refresh = () => {
      fetch('/api/engine')
        .then(res => res.json())
        .then(data => {
          setGlobalDefaultModel(data.defaultModel || '');
        })
        .catch(() => {});
    };
    refresh();
    const onEngineUpdated = () => refresh();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'engine-config-updated-at') refresh();
    };
    window.addEventListener('engine:updated', onEngineUpdated as EventListener);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('engine:updated', onEngineUpdated as EventListener);
      window.removeEventListener('storage', onStorage);
    };
  }, [allowGlobal]);

  // Filter by engine if specified; models without engines field are shown for all engines
  const models = engine
    ? allModels.filter((m) => {
      if (!m.engines || m.engines.length === 0) return true;
      if (m.engines.includes(engine)) return true;
      // nga / codegenie 与 OpenCode 内核兼容：可复用 opencode 的模型声明
      if ((engine === 'nga' || engine === 'codegenie') && m.engines.includes('opencode')) return true;
      return false;
    })
    : allModels;

  const options: ComboboxOption[] = useMemo(
    () => {
      const items: ComboboxOption[] = [];
      if (allowGlobal) {
        items.push({
          value: '__global__',
          label: globalDefaultModel ? `跟随全局 (${globalDefaultModel})` : '跟随全局',
          icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
        });
      }
      items.push(...models.map(m => ({ value: m.value, label: `${m.label} (${m.costMultiplier}x)` })));
      return items;
    },
    [allowGlobal, globalDefaultModel, models],
  );

  const handleChange = (newValue: string) => {
    if (allowGlobal && newValue === '__global__') {
      onChange('');
      toast('info', globalDefaultModel ? `模型已切换: 跟随全局 (${globalDefaultModel})` : '模型已切换: 跟随全局');
      return;
    }
    const selectedModel = models.find(m => m.value === newValue);
    onChange(newValue);
    if (selectedModel) {
      toast('info', `模型已切换: ${selectedModel.label} (${selectedModel.costMultiplier}x)`);
    }
  };

  return (
    <SingleCombobox
      value={value || (allowGlobal ? '__global__' : '')}
      onValueChange={handleChange}
      options={options}
      placeholder="选择模型"
      disabled={loading}
      triggerClassName={className}
    />
  );
}
