'use client';

import { createContext, useContext, useState, useCallback, useRef } from 'react';

interface Toast {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
}

interface ToastContextValue {
  toast: (type: Toast['type'], message: string) => void;
  clearToasts: () => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {}, clearToasts: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timeoutRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const toast = useCallback((type: Toast['type'], message: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    if (type === 'success') {
      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timeoutRef.current.delete(id);
      }, 3000);
      timeoutRef.current.set(id, timer);
    }
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timeoutRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timeoutRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    for (const timer of timeoutRef.current.values()) {
      clearTimeout(timer);
    }
    timeoutRef.current.clear();
    setToasts([]);
  }, []);

  const iconMap = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  const colorMap = {
    success: 'bg-green-600 text-white',
    error: 'bg-destructive text-destructive-foreground',
    info: 'bg-primary text-primary-foreground',
    warning: 'bg-yellow-600 text-white',
  };

  return (
    <ToastContext.Provider value={{ toast, clearToasts }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[400] pointer-events-auto flex flex-col gap-2 max-w-sm">
        {toasts.length > 0 ? (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={clearToasts}
              className="rounded-md border bg-background/90 px-2.5 py-1 text-xs text-muted-foreground shadow-sm transition-colors hover:bg-background hover:text-foreground"
              title="清空全部提示"
              aria-label="清空全部提示"
            >
              一键清理
            </button>
          </div>
        ) : null}
        {toasts.map((t) => (
          <div key={t.id}
            className={`${colorMap[t.type]} rounded-lg px-4 py-3 shadow-lg flex items-start gap-2 animate-in slide-in-from-right-5 text-sm`}>
            <span className="material-symbols-outlined text-base mt-0.5">{iconMap[t.type]}</span>
            <span className="flex-1 leading-relaxed whitespace-pre-wrap select-text">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="rounded p-0.5 opacity-80 transition-opacity hover:bg-black/10 hover:opacity-100"
              title="关闭"
              aria-label="关闭提示"
            >
              <span className="material-symbols-outlined text-base">close</span>
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
