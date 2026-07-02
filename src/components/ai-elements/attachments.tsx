"use client";

import type { FileUIPart } from "ai";
import { FileIcon, ImageIcon, Loader2Icon, XIcon } from "lucide-react";
import type { ComponentProps } from "react";
import { cn } from "@/lib/core/utils";

export type AttachmentData = FileUIPart & {
  id?: string;
  size?: number;
  status?: "uploading" | "uploaded" | "error";
};

export type AttachmentsProps = ComponentProps<"div">;

export const Attachments = ({ className, ...props }: AttachmentsProps) => (
  <div className={cn("flex flex-wrap gap-2", className)} {...props} />
);

export type AttachmentProps = ComponentProps<"div"> & {
  data: AttachmentData;
  onRemove?: () => void;
};

export const Attachment = ({ data, onRemove, className, children, ...props }: AttachmentProps) => (
  <div
    className={cn(
      "group flex max-w-full items-center gap-2 rounded-xl border border-border/70 bg-muted/45 px-2.5 py-2 text-sm text-foreground",
      props.onClick && "cursor-pointer transition-colors hover:bg-muted/70",
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <AttachmentPreview data={data} />
        <AttachmentInfo data={data} />
        {onRemove ? (
          <AttachmentRemove
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            disabled={data.status === "uploading"}
          />
        ) : null}
      </>
    )}
  </div>
);

export type AttachmentPreviewProps = ComponentProps<"span"> & {
  data: AttachmentData;
};

export const AttachmentPreview = ({ data, className, ...props }: AttachmentPreviewProps) => {
  const isImage = data.mediaType?.startsWith("image/") && data.url;
  return (
    <span className={cn("flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-background text-muted-foreground", className)} {...props}>
      {data.status === "uploading" ? (
        <Loader2Icon className="size-4 animate-spin" />
      ) : isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={data.url} alt={data.filename || "attachment"} className="size-full object-cover" />
      ) : data.mediaType?.startsWith("image/") ? (
        <ImageIcon className="size-4" />
      ) : (
        <FileIcon className="size-4" />
      )}
    </span>
  );
};

export type AttachmentInfoProps = ComponentProps<"span"> & {
  data: AttachmentData;
};

export const AttachmentInfo = ({ data, className, ...props }: AttachmentInfoProps) => (
  <span className={cn("min-w-0 flex-1", className)} {...props}>
    <span className="block truncate font-medium">{data.filename || "附件"}</span>
    <span className="block truncate text-xs text-muted-foreground">
      {[data.mediaType, formatAttachmentSize(data.size)].filter(Boolean).join(" · ") || data.url}
    </span>
  </span>
);

export type AttachmentRemoveProps = ComponentProps<"button">;

export const AttachmentRemove = ({ className, children, ...props }: AttachmentRemoveProps) => (
  <button
    type="button"
    className={cn(
      "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
      className
    )}
    {...props}
  >
    {children ?? <XIcon className="size-4" />}
  </button>
);

function formatAttachmentSize(bytes?: number): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}
