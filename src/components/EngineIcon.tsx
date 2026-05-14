import type * as React from 'react'
import { cn } from '@/lib/core/utils'
import { getEngineMeta } from '@/lib/core/engine-metadata'

interface EngineIconProps {
  engineId: string
  className?: string
  alt?: string
  decorative?: boolean
}

export function EngineIcon({ engineId, className, alt, decorative = true }: EngineIconProps) {
  const engine = getEngineMeta(engineId)
  if (!engine) return null

  return (
    <img
      src={engine.iconPath}
      alt={decorative ? '' : (alt || engine.name)}
      aria-hidden={decorative ? true : undefined}
      className={cn('shrink-0 object-contain', className)}
    />
  )
}
