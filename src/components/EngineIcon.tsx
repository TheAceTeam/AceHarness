import type * as React from 'react'
import { cn } from '@/lib/core/utils'
import { getEngineMeta } from '@/lib/core/engine-metadata'
import { AGENT_ICON_PATHS } from '@/lib/runtime-agent/agent-icons'
import { getBuiltinAgentDefinition } from '@/lib/runtime-agent/agent-registry'

interface EngineIconProps {
  engineId: string
  iconPath?: string
  className?: string
  alt?: string
  decorative?: boolean
}

export function EngineIcon({ engineId, iconPath, className, alt, decorative = true }: EngineIconProps) {
  const engine = getEngineMeta(engineId)
  const builtinAgent = engine ? undefined : getBuiltinAgentDefinition(engineId)
  const resolvedIconPath = iconPath || engine?.iconPath || builtinAgent?.iconPath || AGENT_ICON_PATHS.genericProvider
  const resolvedName = engine?.name || builtinAgent?.displayName || engineId

  return (
    <img
      src={resolvedIconPath}
      alt={decorative ? '' : (alt || resolvedName)}
      aria-hidden={decorative ? true : undefined}
      className={cn('shrink-0 object-contain', className)}
    />
  )
}
