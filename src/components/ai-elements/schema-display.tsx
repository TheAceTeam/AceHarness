"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/core/utils";
import { BracesIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type SchemaDisplayField = {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
  children?: SchemaDisplayField[];
};

export type SchemaDisplaySchema = {
  type: "object" | "scalar";
  label?: string;
  raw?: string;
  fields?: SchemaDisplayField[];
};

type SchemaDisplayProps = ComponentProps<"div"> & {
  title?: string;
  schema: SchemaDisplaySchema;
  emptyLabel?: string;
};

function SchemaFieldRow({
  field,
  depth = 0,
}: {
  field: SchemaDisplayField;
  depth?: number;
}) {
  return (
    <div className="space-y-2">
      <div
        className="grid gap-2 rounded-md border border-border/50 bg-background/70 px-3 py-2.5 md:grid-cols-[minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]"
        style={{ marginLeft: depth * 12 }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
              {field.name}
            </code>
            <Badge variant={field.required ? "default" : "secondary"} className="rounded-full text-[10px]">
              {field.required ? "Required" : "Optional"}
            </Badge>
          </div>
        </div>
        <div className="min-w-0">
          <code className="break-all text-[11px] text-primary">{field.type}</code>
        </div>
        <div className="min-w-0 text-xs text-muted-foreground">
          {field.description || " "}
        </div>
      </div>

      {field.children?.length ? (
        <div className="space-y-2">
          {field.children.map((child) => (
            <SchemaFieldRow key={`${field.name}.${child.name}`} field={child} depth={depth + 1} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function SchemaDisplay({
  className,
  title,
  schema,
  emptyLabel = "No schema",
  ...props
}: SchemaDisplayProps) {
  const isObject = schema.type === "object" && Array.isArray(schema.fields) && schema.fields.length > 0;

  return (
    <div className={cn("rounded-xl border border-border/50 bg-card/50", className)} {...props}>
      {title ? (
        <div className="flex items-center gap-2 border-b border-border/30 px-4 py-3">
          <BracesIcon className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-medium">{title}</div>
        </div>
      ) : null}

      <div className="space-y-3 p-4">
        {isObject ? (
          <>
            <div className="hidden gap-2 px-3 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1.3fr)]">
              <div>Field</div>
              <div>Type</div>
              <div>Notes</div>
            </div>
            <div className="space-y-2">
              {schema.fields!.map((field) => (
                <SchemaFieldRow key={field.name} field={field} />
              ))}
            </div>
          </>
        ) : (
          <div className="rounded-md bg-muted/50 px-3 py-2 font-mono text-xs text-foreground">
            {schema.raw || emptyLabel}
          </div>
        )}
      </div>
    </div>
  );
}
