import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/core/utils"

const statusPillVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium leading-none",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300",
        success: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
        warning: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
        info: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
        danger: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
        accent: "border-primary/20 bg-accent text-accent-foreground dark:border-violet-900 dark:bg-violet-950/50 dark:text-violet-300",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  }
)

const statusDotVariants = cva("h-1.5 w-1.5 shrink-0 rounded-full", {
  variants: {
    tone: {
      neutral: "bg-muted-foreground",
      success: "bg-emerald-500",
      warning: "bg-amber-500",
      info: "bg-sky-500",
      danger: "bg-red-500",
      accent: "bg-violet-500",
    },
  },
  defaultVariants: {
    tone: "neutral",
  },
})

type StatusPillProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof statusPillVariants> & {
    dot?: boolean
  }

function StatusPill({ tone, dot = true, className, children, ...props }: StatusPillProps) {
  return (
    <span className={cn(statusPillVariants({ tone }), className)} {...props}>
      {dot ? <span className={statusDotVariants({ tone })} /> : null}
      {children}
    </span>
  )
}

export { StatusPill, statusPillVariants }
export type { StatusPillProps }
