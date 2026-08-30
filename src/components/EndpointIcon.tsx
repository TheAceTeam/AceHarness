import type * as React from 'react'
import { Globe } from 'lucide-react'
import { cn } from '@/lib/core/utils'

interface EndpointMeta {
  id: string
  name: string
  iconPath?: string
  hasWordmark?: boolean
}

const ENDPOINT_META: Record<string, EndpointMeta> = {
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    iconPath: '/protocols/anthropic.svg',
    hasWordmark: true,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    iconPath: '/protocols/openai.svg',
    hasWordmark: true,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    iconPath: '/engines/deepseek-harness.svg',
  },
  cangjie: {
    id: 'cangjie',
    name: 'Cangjie',
  },
  mixed: {
    id: 'mixed',
    name: 'Mixed',
  },
  unknown: {
    id: 'unknown',
    name: 'Unknown',
  },
}

export function getEndpointMeta(endpoint?: string | null): EndpointMeta | undefined {
  if (!endpoint) return undefined
  return ENDPOINT_META[String(endpoint).trim().toLowerCase()]
}

export function getEndpointDisplayName(endpoint?: string | null): string {
  if (!endpoint) return 'Unknown'
  return getEndpointMeta(endpoint)?.name || String(endpoint)
}

export function endpointHasWordmark(endpoint?: string | null): boolean {
  return Boolean(getEndpointMeta(endpoint)?.hasWordmark)
}

interface EndpointIconProps {
  endpoint?: string | null
  className?: string
  alt?: string
  decorative?: boolean
  fallbackClassName?: string
  mode?: 'mark' | 'logo'
}

export function EndpointIcon({
  endpoint,
  className,
  alt,
  decorative = true,
  fallbackClassName,
  mode = 'mark',
}: EndpointIconProps) {
  const meta = getEndpointMeta(endpoint)
  if (meta?.iconPath) {
    const image = (
      <img
        src={meta.iconPath}
        alt={decorative ? '' : (alt || meta.name)}
        aria-hidden={decorative ? true : undefined}
        className={cn(
          mode === 'mark'
            ? 'h-full w-auto max-w-none object-cover object-left'
            : 'h-full w-auto object-contain',
          meta.id === 'openai' || meta.id === 'anthropic' ? 'dark:invert' : undefined
        )}
      />
    )

    if (mode === 'mark') {
      return (
        <span className={cn('inline-flex shrink-0 items-center overflow-hidden', className)}>
          {image}
        </span>
      )
    }

    return (
      <span className={cn('inline-flex shrink-0 items-center', className)}>
        {image}
      </span>
    )
  }

  return (
    <Globe
      aria-hidden={decorative ? true : undefined}
      className={cn('shrink-0', className, fallbackClassName)}
    />
  )
}
