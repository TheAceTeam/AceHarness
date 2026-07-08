"use client"

import * as React from "react"
import { cn } from "@/lib/core/utils"

type FormSectionProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}

function FormSection({ title, description, actions, className, children, ...props }: FormSectionProps) {
  return (
    <section className={cn("grid gap-4 border-b border-border py-5 last:border-b-0", className)} {...props}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description ? (
            <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="grid gap-4">{children}</div>
    </section>
  )
}

type FormFieldProps = React.HTMLAttributes<HTMLDivElement> & {
  label: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  control: React.ReactNode
}

function FormField({ label, description, error, required, control, className, ...props }: FormFieldProps) {
  return (
    <div className={cn("grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)] sm:items-start", className)} {...props}>
      <div className="min-w-0 pt-2">
        <div className="text-sm font-medium text-foreground">
          {label}
          {required ? <span className="ml-1 text-destructive">*</span> : null}
        </div>
        {description ? (
          <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>
        ) : null}
      </div>
      <div className="min-w-0">
        {control}
        {error ? <div className="mt-1.5 text-xs leading-5 text-destructive">{error}</div> : null}
      </div>
    </div>
  )
}

export { FormSection, FormField }
export type { FormSectionProps, FormFieldProps }
