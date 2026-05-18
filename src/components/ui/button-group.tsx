"use client"

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cn } from "@/lib/core/utils"

const ButtonGroup = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    orientation?: "horizontal" | "vertical"
  }
>(({ className, orientation = "horizontal", ...props }, ref) => (
  <div
    ref={ref}
    role="group"
    data-orientation={orientation}
    className={cn(
      "flex",
      orientation === "horizontal"
        ? "flex-row [&>*:not(:first-child):not(:last-child)]:!rounded-none [&>*:first-child]:!rounded-r-none [&>*:last-child]:!rounded-l-none [&>*:not(:first-child)]:-ml-px"
        : "flex-col [&>*:not(:first-child):not(:last-child)]:!rounded-none [&>*:first-child]:!rounded-b-none [&>*:last-child]:!rounded-t-none [&>*:not(:first-child)]:-mt-px",
      className
    )}
    {...props}
  />
))
ButtonGroup.displayName = "ButtonGroup"

const ButtonGroupSeparator = React.forwardRef<
  HTMLDivElement,
  React.ComponentProps<"div"> & {
    orientation?: "horizontal" | "vertical"
  }
>(({ className, orientation = "vertical", ...props }, ref) => (
  <div
    ref={ref}
    role="separator"
    aria-orientation={orientation}
    className={cn(
      "bg-border",
      orientation === "vertical" ? "w-px self-stretch" : "h-px self-stretch",
      className
    )}
    {...props}
  />
))
ButtonGroupSeparator.displayName = "ButtonGroupSeparator"

const ButtonGroupText = React.forwardRef<
  HTMLSpanElement,
  React.ComponentProps<"span"> & { asChild?: boolean }
>(({ className, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "span"
  return (
    <Comp
      ref={ref}
      className={cn(
        "flex items-center px-3 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  )
})
ButtonGroupText.displayName = "ButtonGroupText"

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText }
