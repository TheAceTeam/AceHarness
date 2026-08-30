'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, KeyRound, Plus, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EnvironmentVariables } from '@/components/ai-elements/environment-variables';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { envApi } from '@/lib/core/api';
import {
  CLI_ENVIRONMENT_GROUPS,
  getCliEnvironmentGroupId,
  getCliEnvironmentVariable,
  type CliEnvironmentGroupId,
} from '@/lib/core/cli-environment-variables';

interface EnvVar {
  key: string;
  value: string;
  enabled: boolean;
  group?: CliEnvironmentGroupId;
}

interface EnvVarError {
  key?: string;
}

export interface EnvVarsEditorProps {
  scope?: 'system' | 'user';
  inline?: boolean;
  onClose?: () => void;
  onSavingChange?: (saving: boolean) => void;
}

function validateEnvVars(vars: EnvVar[]) {
  const errors: EnvVarError[] = vars.map(() => ({}));
  const keyPattern = /^[A-Z_][A-Z0-9_]*$/;
  const keyMap = new Map<string, number[]>();

  vars.forEach((item, index) => {
    const trimmedKey = item.key.trim().toUpperCase();
    if (!trimmedKey && !item.value.trim()) return;

    if (!trimmedKey) {
      errors[index].key = '请输入变量名';
      return;
    }

    if (!keyPattern.test(trimmedKey)) {
      errors[index].key = '变量名格式不正确';
      return;
    }

    const indexes = keyMap.get(trimmedKey) || [];
    indexes.push(index);
    keyMap.set(trimmedKey, indexes);
  });

  for (const indexes of keyMap.values()) {
    if (indexes.length > 1) {
      for (const index of indexes) errors[index].key = '变量名不能重复';
    }
  }

  return {
    errors,
    hasErrors: errors.some((item) => Boolean(item.key)),
  };
}

