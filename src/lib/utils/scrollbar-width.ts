/**
 * Calculate and set scrollbar width as CSS variable
 * This prevents layout shift when modals/dropdowns lock body scroll
 */
export function initScrollbarWidth() {
  if (typeof window === 'undefined') return;

  // Calculate scrollbar width
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

  // Set as CSS variable
  document.documentElement.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
}

/**
 * Lock body scroll and compensate for scrollbar width
 */
export function lockBodyScroll() {
  if (typeof window === 'undefined') return;

  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
  document.documentElement.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`);
  document.body.setAttribute('data-scroll-locked', 'true');
}

/**
 * Unlock body scroll
 */
export function unlockBodyScroll() {
  if (typeof window === 'undefined') return;

  document.body.removeAttribute('data-scroll-locked');
  document.documentElement.style.setProperty('--scrollbar-width', '0px');
}
