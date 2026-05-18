/**
 * Roundtable Capability Implementation
 *
 * Manages circular seat layout data, speaker state, and animations.
 */

import type { RoundtableCapability, RoundtableSeat } from './types';

export function createRoundtableCapability(
  setSeatsData: (seats: RoundtableSeat[]) => void,
  setSpeakerId: (id: string | null) => void,
  triggerElimination: (ids: string[]) => void,
  showBannerFn: (text: string, durationMs?: number) => void,
  getSelectedSeat: () => string | null,
  onSeatSelect: (cb: (seatId: string) => void) => () => void,
): RoundtableCapability {
  return {
    setSeats(seats: RoundtableSeat[]) {
      setSeatsData(seats);
    },
    setSpeaker(seatId: string | null) {
      setSpeakerId(seatId);
    },
    eliminate(seatIds: string[]) {
      triggerElimination(seatIds);
    },
    showBanner(text: string, durationMs?: number) {
      showBannerFn(text, durationMs);
    },
    getSelected() {
      return getSelectedSeat();
    },
    onSelect(cb: (seatId: string) => void) {
      return onSeatSelect(cb);
    },
  };
}
