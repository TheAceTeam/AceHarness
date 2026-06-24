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
  registerHeader: (scopeId: string, config: DashboardShellHeaderConfig) => DashboardShellHeaderRegistration;
};

const DashboardShellHeaderContext = createContext<DashboardShellHeaderContextValue | null>(null);
const DashboardShellHeaderScopeContext = createContext<string | null>(null);
type HeaderEntry = { id: number; config: DashboardShellHeaderConfig };
type DashboardShellHeaderRegistration = {
  update: (config: DashboardShellHeaderConfig) => void;
  unregister: () => void;
};

function areHeaderConfigsEqual(a: DashboardShellHeaderConfig, b: DashboardShellHeaderConfig) {
  return a.title === b.title
    && a.subtitle === b.subtitle
    && a.actions === b.actions;
}

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

    return {
      update: (nextConfig: DashboardShellHeaderConfig) => {
        setHeaders((prev) => {
          const entries = prev[scopeId];
          if (!entries) return prev;
          const index = entries.findIndex((entry) => entry.id === id);
          if (index === -1) return prev;
          if (areHeaderConfigsEqual(entries[index].config, nextConfig)) return prev;

          const nextEntries = [...entries];
          nextEntries[index] = { id, config: nextConfig };
          return {
            ...prev,
            [scopeId]: nextEntries,
          };
        });
      },
      unregister: () => setHeaders((prev) => {
        const entries = (prev[scopeId] || []).filter((entry) => entry.id !== id);
        if (entries.length === (prev[scopeId] || []).length) return prev;
        const next = { ...prev };
        if (entries.length > 0) {
          next[scopeId] = entries;
        } else {
          delete next[scopeId];
        }
        return next;
      }),
    };
  }, []);

  const activeEntries = activeScopeId ? headers[activeScopeId] : undefined;
  const value = useMemo<DashboardShellHeaderContextValue>(() => ({
    activeScopeId,
    activeHeader: activeEntries && activeEntries.length > 0 ? activeEntries[activeEntries.length - 1].config : null,
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
  const registrationRef = useRef<DashboardShellHeaderRegistration | null>(null);
  const hasConfig = Boolean(config);

  useEffect(() => {
    if (!registerHeader || !scopeId || !config) return;
    const registration = registerHeader(scopeId, config);
    registrationRef.current = registration;
    return () => {
      if (registrationRef.current === registration) {
        registrationRef.current = null;
      }
      registration.unregister();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerHeader, scopeId, hasConfig]);

  useEffect(() => {
    if (!config) return;
    registrationRef.current?.update(config);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerHeader, scopeId, ...deps]);

  return {
    isDashboardShell: Boolean(context && scopeId),
  };
}
