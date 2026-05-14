'use client';

import { useState, useEffect, useMemo } from 'react';
import { Globe } from 'lucide-react';
import { SingleCombobox, type ComboboxOption } from '@/components/ui/combobox';
import { EngineIcon } from '@/components/EngineIcon';
import { getConcreteEngines, getEngineMeta } from '@/lib/core/engine-metadata';

interface EngineSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Show a "use global" option for per-chat/per-agent overrides */
  allowGlobal?: boolean;
}

export function EngineSelect({ value, onChange, className = '', allowGlobal = false }: EngineSelectProps) {
  const [globalEngine, setGlobalEngine] = useState('');

  useEffect(() => {
    if (!allowGlobal) return;
    const refresh = () => {
      fetch('/api/engine').then(r => r.json()).then(d => {
        if (d.engine) setGlobalEngine(d.engine);
      }).catch(() => {});
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

  const globalLabel = getEngineMeta(globalEngine)?.name || globalEngine;

  const options: ComboboxOption[] = useMemo(() => {
    const items: ComboboxOption[] = [];
    if (allowGlobal) {
      items.push({
        value: '__global__',
        label: `跟随全局 (${globalLabel})`,
        icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
      });
    }
    items.push(...getConcreteEngines().map((eng) => ({
      value: eng.id,
      label: eng.name,
      icon: <EngineIcon engineId={eng.id} className="h-4 w-4" />,
    })));
    return items;
  }, [allowGlobal, globalLabel]);

  return (
    <SingleCombobox
      value={value || '__global__'}
      onValueChange={(v) => onChange(v === '__global__' ? '' : v)}
      options={options}
      placeholder="选择引擎"
      triggerClassName={className}
      searchable={false}
    />
  );
}

/** Hook to get the effective engine (per-chat override or global) */
export function useCurrentEngine(override?: string): string {
  const [globalEngine, setGlobalEngine] = useState('');

  useEffect(() => {
    const refresh = () => {
      fetch('/api/engine').then(r => r.json()).then(d => {
        if (d.engine) setGlobalEngine(d.engine);
      }).catch(() => {});
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
  }, []);

  return override || globalEngine;
}
