"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "@/lib/core/utils"

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-radix-dialog-overlay=""
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      "[body[data-rich-text-editor-fullscreen-open=true]_&]:pointer-events-none",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

type DialogContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  resizableHeight?: boolean
  defaultHeight?: number
  minHeight?: number
  maxHeight?: number
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, resizableHeight = false, defaultHeight, minHeight = 280, maxHeight, style, ...props }, ref) => {
  const [height, setHeight] = React.useState<number | null>(defaultHeight ?? null)
  const startRef = React.useRef<{ y: number; height: number } | null>(null)

  const resolvedMaxHeight = React.useMemo(() => {
    if (typeof window === "undefined") return maxHeight ?? 900
    return maxHeight ?? Math.max(360, Math.floor(window.innerHeight * 0.9))
  }, [maxHeight])

  React.useEffect(() => {
    if (!resizableHeight || !defaultHeight) return
    setHeight(defaultHeight)
  }, [defaultHeight, resizableHeight])

  React.useEffect(() => {
    if (!resizableHeight) return
    const handleMove = (event: PointerEvent) => {
      if (!startRef.current) return
      const nextHeight = startRef.current.height + (event.clientY - startRef.current.y)
      setHeight(Math.min(resolvedMaxHeight, Math.max(minHeight, nextHeight)))
    }
    const handleUp = () => {
      startRef.current = null
      document.body.style.userSelect = ""
      document.body.style.cursor = ""
    }
    window.addEventListener("pointermove", handleMove)
    window.addEventListener("pointerup", handleUp)
    return () => {
      window.removeEventListener("pointermove", handleMove)
      window.removeEventListener("pointerup", handleUp)
    }
  }, [minHeight, resizableHeight, resolvedMaxHeight])

  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          resizableHeight && "overflow-hidden",
          className
        )}
        style={{
          ...style,
          ...(height ? { height: `${height}px`, maxHeight: `${resolvedMaxHeight}px` } : {}),
        }}
        {...props}
      >
        {children}
        {resizableHeight ? (
          <div
            role="separator"
            aria-orientation="horizontal"
            className="absolute inset-x-0 bottom-0 flex h-4 cursor-ns-resize items-end justify-center"
            onPointerDown={(event) => {
              startRef.current = { y: event.clientY, height: height ?? (event.currentTarget.parentElement?.getBoundingClientRect().height || minHeight) }
              document.body.style.userSelect = "none"
              document.body.style.cursor = "ns-resize"
            }}
          >
            <div className="mb-1 h-1.5 w-20 rounded-full bg-border/80 transition-colors hover:bg-border" />
          </div>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}
