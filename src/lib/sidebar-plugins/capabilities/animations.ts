/**
 * Animations Capability Implementation
 *
 * Controls phase transition banners and seat animations.
 */

import type { AnimationsCapability } from './types';

export function createAnimationsCapability(
  showBanner: (text: string, durationMs?: number) => void,
  triggerSeatAnim: (seatId: string, type: 'fall' | 'disconnect' | 'fadeIn') => void,
): AnimationsCapability {
  return {
    showPhaseBanner(text: string, durationMs?: number) {
      showBanner(text, durationMs);
    },
    triggerSeatAnimation(seatId: string, type: 'fall' | 'disconnect' | 'fadeIn') {
      triggerSeatAnim(seatId, type);
    },
  };
}
