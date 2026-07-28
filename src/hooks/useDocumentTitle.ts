import * as React from 'react'

const DEFAULT_TITLE = 'ACEHarness'

function formatTitle(segment?: string | null): string {
  const normalized = segment?.trim()
  return normalized ? `${normalized} · ${DEFAULT_TITLE}` : DEFAULT_TITLE
}

export function getDocumentTitle(segment?: string | null): string {
  return formatTitle(segment)
}

export function useDocumentTitle(segment?: string | null) {
  const title = formatTitle(segment)

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.title = title
  }, [title])
}
