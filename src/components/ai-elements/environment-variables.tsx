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

function maskValue(value: string) {
  if (!value) return "";
  if (value.length <= 8) return "•".repeat(Math.max(4, value.length));
  return `${value.slice(0, 2)}${"•".repeat(Math.min(12, value.length - 4))}${value.slice(-2)}`;
}

export function EnvironmentVariables({
  className,
  items,
  disabled = false,
  onAdd,
  onRemove,
  onChange,
  onCopy,
  emptyMessage = "No environment variables configured.",
  ...props
}: EnvironmentVariablesProps) {
  const [revealedIndexes, setRevealedIndexes] = useState<number[]>([]);
  const [copiedIndexes, setCopiedIndexes] = useState<number[]>([]);

  const revealedSet = useMemo(() => new Set(revealedIndexes), [revealedIndexes]);
  const copiedSet = useMemo(() => new Set(copiedIndexes), [copiedIndexes]);

  const toggleReveal = (index: number) => {
    setRevealedIndexes((prev) => (
      prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]
    ));
  };

  const handleCopy = async (index: number) => {
    await onCopy?.(index);
    setCopiedIndexes((prev) => (prev.includes(index) ? prev : [...prev, index]));
    window.setTimeout(() => {
      setCopiedIndexes((prev) => prev.filter((item) => item !== index));
    }, 1200);
  };

  return (
    <div className={cn("space-y-4", className)} {...props}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold">Environment Variables</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Variables are stored as runtime fallback values and can be toggled per entry.
          </p>
        </div>
        {onAdd ? (
          <Button variant="outline" size="sm" onClick={onAdd} disabled={disabled}>
            Add Variable
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
            const revealed = revealedSet.has(index);
            const copied = copiedSet.has(index);
            const showMaskedValue = Boolean(item.maskValue && !revealed);
            const valueText = showMaskedValue ? maskValue(item.value) : item.value;

            return (
              <div
                key={`${item.key || "env"}-${index}`}
                className="rounded-lg border bg-card/60 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground">
                        {item.key.trim() || "KEY"}
                      </code>
                      {item.required ? (
                        <Badge variant="outline" className="rounded-full text-[11px]">
                          Required
                        </Badge>
                      ) : null}
                      {!item.enabled ? (
                        <Badge variant="secondary" className="rounded-full text-[11px]">
                          Disabled
                        </Badge>
                      ) : null}
                    </div>
                    {item.description ? (
                      <p className="text-sm text-muted-foreground">{item.description}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    {item.maskValue ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        onClick={() => toggleReveal(index)}
                        disabled={disabled}
                        title={revealed ? "Hide value" : "Show value"}
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
                      title="Copy export command"
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
                        title="Remove variable"
                      >
                        <Trash2Icon className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_84px]">
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Key
                    </div>
                    <Input
                      value={item.key}
                      onChange={(event) => onChange?.(index, { key: event.target.value })}
                      placeholder="KEY"
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
                      Value
                    </div>
                    <Input
                      value={valueText}
                      onChange={(event) => onChange?.(index, { value: event.target.value })}
                      placeholder="value"
                      className="h-10 font-mono text-xs"
                      disabled={disabled || item.disableValueEdit || showMaskedValue}
                    />
                    {item.valueHint ? (
                      <div className="text-xs text-muted-foreground">{item.valueHint}</div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Enabled
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
