/**
 * Breakpoint Resume Capability Implementation
 *
 * Manages breakpoint state for failure recovery and step resumption.
 */

import type { BreakpointResumeCapability, BreakpointData } from './types';

export function createBreakpointResumeCapability(
  getBreakpoint: () => BreakpointData | null,
  setBreakpoint: (bp: BreakpointData | null) => void,
): BreakpointResumeCapability {
  return {
    set(data: BreakpointData) {
      setBreakpoint(data);
    },
    get() {
      return getBreakpoint();
    },
    clear() {
      setBreakpoint(null);
    },
    shouldSkip(stepId: string, stepOrder: string[]): boolean {
      const bp = getBreakpoint();
      if (!bp?.resumeFrom) return false;
      const resumeIndex = stepOrder.indexOf(bp.resumeFrom);
      const currentIndex = stepOrder.indexOf(stepId);
      if (resumeIndex < 0 || currentIndex < 0) return false;
      return currentIndex < resumeIndex;
    },
  };
}
