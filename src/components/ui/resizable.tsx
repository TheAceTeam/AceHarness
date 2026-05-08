"use client"

import * as React from "react"
import { useRef, useEffect } from "react"
import { GripVertical } from "lucide-react"
import { Group, Panel, Separator } from "react-resizable-panels"
import type { PanelImperativeHandle } from "react-resizable-panels"
import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: any) => (
  <Group
    className={cn(className)}
    {...props}
  />
)

const ResizablePanel = (props: any) => <Panel {...props} />

function HandleButton({ onClickHandle, handleIcon }: { onClickHandle?: () => void; handleIcon?: React.ReactNode }) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const stop = (e: Event) => {
      e.stopPropagation()
      e.stopImmediatePropagation()
    }
    // Capture phase to intercept before the library's listeners
    el.addEventListener('pointerdown', stop, true)
    el.addEventListener('pointermove', stop, true)
    el.addEventListener('pointerover', stop, true)
    return () => {
      el.removeEventListener('pointerdown', stop, true)
      el.removeEventListener('pointermove', stop, true)
      el.removeEventListener('pointerover', stop, true)
    }
  }, [])

  return (
    <button
      ref={ref}
      type="button"
      data-resize-btn=""
      className="z-10 flex h-6 w-3 items-center justify-center rounded-sm border bg-border hover:bg-accent transition-colors relative"
      onClick={(e) => {
        e.stopPropagation()
        onClickHandle?.()
      }}
    >
      {handleIcon ?? <GripVertical className="h-3 w-3" />}
    </button>
  )
}

const ResizableHandle = ({
  withHandle,
  className,
  onClickHandle,
  handleIcon,
  collapsed,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
  onClickHandle?: () => void
  handleIcon?: React.ReactNode
  collapsed?: boolean
}) => (
  <Separator
    className={cn(
      "relative flex items-center justify-center bg-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1",
      "data-[panel-group-direction=horizontal]:w-px data-[panel-group-direction=horizontal]:after:absolute data-[panel-group-direction=horizontal]:after:inset-y-0 data-[panel-group-direction=horizontal]:after:left-1/2 data-[panel-group-direction=horizontal]:after:w-1 data-[panel-group-direction=horizontal]:after:-translate-x-1/2",
      "data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:absolute data-[panel-group-direction=vertical]:after:inset-x-0 data-[panel-group-direction=vertical]:after:top-1/2 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:-translate-y-1/2",
      collapsed ? "data-[panel-group-direction=horizontal]:w-3 data-[panel-group-direction=vertical]:h-3" : "",
      className
    )}
    {...props}
  >
    {withHandle && (
      <HandleButton onClickHandle={onClickHandle} handleIcon={handleIcon} />
    )}
  </Separator>
)

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
export type { PanelImperativeHandle as ImperativePanelHandle }
