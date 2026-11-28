'use client';

import { useMemo, useState } from 'react';
import { Check, Copy, Eye, EyeOff, Plus, TriangleAlert, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/core/utils';

export interface EnvironmentVariable {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  secret?: boolean;
  required?: boolean;
  description?: string;
  keyError?: string;
  disableKeyEdit?: boolean;
}

interface EnvironmentVariablesProps {
  variables: EnvironmentVariable[];
  title?: string;
  source?: string;
  peek?: boolean;
  revealed?: boolean;
  defaultRevealed?: boolean;
  onRevealedChange?: (revealed: boolean) => void;
  warning?: React.ReactNode;
  disabled?: boolean;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  onChange?: (index: number, patch: Partial<EnvironmentVariable>) => void;
  onSecretModeChange?: (index: number, enabled: boolean) => void;
  onCopy?: (index: number) => void | Promise<void>;
  emptyMessage?: string;
  className?: string;
}

const PUBLIC_KEY = /^(NEXT_PUBLIC_|VITE_|PUBLIC_|EXPO_PUBLIC_|NUXT_PUBLIC_|REACT_APP_)/;
const MASK = '\u2022'.repeat(12);

function isSecret(variable: EnvironmentVariable) {
  return variable.secret ?? !PUBLIC_KEY.test(variable.key);
}

export function EnvironmentVariables({
  variables,
  title = '环境变量',
  source,
  peek = false,
  revealed: revealedProp,
  defaultRevealed = false,
  onRevealedChange,
  warning,
  disabled = false,
  onAdd,
  onRemove,
  onChange,
  onSecretModeChange,
  onCopy,
  emptyMessage = '暂无环境变量。',
  className,
}: EnvironmentVariablesProps) {
  const [revealedState, setRevealedState] = useState(defaultRevealed);
  const [revealedIds, setRevealedIds] = useState<string[]>([]);
  const [copiedIds, setCopiedIds] = useState<string[]>([]);
  const revealAll = revealedProp ?? revealedState;
  const secrets = useMemo(() => variables.filter((item) => isSecret(item) && item.value !== ''), [variables]);

  const setRevealAll = (next: boolean) => {
    if (revealedProp === undefined) setRevealedState(next);
    onRevealedChange?.(next);
    if (!next) setRevealedIds([]);
  };

  const copyValue = async (index: number) => {
    const item = variables[index];
    if (!item) return;
    if (onCopy) {
      await onCopy(index);
    } else {
      await navigator.clipboard?.writeText(`${item.key}=${item.value}`);
    }
    setCopiedIds((current) => current.includes(item.id) ? current : [...current, item.id]);
    window.setTimeout(() => setCopiedIds((current) => current.filter((id) => id !== item.id)), 1500);
  };

  const copyAll = async () => {
    const text = variables
      .filter((item) => item.key.trim() && item.value !== '')
      .map((item) => `${item.key.trim()}=${item.value}`)
      .join('\n');
    await navigator.clipboard?.writeText(text);
  };

  const toggleReveal = (index: number, item: EnvironmentVariable) => {
    const current = isSecret(item);
    onSecretModeChange?.(index, !current);
    if (current) setRevealedIds((ids) => ids.filter((id) => id !== item.id));
  };

  return (
    <div
      data-slot="environment-variables"
      className={cn('overflow-hidden rounded-lg border bg-card text-card-foreground', className)}
    >
      <div className="flex min-h-12 items-center gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
          <span className="flex min-w-0 items-baseline gap-2 text-xs text-muted-foreground">
            {source ? <><span className="truncate">{source}</span><span aria-hidden="true">·</span></> : null}
            <span className="shrink-0 tabular-nums">{variables.length} 项</span>
          </span>
        </div>
        <TooltipProvider delayDuration={300}>
          {secrets.length > 0 ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-pressed={revealAll}
              onClick={() => setRevealAll(!revealAll)}
              disabled={disabled}
              className="h-8 gap-1.5 px-2 text-xs"
            >
              {revealAll ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              <span className="hidden sm:inline">{revealAll ? '全部隐藏' : '全部显示'}</span>
            </Button>
          ) : null}
          {variables.some((item) => item.key.trim() && item.value !== '') ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => void copyAll()} aria-label="复制全部环境变量">
                  <Copy className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>复制为环境配置</TooltipContent>
            </Tooltip>
          ) : null}
          {onAdd ? (
            <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs" onClick={onAdd} disabled={disabled}>
              <Plus className="size-3.5" />新增
            </Button>
          ) : null}
        </TooltipProvider>
      </div>

      {warning ? (
        <div role="alert" className="flex items-start gap-2 border-b px-4 py-3 text-sm text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{warning}</p>
        </div>
      ) : null}

      {variables.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">{emptyMessage}</div>
      ) : (
        <ul aria-label={title} className="divide-y">
          {variables.map((item, index) => {
            const secret = isSecret(item);
            const visible = !secret || revealedIds.includes(item.id) || revealAll;
            const copied = copiedIds.includes(item.id);
            return (
              <li key={item.id} className="group/row grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
                <div className="col-start-1 row-start-1 flex min-w-0 flex-col">
                  <Input
                    value={item.key}
                    onChange={(event) => onChange?.(index, { key: event.target.value })}
                    placeholder="例如：MY_API_TOKEN"
                    aria-label="变量名"
                    className="h-9 font-mono text-xs"
                    disabled={disabled || item.disableKeyEdit}
                  />
                  {item.description ? <p className="mt-1 truncate text-xs text-muted-foreground">{item.description}</p> : null}
                  {item.keyError ? <p className="mt-1 text-xs text-destructive">{item.keyError}</p> : null}
                </div>

                <div className="col-start-1 row-start-2 min-w-0 sm:col-start-2 sm:row-start-1">
                  <Input
                    type={secret && !visible ? 'password' : 'text'}
                    value={secret && !visible ? '' : item.value}
                    onChange={(event) => onChange?.(index, { value: event.target.value })}
                    placeholder={secret && !visible && item.value ? MASK : '输入变量值'}
                    aria-label={`${item.key || '变量'}的值`}
                    className="h-9 font-mono text-xs"
                    disabled={disabled}
                  />
                </div>

                <div className="col-start-2 row-span-2 row-start-1 flex items-center justify-end gap-1 sm:col-start-3 sm:row-span-1">
                  {onChange ? (
                    <div className="flex h-9 items-center gap-1.5 px-1" title="启用">
                      <Switch checked={item.enabled} onCheckedChange={(enabled) => onChange(index, { enabled })} disabled={disabled} aria-label={`启用 ${item.key || '变量'}`} />
                    </div>
                  ) : null}
                  <TooltipProvider delayDuration={300}>
                    {onSecretModeChange ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => toggleReveal(index, item)} disabled={disabled} aria-label={secret ? `关闭 ${item.key} 的密码模式` : `开启 ${item.key} 的密码模式`} aria-pressed={secret}>
                            {secret ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{secret ? '关闭密码模式' : '开启密码模式'}</TooltipContent>
                      </Tooltip>
                    ) : secret ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => setRevealedIds((ids) => ids.includes(item.id) ? ids.filter((id) => id !== item.id) : [...ids, item.id])} disabled={disabled || revealAll} aria-label={visible ? `隐藏 ${item.key}` : `显示 ${item.key}`}>
                            {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{visible ? '隐藏变量值' : '显示变量值'}</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={() => void copyValue(index)} disabled={disabled || !item.value} aria-label={copied ? '已复制' : `复制 ${item.key}`}>
                          {copied ? <Check className="size-4 text-emerald-600" /> : <Copy className="size-4" />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{copied ? '已复制' : '复制变量值'}</TooltipContent>
                    </Tooltip>
                    {onRemove ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button type="button" size="icon" variant="ghost" className="size-8 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => onRemove(index)} disabled={disabled} aria-label={`删除 ${item.key || '变量'}`}>
                            <Trash2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>删除变量</TooltipContent>
                      </Tooltip>
                    ) : null}
                  </TooltipProvider>
                </div>

              </li>
            );
          })}
        </ul>
      )}
      {peek ? <span className="sr-only">敏感变量默认隐藏</span> : null}
    </div>
  );
}

export default EnvironmentVariables;
