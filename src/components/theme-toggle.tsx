"use client"

import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setTheme(resolvedTheme === "dark" ? "light" : "dark")
      }}
    >
      <span className="material-symbols-outlined dark:hidden" style={{ fontSize: '18px' }}>light_mode</span>
      <span className="material-symbols-outlined hidden dark:inline" style={{ fontSize: '18px' }}>dark_mode</span>
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
