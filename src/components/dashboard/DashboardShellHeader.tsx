'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DependencyList,
  type ReactNode,
} from 'react';

export type DashboardShellHeaderConfig = {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
};

type DashboardShellHeaderContextValue = {
  activeScopeId: string | null;
  activeHeader: DashboardShellHeaderConfig | null;
  setActiveScopeId: (scopeId: string | null) => void;
  registerHeader: (scopeId: string, config: DashboardShellHeaderConfig) => () => void;
};

const DashboardShellHeaderContext = createContext<DashboardShellHeaderContextValue | null>(null);
const DashboardShellHeaderScopeContext = createContext<string | null>(null);
type HeaderEntry = { id: number; config: DashboardShellHeaderConfig };

export function DashboardShellHeaderProvider({ children }: { children: ReactNode }) {
  const [activeScopeId, setActiveScopeId] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, HeaderEntry[]>>({});
  const nextEntryIdRef = useRef(1);

  const registerHeader = useCallback((scopeId: string, config: DashboardShellHeaderConfig) => {
    const id = nextEntryIdRef.current++;
    setHeaders((prev) => ({
      ...prev,
      [scopeId]: [...(prev[scopeId] || []), { id, config }],
    }));
    return () => {
      setHeaders((prev) => {
        const entries = (prev[scopeId] || []).filter((entry) => entry.id !== id);
        const next = { ...prev };
        if (entries.length > 0) {
          next[scopeId] = entries;
        } else {
          delete next[scopeId];
        }
        return next;
      });
    };
  }, []);

  const activeEntries = activeScopeId ? headers[activeScopeId] || [] : [];
  const value = useMemo<DashboardShellHeaderContextValue>(() => ({
    activeScopeId,
    activeHeader: activeEntries.length > 0 ? activeEntries[activeEntries.length - 1].config : null,
    setActiveScopeId,
    registerHeader,
  }), [activeEntries, activeScopeId, registerHeader]);

  return (
    <DashboardShellHeaderContext.Provider value={value}>
      {children}
    </DashboardShellHeaderContext.Provider>
  );
}

export function DashboardShellHeaderScope({
  scopeId,
  children,
}: {
  scopeId: string;
  children: ReactNode;
}) {
  return (
    <DashboardShellHeaderScopeContext.Provider value={scopeId}>
      {children}
    </DashboardShellHeaderScopeContext.Provider>
  );
}

export function useDashboardShellHeaderController() {
  return useContext(DashboardShellHeaderContext);
}

export function useDashboardShellHeader(
  config?: DashboardShellHeaderConfig,
  deps: DependencyList = []
) {
  const context = useContext(DashboardShellHeaderContext);
  const scopeId = useContext(DashboardShellHeaderScopeContext);
  const registerHeader = context?.registerHeader;

  useEffect(() => {
    if (!registerHeader || !scopeId || !config) return;
    return registerHeader(scopeId, config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerHeader, scopeId, ...deps]);

  return {
    isDashboardShell: Boolean(context && scopeId),
  };
}
