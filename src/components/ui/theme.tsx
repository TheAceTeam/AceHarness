"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/core/utils";

export type ThemeName = "light" | "dark" | "system";
export type ThemeToggleVariant = "tabs";
export type ThemeToggleSize = "sm" | "md" | "lg";

type ThemeToggleProps = {
  variant?: ThemeToggleVariant;
  size?: ThemeToggleSize;
  showLabel?: boolean;
  themes?: ThemeName[];
  className?: string;
};

const themeIcons = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

const themeLabels: Record<ThemeName, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function Theme({
  variant = "tabs",
  size = "md",
  showLabel = false,
  themes = ["light", "dark", "system"],
  className,
}: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted || variant !== "tabs") return null;

  return (
    <Tabs value={theme || "system"} onValueChange={setTheme} className={cn(className)}>
      <TabsList
        className={cn(
          "inline-flex items-center rounded-full border border-sidebar-border/70 bg-sidebar/80 p-1 text-sidebar-foreground",
          size === "sm" && "h-8",
          size === "md" && "h-10",
          size === "lg" && "h-12"
        )}
      >
        {themes.map((themeOption) => {
          const Icon = themeIcons[themeOption];
          const isSelected = theme === themeOption;

          return (
            <TabsTrigger
              key={themeOption}
              value={themeOption}
              className={cn(
                "relative inline-flex items-center justify-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-sidebar-foreground/70 transition-all hover:bg-sidebar hover:text-sidebar-foreground data-[state=active]:bg-transparent data-[state=active]:text-sidebar-foreground data-[state=active]:shadow-none",
                size === "sm" && "h-6 px-2",
                size === "md" && "h-7 px-3",
                size === "lg" && "h-8 px-4",
                isSelected && "text-sidebar-foreground"
              )}
              title={themeLabels[themeOption]}
            >
              {isSelected ? (
              <motion.div
                layoutId="dashboard-theme-tabs-bg"
                  className="absolute inset-0 rounded-full border border-sidebar-border/70 bg-sidebar-accent"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              ) : null}
              <span className="relative z-10 flex items-center gap-1">
                <Icon size={size === "sm" ? 12 : size === "md" ? 14 : 16} />
                {showLabel ? <span>{themeLabels[themeOption]}</span> : null}
              </span>
            </TabsTrigger>
          );
        })}
      </TabsList>
    </Tabs>
  );
}
