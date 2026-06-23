"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/core/utils";

export interface AnimatedTabsProps {
  tabs: { label: string; value?: string; disabled?: boolean }[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  tabClassName?: string;
}

export function AnimatedTabs({
  tabs,
  value,
  defaultValue,
  onValueChange,
  className,
  tabClassName,
}: AnimatedTabsProps) {
  const firstValue = tabs[0]?.value || tabs[0]?.label || "";
  const [internalActiveTab, setInternalActiveTab] = useState(defaultValue || firstValue);
  const activeTab = value ?? internalActiveTab;
  const containerRef = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLButtonElement>(null);
  const tabValues = useMemo(() => tabs.map((tab) => tab.value || tab.label).join("\u0000"), [tabs]);

  useEffect(() => {
    if (!tabs.length) return;
    if (tabs.some((tab) => (tab.value || tab.label) === activeTab)) return;
    const next = firstValue;
    if (value === undefined) setInternalActiveTab(next);
    onValueChange?.(next);
  }, [activeTab, firstValue, onValueChange, tabs, tabValues, value]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !activeTab) return;

    const activeTabElement = activeTabRef.current;
    if (!activeTabElement) return;

    const { offsetLeft, offsetWidth } = activeTabElement;
    const clipLeft = offsetLeft + 16;
    const clipRight = offsetLeft + offsetWidth + 16;

    container.style.clipPath = `inset(0 ${Number(
      100 - (clipRight / container.offsetWidth) * 100,
    ).toFixed()}% 0 ${Number(
      (clipLeft / container.offsetWidth) * 100,
    ).toFixed()}% round 17px)`;
  }, [activeTab, tabValues]);

  const selectTab = (next: string) => {
    if (value === undefined) setInternalActiveTab(next);
    onValueChange?.(next);
  };

  if (!tabs.length) return null;

  return (
    <div className={cn("relative flex w-fit flex-col items-center rounded-full border border-primary/10 bg-secondary/50 px-4 py-2", className)}>
      <div
        ref={containerRef}
        className="absolute z-10 w-full overflow-hidden [clip-path:inset(0px_75%_0px_0%_round_17px)] [transition:clip-path_0.25s_ease]"
      >
        <div className="relative flex w-full justify-center bg-primary">
          {tabs.map((tab) => {
            const tabValue = tab.value || tab.label;
            return (
              <button
                key={tabValue}
                type="button"
                onClick={() => !tab.disabled && selectTab(tabValue)}
                className={cn("flex h-8 items-center rounded-full p-3 text-sm font-medium text-primary-foreground", tabClassName)}
                tabIndex={-1}
                disabled={tab.disabled}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="relative flex w-full justify-center">
        {tabs.map(({ label, value: tabValueProp, disabled }) => {
          const tabValue = tabValueProp || label;
          const isActive = activeTab === tabValue;

          return (
            <button
              key={tabValue}
              ref={isActive ? activeTabRef : null}
              type="button"
              onClick={() => !disabled && selectTab(tabValue)}
              className={cn("flex h-8 cursor-pointer items-center rounded-full p-3 text-sm font-medium text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50", tabClassName)}
              disabled={disabled}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default AnimatedTabs;
