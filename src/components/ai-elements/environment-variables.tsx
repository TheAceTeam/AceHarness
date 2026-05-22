"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/core/utils";
import { CheckIcon, CopyIcon, EyeIcon, EyeOffIcon, Trash2Icon } from "lucide-react";
import type { ComponentProps } from "react";
import { useMemo, useState } from "react";

export type EnvironmentVariableItem = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  required?: boolean;
  description?: string;
  maskValue?: boolean;
  disableValueEdit?: boolean;
  keyError?: string;
  valueHint?: string;
};

type EnvironmentVariablesProps = Omit<ComponentProps<"div">, "onChange" | "onCopy"> & {
  items: EnvironmentVariableItem[];
  disabled?: boolean;
  onAdd?: () => void;
  onRemove?: (index: number) => void;
  onChange?: (index: number, patch: Partial<EnvironmentVariableItem>) => void;
  onCopy?: (index: number) => void | Promise<void>;
  emptyMessage?: string;
};

export function EnvironmentVariables({
  className,
  items,
  disabled = false,
  onAdd,
  onRemove,
  onChange,
  onCopy,
  emptyMessage = "暂无环境变量。",
  ...props
}: EnvironmentVariablesProps) {
  const [revealedIds, setRevealedIds] = useState<string[]>([]);
  const [copiedIds, setCopiedIds] = useState<string[]>([]);
  const [secretModeOverrides, setSecretModeOverrides] = useState<Record<string, boolean>>({});

  const revealedSet = useMemo(() => new Set(revealedIds), [revealedIds]);
  const copiedSet = useMemo(() => new Set(copiedIds), [copiedIds]);

  const toggleReveal = (itemId: string) => {
    setRevealedIds((prev) => (
      prev.includes(itemId) ? prev.filter((item) => item !== itemId) : [...prev, itemId]
    ));
  };

  const toggleSecretMode = (item: EnvironmentVariableItem) => {
    const current = secretModeOverrides[item.id] ?? Boolean(item.maskValue);
    setSecretModeOverrides((prev) => ({ ...prev, [item.id]: !current }));
    if (current) {
      setRevealedIds((prev) => prev.filter((entry) => entry !== item.id));
    }
  };

  const handleCopy = async (index: number) => {
    await onCopy?.(index);
    const itemId = items[index]?.id;
    if (!itemId) return;
    setCopiedIds((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
    window.setTimeout(() => {
      setCopiedIds((prev) => prev.filter((item) => item !== itemId));
    }, 1200);
  };

  return (
    <div className={cn("space-y-4", className)} {...props}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">环境变量</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            这些变量会作为运行时回退值保存，并支持逐条启停。
          </p>
        </div>
        {onAdd ? (
          <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
            新增变量
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => {
            const revealed = revealedSet.has(item.id);
            const copied = copiedSet.has(item.id);
            const secretMode = secretModeOverrides[item.id] ?? Boolean(item.maskValue);
            const inputType = secretMode && !revealed ? "password" : "text";

            return (
              <div
                key={item.id}
                className="rounded-lg border bg-card/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                        {item.key.trim() || "变量名"}
                      </code>
                      {item.required ? (
                        <Badge variant="outline" className="rounded-full text-[11px]">
                          必填
                        </Badge>
                      ) : null}
                      {!item.enabled ? (
                        <Badge variant="secondary" className="rounded-full text-[11px]">
                          已停用
                        </Badge>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant={secretMode ? "secondary" : "ghost"}
                      className="h-8 px-2 text-xs"
                      onClick={() => toggleSecretMode(item)}
                      disabled={disabled || item.disableValueEdit}
                      title={secretMode ? "关闭密码模式" : "开启密码模式"}
                    >
                      {secretMode ? "密码模式" : "普通模式"}
                    </Button>
                    {secretMode ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => toggleReveal(item.id)}
                        disabled={disabled}
                        title={revealed ? "隐藏变量值" : "显示变量值"}
                      >
                        {revealed ? <EyeOffIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => void handleCopy(index)}
                      disabled={disabled}
                      title="复制导出命令"
                    >
                      {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                    </Button>
                    {onRemove ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => onRemove(index)}
                        disabled={disabled}
                        title="删除变量"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_84px]">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      变量名
                    </div>
                    <Input
                      value={item.key}
                      onChange={(event) => onChange?.(index, { key: event.target.value })}
                      placeholder="例如：my_key"
                      className={cn(
                        "h-10 font-mono text-xs",
                        item.keyError ? "border-destructive focus-visible:ring-destructive" : ""
                      )}
                      disabled={disabled}
                    />
                    {item.keyError ? (
                      <div className="text-xs text-destructive">{item.keyError}</div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      变量值
                    </div>
                    <Input
                      type={inputType}
                      value={item.value}
                      onChange={(event) => onChange?.(index, { value: event.target.value })}
                      placeholder="输入变量值"
                      className="h-10 font-mono text-xs"
                      disabled={disabled || item.disableValueEdit}
                    />
                    {item.valueHint ? (
                      <div className="text-xs text-muted-foreground">{item.valueHint}</div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      启用
                    </div>
                    <div className="flex h-10 items-center justify-center rounded-md border bg-background">
                      <Switch
                        checked={item.enabled}
                        onCheckedChange={(checked) => onChange?.(index, { enabled: checked })}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