export function EnvVarsEditor({
  onClose,
  scope = 'user',
  inline = false,
  onSavingChange,
}: EnvVarsEditorProps) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [errors, setErrors] = useState<EnvVarError[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [activeGroup, setActiveGroup] = useState<CliEnvironmentGroupId>('claude');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setSubmitError(null);
      setSaved(false);
      try {
        const data = await envApi.get(scope);
        if (cancelled) return;
        const nextVars = data.vars || [];
        setVars(nextVars);
        setErrors(nextVars.map(() => ({})));
      } catch (error: any) {
        if (!cancelled) setSubmitError(error?.message || '加载环境变量失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [scope]);

  const activeGroupDefinition = CLI_ENVIRONMENT_GROUPS.find((group) => group.id === activeGroup)!;
  const activeRows = useMemo(
    () => vars
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => (getCliEnvironmentGroupId(item.key) || item.group || 'other-cli') === activeGroup),
    [activeGroup, vars],
  );
  const activeKeys = useMemo(() => new Set(activeRows.map(({ item }) => item.key.trim().toUpperCase())), [activeRows]);
  const configuredCount = vars.filter((item) => item.key.trim() && item.enabled).length;

  const updateVar = (index: number, patch: Partial<EnvVar>) => {
    setSaved(false);
    setVars((previous) => previous.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
    if (patch.key !== undefined) {
      setErrors((previous) => previous.map((item, itemIndex) => (
        itemIndex === index ? { ...item, key: undefined } : item
      )));
    }
  };

  const addPreset = (key: string) => {
    if (vars.some((item) => item.key.trim().toUpperCase() === key)) return;
    setSaved(false);
    setVars((previous) => [...previous, { key, value: '', enabled: true, group: activeGroup }]);
    setErrors((previous) => [...previous, {}]);
  };

  const addCustomVariable = () => {
    setSaved(false);
    setVars((previous) => [...previous, { key: '', value: '', enabled: true, group: activeGroup }]);
    setErrors((previous) => [...previous, {}]);
  };

  const removeVar = (index: number) => {
    setSaved(false);
    setVars((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    setErrors((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
  };

  const save = async () => {
    const normalizedVars = vars.map((item) => ({ ...item, key: item.key.trim().toUpperCase() }));
    const validation = validateEnvVars(normalizedVars);
    setErrors(validation.errors);
    if (validation.hasErrors) {
      setSaved(false);
      setSubmitError('请先完善变量名称');
      return;
    }

    setSaving(true);
    onSavingChange?.(true);
    setSubmitError(null);
    try {
      await envApi.save(scope, normalizedVars
        .filter((item) => item.key)
        .map(({ key, value, enabled }) => ({ key, value, enabled })));
      setSaved(true);
      if (!inline) onClose?.();
    } catch (error: any) {
      setSaved(false);
      setSubmitError(error?.message || '保存环境变量失败');
    } finally {
      setSaving(false);
      onSavingChange?.(false);
    }
  };

  return (
    <div className={inline ? 'space-y-5' : 'flex min-h-0 flex-1 flex-col overflow-hidden'} data-env-scope={scope}>
      <div className={inline ? 'space-y-5' : 'min-h-0 flex-1 overflow-y-auto px-6 py-5'}>
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">正在加载 CLI 配置</div>
        ) : (
          <div className="space-y-5">
            {submitError ? (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{submitError}</div>
            ) : null}

            <Tabs value={activeGroup} onValueChange={(value) => setActiveGroup(value as CliEnvironmentGroupId)} className="space-y-5">
              <TabsList className="grid h-auto w-full grid-cols-2 md:grid-cols-4">
                {CLI_ENVIRONMENT_GROUPS.map((group) => (
                  <TabsTrigger key={group.id} value={group.id}>{group.label}</TabsTrigger>
                ))}
              </TabsList>

              <TabsContent value={activeGroup} className="mt-0 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-muted/20 px-4 py-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold">{activeGroupDefinition.label}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">{activeGroupDefinition.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{activeRows.length} 项配置</span>
                </div>

                <div className="flex flex-wrap gap-2">
                  {activeGroupDefinition.variables.map((variable) => {
                    const exists = activeKeys.has(variable.key);
                    return (
                      <Button
                        key={variable.key}
                        type="button"
                        variant={exists ? 'secondary' : 'outline'}
                        size="sm"
                        onClick={() => addPreset(variable.key)}
                        disabled={exists}
                        title={variable.description}
                        className="h-8 font-mono text-xs"
                      >
                        {exists ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                        {variable.key}
                      </Button>
                    );
                  })}
                </div>

                <EnvironmentVariables
                  items={activeRows.map(({ item, index }) => {
                    const definition = getCliEnvironmentVariable(item.key);
                    return {
                      id: `${index}-${item.key}`,
                      key: item.key,
                      value: item.value,
                      enabled: item.enabled,
                      description: definition?.description,
                      maskValue: Boolean(definition && 'secret' in definition && definition.secret),
                      disableKeyEdit: Boolean(definition),
                      keyError: errors[index]?.key,
                    };
                  })}
                  onChange={(rowIndex, patch) => {
                    const actualIndex = activeRows[rowIndex]?.index;
                    if (actualIndex === undefined) return;
                    updateVar(actualIndex, patch);
                  }}
                  onRemove={(rowIndex) => {
                    const actualIndex = activeRows[rowIndex]?.index;
                    if (actualIndex !== undefined) removeVar(actualIndex);
                  }}
                  onAdd={addCustomVariable}
                  emptyMessage="选择上方变量名，开始配置此 CLI。"
                />
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>

      <div className={inline
        ? 'flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4'
        : 'flex shrink-0 flex-row items-center justify-between gap-3 border-t border-border px-6 py-4'}>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{configuredCount} 项已启用</span>
          {inline && saved ? <span role="status" className="text-xs text-emerald-600">已保存</span> : null}
        </div>
        <div className="flex gap-2">
          {!inline ? <Button type="button" variant="outline" onClick={onClose}>取消</Button> : null}
          <Button type="button" onClick={() => void save()} disabled={loading || saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? '保存中...' : '保存配置'}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function EnvVarsDialog({
  onClose,
  scope = 'user',
}: {
  onClose: () => void;
  scope?: 'system' | 'user';
}) {
  const [saving, setSaving] = useState(false);
  const title = scope === 'system' ? '系统 CLI 环境变量' : '个人 CLI 环境变量';
  const description = scope === 'system'
    ? '集中管理 CLI 的默认启动配置，个人设置中的同名配置会优先应用。'
    : '按 CLI 分类管理当前账号的启动配置，保存后用于新的运行会话。';

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="flex max-h-[min(820px,calc(100vh-2rem))] w-[min(860px,calc(100vw-2rem))] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 text-left">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                <KeyRound className="h-4 w-4" />
                <span>CLI 配置</span>
              </div>
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-2">{description}</DialogDescription>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="关闭环境变量">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>
        <EnvVarsEditor scope={scope} onClose={onClose} onSavingChange={setSaving} />
      </DialogContent>
    </Dialog>
  );
}
