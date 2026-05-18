'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { envApi } from '@/lib/core/api';

interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
}

interface EnvVarError {
  key?: string;
}

function validateEnvVars(vars: EnvVar[]) {
  const errors: EnvVarError[] = vars.map(() => ({}));
  const keyPattern = /^[A-Z_][A-Z0-9_]*$/;
  const keyMap = new Map<string, number[]>();

  vars.forEach((item, index) => {
    const trimmedKey = item.key.trim();
    const isEmptyRow = !trimmedKey && !item.value.trim() && item.enabled;

    if (!trimmedKey) {
      if (!isEmptyRow) {
        errors[index].key = '请输入变量名';
      }
      return;
    }

    if (!keyPattern.test(trimmedKey)) {
      errors[index].key = '仅支持大写字母、数字和下划线，且不能以数字开头';
      return;
    }

    const indexes = keyMap.get(trimmedKey) || [];
    indexes.push(index);
    keyMap.set(trimmedKey, indexes);
  });

  for (const indexes of keyMap.values()) {
    if (indexes.length > 1) {
      for (const index of indexes) {
        errors[index].key = '变量名不能重复';
      }
    }
  }

  return {
    errors,
    hasErrors: errors.some((item) => Boolean(item.key)),
  };
}

export default function EnvVarsDialog({ onClose, scope = 'user' }: { onClose: () => void; scope?: 'user' }) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [errors, setErrors] = useState<EnvVarError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setSubmitError(null);
      try {
        const data = await envApi.get(scope);
        if (cancelled) return;
        const nextVars = data.vars || [];
        setVars(nextVars);
        setErrors(nextVars.map(() => ({})));
      } catch (error: any) {
        if (cancelled) return;
        setSubmitError(error?.message || '加载环境变量失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [scope]);

  const displayVars = useMemo(() => vars, [vars]);

  const updateVar = (index: number, patch: Partial<EnvVar>) => {
    setVars((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
    if (patch.key !== undefined) {
      setErrors((prev) => prev.map((item, itemIndex) => (itemIndex === index ? { ...item, key: undefined } : item)));
    }
  };

  const addRow = () => {
    setVars((prev) => [...prev, { key: '', value: '', enabled: true }]);
    setErrors((prev) => [...prev, {}]);
  };

  const removeVar = (index: number) => {
    setVars((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
    setErrors((prev) => prev.filter((_, itemIndex) => itemIndex !== index));
  };

  const save = async () => {
    const normalizedVars = vars.map((item) => ({ ...item, key: item.key.trim() }));
    const validation = validateEnvVars(normalizedVars);
    setErrors(validation.errors);
    if (validation.hasErrors) {
      setSubmitError('请先修正错误后再保存');
      return;
    }

    setSaving(true);
    setSubmitError(null);
    try {
      await envApi.save(scope, normalizedVars.filter((item) => item.key));
      onClose();
    } catch (error: any) {
      setSubmitError(error?.message || '保存环境变量失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-background border rounded-xl shadow-2xl w-[560px] max-h-[80vh] flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">key</span>
            <h2 className="text-base font-semibold">个人环境变量</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-muted rounded">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="text-sm text-muted-foreground text-center py-8">加载中...</div>
          ) : (
            <div className="space-y-4">
              {submitError ? (
                <div className="text-xs text-destructive bg-destructive/10 rounded-md px-2 py-1.5">{submitError}</div>
              ) : null}

              <div className="grid grid-cols-[1fr_1fr_48px_32px] gap-2 text-xs text-muted-foreground font-medium px-1">
                <span>Key</span>
                <span>Value</span>
                <span className="text-center">启用</span>
                <span></span>
              </div>
              {displayVars.map((item, index) => (
                <div key={index} className="space-y-1">
                  <div className="grid grid-cols-[1fr_1fr_48px_32px] gap-2 items-center">
                    <Input
                      value={item.key}
                      onChange={(event) => updateVar(index, { key: event.target.value })}
                      placeholder="KEY"
                      className={`h-8 text-xs font-mono ${errors[index]?.key ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                    />
                    <Input
                      value={item.value}
                      onChange={(event) => updateVar(index, { value: event.target.value })}
                      placeholder="value"
                      className="h-8 text-xs font-mono"
                    />
                    <div className="flex justify-center">
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(checked) => updateVar(index, { enabled: checked })}
                        className="scale-75"
                      />
                    </div>
                    <button
                      onClick={() => removeVar(index)}
                      className="p-1 hover:bg-destructive/10 rounded text-muted-foreground hover:text-destructive"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: '16px' }}>delete</span>
                    </button>
                  </div>
                  {errors[index]?.key ? (
                    <div className="px-1 text-xs text-destructive">{errors[index].key}</div>
                  ) : null}
                </div>
              ))}
              {displayVars.length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-4">暂无环境变量</div>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-5 py-3 border-t">
          <Button variant="outline" size="sm" onClick={addRow}>
            <span className="material-symbols-outlined mr-1" style={{ fontSize: '14px' }}>add</span>
            添加
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>取消</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
