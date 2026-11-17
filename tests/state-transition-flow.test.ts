import { describe, expect, test } from 'vitest';
import { getTransitionHighlightDashes } from '@/components/state-transition-flow';

describe('state transition highlights', () => {
  test('advance by the same distance on short and long edges', () => {
    const head = (dashArray: string) => {
      const [, gap, highlight] = dashArray.split(' ').map(Number);
      return gap + highlight;
    };

    const shortAdvance = head(getTransitionHighlightDashes(115, 0, 160))
      - head(getTransitionHighlightDashes(80, 0, 160));
    const longAdvance = head(getTransitionHighlightDashes(265, 160, 400))
      - head(getTransitionHighlightDashes(230, 160, 400));

    expect(shortAdvance).toBe(35);
    expect(longAdvance).toBe(shortAdvance);
  });

  test('keeps the highlight continuous when the head enters the next edge', () => {
    expect(getTransitionHighlightDashes(159, 160, 400)).toBe('');
    expect(getTransitionHighlightDashes(178, 0, 160)).toBe('0 138 22 1');
    expect(getTransitionHighlightDashes(178, 160, 400)).toBe('0 0 18 383');
  });

  test('can draw two pulses on one edge longer than the pulse spacing', () => {
    expect(getTransitionHighlightDashes(1700, 0, 2400)).toBe('0 160 40 1460 40 701');
  });
});
