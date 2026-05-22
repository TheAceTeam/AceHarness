"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/core/utils";
import { CheckIcon, CopyIcon } from "lucide-react";
import type { ComponentProps, HTMLAttributes } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface ArtifactContextValue {
  value: string;
}

const ArtifactContext = createContext<ArtifactContextValue>({ value: "" });

export type ArtifactProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
};

export function Artifact({ value, className, children, ...props }: ArtifactProps) {
  const contextValue = useMemo(() => ({ value }), [value]);
  return (
    <ArtifactContext.Provider value={contextValue}>
      <div
        className={cn("overflow-hidden rounded-md border bg-background text-foreground", className)}
        {...props}
      >
        {children}
      </div>
    </ArtifactContext.Provider>
  );
}

export type ArtifactHeaderProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactHeader({ className, ...props }: ArtifactHeaderProps) {
  return (
    <div
      className={cn("flex items-center justify-between border-b bg-muted/70 px-3 py-2 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export type ArtifactTitleProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactTitle({ className, ...props }: ArtifactTitleProps) {
  return <div className={cn("flex items-center gap-2 font-mono", className)} {...props} />;
}

export type ArtifactActionsProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactActions({ className, ...props }: ArtifactActionsProps) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />;
}

export type ArtifactContentProps = HTMLAttributes<HTMLDivElement>;

export function ArtifactContent({ className, ...props }: ArtifactContentProps) {
  return <div className={cn("relative", className)} {...props} />;
}

export type ArtifactCopyButtonProps = ComponentProps<typeof Button> & {
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
};

export function ArtifactCopyButton({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: ArtifactCopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<number>(0);
  const { value } = useContext(ArtifactContext);

  const copyToClipboard = useCallback(async () => {
    if (typeof window === "undefined" || !navigator?.clipboard?.writeText) {
      onError?.(new Error("Clipboard API not available"));
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setIsCopied(true);
      onCopy?.();
      timeoutRef.current = window.setTimeout(() => setIsCopied(false), timeout);
    } catch (error) {
      onError?.(error as Error);
    }
  }, [onCopy, onError, timeout, value]);

  useEffect(() => () => {
    window.clearTimeout(timeoutRef.current);
  }, []);

  const Icon = isCopied ? CheckIcon : CopyIcon;

  return (
    <Button
      className={cn("size-7 shrink-0 text-muted-foreground hover:text-foreground", className)}
      onClick={copyToClipboard}
      size="icon"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <Icon size={14} />}
    </Button>
  );
}
