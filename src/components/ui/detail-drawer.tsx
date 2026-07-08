"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/core/utils"
import { Button } from "@/components/ui/button"

const DetailDrawer = DialogPrimitive.Root
const DetailDrawerTrigger = DialogPrimitive.Trigger
const DetailDrawerClose = DialogPrimitive.Close
const DetailDrawerPortal = DialogPrimitive.Portal

type DetailDrawerContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showOverlay?: boolean
  overlayClassName?: string
  widthClassName?: string
}

const DetailDrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-transparent data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DetailDrawerOverlay.displayName = DialogPrimitive.Overlay.displayName

const DetailDrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DetailDrawerContentProps
>(
  (
    {
      className,
      children,
      showOverlay = false,
      overlayClassName,
      widthClassName = "w-[min(440px,calc(100vw-1rem))]",
      ...props
    },
    ref
  ) => (
    <DetailDrawerPortal>
      {showOverlay ? <DetailDrawerOverlay className={overlayClassName} /> : null}
      <DialogPrimitive.Content
        ref={ref}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full flex-col border-l border-border bg-popover shadow-none outline-none",
          "duration-240 ease-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right",
          widthClassName,
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DetailDrawerPortal>
  )
)
DetailDrawerContent.displayName = DialogPrimitive.Content.displayName

const DetailDrawerHeader = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex shrink-0 items-start justify-between gap-3 border-b border-border bg-card px-5 py-4", className)}
    {...props}
  >
    <div className="min-w-0 flex-1">{children}</div>
    <DetailDrawerClose asChild>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Close drawer">
        <X className="h-4 w-4" />
      </Button>
    </DetailDrawerClose>
  </div>
)
DetailDrawerHeader.displayName = "DetailDrawerHeader"

const DetailDrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("truncate text-base font-semibold leading-6 text-foreground", className)}
    {...props}
  />
))
DetailDrawerTitle.displayName = DialogPrimitive.Title.displayName

const DetailDrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("mt-1 text-sm leading-5 text-muted-foreground", className)}
    {...props}
  />
))
DetailDrawerDescription.displayName = DialogPrimitive.Description.displayName

const DetailDrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("min-h-0 flex-1 overflow-y-auto bg-popover px-5 py-4", className)} {...props} />
)
DetailDrawerBody.displayName = "DetailDrawerBody"

const DetailDrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("flex shrink-0 items-center justify-end gap-2 border-t border-border bg-card px-5 py-4", className)}
    {...props}
  />
)
DetailDrawerFooter.displayName = "DetailDrawerFooter"

export {
  DetailDrawer,
  DetailDrawerTrigger,
  DetailDrawerClose,
  DetailDrawerContent,
  DetailDrawerHeader,
  DetailDrawerTitle,
  DetailDrawerDescription,
  DetailDrawerBody,
  DetailDrawerFooter,
}
