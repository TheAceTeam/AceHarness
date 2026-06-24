'use client';

import { useCallback, useEffect, useState } from 'react';
import { applySidebarPluginPreferences } from '@/lib/sidebar-plugins';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

type SidebarPluginPreferenceIds = {
  disabledPluginIds: string[];
  enabledPluginIds: string[];
};

async function requestSidebarPluginPreferences(init?: RequestInit): Promise<SidebarPluginPreferenceIds> {
  const response = await fetch('/api/sidebar-plugins/preferences', {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let message = '读取侧边栏插件设置失败';
    try {
      const data = await response.json();
      if (typeof data?.error === 'string' && data.error) {
        message = data.error;
      }
    } catch {}
    throw new Error(message);
  }

  const data = await response.json();
  const disabledPluginIds = Array.isArray(data?.disabledPluginIds)
    ? data.disabledPluginIds.filter((item: unknown) => typeof item === 'string')
    : [];
  const enabledPluginIds = Array.isArray(data?.enabledPluginIds)
    ? data.enabledPluginIds.filter((item: unknown) => typeof item === 'string')
    : [];
  return { disabledPluginIds, enabledPluginIds };
}

export function useSidebarPluginPreferences() {
  const [disabledPluginIds, setDisabledPluginIds] = useState<string[]>([]);
  const [enabledPluginIds, setEnabledPluginIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const data = await requestSidebarPluginPreferences();
    applySidebarPluginPreferences(data);
    setDisabledPluginIds(data.disabledPluginIds);
    setEnabledPluginIds(data.enabledPluginIds);
    setVersion((prev) => prev + 1);
    return data;
  }, []);

  const save = useCallback(async (nextPreferences: SidebarPluginPreferenceIds) => {
    const data = await requestSidebarPluginPreferences({
      method: 'PUT',
      body: JSON.stringify(nextPreferences),
    });
    applySidebarPluginPreferences(data);
    setDisabledPluginIds(data.disabledPluginIds);
    setEnabledPluginIds(data.enabledPluginIds);
    setVersion((prev) => prev + 1);
    return data;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await requestSidebarPluginPreferences();
        if (cancelled) return;
        applySidebarPluginPreferences(data);
        setDisabledPluginIds(data.disabledPluginIds);
        setEnabledPluginIds(data.enabledPluginIds);
        setVersion((prev) => prev + 1);
      } catch {
        if (cancelled) return;
        applySidebarPluginPreferences({ disabledPluginIds: [], enabledPluginIds: [] });
        setDisabledPluginIds([]);
        setEnabledPluginIds([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    disabledPluginIds,
    enabledPluginIds,
    loading,
    refresh,
    save,
    version,
  };
}
