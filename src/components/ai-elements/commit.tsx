"use client";

import * as React from "react";
import { Check, ChevronDown, Copy, File as FileIcon, Minus, Plus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/core/utils";

type CommitFileStatusValue = "added" | "modified" | "deleted" | "renamed";

const statusMeta: Record<CommitFileStatusValue, { label: string; className: string }> = {
  added: { label: "A", className: "text-emerald-600 dark:text-emerald-400" },
  modified: { label: "M", className: "text-amber-600 dark:text-amber-400" },
  deleted: { label: "D", className: "text-red-600 dark:text-red-400" },
  renamed: { label: "R", className: "text-sky-600 dark:text-sky-400" },
};

function formatRelativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return date.toLocaleString("zh-CN");
}

export function Commit(props: React.ComponentProps<typeof Collapsible>) {
  return <Collapsible data-slot="commit" {...props} />;
}

export function CommitHeader({ className, children, ...props }: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger asChild {...props}>
      <div
        className={cn(
          "group flex w-full items-center gap-3 rounded-md px-3 py-3 text-left hover:bg-muted/40",
          className,
        )}
      >
        {children}
        <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </div>
    </CollapsibleTrigger>
  );
}

export function CommitAuthor({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("shrink-0", className)} {...props} />;
}

export function CommitAuthorAvatar({
  initials,
  className,
  ...props
}: React.ComponentProps<typeof Avatar> & { initials: string }) {
  return (
    <Avatar className={cn("h-8 w-8 border", className)} {...props}>
      <AvatarFallback className="text-xs">{initials}</AvatarFallback>
    </Avatar>
  );
}

export function CommitInfo({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />;
}

export function CommitMessage({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("block truncate text-sm font-medium text-foreground", className)} {...props} />;
}

export function CommitMetadata({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground", className)} {...props} />;
}

export function CommitHash({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("font-mono", className)} {...props} />;
}

export function CommitSeparator({ className, children = "·", ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-muted-foreground/70", className)} {...props}>{children}</span>;
}

export function CommitTimestamp({
  date,
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLTimeElement> & { date: Date }) {
  return (
    <time
      dateTime={date.toISOString()}
      className={cn(className)}
      {...props}
    >
      {children || formatRelativeTime(date)}
    </time>
  );
}

export function CommitActions({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex shrink-0 items-center gap-1", className)} {...props} />;
}

export function CommitCopyButton({
  hash,
  onCopy,
  onError,
  timeout = 2000,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  hash: string;
  onCopy?: () => void;
  onError?: (error: Error) => void;
  timeout?: number;
}) {
  const [copied, setCopied] = React.useState(false);

  const handleClick = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      onCopy?.();
      window.setTimeout(() => setCopied(false), timeout);
    } catch (error) {
      onError?.(error instanceof Error ? error : new Error("复制失败"));
    }
  }, [hash, onCopy, onError, timeout]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("h-8 w-8", className)}
      onClick={(event) => {
        event.stopPropagation();
        void handleClick();
      }}
      {...props}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
    </Button>
  );
}

export function CommitContent(props: React.ComponentProps<typeof CollapsibleContent>) {
  return <CollapsibleContent data-slot="commit-content" {...props} />;
}

export function CommitFiles({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t", className)} {...props} />;
}

export function CommitFile({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center justify-between gap-3 px-3 py-2 text-sm", className)} {...props} />;
}

export function CommitFileInfo({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-w-0 items-center gap-2", className)} {...props} />;
}

export function CommitFileStatus({
  status,
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { status: unknown }) {
  const normalized = (String(status || "") as CommitFileStatusValue) in statusMeta
    ? (String(status || "") as CommitFileStatusValue)
    : "modified";
  const meta = statusMeta[normalized];
  return (
    <span className={cn("w-4 text-center text-xs font-semibold", meta.className, className)} {...props}>
      {children || meta.label}
    </span>
  );
}

export function CommitFileIcon({ className, ...props }: React.ComponentProps<typeof FileIcon>) {
  return <FileIcon className={cn("size-4 shrink-0 text-muted-foreground", className)} {...props} />;
}

export function CommitFilePath({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("truncate text-sm", className)} {...props} />;
}

export function CommitFileChanges({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center gap-2 text-xs", className)} {...props} />;
}

export function CommitFileAdditions({
  count,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { count: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400", className)} {...props}>
      <Plus className="size-3" />
      {count}
    </span>
  );
}

export function CommitFileDeletions({
  count,
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { count: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-red-600 dark:text-red-400", className)} {...props}>
      <Minus className="size-3" />
      {count}
    </span>
  );
}
