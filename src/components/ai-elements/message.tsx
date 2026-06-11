// src/components/ai-elements/message.tsx
"use client";

import React from "react";
import { cn } from "@/lib/core/utils";

/* ------------------------------------------------------------------ */
/*  Message                                                           */
/* ------------------------------------------------------------------ */

export interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Who sent the message — controls alignment and styling. */
  from: "user" | "assistant";
  children: React.ReactNode;
}

/**
 * Top-level wrapper for a single chat message.
 *
 * - `from="assistant"` → left-aligned, `is-assistant` class applied.
 * - `from="user"`      → right-aligned, `is-user` class applied.
 */
export function Message({
  from,
  className,
  children,
  ...props
}: MessageProps) {
  const isAssistant = from === "assistant";

  return (
    <div
      className={cn(
        "group flex",
        isAssistant ? "is-assistant items-start gap-2" : "is-user justify-end",
        className,
      )}
      data-message-from={from}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MessageContent                                                    */
/* ------------------------------------------------------------------ */

export interface MessageContentProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Container for the message body (text bubble, cards, metadata, etc.).
 * Typically used inside `<Message>`.
 */
export function MessageContent({
  className,
  children,
  ...props
}: MessageContentProps) {
  return (
    <div
      className={cn("max-w-[85%] min-w-0 space-y-1", className)}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MessageActions                                                    */
/* ------------------------------------------------------------------ */

export interface MessageActionsProps
  extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

/**
 * Horizontal row of action buttons that appears on hover.
 * Applies `opacity-0 group-hover:opacity-100` by default so it reveals
 * when the parent `<Message>` (which has the `group` class) is hovered.
 */
export function MessageActions({
  className,
  children,
  ...props
}: MessageActionsProps) {
  return (
    <div
      className={cn(
        "mt-1 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MessageAction                                                     */
/* ------------------------------------------------------------------ */

export interface MessageActionProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible label shown as tooltip. */
  label: string;
  /** Visual variant. `"danger"` turns the hover state red. */
  variant?: "default" | "danger";
  children: React.ReactNode;
}

/**
 * A single icon-button inside `<MessageActions>`.
 */
export function MessageAction({
  label,
  variant = "default",
  className,
  children,
  ...props
}: MessageActionProps) {
  return (
    <button
      title={label}
      className={cn(
        "rounded p-1 text-muted-foreground",
        variant === "danger"
          ? "text-destructive hover:bg-destructive/20 hover:text-destructive"
          : "hover:bg-accent hover:text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
