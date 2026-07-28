'use client';

import { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Globe } from 'lucide-react';
import { AiModelSelectorField, type AiModelSelectorOption } from '@/components/AiModelSelectorField';
import { EngineIcon } from '@/components/EngineIcon';
import { getEngineMeta } from '@/lib/core/engine-metadata';
import { useRuntimeEngineOptionsQuery, useRuntimeEngineSelectionQuery } from '@/client/query/engines';
import { queryKeys } from '@/client/query/query-keys';

interface EngineSelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** Show a "use global" option for per-chat/per-agent overrides */
  allowGlobal?: boolean;
}

export function EngineSelect({ value, onChange, className = '', allowGlobal = false }: EngineSelectProps) {
  const queryClient = useQueryClient();
  const runtimeSelectionQuery = useRuntimeEngineSelectionQuery();
  const runtimeOptionsQuery = useRuntimeEngineOptionsQuery();
  const globalEngine = typeof runtimeSelectionQuery.data?.engine === 'string' ? runtimeSelectionQuery.data.engine : '';

  useEffect(() => {
    if (!allowGlobal) return;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
    };
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

  const globalLabel = runtimeOptionsQuery.data?.find((engine) => engine.id === globalEngine)?.name
    || getEngineMeta(globalEngine)?.name
    || globalEngine;

  const options: AiModelSelectorOption[] = useMemo(() => {
    const items: AiModelSelectorOption[] = [];
    if (allowGlobal) {
      items.push({
        value: '__global__',
        label: `跟随全局 (${globalLabel})`,
        icon: <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />,
      });
    }
    items.push(...(runtimeOptionsQuery.data || []).map((eng) => ({
      value: eng.id,
      label: eng.name,
      icon: <EngineIcon engineId={eng.id} iconPath={eng.iconPath} className="h-4 w-4" />,
    })));
    return items;
  }, [allowGlobal, globalLabel, runtimeOptionsQuery.data]);

  return (
    <AiModelSelectorField
      value={value || '__global__'}
      onValueChange={(v) => onChange(v === '__global__' ? '' : v)}
      options={options}
      placeholder="选择引擎"
      searchPlaceholder="搜索引擎..."
      className={className}
    />
  );
}

/** Hook to get the effective engine (per-chat override or global) */
export function useCurrentEngine(override?: string): string {
  const queryClient = useQueryClient();
  const runtimeSelectionQuery = useRuntimeEngineSelectionQuery();
  const globalEngine = typeof runtimeSelectionQuery.data?.engine === 'string' ? runtimeSelectionQuery.data.engine : '';

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.models() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.agents() });
    };
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
  }, [queryClient]);

  return override || globalEngine;
}
