'use client';

import { useState, useEffect, useMemo } from 'react';
import { ModelOption } from '@/lib/models';
import { SingleCombobox, type ComboboxOption } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';

interface ModelSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** When set, only show models that include this engine in their engines list */
  engine?: string;
}

export function ModelSelect({ value, onChange, className = '', engine }: ModelSelectProps) {
  const [allModels, setAllModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(true);
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
    () => models.map(m => ({ value: m.value, label: `${m.label} (${m.costMultiplier}x)` })),
    [models],
  );

  const handleChange = (newValue: string) => {
    const selectedModel = models.find(m => m.value === newValue);
    onChange(newValue);
    if (selectedModel) {
      toast('info', `模型已切换: ${selectedModel.label} (${selectedModel.costMultiplier}x)`);
    }
  };

  return (
    <SingleCombobox
      value={value}
      onValueChange={handleChange}
      options={options}
      placeholder="选择模型"
      disabled={loading}
      triggerClassName={className}
    />
  );
}
