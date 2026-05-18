'use client';

import { useCallback, useEffect, useState } from 'react';
import { applyDisabledPluginIds } from '@/lib/sidebar-plugins';

function getAuthHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  const token = window.localStorage.getItem('auth-token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function requestSidebarPluginPreferences(init?: RequestInit): Promise<{ disabledPluginIds: string[] }> {
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
  return { disabledPluginIds };
}

export function useSidebarPluginPreferences() {
  const [disabledPluginIds, setDisabledPluginIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const data = await requestSidebarPluginPreferences();
    applyDisabledPluginIds(data.disabledPluginIds);
    setDisabledPluginIds(data.disabledPluginIds);
    setVersion((prev) => prev + 1);
    return data.disabledPluginIds;
  }, []);

  const save = useCallback(async (nextDisabledPluginIds: string[]) => {
    const data = await requestSidebarPluginPreferences({
      method: 'PUT',
      body: JSON.stringify({ disabledPluginIds: nextDisabledPluginIds }),
    });
    applyDisabledPluginIds(data.disabledPluginIds);
    setDisabledPluginIds(data.disabledPluginIds);
    setVersion((prev) => prev + 1);
    return data.disabledPluginIds;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const data = await requestSidebarPluginPreferences();
        if (cancelled) return;
        applyDisabledPluginIds(data.disabledPluginIds);
        setDisabledPluginIds(data.disabledPluginIds);
        setVersion((prev) => prev + 1);
      } catch {
        if (cancelled) return;
        applyDisabledPluginIds([]);
        setDisabledPluginIds([]);
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
    loading,
    refresh,
    save,
    version,
  };
}
