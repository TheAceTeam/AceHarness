"use client";

import { Theme } from "@/components/ui/theme";
import { cn } from "@/lib/core/utils";

export function ThemeTabs({ className, showLabel = false }: { className?: string; showLabel?: boolean }) {
  return (
    <div className={cn("flex items-center", className)}>
      <Theme
        variant="tabs"
        size="sm"
        showLabel={showLabel}
        themes={["light", "dark", "system"]}
      />
    </div>
  );
}

export const Component = ThemeTabs;

export default ThemeTabs;
