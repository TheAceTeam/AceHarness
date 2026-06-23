"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

import { cn } from "@/lib/core/utils";

type Locale = "zh" | "en";

const LOCALE_STORAGE_KEY = "locale";
const languages: Array<{ code: Locale; label: string; flag: string; htmlLang: string }> = [
  { code: "zh", label: "简体中文", flag: "CN", htmlLang: "zh-CN" },
  { code: "en", label: "English", flag: "EN", htmlLang: "en" },
];

function normalizeLocale(value: unknown): Locale {
  return value === "en" ? "en" : "zh";
}

function applyLocale(locale: Locale) {
  localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.documentElement.lang = locale === "en" ? "en" : "zh-CN";
}

export function LanguageSelectorDropdown({ className }: { className?: string }) {
  const [selected, setSelected] = useState(languages[0]);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ left: number; bottom: number; width: number } | null>(null);
  const selectedCode = selected.code;
  const options = useMemo(() => languages, []);

  useEffect(() => {
    const saved = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY) || document.documentElement.lang || "zh");
    const next = options.find((language) => language.code === saved) || options[0];
    applyLocale(next.code);
    setSelected(next);
  }, [options]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (
        dropdownRef.current
        && !dropdownRef.current.contains(target)
        && menuRef.current
        && !menuRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!open) return;

    function updateMenuPosition() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = {
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
        width: Math.max(176, rect.width),
      };
      setMenuPosition((prev) => {
        if (
          prev
          && Math.abs(prev.left - next.left) < 0.5
          && Math.abs(prev.bottom - next.bottom) < 0.5
          && Math.abs(prev.width - next.width) < 0.5
        ) {
          return prev;
        }
        return next;
      });
    }

    function scheduleMenuPositionUpdate() {
      if (frameRef.current !== null) return;
      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        updateMenuPosition();
      });
    }

    updateMenuPosition();
    window.addEventListener("resize", scheduleMenuPositionUpdate);
    window.addEventListener("scroll", scheduleMenuPositionUpdate, true);
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      window.removeEventListener("resize", scheduleMenuPositionUpdate);
      window.removeEventListener("scroll", scheduleMenuPositionUpdate, true);
    };
  }, [open]);

  const selectLocale = async (locale: Locale) => {
    const next = options.find((language) => language.code === locale) || options[0];
    setSelected(next);
    applyLocale(next.code);
    setOpen(false);

    try {
      await fetch("/api/system-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next.code }),
      });
    } catch {}

    window.location.reload();
  };

  return (
    <div className={cn("relative inline-block", className)} ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-center gap-2 rounded-full border px-3 py-1.5 text-sm",
          "border-sidebar-border bg-sidebar-accent text-sidebar-foreground shadow-sm backdrop-blur-md",
          "transition-colors hover:bg-sidebar hover:text-sidebar-foreground"
        )}
      >
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar px-1 text-[10px] font-semibold text-sidebar-foreground">
          {selected.flag}
        </span>
        <span className="min-w-0 flex-1 truncate text-left">{selected.label}</span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </button>

      {open && menuPosition && typeof document !== "undefined" ? createPortal(
        <div
          ref={menuRef}
          style={{
            left: menuPosition.left,
            bottom: menuPosition.bottom,
            width: menuPosition.width,
            zIndex: 2147483647,
          }}
          className={cn(
            "fixed overflow-hidden rounded-xl",
            "border border-sidebar-border bg-sidebar text-sidebar-foreground shadow-lg backdrop-blur-xl",
            "animate-fade-in"
          )}
        >
          {options.map((language) => (
            <button
              key={language.code}
              type="button"
              onClick={() => void selectLocale(language.code)}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                selectedCode === language.code
                  ? "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              )}
            >
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-sidebar px-1 text-[10px] font-semibold text-sidebar-foreground">
                {language.flag}
              </span>
              <span className="flex-1">{language.label}</span>
              {selectedCode === language.code ? <Check className="h-4 w-4 text-sidebar-accent-foreground" /> : null}
            </button>
          ))}
        </div>
      , document.body) : null}
    </div>
  );
}

export const Component = LanguageSelectorDropdown;

export default LanguageSelectorDropdown;
